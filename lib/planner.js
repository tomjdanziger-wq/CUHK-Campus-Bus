/* ---------------------------------------------------------------------------
 * planner.js — find and rank journey options.
 *
 * Origin and destination are arbitrary {lat, lng, elevation} coordinates. They
 * may come from GPS, a search result or a tapped pin; the logic does not care.
 *
 * The search is deliberately brute force. With ~16 stops and ~6 routes the
 * whole space is a few thousand combinations, which is nothing. Do not
 * optimise this into something clever and unreadable.
 *
 *   for each stop S within walking distance of the origin
 *     for each route R serving S
 *       for each stop T later on R, within walking distance of the destination
 *         total = walk(O→S) + wait for next departure + ride(S→T) + walk(T→D)
 *
 * Plus the direct walk, always, with no bus at all.
 *
 * SINGLE-ROUTE ONLY. Transfers between shuttle routes are out of scope for v1
 * (see README for why that is defensible on this campus).
 * ------------------------------------------------------------------------- */

(function (root) {
  'use strict';

  var geo = root.CUHK.geo;

  var DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  // Two options within this many minutes of each other are treated as a tie.
  var TIE_EPSILON_MINUTES = 1;

  // ---------------------------------------------------------------------
  // Time helpers. Everything internal is "minutes since local midnight".
  // ---------------------------------------------------------------------

  function parseHHMM(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
    if (!m) return null;
    return (+m[1]) * 60 + (+m[2]);
  }

  function formatHHMM(minutes) {
    var m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  }

  /** Does `route.runsOn` include this weekday? */
  function runsToday(route, date) {
    var day = DAY_KEYS[date.getDay()];
    var pattern = (route.runsOn || 'daily').toLowerCase();

    if (pattern === 'daily') return true;
    if (pattern === 'mon-fri') return day !== 'sat' && day !== 'sun';
    if (pattern === 'mon-sat') return day !== 'sun';
    if (pattern === 'sun-ph') return day === 'sun';
    if (pattern === 'sat') return day === 'sat';
    // Fall back to a comma list, e.g. "mon,wed,fri".
    return pattern.split(/[,\s]+/).indexOf(day) !== -1;
  }

  /**
   * Scheduled departures from stop index `stopIndex` on `route`, at or after
   * `fromMinutes`, within the look-ahead window.
   *
   * `departureMinutes` are minutes past the hour at the FIRST stop, bounded by
   * firstDeparture/lastDeparture. A departure from a later stop is offset by
   * the cumulative ride time to that stop.
   */
  function departuresFrom(route, stopIndex, fromMinutes, stopsById, cfg) {
    var first = parseHHMM(route.firstDeparture);
    var last = parseHHMM(route.lastDeparture);
    if (first === null || last === null) return [];

    var offset = stopIndex > 0
      ? geo.ride(route, 0, stopIndex, stopsById, cfg).minutes
      : 0;

    var horizon = fromMinutes + cfg.search.lookAheadMinutes;
    var out = [];

    // Walk the hours the timetable could plausibly cover.
    var startHour = Math.max(0, Math.floor((first) / 60));
    var endHour = Math.min(23, Math.ceil((last + offset) / 60));

    for (var hour = startHour; hour <= endHour; hour++) {
      for (var i = 0; i < route.departureMinutes.length; i++) {
        var atFirstStop = hour * 60 + route.departureMinutes[i];
        if (atFirstStop < first || atFirstStop > last) continue;

        var atThisStop = atFirstStop + offset;
        if (atThisStop < fromMinutes - 0.001) continue;
        if (atThisStop > horizon) continue;
        out.push(atThisStop);
      }
    }

    out.sort(function (a, b) { return a - b; });
    return out;
  }

  // ---------------------------------------------------------------------
  // Peak-period capacity warning. Static text — we have no occupancy data.
  // ---------------------------------------------------------------------

  function peakWarning(atMinutes, date, cfg) {
    var day = DAY_KEYS[date.getDay()];
    for (var i = 0; i < cfg.peakPeriods.length; i++) {
      var p = cfg.peakPeriods[i];
      var start = parseHHMM(p.start), end = parseHHMM(p.end);
      if (start === null || end === null) continue;
      if (atMinutes < start || atMinutes > end) continue;

      var days = (p.days || 'daily').toLowerCase();
      var ok = days === 'daily' ||
               (days === 'mon-fri' && day !== 'sat' && day !== 'sun') ||
               (days === 'mon-sat' && day !== 'sun') ||
               days.split(/[,\s]+/).indexOf(day) !== -1;
      if (ok) return p.message;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Options
  // ---------------------------------------------------------------------

  function walkOption(origin, destination, cfg) {
    var w = geo.walk(origin, destination, cfg);
    return {
      kind: 'walk',
      key: 'walk',
      totalMinutes: w.minutes,
      totalLow: w.low,
      totalHigh: w.high,
      walk: w,
      legs: [{ type: 'walk', minutes: w.minutes, detail: w }]
    };
  }

  /**
   * Build every shuttle option. `now` is a Date; `nowMinutes` its
   * minutes-since-midnight.
   */
  function shuttleOptions(origin, destination, data, now) {
    var cfg = data.config;
    var stopsById = {};
    data.stops.forEach(function (s) { stopsById[s.id] = s; });

    var nowMinutes = minutesSinceMidnight(now);

    // Pre-compute the walk from the origin to every stop, and from every stop
    // to the destination. Two passes over 16 stops rather than a nested mess.
    var toStop = {}, fromStop = {};
    data.stops.forEach(function (s) {
      toStop[s.id] = geo.walk(origin, s, cfg);
      fromStop[s.id] = geo.walk(s, destination, cfg);
    });

    var options = [];

    data.routes.forEach(function (route) {
      if (!runsToday(route, now)) return;

      for (var i = 0; i < route.stops.length - 1; i++) {
        var boardId = route.stops[i];
        var board = stopsById[boardId];
        if (!board) continue;

        var walkTo = toStop[boardId];
        if (walkTo.minutes > cfg.search.maxWalkToStopMinutes) continue;

        var arriveAtStop = nowMinutes + walkTo.minutes;
        var deps = departuresFrom(route, i, arriveAtStop, stopsById, cfg);
        if (!deps.length) continue;

        for (var j = i + 1; j < route.stops.length; j++) {
          var alightId = route.stops[j];
          var alight = stopsById[alightId];
          if (!alight) continue;

          var walkFrom = fromStop[alightId];
          if (walkFrom.minutes > cfg.search.maxWalkFromStopMinutes) continue;

          var rideResult = geo.ride(route, i, j, stopsById, cfg);
          var departure = deps[0];
          var wait = departure - arriveAtStop;
          var arrival = departure + rideResult.minutes + walkFrom.minutes;
          var total = arrival - nowMinutes;

          options.push({
            kind: 'shuttle',
            key: route.id + '|' + boardId + '|' + alightId,
            routeId: route.id,
            route: route,
            boardStop: board,
            alightStop: alight,
            boardIndex: i,
            alightIndex: j,

            walkToStop: walkTo,
            waitMinutes: wait,
            departureMinutes: departure,
            departureTime: formatHHMM(departure),
            upcomingDepartures: deps.slice(0, cfg.search.departuresToShow).map(formatHHMM),
            rideMinutes: rideResult.minutes,
            rideIsEstimated: rideResult.estimated,
            walkFromStop: walkFrom,

            arrivalMinutes: arrival,
            arrivalTime: formatHHMM(arrival),
            totalMinutes: total,
            // Only the walking legs carry real uncertainty; the wait is fixed
            // by the timetable and the ride is a published figure. So the
            // range is narrower than a flat ±30% on the whole journey.
            totalLow: walkTo.low + wait + rideResult.minutes + walkFrom.low,
            totalHigh: walkTo.high + wait + rideResult.minutes * 1.15 + walkFrom.high,

            capacityWarning: peakWarning(departure, now, cfg),

            // If the slow end of our own walking estimate lands after the bus
            // has gone, the total time above is optimistic in a way the user
            // cannot see. Say so, and name the fallback departure — otherwise
            // the honest-looking range quietly assumes you made the bus.
            isTight: walkTo.high > wait + walkTo.minutes,
            fallbackDeparture: deps.length > 1 ? formatHHMM(deps[1]) : null,

            legs: [
              { type: 'walk',  minutes: walkTo.minutes,      detail: walkTo,  label: 'Walk to ' + board.name },
              { type: 'wait',  minutes: wait,                label: 'Wait for the ' + formatHHMM(departure) },
              { type: 'ride',  minutes: rideResult.minutes,  label: route.name + ' to ' + alight.name },
              { type: 'walk',  minutes: walkFrom.minutes,    detail: walkFrom, label: 'Walk to destination' }
            ]
          });
        }
      }
    });

    return options;
  }

  /**
   * Reduce the raw option list to the few worth showing.
   *
   * Rules, in order:
   *
   *   1. DOMINANCE. Drop any option that does not save at least
   *      `minWalkSavedMinutes` of walking compared with just walking there.
   *      An option that has you walk 5 minutes to a stop and 14 minutes from
   *      the next one, to save a 17-minute direct walk, is strictly worse in
   *      every dimension and is pure noise on the screen.
   *
   *      Note this filter is about WALKING, not total time. A bus that takes
   *      as long as walking is still a real option on this campus, because it
   *      saves you a 140-metre climb. We keep those.
   *
   *   2. One option per route. Two ways to catch the same bus is noise.
   *
   *   3. Identify the "near" options — those boarding at (or within
   *      nearStopToleranceMinutes of) the closest usable stop. Always keep the
   *      best of those; it is the obvious answer and must be present.
   *
   *   4. Keep a further-away boarding stop ONLY if it beats the best near
   *      option by furtherStopThresholdMinutes or more. Below that threshold
   *      the difference is inside our own error bars, and surfacing it would
   *      be false confidence dressed up as advice.
   *
   *   5. Rank by total time, cap the list.
   *
   * The direct walk is added by the caller and is never filtered out.
   */
  /**
   * Order two options. Times this coarse tie constantly, and when two options
   * get you there at the same moment the one with less walking is simply
   * better advice — so total time first, walking distance as the tie-break.
   */
  function compareOptions(a, b) {
    if (Math.abs(a.totalMinutes - b.totalMinutes) > TIE_EPSILON_MINUTES) {
      return a.totalMinutes - b.totalMinutes;
    }
    var aWalk = a.kind === 'walk' ? 0 : a.walkToStop.minutes;
    var bWalk = b.kind === 'walk' ? 0 : b.walkToStop.minutes;
    return aWalk - bWalk;
  }

  function selectShuttleOptions(all, directWalk, cfg) {
    if (!all.length) return [];

    // 1. Dominance.
    var useful = all.filter(function (o) {
      o.walkSavedMinutes = directWalk.minutes - (o.walkToStop.minutes + o.walkFromStop.minutes);
      o.climbAvoided = Math.max(0, directWalk.climb - (o.walkToStop.climb + o.walkFromStop.climb));

      if (o.walkSavedMinutes < cfg.search.minWalkSavedMinutes) return false;

      // Sanity cap. A route with a 58-minute wait is technically an option and
      // is technically honest, but next to an 8-minute walk it is noise, and
      // noise crowds out the answer the user needs. We keep buses that merely
      // tie with walking — on this campus those still save you the climb —
      // but not ones that lose by a wide margin.
      if (o.totalMinutes > directWalk.minutes + cfg.search.maxWorseThanWalkMinutes) return false;

      return true;
    });
    if (!useful.length) return [];

    // 2. Best option per route.
    var bestByRoute = {};
    useful.forEach(function (o) {
      var prev = bestByRoute[o.routeId];
      if (!prev || compareOptions(o, prev) < 0) bestByRoute[o.routeId] = o;
    });

    var candidates = Object.keys(bestByRoute).map(function (k) { return bestByRoute[k]; });
    candidates.sort(compareOptions);

    // 3. Near vs far.
    var nearestWalk = Math.min.apply(null, candidates.map(function (o) { return o.walkToStop.minutes; }));
    var nearCutoff = nearestWalk + cfg.search.nearStopToleranceMinutes;

    var near = candidates.filter(function (o) { return o.walkToStop.minutes <= nearCutoff; });
    var bestNear = near[0];   // already sorted by total

    var chosen = [bestNear];

    candidates.forEach(function (o) {
      if (o === bestNear) return;

      if (o.walkToStop.minutes <= nearCutoff) {
        // Same stop area, different route — genuinely useful context, since
        // the next departure and the drop-off point both differ.
        chosen.push(o);
        return;
      }

      // 4. Further stop: only when the saving clears the threshold.
      var saving = bestNear.totalMinutes - o.totalMinutes;
      if (saving >= cfg.search.furtherStopThresholdMinutes) {
        o.worthTheExtraWalk = {
          extraWalkMinutes: o.walkToStop.minutes - bestNear.walkToStop.minutes,
          savingMinutes: saving,
          insteadOf: bestNear.boardStop
        };
        chosen.push(o);
      }
    });

    chosen.sort(compareOptions);
    return chosen.slice(0, cfg.search.maxOptions - 1);   // leave room for the walk
  }

  /**
   * The entry point.
   *
   * Returns { options, walkOption, now, hasShuttle, noShuttleReason }.
   * `options` is the ranked list shown to the user, walking always included.
   */
  function plan(origin, destination, data, now) {
    now = now || new Date();
    var cfg = data.config;

    var walkOpt = walkOption(origin, destination, cfg);
    var raw = shuttleOptions(origin, destination, data, now);
    var picked = selectShuttleOptions(raw, walkOpt.walk, cfg);

    var options = picked.concat([walkOpt]);
    options.sort(compareOptions);

    // Flag options the bus does not actually help with, rather than hiding
    // them. If the walk wins, say so plainly.
    var best = options[0];
    options.forEach(function (o) { o.isBest = (o === best); });

    var noShuttleReason = null;
    if (!picked.length) {
      noShuttleReason = raw.length
        ? 'Every shuttle route here would have you walking about as far as ' +
          'just walking the whole way. Walking is the sensible option.'
        : 'No scheduled shuttle connects these two points in the next ' +
          cfg.search.lookAheadMinutes + ' minutes. Check the service days and ' +
          'first/last departure times.';
    }

    return {
      options: options,
      walkOption: walkOpt,
      rawCount: raw.length,
      now: now,
      nowMinutes: minutesSinceMidnight(now),
      noShuttleReason: noShuttleReason
    };
  }

  /** Nearest stops to a coordinate, closest first. Used by the GPS confirm UI. */
  function nearestStops(point, data, limit) {
    return data.stops
      .map(function (s) {
        return { stop: s, walk: geo.walk(point, s, data.config) };
      })
      .sort(function (a, b) { return a.walk.minutes - b.walk.minutes; })
      .slice(0, limit || 5);
  }

  root.CUHK.planner = {
    plan: plan,
    nearestStops: nearestStops,
    parseHHMM: parseHHMM,
    formatHHMM: formatHHMM,
    minutesSinceMidnight: minutesSinceMidnight,
    runsToday: runsToday,
    departuresFrom: departuresFrom,
    peakWarning: peakWarning
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
