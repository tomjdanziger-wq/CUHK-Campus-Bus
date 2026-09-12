/* ---------------------------------------------------------------------------
 * app.js — UI layer.
 *
 * Everything here is presentation. The rules about what to show, and how
 * honest to be about it, live in the comments beside the code that enforces
 * them — mostly in the formatting helpers below and in lib/planner.js.
 *
 * The governing idea: this app supports a decision, it does not make one. It
 * never hides the walk, never pre-selects an option, and never rounds in a way
 * that makes an estimate look like a fact.
 * ------------------------------------------------------------------------- */

(function () {
  'use strict';

  var DATA = window.SHUTTLE_DATA;
  var geo = window.CUHK.geo;
  var planner = window.CUHK.planner;
  var finder = window.CUHK.search;
  var CFG = DATA.config;

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    origin: null,          // { lat, lng, elevation, name, nameZh }
    destination: null,
    originSource: null,    // 'gps' | 'manual'
    when: null,            // Date, or null meaning "now"
    selectedKey: null,
    map: null,
    mapLoading: false,
    ghostLayer: null,
    activeLayer: null,
    walkRouter: null,
    netMap: null,
    netLayer: null,
    netRoute: null,
    netZoomBound: false
  };


  // =========================================================================
  // Icons
  //
  // Inline SVG rather than emoji. Emoji render differently on every platform,
  // sit on the text baseline at the wrong size, and cannot take the colour of
  // the thing they label — a bus icon should be the colour of its route.
  // =========================================================================

  var ICON_PATHS = {
    walk:  'M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7 7 0 0 0 19 13v-2a5 5 0 0 1-4.2-2.4l-1-1.6c-.4-.6-1-1-1.8-1-.3 0-.5 0-.8.2L6 8.3V13h2V9.6l1.8-.7z',
    bus:   'M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM18 11H6V6h12v5z',
    clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z',
    pin:   'M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
    alert: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    info:  'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    hill:  'M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z',
    trend: 'M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6h-6z',
    map:   'M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z',
    swap:  'M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z',
    gps:   'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 3A9 9 0 0 0 13 3.06V1h-2v2.06A9 9 0 0 0 3.06 11H1v2h2.06A9 9 0 0 0 11 20.94V23h2v-2.06A9 9 0 0 0 20.94 13H23v-2h-2.06zM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14z'
  };

  function icon(name, className) {
    var span = document.createElement('span');
    span.className = 'icon' + (className ? ' ' + className : '');
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="' +
                     ICON_PATHS[name] + '"/></svg>';
    return span;
  }

  // =========================================================================
  // Formatting
  //
  // This is where the honesty requirements are actually enforced, so the
  // reasoning is written out rather than assumed.
  // =========================================================================

  /**
   * Show a duration as a RANGE, never a point estimate.
   *
   * Granularity is coarse on purpose. Two options sit side by side, so a
   * one-minute difference between them reads as a recommendation — and given
   * roughly ±30% error, that recommendation would frequently be wrong.
   *
   * Long trips round to 5 minutes. Short ones round to the minute: "0–5 min"
   * for a three-minute stroll is coarse to the point of uselessness, and the
   * comparison problem does not arise at that scale.
   */
  function formatRange(lowMin, highMin) {
    var low, high;

    if (highMin <= 12) {
      low = Math.max(1, Math.round(lowMin));
      high = Math.max(low + 1, Math.round(highMin));
    } else {
      // Round to the NEAREST step, not outward. Rounding both ends outward
      // adds up to a full granularity step of width that the model never
      // claimed, which reads as more uncertainty than we actually have.
      var g = CFG.display.totalRoundingMinutes;
      low = Math.max(g, Math.round(lowMin / g) * g);
      high = Math.round(highMin / g) * g;
      if (high <= low) high = low + g;
    }
    return low + '–' + high;
  }

  /**
   * Arrival as a RANGE on the clock, rounded the same way the duration is.
   *
   * "arrive ~09:24" next to "20–30 minutes" is the exact false precision this
   * app is supposed to avoid: the minute looks like a promise while the range
   * beside it admits a ten-minute spread. So the clock time gets the same
   * coarseness as everything else.
   */
  function formatArrivalRange(nowMinutes, lowMin, highMin) {
    var g = CFG.display.totalRoundingMinutes;
    var lo = Math.round((nowMinutes + lowMin) / g) * g;
    var hi = Math.round((nowMinutes + highMin) / g) * g;
    if (hi <= lo) return 'arrive ~' + planner.formatHHMM(lo);
    return 'arrive ' + planner.formatHHMM(lo) + '–' + planner.formatHHMM(hi);
  }

  /** A single leg. Approximate, and marked as such with a tilde. */
  function formatLeg(minutes) {
    if (minutes < 0.75) return 'under 1 min';
    return '~' + Math.round(minutes) + ' min';
  }

  /**
   * The wait. This one is NOT an average and NOT rounded coarsely.
   *
   * Showing "~7 min average wait" to somebody who has just watched a bus pull
   * away, when the next is in 19 minutes, is the single most harmful thing
   * this app could do. So we show the real gap to the actual next scheduled
   * departure, and we name the time.
   */
  function formatWait(minutes) {
    if (minutes < 0.75) return 'leaving now';
    return Math.round(minutes) + ' min';
  }

  /** Plain-language elevation, with direction. Never just a distance. */
  function describeElevation(walkResult) {
    var notable = CFG.display.notableElevationMetres;
    var d = walkResult.deltaElevation;

    if (Math.abs(d) < notable) return 'roughly level';

    var steep = Math.abs(walkResult.gradient) > 0.11 ? 'steeply ' : '';
    return d > 0
      ? steep + 'uphill, ~' + Math.abs(d) + ' m climb'
      : steep + 'downhill, ~' + Math.abs(d) + ' m drop';
  }

  function describeWalk(walkResult) {
    if (walkResult.metres < 30) return 'you are basically there already';
    return walkResult.metres + ' m · ' + describeElevation(walkResult);
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  // =========================================================================
  // Chrome: banner, footer
  // =========================================================================

  function renderChrome() {
    if (DATA.meta.isPlaceholder) {
      var banner = $('placeholder-banner');
      $('placeholder-banner-text').textContent =
        'The routes and departure times in this app are invented placeholders, ' +
        'not the real CUHK timetable. Do not rely on them to catch a bus.';
      banner.hidden = false;
    }

    // Ride times are the weakest number in the app when they are estimated
    // rather than published, and the user cannot tell that from a card alone.
    if (DATA.meta.rideTimesEstimated) {
      $('estimate-banner-text').textContent =
        'Departure times are the real published ones. Time spent ON the bus is ' +
        'estimated from distance — CUHK does not publish stop-to-stop running times.';
      $('estimate-banner').hidden = false;
    }

    var m = DATA.meta;
    var validity = 'Timetable: ' + m.timetableLabel;
    if (m.validFrom && m.validUntil) {
      validity += ' · valid ' + m.validFrom + ' to ' + m.validUntil;
    } else if (m.extractedOn) {
      // No validity window is printed on the source pages, so say when we
      // took the data rather than implying it is current.
      validity += ' · taken from the Transport Office pages on ' + m.extractedOn +
                  '. Check the official page if that looks old.';
    }
    $('validity').textContent = validity;

    $('attribution').textContent = DATA.attribution;
  }

  // =========================================================================
  // Autocomplete
  // =========================================================================

  /**
   * One-tap shortcuts for the trips someone makes every day.
   *
   * They set the field exactly as picking from the search results would, so
   * nothing downstream needs to know they exist. Configured in
   * `config.quickPicks` rather than hard-coded, since whose home this is
   * depends on who is using it.
   */
  function renderQuickPicks(containerId, inputId, picks, onPick) {
    var box = $(containerId);
    box.innerHTML = '';
    (picks || []).forEach(function (pick) {
      var place = DATA.places.filter(function (p) { return p.id === pick.place; })[0];
      if (!place) return;   // an id that no longer exists just disappears

      var btn = el('button', 'quick__btn', pick.label || place.name);
      btn.type = 'button';
      btn.title = place.name + (place.nameZh ? ' ' + place.nameZh : '');
      btn.addEventListener('click', function () {
        $(inputId).value = place.name;
        onPick(place);
      });
      box.appendChild(btn);
    });
  }

  function wireAutocomplete(inputId, listId, onPick) {
    var input = $(inputId);
    var list = $(listId);

    function close() {
      list.hidden = true;
      list.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
    }

    function render(query) {
      var matches = finder.search(query, DATA.places, 8);
      list.innerHTML = '';

      if (!matches.length) {
        close();
        return;
      }

      matches.forEach(function (m) {
        var li = document.createElement('li');
        var btn = el('button');
        btn.type = 'button';
        btn.setAttribute('role', 'option');

        var name = el('span', 'results__name', m.place.name);
        if (m.place.stopId) {
          var tag = el('span', 'results__tag', 'SHUTTLE STOP');
          name.appendChild(tag);
        }
        btn.appendChild(name);

        if (m.place.nameZh) btn.appendChild(el('span', 'results__zh', m.place.nameZh));

        btn.addEventListener('click', function () {
          input.value = m.place.name;
          close();
          onPick(m.place);
        });

        li.appendChild(btn);
        list.appendChild(li);
      });

      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (q.length < 1) { close(); return; }
      render(q);
    });

    input.addEventListener('focus', function () {
      if (input.value.trim()) render(input.value.trim());
    });

    // Enter picks the top match, so the keyboard flow works without tapping.
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var first = list.querySelector('button');
      if (first) { e.preventDefault(); first.click(); }
    });

    document.addEventListener('click', function (e) {
      if (!list.contains(e.target) && e.target !== input) close();
    });

    return { close: close };
  }

  // =========================================================================
  // Origin: GPS, with mandatory confirmation
  //
  // GPS accuracy on this campus is poor — dense buildings, steep terrain, tree
  // cover. So the app never silently assumes a location. It states which stop
  // it thinks you are near and offers the alternatives as one-tap buttons.
  // =========================================================================

  function setOriginStatus(text, kind) {
    var n = $('origin-status');
    n.textContent = text;
    n.className = 'field__status' + (kind ? ' field__status--' + kind : '');
  }

  function requestGps() {
    if (!navigator.geolocation) {
      setOriginStatus('This browser has no location support. Search for where you are instead.', 'err');
      return;
    }

    setOriginStatus('Finding you…');
    $('gps-btn').setAttribute('aria-pressed', 'true');

    navigator.geolocation.getCurrentPosition(function (pos) {
      var point = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        // A GPS fix carries no elevation we can trust, so interpolate from the
        // known campus points. See geo.estimateElevation for why this matters.
        elevation: 0
      };
      point.elevation = geo.estimateElevation(point, DATA.places);
      point.name = 'My location';
      point.nameZh = null;

      state.origin = point;
      state.originSource = 'gps';
      state.originCorrected = false;
      $('origin-input').value = '';

      var accuracy = Math.round(pos.coords.accuracy || 0);
      setOriginStatus(
        'Using GPS' + (accuracy ? ' (accurate to about ' + accuracy + ' m)' : '') +
        ' · estimated elevation ' + point.elevation + ' m', 'ok');

      renderOriginConfirmation(point);
      recompute();

    }, function (err) {
      $('gps-btn').setAttribute('aria-pressed', 'false');
      var msg = err.code === err.PERMISSION_DENIED
        ? 'Location permission denied. Search for where you are instead.'
        : 'Could not get your location. Search for where you are instead.';
      setOriginStatus(msg, 'err');
      $('origin-confirm').hidden = true;
      $('origin-input').focus();
    }, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    });
  }

  /**
   * Always show which stop we think the user is near, and let them correct it
   * in one tap. Never assume silently.
   */
  function renderOriginConfirmation(point) {
    var box = $('origin-confirm');
    var listEl = $('origin-confirm-list');
    listEl.innerHTML = '';

    var near = planner.nearestStops(point, DATA, 4);
    if (!near.length) { box.hidden = true; return; }

    // Name the guess out loud. A bare list of stops does not tell the user
    // what the app has actually assumed about them.
    var q = $('origin-confirm').querySelector('.confirm__q');
    q.innerHTML = '';
    q.appendChild(document.createTextNode('GPS is unreliable here. We think you are nearest '));
    q.appendChild(el('strong', null, near[0].stop.name));
    q.appendChild(document.createTextNode('. If that is wrong, tap where you actually are:'));

    near.forEach(function (n) {
      var btn = el('button', 'confirm__btn');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', 'false');

      btn.appendChild(document.createTextNode(n.stop.name));
      var sub = el('small', null,
        (n.stop.nameZh ? n.stop.nameZh + ' · ' : '') + formatLeg(n.walk.minutes) + ' walk');
      btn.appendChild(sub);

      btn.addEventListener('click', function () {
        // Correcting the guess means "I am at that stop", so the origin
        // becomes the stop itself — coordinates, elevation and all.
        state.origin = {
          lat: n.stop.lat, lng: n.stop.lng, elevation: n.stop.elevation,
          name: n.stop.name, nameZh: n.stop.nameZh
        };
        state.originSource = 'manual';
        state.originCorrected = true;
        setOriginStatus('Starting from ' + n.stop.name + '. Tap another if that is wrong.', 'ok');

        Array.prototype.forEach.call(listEl.children, function (c) {
          c.setAttribute('aria-pressed', String(c === btn));
        });
        recompute();
      });

      listEl.appendChild(btn);
    });

    box.hidden = false;
  }

  // =========================================================================
  // Option cards
  // =========================================================================

  function renderWalkCard(o) {
    var card = el('div', 'opt opt--walk' + (o.isBest ? ' opt--best' : ''));

    var head = el('div', 'opt__head');
    head.appendChild(icon('walk', 'icon--mode'));

    var titles = el('div', 'opt__titles');
    titles.appendChild(el('h2', 'opt__mode', 'Walk'));
    titles.appendChild(el('span', 'opt__mode-sub', describeWalk(o.walk)));
    head.appendChild(titles);

    var time = el('div', 'opt__time');
    time.appendChild(el('strong', 'opt__time-range', formatRange(o.totalLow, o.totalHigh)));
    time.appendChild(el('span', 'opt__time-unit', 'min'));
    time.appendChild(el('span', 'opt__arrive', o.arrivalLabel));
    head.appendChild(time);
    card.appendChild(head);

    var body = el('div', 'opt__body');

    // The elevation note is not optional. A flat time estimate on this campus
    // is misleading — the same route is a different journey in each direction.
    if (o.walk.climb >= CFG.display.notableElevationMetres) {
      body.appendChild(flag('hill', 'flag--climb',
        'The climb is the part the clock does not show.'));
    }

    body.appendChild(mapButton(o));
    attachMapPanel(o, body);
    card.appendChild(body);
    return card;
  }

  /** "1, 2 or 4" — how someone would actually say it out loud. */
  function joinList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' or ' + items[items.length - 1];
  }

  function flag(iconName, className, text) {
    var p = el('p', 'flag ' + className);
    p.appendChild(icon(iconName));
    p.appendChild(el('span', null, text));
    return p;
  }

  function renderShuttleCard(o) {
    var routes = o.routes || [o.route];
    var card = el('div', 'opt opt--bus' + (o.isBest ? ' opt--best' : ''));
    card.style.setProperty('--route-colour', o.route.colour);

    // A grouped option carries several routes, so the edge stripe blends their
    // colours rather than picking a winner among equals.
    if (routes.length > 1) {
      var stops = routes.map(function (r, i) {
        return r.colour + ' ' + Math.round(i * 100 / routes.length) + '% ' +
               Math.round((i + 1) * 100 / routes.length) + '%';
      });
      card.style.setProperty('--route-stripe', 'linear-gradient(180deg,' + stops.join(',') + ')');
    }

    // --- header ---
    var head = el('div', 'opt__head');
    head.appendChild(icon('bus', 'icon--mode'));

    var titles = el('div', 'opt__titles');
    titles.appendChild(el('h2', 'opt__mode',
      routes.length > 1 ? 'Route ' + joinList(routes.map(function (r) { return r.id; }))
                        : o.route.name));
    titles.appendChild(el('span', 'opt__mode-sub',
      routes.length > 1
        ? 'whichever comes first'
        : (o.route.label || o.route.nameZh || '')));
    head.appendChild(titles);

    // The headline is time spent MOVING. The wait gets its own line below,
    // because rolling it in would claim the bus takes as long as your bad
    // luck with the timetable.
    var time = el('div', 'opt__time');
    time.appendChild(el('strong', 'opt__time-range', formatRange(o.travelLow, o.travelHigh)));
    time.appendChild(el('span', 'opt__time-unit', 'min travel'));
    head.appendChild(time);
    card.appendChild(head);

    // --- the single most important field on the screen ---
    // The most common failure for a new student is waiting at the wrong stop.
    var board = el('div', 'board');
    board.appendChild(el('p', 'board__label', 'Board at'));
    var name = el('p', 'board__name', o.boardStop.name);
    if (o.boardStop.nameZh) name.appendChild(el('span', 'board__zh', o.boardStop.nameZh));
    board.appendChild(name);
    board.appendChild(el('p', 'board__walk',
      o.walkToStop.metres < 30
        ? "You're already here."
        : formatLeg(o.walkToStop.minutes) + ' walk · ' + describeWalk(o.walkToStop)));

    // "(Downward)" is the Transport Office's wording and means nothing to
    // somebody new. Say which kerb it is.
    if (o.boardStop.side) {
      board.appendChild(el('p', 'board__side',
        o.boardStop.side === 'up'
          ? 'The uphill side of the road — buses heading up the hill.'
          : 'The downhill side of the road — buses heading down the hill.'));
    }
    card.appendChild(board);

    // --- boarding on the wrong side sends you round the whole campus ---
    if (o.longWayRound) {
      var lw = o.longWayRound;
      var otherSide = lw.better.boardStop.side === 'up' ? 'uphill' : 'downhill';
      card.appendChild(flag('alert', 'flag--danger flag--boxed',
        lw.sameStopPair
          ? 'Wrong side for this trip. The ' + otherSide + ' stop gets you there ' +
            'about ' + Math.round(lw.penaltyMinutes) + ' min sooner. Take this one ' +
            'only if you just want to be on a bus.'
          : 'The long way round — about ' + Math.round(lw.penaltyMinutes) +
            ' min slower than ' + lw.better.route.name + ' from ' +
            lw.better.boardStop.name + '. Take it only if you just want to be on a bus.'));
    }

    var body = el('div', 'opt__body');

    if (o.worthTheExtraWalk) {
      var w = o.worthTheExtraWalk;
      body.appendChild(flag('trend', 'flag--warn',
        'About ' + Math.round(w.extraWalkMinutes) + ' min further than ' +
        w.insteadOf.name + ', but roughly ' + Math.round(w.savingMinutes) +
        ' min sooner overall.'));
    }

    // --- the wait, on its own, in full ---
    //
    // Not folded into the headline and not buried in the leg list. If you have
    // just watched a bus pull away, the gap to the next one is the single most
    // important number on the screen, and it is the one an "average wait"
    // would quietly lie about.
    var waitRow = el('p', 'waitline');
    waitRow.appendChild(icon('clock'));
    var waitText = el('span', 'waitline__text');
    waitText.appendChild(el('strong', null,
      o.waitMinutes < 0.75 ? 'Leaving now' : 'Wait ' + Math.round(o.waitMinutes) + ' min'));
    waitText.appendChild(document.createTextNode(
      ' for the ' + o.departureTime +
      (routes.length > 1 ? ' (Route ' + o.route.id + ')' : '')));
    waitText.appendChild(el('span', 'waitline__arrive', o.arrivalLabel));
    waitRow.appendChild(waitText);
    body.appendChild(waitRow);

    // --- the travel legs, deliberately not collapsed into one number ---
    var legs = el('ul', 'legs');

    if (o.walkToStop.metres >= 30) {
      legs.appendChild(legRow('walk', 'Walk',
        'to ' + o.boardStop.name, formatLeg(o.walkToStop.minutes)));
    }

    legs.appendChild(legRow('bus', 'Ride',
      'to ' + o.alightStop.name +
      (o.rideIsEstimated ? ' · time estimated' : ''),
      o.rideMinutesHigh && o.rideMinutesHigh - o.rideMinutesLow >= 1
        ? '~' + Math.round(o.rideMinutesLow) + '–' + Math.round(o.rideMinutesHigh) + ' min'
        : '~' + Math.round(o.rideMinutes) + ' min'));

    if (o.walkFromStop.metres >= 30) {
      legs.appendChild(legRow('walk', 'Walk',
        describeWalk(o.walkFromStop), formatLeg(o.walkFromStop.minutes)));
    }
    body.appendChild(legs);

    // --- departures ---
    var deps = el('p', 'deps');
    deps.appendChild(el('span', 'deps__label', 'Next from this stop'));
    var times = el('span', 'deps__times');
    if (o.pooledDepartures) {
      // Only underline in route colours when several routes are pooled here —
      // otherwise it is decoration that looks like it means something.
      o.pooledDepartures.forEach(function (d, i) {
        if (i) times.appendChild(el('span', 'deps__sep', '·'));
        var t = el('span', 'deps__time deps__time--tagged', d.time);
        t.style.setProperty('--route-colour', d.route.colour);
        t.title = d.route.name;
        times.appendChild(t);
      });
    } else {
      o.upcomingDepartures.forEach(function (t, i) {
        if (i) times.appendChild(el('span', 'deps__sep', '·'));
        times.appendChild(el('span', 'deps__time', t));
      });
    }
    deps.appendChild(times);
    body.appendChild(deps);

    // --- where the bus goes next ---
    if (o.onwardStops && o.onwardStops.length) {
      var onward = el('div', 'onward');
      onward.appendChild(el('p', 'onward__label', 'Or stay on for'));
      var list = el('ul', 'onward__list');
      o.onwardStops.forEach(function (n) {
        var li = el('li');
        var nm = el('span', 'onward__stop', n.stop.name);
        li.appendChild(nm);
        li.appendChild(el('span', 'onward__walk',
          n.walkMinutes == null ? '—'
            : n.walkMetres < 30 ? 'you are there'
            : 'then ' + Math.round(n.walkMinutes) + ' min walk'));
        // Flag a later stop that leaves you meaningfully closer on foot. The
        // ranking prefers arriving sooner; someone facing a climb in August
        // may not.
        if (n.walkMinutes != null && n.walkMinutes <= o.walkFromStop.minutes - 3) {
          li.classList.add('onward__item--closer');
        }
        list.appendChild(li);
      });
      onward.appendChild(list);
      body.appendChild(onward);
    }

    if (o.isTight) {
      body.appendChild(flag('clock', 'flag--warn',
        'Tight — if the walk runs long you may miss it' +
        (o.fallbackDeparture ? '. Next is ' + o.fallbackDeparture + '.' : '.')));
    }

    if (o.capacityWarning) body.appendChild(flag('alert', 'flag--warn', o.capacityWarning));

    (o.notes || (o.route.notes ? [o.route.notes] : [])).forEach(function (n) {
      body.appendChild(flag('info', 'flag--info', n));
    });

    body.appendChild(mapButton(o));
    attachMapPanel(o, body);
    card.appendChild(body);
    return card;
  }

  /**
   * Move the single map panel into the option being shown, so it opens
   * directly beneath that card rather than somewhere further down the page.
   * One map instance is reused: rebuilding it would re-fetch every tile.
   */
  function attachMapPanel(o, body) {
    if (state.selectedKey !== o.key) return;
    var panel = $('map-panel');
    panel.hidden = false;
    body.appendChild(panel);
  }

  /**
   * Selecting an option only changes what the map draws. It is not a
   * commitment, and nothing is ever pre-selected on the user's behalf.
   */
  function mapButton(o) {
    var pick = el('button', 'pick');
    pick.type = 'button';
    pick.appendChild(icon('map'));
    pick.appendChild(el('span', null,
      state.selectedKey === o.key ? 'Showing on map' : 'Show on map'));
    pick.setAttribute('aria-pressed', String(state.selectedKey === o.key));
    pick.addEventListener('click', function () {
      state.selectedKey = state.selectedKey === o.key ? null : o.key;
      render();
      if (state.selectedKey) showMapFor(o);
    });
    return pick;
  }

  function legRow(iconName, main, sub, timeText, extraClass) {
    var li = el('li', extraClass || null);
    li.appendChild(icon(iconName, 'leg__icon'));
    var text = el('div', 'leg__text');
    text.appendChild(el('span', 'leg__label', main));
    if (sub) text.appendChild(el('span', 'leg__sub', sub));
    li.appendChild(text);
    li.appendChild(el('span', 'leg__time', timeText));
    return li;
  }

  // =========================================================================
  // Render
  // =========================================================================

  function currentWhen() {
    return state.when ? new Date(state.when) : new Date();
  }

  function render() {
    var out = $('options');

    // The map panel lives inside whichever card is showing it, so rescue it
    // before the list is torn down or it would be destroyed with the cards.
    var panel = $('map-panel');
    if (panel.parentNode !== document.body) document.body.appendChild(panel);
    if (!state.selectedKey) panel.hidden = true;

    out.innerHTML = '';

    if (!state.origin || !state.destination) {
      $('empty-state').hidden = false;
      return;
    }
    $('empty-state').hidden = true;

    var result = planner.plan(state.origin, state.destination, DATA, currentWhen());

    result.options.forEach(function (o) {
      o.arrivalLabel = formatArrivalRange(result.nowMinutes, o.totalLow, o.totalHigh);
    });

    var header = el('p', 'notice',
      state.origin.name + ' → ' + state.destination.name +
      ' · leaving ' + (state.when ? 'at ' + planner.formatHHMM(planner.minutesSinceMidnight(currentWhen())) : 'now'));
    out.appendChild(header);

    result.options.forEach(function (o) {
      out.appendChild(o.kind === 'walk' ? renderWalkCard(o) : renderShuttleCard(o));
    });

    if (result.noShuttleReason) {
      out.appendChild(el('p', 'notice', result.noShuttleReason));
    }

  }

  function recompute() { render(); }

  // =========================================================================
  // Map — optional, illustrative, and lazily loaded.
  //
  // The written instructions are the product. If Leaflet fails to load, or
  // there is no network, everything above still works. That is the whole
  // reason it is loaded on demand rather than in the page head.
  // =========================================================================

  var LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  var LEAFLET_JS  = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (state.mapLoading) return state.mapLoading;

    state.mapLoading = new Promise(function (resolve, reject) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);

      var js = document.createElement('script');
      js.src = LEAFLET_JS;
      js.onload = function () { resolve(window.L); };
      js.onerror = function () { reject(new Error('Leaflet failed to load')); };
      document.head.appendChild(js);
    });
    return state.mapLoading;
  }

  /**
   * Draw the map.
   *
   * Every shuttle route is drawn faintly, so you can see the shape of the
   * network. The option you are actually looking at is drawn on top in that
   * route's own colour, and only for the stretch you would ride — boarding
   * stop to alighting stop, not the whole loop. Walking legs are dashed, in
   * the walk colour, and follow real footpaths rather than cutting through
   * buildings.
   */
  function showMapFor(option) {
    var container = $('map');

    loadLeaflet().then(function (L) {
      if (!state.map) {
        state.map = L.map(container, { scrollWheelZoom: false });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors'
        }).addTo(state.map);

        state.ghostLayer = L.layerGroup().addTo(state.map);
        state.activeLayer = L.layerGroup().addTo(state.map);
        drawGhostNetwork(L);
      }

      var map = state.map;
      state.activeLayer.clearLayers();

      var bounds = [];
      var add = function (pts) { for (var i = 0; i < pts.length; i++) bounds.push(pts[i]); };

      // --- where the bus carries on to, faded ---
      // Shown so a rider can see that staying on leads somewhere useful. It is
      // drawn thin and translucent: it is context, not the recommendation.
      if (option.kind === 'shuttle') {
        var onward = onwardShape(option);
        if (onward.length > 1) {
          L.polyline(onward, {
            color: option.route.colour, weight: 3.5, opacity: 0.5,
            dashArray: '8 7', lineCap: 'butt', interactive: false
          }).addTo(state.activeLayer);
        }
        (option.onwardStops || []).forEach(function (n) {
          L.circleMarker([n.stop.lat, n.stop.lng], {
            radius: 5, color: option.route.colour, weight: 2,
            fillColor: '#fffdf8', fillOpacity: 1, opacity: 0.7
          }).addTo(state.activeLayer).bindPopup(
            '<strong>' + n.stop.name + '</strong><br>stay on for this stop' +
            (n.walkMinutes != null
              ? '<br>then about ' + Math.round(n.walkMinutes) + ' min walk' : ''));
        });
      }

      // --- the ridden stretch, in the route's colour ---
      if (option.kind === 'shuttle') {
        var ridden = riddenShape(option);
        if (ridden.length > 1) {
          // A white casing underneath makes the colour legible over any tile.
          L.polyline(ridden, { color: '#ffffff', weight: 12, opacity: 0.9 })
            .addTo(state.activeLayer);
          L.polyline(ridden, {
            color: option.route.colour, weight: 7, opacity: 1, lineJoin: 'round'
          }).addTo(state.activeLayer).bindPopup(
            option.route.name + (option.route.label ? ' · ' + option.route.label : ''));
          drawDirectionArrows(L, ridden, state.activeLayer, 180);
          add(ridden);
        }
      }

      // --- walking legs, dashed, on real paths ---
      var walkColour = CFG.walkColour || '#1b7f4d';
      function drawWalk(from, to) {
        if (!from || !to) return;
        var line = walkLine(from, to);
        if (line.length < 2) return;
        L.polyline(line, {
          color: walkColour, weight: 5, opacity: 0.95,
          dashArray: '2 9', lineCap: 'round'
        }).addTo(state.activeLayer);
        add(line);
      }

      if (option.kind === 'walk') {
        drawWalk(state.origin, state.destination);
      } else {
        drawWalk(state.origin, option.boardStop);
        drawWalk(option.alightStop, state.destination);
      }

      // --- markers ---
      function marker(p, label, colour, radius) {
        if (!p) return;
        L.circleMarker([p.lat, p.lng], {
          radius: radius || 8, color: '#ffffff', weight: 3,
          fillColor: colour, fillOpacity: 1
        }).addTo(state.activeLayer).bindPopup(label);
        bounds.push([p.lat, p.lng]);
      }

      if (option.kind === 'shuttle') {
        marker(option.boardStop, 'Board here: ' + option.boardStop.name,
               option.route.colour, 9);
        marker(option.alightStop, 'Get off: ' + option.alightStop.name,
               option.route.colour, 9);
      }
      marker(state.origin, 'Start: ' + state.origin.name, walkColour);
      marker(state.destination, 'Destination: ' + state.destination.name, '#a11919');

      if (bounds.length) map.fitBounds(bounds, { padding: [35, 35] });
      renderLegend(option);
      setTimeout(function () { map.invalidateSize(); }, 0);

    }).catch(function () {
      container.hidden = true;
      $('map-legend').innerHTML = '';
      $('map-note').textContent =
        'The map could not load. Everything above still works — the written ' +
        'instructions are the accurate part anyway.';
    });
  }

  /** Every route, faint, so the network is visible behind the chosen one. */
  function drawGhostNetwork(L) {
    DATA.routes.forEach(function (route) {
      var shape = DATA.routeShapes[route.id];
      if (!shape || !shape.line || shape.line.length < 2) return;
      L.polyline(shape.line, {
        color: route.colour, weight: 3, opacity: 0.22,
        interactive: false, lineJoin: 'round'
      }).addTo(state.ghostLayer);
    });
  }

  /**
   * The stretch of a route actually ridden. The generated geometry records the
   * polyline vertex of every stop, so this is an exact slice — deriving it by
   * proximity would be ambiguous on a loop that passes the same point twice.
   */
  function riddenShape(option) {
    var shape = DATA.routeShapes[option.routeId];
    if (!shape || !shape.line) {
      return [[option.boardStop.lat, option.boardStop.lng],
              [option.alightStop.lat, option.alightStop.lng]];
    }
    var idx = shape.stopIndices || [];
    var a = idx[option.boardIndex], b = idx[option.alightIndex];
    if (typeof a !== 'number' || typeof b !== 'number' || b <= a) {
      return [[option.boardStop.lat, option.boardStop.lng],
              [option.alightStop.lat, option.alightStop.lng]];
    }
    return shape.line.slice(a, b + 1);
  }

  /** The rest of the route after the alighting stop. */
  function onwardShape(option) {
    var shape = DATA.routeShapes[option.routeId];
    if (!shape || !shape.line || !shape.stopIndices) return [];
    var from = shape.stopIndices[option.alightIndex];
    var last = option.onwardStops && option.onwardStops.length
      ? shape.stopIndices[option.onwardStops[option.onwardStops.length - 1].index]
      : shape.stopIndices[shape.stopIndices.length - 1];
    if (typeof from !== 'number' || typeof last !== 'number' || last <= from) return [];
    return shape.line.slice(from, last + 1);
  }

  /** A walking leg along real footpaths, falling back to a straight line. */
  function walkLine(from, to) {
    if (!state.walkRouter && window.CUHK.WalkRouter && DATA.walkGraph) {
      state.walkRouter = new window.CUHK.WalkRouter(DATA.walkGraph);
    }
    if (state.walkRouter) {
      var routed = state.walkRouter.route(from, to);
      if (routed && routed.points.length > 1) return routed.points;
    }
    return [[from.lat, from.lng], [to.lat, to.lng]];
  }

  /** Name the colours on screen, so the lines mean something. */
  function renderLegend(option) {
    var box = $('map-legend');
    box.innerHTML = '';

    function row(colour, label, style) {
      var item = el('span', 'legend__item');
      var swatch = el('span', 'legend__swatch' +
        (style ? ' legend__swatch--' + style : ''));
      swatch.style.background = style ? 'transparent' : colour;
      if (style) swatch.style.borderTopColor = colour;
      item.appendChild(swatch);
      item.appendChild(el('span', null, label));
      box.appendChild(item);
    }

    if (option.kind === 'shuttle') {
      row(option.route.colour,
          option.route.name + (option.route.label ? ' · ' + option.route.label : ''));
    }
    if (option.kind === 'shuttle' && option.onwardStops && option.onwardStops.length) {
      row(option.route.colour, 'Where it carries on', 'dashed');
    }
    row(CFG.walkColour || '#1b7f4d', 'Your walk', 'dotted');
    var faint = el('span', 'legend__item legend__item--muted');
    faint.textContent = 'Faint lines are the other shuttle routes.';
    box.appendChild(faint);
  }

  // =========================================================================
  // Network browser
  //
  // The journey planner answers "how do I get from A to B". This answers the
  // other question people actually have: "where do these buses go?" — which
  // is what you need when you already know the campus and would rather choose
  // the route yourself than describe a trip.
  //
  // Every route is drawn in its own colour, every stop is marked with its
  // short code, and arrows along each line show which way round the loop the
  // bus travels. Direction matters more than anything else here: most of
  // these routes are one-way loops, so boarding on the wrong side of the road
  // means riding almost the whole campus to get somewhere two minutes away.
  // =========================================================================

  var ARROW_SPACING_M = 260;

  function bearing(a, b) {
    var y = Math.sin((b[1] - a[1]) * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180);
    var x = Math.cos(a[0] * Math.PI / 180) * Math.sin(b[0] * Math.PI / 180) -
            Math.sin(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) *
            Math.cos((b[1] - a[1]) * Math.PI / 180);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function metresBetween(a, b) {
    return geo.haversineMetres({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
  }

  function wireNetwork() {
    var toggle = $('network-toggle');
    var panel = $('network-panel');

    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
      toggle.classList.toggle('is-open', !open);
      if (!open) openNetwork();
    });

    renderNetworkChips();
  }

  function renderNetworkChips() {
    var box = $('network-chips');
    box.innerHTML = '';

    function chip(id, label, colour) {
      var b = el('button', 'chip');
      b.type = 'button';
      b.dataset.route = id || '';
      b.setAttribute('aria-pressed', String(state.netRoute === id));
      if (colour) {
        b.style.setProperty('--chip-colour', colour);
        b.classList.add('chip--colour');
      }
      b.appendChild(el('span', 'chip__dot'));
      b.appendChild(el('span', null, label));
      b.addEventListener('click', function () {
        state.netRoute = state.netRoute === id ? null : id;
        renderNetworkChips();
        openNetwork();
      });
      box.appendChild(b);
    }

    chip(null, 'All routes', null);
    DATA.routes.forEach(function (r) { chip(r.id, r.name.replace('Route ', ''), r.colour); });
  }

  function openNetwork() {
    var container = $('network-map');

    loadLeaflet().then(function (L) {
      if (!state.netMap) {
        state.netMap = L.map(container, { scrollWheelZoom: false });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '© OpenStreetMap contributors'
        }).addTo(state.netMap);
        state.netLayer = L.layerGroup().addTo(state.netMap);
      }

      var map = state.netMap;
      state.netLayer.clearLayers();

      var only = state.netRoute;
      var bounds = [];

      // --- route lines ---
      DATA.routes.forEach(function (route) {
        var shape = DATA.routeShapes[route.id];
        if (!shape || !shape.line || shape.line.length < 2) return;

        var active = !only || only === route.id;
        if (active) {
          L.polyline(shape.line, { color: '#fff', weight: 11, opacity: 0.9 })
            .addTo(state.netLayer);
        }
        L.polyline(shape.line, {
          color: route.colour,
          weight: active ? 7 : 2.5,
          opacity: active ? 0.95 : 0.16,
          lineJoin: 'round'
        }).addTo(state.netLayer).bindPopup(
          '<strong>' + route.name + '</strong><br>' + (route.label || '') +
          '<br>' + route.firstDeparture + '–' + route.lastDeparture);

        if (active) {
          // Direction arrows only when one route is selected. Eight sets of
          // arrows overlapping each other tells you nothing.
          if (only) drawDirectionArrows(L, shape.line, state.netLayer);
          shape.line.forEach(function (pt) { bounds.push(pt); });
        }
      });

      // --- stop markers ---
      var shown = {};
      DATA.routes.forEach(function (route) {
        if (only && only !== route.id) return;
        route.stops.forEach(function (id) { shown[id] = true; });
      });

      DATA.stops.forEach(function (stop) {
        var active = !only || shown[stop.id];
        if (only && !active) return;

        L.marker([stop.lat, stop.lng], {
          icon: L.divIcon({
            className: 'stopmark',
            html: '<span class="stopmark__dot"></span>' +
                  '<span class="stopmark__pill">' + stop.abbr + '</span>',
            iconSize: null
          }),
          keyboard: false
        }).addTo(state.netLayer).bindPopup(
          '<strong>' + stop.name + '</strong>' +
          (stop.nameZh ? '<br>' + stop.nameZh : '') +
          '<br>' + stop.elevation + ' m above sea level');

        if (!only) bounds.push([stop.lat, stop.lng]);
      });

      if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });

      // Twenty-nine labelled pills on a campus-wide view overlap into an
      // unreadable pile, so they collapse to dots until there is room: either
      // a single route is selected, or the user has zoomed in.
      //
      // This reads state.netRoute rather than the `only` local on purpose. The
      // zoomend handler is bound once, so a closure over `only` would freeze
      // whatever was selected the first time the map opened — and fitBounds
      // fires zoomend, which promptly undid the correct value.
      if (!state.netZoomBound) {
        map.on('zoomend', syncNetworkLabels);
        state.netZoomBound = true;
      }
      syncNetworkLabels();

      setTimeout(function () { map.invalidateSize(); syncNetworkLabels(); }, 0);

    }).catch(function () {
      container.innerHTML =
        '<p class="map-note">The map could not load. The stop list below still works.</p>';
    });

    renderNetworkList();
  }

  function syncNetworkLabels() {
    var container = $('network-map');
    if (!state.netMap) return;
    var roomy = !!state.netRoute || state.netMap.getZoom() >= 16;
    container.classList.toggle('labels-off', !roomy);
  }

  /**
   * Direction arrows along a route line.
   *
   * These carry real information: nearly every route here is a one-way loop,
   * so which way it goes round decides whether the bus is a five-minute ride
   * or a twenty-minute one.
   *
   * Drawn as white chevrons sitting *on* the coloured line, the way transit
   * maps do it, rather than glyphs floating beside it. The line has to be
   * thick enough to hold them, which is why the active route is drawn heavier.
   */
  function drawDirectionArrows(L, line, layer, spacing) {
    var carried = 0;
    for (var i = 0; i < line.length - 1; i++) {
      var seg = metresBetween(line[i], line[i + 1]);
      carried += seg;
      if (carried < (spacing || ARROW_SPACING_M) || seg < 1) continue;
      carried = 0;

      // A bearing of 0 is north; the chevron is drawn pointing east.
      var angle = bearing(line[i], line[i + 1]) - 90;
      L.marker(line[i + 1], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'arrowmark',
          html: '<svg class="arrowmark__svg" viewBox="0 0 16 16" ' +
                'style="transform:rotate(' + angle + 'deg)">' +
                '<path d="M5.5 3.4 L10.1 8 L5.5 12.6" fill="none" stroke="#fff" ' +
                'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
          iconSize: null
        })
      }).addTo(layer);
    }
  }

  function renderNetworkList() {
    var summary = $('network-summary');
    var list = $('network-stops');
    list.innerHTML = '';

    if (!state.netRoute) {
      summary.textContent =
        DATA.routes.length + ' routes, ' + DATA.stops.length + ' stops. ' +
        'Pick a route above to see where it goes and which way round it runs. ' +
        'Arrows on the map show the direction of travel.';
      list.hidden = true;
      return;
    }

    var route = DATA.routes.filter(function (r) { return r.id === state.netRoute; })[0];
    if (!route) return;

    var byId = {};
    DATA.stops.forEach(function (s) { byId[s.id] = s; });

    summary.innerHTML = '';
    var head = el('strong', null, route.name + (route.label ? ' · ' + route.label : ''));
    head.style.color = route.colour;
    summary.appendChild(head);
    summary.appendChild(document.createTextNode(
      ' — ' + route.firstDeparture + ' to ' + route.lastDeparture + ', ' +
      describeDays(route.runsOn) + ', departing at ' +
      route.departureMinutes.map(function (m) {
        return ':' + String(m).padStart(2, '0');
      }).join(', ') + ' past the hour from ' +
      (byId[route.stops[0]] ? byId[route.stops[0]].name : 'the first stop') + '.'));

    if (route.notes) {
      var note = el('span', 'network__note', ' ' + route.notes);
      summary.appendChild(note);
    }

    list.hidden = false;
    route.stops.forEach(function (id, i) {
      var stop = byId[id];
      if (!stop) return;
      var li = el('li', 'stoplist__item');
      li.style.setProperty('--route-colour', route.colour);

      var code = el('span', 'stoplist__code', stop.abbr);
      li.appendChild(code);

      var text = el('span', 'stoplist__text');
      text.appendChild(el('span', 'stoplist__name', stop.name));
      if (stop.nameZh) text.appendChild(el('span', 'stoplist__zh', stop.nameZh));
      li.appendChild(text);

      var meta = el('span', 'stoplist__meta',
        i === 0 ? 'first stop' : i === route.stops.length - 1 ? 'last stop' : stop.elevation + ' m');
      li.appendChild(meta);

      list.appendChild(li);
    });
  }

  function describeDays(runsOn) {
    if (runsOn === 'mon-fri') return 'Monday to Friday';
    if (runsOn === 'mon-sat') return 'Monday to Saturday';
    if (runsOn === 'sun-ph') return 'Sundays and public holidays';
    if (runsOn === 'sat') return 'Saturdays';
    if (runsOn === 'daily') return 'every day';
    return runsOn;
  }

  // =========================================================================
  // Wiring
  // =========================================================================

  function init() {
    renderChrome();

    var pickOrigin = function (place) {
      state.origin = place;
      state.originSource = 'manual';
      state.originCorrected = true;
      $('gps-btn').setAttribute('aria-pressed', 'false');
      setOriginStatus('Starting from ' + place.name + (place.nameZh ? ' ' + place.nameZh : '') + '.', 'ok');
      $('origin-confirm').hidden = true;
      recompute();
    };

    var pickDestination = function (place) {
      state.destination = place;
      $('dest-status').textContent =
        'Going to ' + place.name + (place.nameZh ? ' ' + place.nameZh : '') + '.';
      $('dest-status').className = 'field__status field__status--ok';
      recompute();
    };

    wireAutocomplete('origin-input', 'origin-results', pickOrigin);
    wireAutocomplete('dest-input', 'dest-results', pickDestination);

    renderQuickPicks('origin-quick', 'origin-input', CFG.quickPicks && CFG.quickPicks.from, pickOrigin);
    renderQuickPicks('dest-quick', 'dest-input', CFG.quickPicks && CFG.quickPicks.to, pickDestination);

    $('gps-btn').addEventListener('click', requestGps);

    // Swap. The uphill/downhill answer flips completely, so this is not a
    // cosmetic convenience — it is a different journey.
    $('swap-btn').addEventListener('click', function () {
      if (!state.origin && !state.destination) return;
      var o = state.origin;
      state.origin = state.destination;
      state.destination = o;
      state.originSource = 'manual';
      state.originCorrected = true;
      state.selectedKey = null;

      $('origin-input').value = state.origin ? state.origin.name : '';
      $('dest-input').value = state.destination ? state.destination.name : '';
      setOriginStatus(state.origin ? 'Starting from ' + state.origin.name + '.' : '', 'ok');
      $('dest-status').textContent = state.destination ? 'Going to ' + state.destination.name + '.' : '';
      $('origin-confirm').hidden = true;
      recompute();
    });

    $('when-input').addEventListener('change', function (e) {
      var v = e.target.value;
      if (!v) { state.when = null; recompute(); return; }
      var parts = v.split(':');
      var d = new Date();
      d.setHours(+parts[0], +parts[1], 0, 0);
      state.when = d;
      recompute();
    });

    $('now-btn').addEventListener('click', function () {
      state.when = null;
      $('when-input').value = '';
      recompute();
    });

    wireNetwork();

    // Waits count down in real time, so a stale screen is a wrong screen.
    setInterval(function () { if (!state.when) render(); }, 30000);

    requestGps();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
