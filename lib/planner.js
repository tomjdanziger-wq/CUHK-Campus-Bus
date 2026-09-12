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

  /** Does a service pattern like 'mon-sat' cover this date? */
  function matchesDay(pattern, date) {
    var day = DAY_KEYS[date.getDay()];
    pattern = (pattern || 'daily').toLowerCase();

    if (pattern === 'daily') return true;
    if (pattern === 'mon-fri') return day !== 'sat' && day !== 'sun';
    if (pattern === 'mon-sat') return day !== 'sun';
    if (pattern === 'sun-ph') return day === 'sun';
    if (pattern === 'sat') return day === 'sat';
    // Fall back to a comma list, e.g. "mon,wed,fri".
    return pattern.split(/[,\s]+/).indexOf(day) !== -1;
  }

  /**
   * Does this route run on this date?
   *
   * A route can run on a day its main pattern excludes: Route 7 is
   * `mon-fri` with a separate Saturday block, so the overrides count too.
   */
  function runsToday(route, date) {
    if (matchesDay(route.runsOn, date)) return true;
    return (route.serviceOverrides || []).some(function (o) {
      return matchesDay(o.runsOn, date);
    });
  }

  /**
   * First and last departure for this date, in minutes since midnight.
   *
   * Some routes keep different hours on different days — Route 7 finishes at
   * 17:18 on weekdays and 13:18 on Saturdays — so a route may carry
   * `serviceOverrides`, the first matching one winning.
   */
  function serviceWindow(route, date) {
    var window = {
      first: parseHHMM(route.firstDeparture),
      last: parseHHMM(route.lastDeparture),
      minutes: route.departureMinutes
    };

    var overrides = route.serviceOverrides || [];
    for (var i = 0; i < overrides.length; i++) {
      var o = overrides[i];
      if (!matchesDay(o.runsOn, date)) continue;
      if (o.firstDeparture) window.first = parseHHMM(o.firstDeparture);
      if (o.lastDeparture) window.last = parseHHMM(o.lastDeparture);
      if (o.departureMinutes && o.departureMinutes.length) window.minutes = o.departureMinutes;
      break;
    }
    return window;
  }

  /**
   * Scheduled departures from stop index `stopIndex` on `route`, at or after
   * `fromMinutes`, within the look-ahead window.
   *
   * `departureMinutes` are minutes past the hour at the FIRST stop, bounded by
   * firstDeparture/lastDeparture. A departure from a later stop is offset by
   * the cumulative ride time to that stop.
   */
  function departuresFrom(route, stopIndex, fromMinutes, stopsById, cfg, now) {
    var window = serviceWindow(route, now || new Date());
    var first = window.first;
    var last = window.last;
    var minutes = window.minutes || [];
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
      for (var i = 0; i < minutes.length; i++) {
        var atFirstStop = hour * 60 + minutes[i];
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
        var deps = departuresFrom(route, i, arriveAtStop, stopsById, cfg, now);
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
            allDepartures: deps.slice(0, 6),
            rideMinutes: rideResult.minutes,
            rideIsEstimated: rideResult.estimated,
            walkFromStop: walkFrom,

            arrivalMinutes: arrival,
            arrivalTime: formatHHMM(arrival),

            // Time actually spent moving: walk, ride, walk. Kept apart from
            // the wait, because folding a 19-minute wait into "the bus takes
            // 30 minutes" misrepresents the bus. The wait is a fact about
            // when you turned up, not about the journey.
            //
            // Ranking still uses totalMinutes. Arriving sooner is what
            // matters, and a bus you would wait forty minutes for should not
            // outrank walking just because the ride itself is quick.
            travelMinutes: walkTo.minutes + rideResult.minutes + walkFrom.minutes,
            travelLow: walkTo.low + rideResult.minutes + walkFrom.low,
            travelHigh: walkTo.high + rideResult.minutes * 1.15 + walkFrom.high,

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

            // Where the bus carries on to, with how far each of those stops
            // leaves you from the destination.
            //
            // The planner already considered every one of these and picked
            // the best, but its walking model is an estimate over an
            // imperfectly mapped campus. Showing the alternatives lets
            // someone who knows the ground overrule it — "that one is closer
            // than it looks, I'll stay on" — instead of having to trust a
            // number. It also shows the reasoning rather than asserting it.
            onwardStops: onwardFrom(route, j, stopsById, fromStop, cfg),

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
   * The stops after `fromIndex` on this route, with the walk from each to the
   * destination. Used to show a rider where staying on would leave them.
   */
  function onwardFrom(route, fromIndex, stopsById, fromStop, cfg) {
    var out = [];
    for (var k = fromIndex + 1; k < route.stops.length && out.length < 4; k++) {
      var stop = stopsById[route.stops[k]];
      if (!stop) continue;
      // A loop route ends where it started; listing the boarding stop again
      // as somewhere you might get off is noise.
      if (k === route.stops.length - 1 && route.stops[k] === route.stops[0]) continue;
      var walk = fromStop[stop.id];
      out.push({
        stop: stop,
        index: k,
        walkMinutes: walk ? walk.minutes : null,
        walkMetres: walk ? walk.metres : null
      });
    }
    return out;
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
   *   2. GROUP identical journeys. If several routes take you from the same
   *      boarding stop to the same alighting stop in about the same time, they
   *      are the same journey as far as the rider is concerned — you take
   *      whichever turns up first. They collapse into one option carrying all
   *      their departures. Routes that share the endpoints but take markedly
   *      longer between them (a loop going the long way round) stay separate,
   *      because those are genuinely different rides.
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
   * Merge journeys that differ only by which bus turns up.
   *
   * Several routes often run the same stretch — from University Station to
   * Sir Run Run Shaw Hall, say. Presented as separate cards they look like a
   * decision, and they are not: you walk to the stop and board whichever
   * arrives first. Showing them apart also hides the thing that actually
   * matters, which is their combined frequency.
   *
   * Routes only merge when the ride between the two stops takes about the
   * same time. A route that shares both endpoints but loops the long way
   * round is a different journey and stays on its own card.
   */
  function groupInterchangeable(options, cfg) {
    var tolerance = cfg.search.groupRideToleranceMinutes;
    var groups = {};
    var order = [];

    options.forEach(function (o) {
      var key = o.boardStop.id + '>' + o.alightStop.id;
      if (!groups[key]) { groups[key] = []; order.push(key); }

      // Find a bucket whose ride time is close enough to share a card with.
      var bucket = null;
      groups[key].forEach(function (b) {
        if (!bucket && Math.abs(b[0].rideMinutes - o.rideMinutes) <= tolerance) bucket = b;
      });
      if (bucket) bucket.push(o); else groups[key].push([o]);
    });

    var merged = [];
    order.forEach(function (key) {
      groups[key].forEach(function (bucket) {
        merged.push(bucket.length === 1 ? bucket[0] : mergeOptions(bucket));
      });
    });
    return merged;
  }

  /**
   * Fold a bucket of interchangeable journeys into one option.
   *
   * The headline numbers come from whichever bus actually gets you there
   * first — that is the one you would catch. The departure list is pooled
   * across all of them and tagged with the route, because "the next three
   * buses" is the useful fact, not "the next three buses on route 2".
   */
  function mergeOptions(bucket) {
    bucket = bucket.slice().sort(function (a, b) { return a.arrivalMinutes - b.arrivalMinutes; });

    var best = bucket[0];
    var out = Object.create(Object.getPrototypeOf(best));
    Object.keys(best).forEach(function (k) { out[k] = best[k]; });

    out.isGroup = true;

    // Listed in timetable order, not arrival order — "Route 2 or 2S" is how
    // anyone would say it, and the arrival ordering shifts minute to minute.
    out.routes = bucket.map(function (o) { return o.route; })
                       .slice()
                       .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    out.key = 'grp|' + best.boardStop.id + '>' + best.alightStop.id + '|' +
              out.routes.map(function (r) { return r.id; }).join('+');

    // Pool every upcoming departure, tagged with the route running it.
    var pooled = [];
    bucket.forEach(function (o) {
      o.allDepartures.forEach(function (m) {
        pooled.push({ minutes: m, time: formatHHMM(m), route: o.route });
      });
    });
    pooled.sort(function (a, b) { return a.minutes - b.minutes; });

    // Two of the grouped routes can leave on the same minute. Listing "11:19 ·
    // 11:19" reads as a bug, and it makes no difference to the rider which of
    // the two pulls in — that is the whole point of grouping them.
    var seenTime = {};
    pooled = pooled.filter(function (d) {
      if (seenTime[d.time]) return false;
      seenTime[d.time] = true;
      return true;
    });

    out.pooledDepartures = pooled.slice(0, Math.max(4, bucket.length * 2));

    // The ride leg is a range when the grouped routes differ slightly, and so
    // is the travel time that contains it.
    var rides = bucket.map(function (o) { return o.rideMinutes; });
    out.rideMinutesLow = Math.min.apply(null, rides);
    out.rideMinutesHigh = Math.max.apply(null, rides);
    out.travelLow = Math.min.apply(null, bucket.map(function (o) { return o.travelLow; }));
    out.travelHigh = Math.max.apply(null, bucket.map(function (o) { return o.travelHigh; }));
    out.rideIsEstimated = bucket.some(function (o) { return o.rideIsEstimated; });

    out.capacityWarning = best.capacityWarning;
    out.notes = bucket.map(function (o) { return o.route.notes; })
                      .filter(Boolean)
                      .filter(function (n, i, a) { return a.indexOf(n) === i; });
    return out;
  }

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

    // 2. Collapse interchangeable journeys, then keep the best per boarding
    //    stop so the same stop is not offered twice over.
    var grouped = groupInterchangeable(useful, cfg);

    var bestByLeg = {};
    grouped.forEach(function (o) {
      var k = o.boardStop.id + '>' + o.alightStop.id;
      if (!bestByLeg[k] || compareOptions(o, bestByLeg[k]) < 0) bestByLeg[k] = o;
    });

    var byBoard = {};
    Object.keys(bestByLeg).forEach(function (k) {
      var o = bestByLeg[k];
      if (!byBoard[o.boardStop.id] || compareOptions(o, byBoard[o.boardStop.id]) < 0) {
        byBoard[o.boardStop.id] = o;
      }
    });

    var candidates = Object.keys(byBoard).map(function (k) { return byBoard[k]; });
    candidates.sort(compareOptions);

    // The same bus offered from two nearby stops, arriving at the same time,
    // is one option presented twice. Keep whichever is less walking; only let
    // a route appear again from a different stop if it is genuinely better.
    var seenRoute = {};
    candidates = candidates.filter(function (o) {
      var ids = (o.routes || [o.route]).map(function (r) { return r.id; }).join('+');
      var prev = seenRoute[ids];
      if (prev && o.totalMinutes > prev.totalMinutes - TIE_EPSILON_MINUTES) return false;
      seenRoute[ids] = o;
      return true;
    });

    // 3. Near vs far.
    var nearestWalk = Math.min.apply(null, candidates.map(function (o) { return o.walkToStop.minutes; }));
    var nearCutoff = nearestWalk + cfg.search.nearStopToleranceMinutes;

    var near = candidates.filter(function (o) { return o.walkToStop.minutes <= nearCutoff; });
    var bestNear = near[0];   // already sorted by total

    var chosen = [bestNear];

    candidates.forEach(function (o) {
      if (o === bestNear) return;

      if (o.walkToStop.minutes <= nearCutoff) {
        // A different stop nearby, or the same stop with a different drop-off
        // — genuinely useful context, since where you get off differs.
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
    var trimmed = chosen.slice(0, cfg.search.maxOptions - 1);  // room for the walk
    flagLongWayRound(trimmed, cfg);
    return trimmed;
  }

  /**
   * Mark options that go the long way round.
   *
   * Almost every route here is a one-way loop, and the uphill and downhill
   * stops of a pair sit metres apart on opposite sides of the same road. Board
   * on the wrong side and the bus does not go a slightly worse way — it goes
   * the entire circuit. From the downhill side of Wu Yee Sun the station is
   * nine minutes; from the uphill side it is twenty-one.
   *
   * These options are not hidden. Sometimes you want to sit down, or it is
   * raining, or the quick bus does not come for half an hour. But the card
   * says plainly that this one is the slow way and names the stop that is not,
   * so nobody boards it by accident.
   *
   * The test is: much slower than the best option, while boarding somewhere
   * you could just as easily have walked to. A genuinely distant stop that is
   * slower is not a mistake, it is just further away.
   */
  function flagLongWayRound(options, cfg) {
    var buses = options.filter(function (o) { return o.kind === 'shuttle'; });
    if (buses.length < 2) return;

    var best = buses[0];
    buses.slice(1).forEach(function (o) {
      var penalty = o.totalMinutes - best.totalMinutes;
      if (penalty < cfg.search.longWayRoundThresholdMinutes) return;

      var apart = geo.walk(o.boardStop, best.boardStop, cfg).minutes;
      if (apart > cfg.search.longWayRoundWalkMinutes) return;

      o.longWayRound = {
        better: best,
        penaltyMinutes: penalty,
        // Same place, opposite kerb — worth saying so explicitly.
        sameStopPair: !!(o.boardStop.pair && o.boardStop.pair === best.boardStop.pair)
      };
    });
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
    matchesDay: matchesDay,
    serviceWindow: serviceWindow,
    departuresFrom: departuresFrom,
    peakWarning: peakWarning
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
