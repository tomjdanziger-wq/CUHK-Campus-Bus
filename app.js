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
    netZoomBound: false,
    foodGroup: null,
    picker: null,          // { map, onPick }
    live: null             // see "Live location"
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
    home:  'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
    train: 'M12 2c-4 0-8 .5-8 4v9.5A3.5 3.5 0 0 0 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
    pin:   'M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
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

  /** "1.5 km · ↓99 m" — the same facts as describeWalk, for one line. */
  function shortWalk(walkResult) {
    var m = walkResult.metres;
    var dist = m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m';
    var d = walkResult.deltaElevation;
    if (Math.abs(d) < CFG.display.notableElevationMetres) return dist + ' · level';
    return dist + ' · ' + (d > 0 ? '↑' : '↓') + Math.abs(d) + ' m';
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
      $('estimate-note').textContent =
        'Departure times are the published ones, but time spent on the bus is ' +
        'estimated from distance — CUHK does not publish stop-to-stop running times.';
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
  function renderQuickPicks(inputId, picks, onPick, verb) {
    var box = $('quick');
    (picks || []).forEach(function (pick) {
      var place = DATA.places.filter(function (p) { return p.id === pick.place; })[0];
      if (!place) return;   // an id that no longer exists just disappears

      var btn = el('button', 'chip chip--pick');
      btn.type = 'button';
      if (pick.icon && ICON_PATHS[pick.icon]) btn.appendChild(icon(pick.icon));
      btn.appendChild(el('span', null, pick.label || place.name));
      btn.title = verb + ' ' + place.name + (place.nameZh ? ' ' + place.nameZh : '');
      btn.setAttribute('aria-label', btn.title);
      btn.addEventListener('click', function () {
        $(inputId).value = place.name;
        onPick(place);
      });
      box.appendChild(btn);
    });
  }

  function wireAutocomplete(inputId, listId, onPick, pickerTitle) {
    var input = $(inputId);
    var list = $(listId);

    // Always the last row, and the only row while the box is empty: for when
    // you know where it is but not what it is called.
    function mapRow() {
      var li = document.createElement('li');
      var btn = el('button', 'results__map');
      btn.type = 'button';
      btn.setAttribute('role', 'option');
      btn.appendChild(icon('pin'));
      btn.appendChild(el('span', null, 'Choose on map'));
      btn.addEventListener('click', function () {
        close();
        input.blur();
        openPicker(pickerTitle, function (place) {
          input.value = place.name;
          onPick(place);
        });
      });
      li.appendChild(btn);
      return li;
    }

    function close() {
      list.hidden = true;
      list.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
    }

    function render(query) {
      var matches = query ? finder.search(query, DATA.places, 8) : [];
      list.innerHTML = '';

      matches.forEach(function (m) {
        var li = document.createElement('li');
        var btn = el('button');
        btn.type = 'button';
        btn.setAttribute('role', 'option');

        var name = el('span', 'results__name', m.place.name);
        // Found by its building code ("ERB 407"): show the code next to the
        // full name, so it is obvious why this building came up.
        if (m.matched && /^[A-Z][A-Z0-9]{1,4}( LT)?$/.test(m.matched) &&
            m.matched !== m.place.name) {
          name.appendChild(el('span', 'results__tag', m.matched));
        }
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

      list.appendChild(mapRow());
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('input', function () {
      render(input.value.trim());
    });

    input.addEventListener('focus', function () {
      render(input.value.trim());
    });

    // Enter picks the top match, so the keyboard flow works without tapping.
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var first = list.querySelector('button:not(.results__map)');
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

  /**
   * Walking as a single row, always first: it is the baseline every bus is
   * measured against, so it should be visible without taking up the screen.
   * The climb stays in the one line — on this campus a flat time estimate
   * without it would mislead.
   */
  function renderWalkCard(o) {
    var card = el('div', 'opt opt--walk' + (o.isBest ? ' opt--best' : ''));
    var selected = state.selectedKey === o.key;

    var row = el('button', 'walkrow');
    row.type = 'button';
    row.setAttribute('aria-pressed', String(selected));
    row.setAttribute('aria-label', 'Walk, ' + formatRange(o.totalLow, o.totalHigh) +
      ' minutes, ' + describeWalk(o.walk) + '. ' + (selected ? 'Hide map' : 'Show on map'));
    row.appendChild(icon('walk', 'walkrow__icon'));

    var text = el('span', 'walkrow__text');
    text.appendChild(el('span', 'walkrow__label', 'Walk'));
    text.appendChild(el('span', 'walkrow__sub', shortWalk(o.walk)));
    row.appendChild(text);

    var time = el('span', 'walkrow__time');
    time.appendChild(el('strong', null, formatRange(o.totalLow, o.totalHigh)));
    time.appendChild(document.createTextNode(' min'));
    // Without "arrive": the row is one line wide and the clock time reads
    // for itself under the duration.
    time.appendChild(el('span', 'walkrow__arrive', o.arrivalLabel.replace(/^arrive /, '')));
    row.appendChild(time);
    row.appendChild(icon('map', 'walkrow__map'));

    row.addEventListener('click', function () {
      state.selectedKey = selected ? null : o.key;
      render();
      if (state.selectedKey) showMapFor(o);
    });
    card.appendChild(row);

    var body = el('div', 'opt__body');
    attachMapPanel(o, body);
    if (body.firstChild) card.appendChild(body);
    return card;
  }

  function routeBadge(route) {
    var b = el('span', 'badge', route.id);
    b.style.setProperty('--route-colour', route.colour);
    b.setAttribute('aria-hidden', 'true');
    return b;
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

    // --- header ---
    var head = el('div', 'opt__head');
    head.appendChild(icon('bus', 'icon--mode'));

    // Route numbers as coloured badges, the way transit maps and maps apps
    // show them: the colour identifies the line, the number names it.
    var titles = el('div', 'opt__titles');
    var modeLine = el('h2', 'opt__mode');
    modeLine.setAttribute('aria-label',
      routes.length > 1 ? 'Route ' + joinList(routes.map(function (r) { return r.id; }))
                        : o.route.name);
    routes.forEach(function (r) { modeLine.appendChild(routeBadge(r)); });
    titles.appendChild(modeLine);
    head.appendChild(titles);

    // The headline is time spent MOVING. The wait gets its own line below,
    // because rolling it in would claim the bus takes as long as your bad
    // luck with the timetable.
    var time = el('div', 'opt__time');
    time.appendChild(el('strong', 'opt__time-range', formatRange(o.travelLow, o.travelHigh)));
    time.appendChild(el('span', 'opt__time-unit', 'min travel'));
    time.appendChild(el('span', 'opt__arrive', o.arrivalLabel));
    head.appendChild(time);
    card.appendChild(head);

    // --- the single most important field on the screen ---
    // The most common failure for a new student is waiting at the wrong stop.
    // Name only: the walk to it is in the legs below, and the stop name
    // already says (Upward) or (Downward).
    var board = el('p', 'board');
    board.appendChild(el('span', 'board__label', 'Board at '));
    board.appendChild(el('span', 'board__name', o.boardStop.name));
    card.appendChild(board);

    // --- boarding on the wrong side sends you round the whole campus ---
    if (o.longWayRound) {
      var lw = o.longWayRound;
      var otherSide = lw.better.boardStop.side === 'up' ? 'uphill' : 'downhill';
      card.appendChild(flag('alert', 'flag--danger flag--boxed',
        lw.sameStopPair
          ? 'Wrong side for this trip. From the ' + otherSide + ' stop the ride is ' +
            'about ' + Math.round(lw.penaltyMinutes) + ' min shorter. Take this one ' +
            'only if you just want to be on a bus.'
          : 'The long way round — about ' + Math.round(lw.penaltyMinutes) +
            ' min more riding than ' + lw.better.route.name + ' from ' +
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
    // would quietly lie about — so this is the real gap to the next scheduled
    // departure, named, and never rounded to a comfortable-looking figure.
    var waitRow = el('p', 'waitline');
    waitRow.appendChild(icon('clock'));
    var waitText = el('span', 'waitline__text');
    waitText.appendChild(el('strong', null,
      o.waitMinutes < 0.75 ? 'Leaving now' : 'Wait ' + Math.round(o.waitMinutes) + ' min'));
    waitText.appendChild(document.createTextNode(
      ' for the ' + o.departureTime +
      (routes.length > 1 ? ' (Route ' + o.route.id + ')' : '')));
    waitRow.appendChild(waitText);
    body.appendChild(waitRow);

    // --- the travel legs, deliberately not collapsed into one number ---
    var legs = el('ul', 'legs');

    if (o.walkToStop.metres >= 30) {
      legs.appendChild(legRow('walk', 'Walk',
        'to the stop · ' + shortWalk(o.walkToStop), formatLeg(o.walkToStop.minutes)));
    }

    legs.appendChild(legRow('bus', 'Ride',
      // The "~" on the time marks it as an estimate; the footer says why.
      'to ' + o.alightStop.name,
      o.rideMinutesHigh && o.rideMinutesHigh - o.rideMinutesLow >= 1
        ? '~' + Math.round(o.rideMinutesLow) + '–' + Math.round(o.rideMinutesHigh) + ' min'
        : '~' + Math.round(o.rideMinutes) + ' min'));

    if (o.walkFromStop.metres >= 30) {
      legs.appendChild(legRow('walk', 'Walk',
        shortWalk(o.walkFromStop), formatLeg(o.walkFromStop.minutes)));
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

    renderLastBus();

    if (!state.origin || !state.destination) return;

    var result = planner.plan(state.origin, state.destination, DATA, currentWhen());

    result.options.forEach(function (o) {
      o.arrivalLabel = formatArrivalRange(result.nowMinutes, o.totalLow, o.totalHigh);
    });


    result.options.forEach(function (o) {
      if (o.kind === 'walk') out.appendChild(renderWalkCard(o));
    });
    result.options.forEach(function (o) {
      if (o.kind !== 'walk') out.appendChild(renderShuttleCard(o));
    });

    // The option being mapped can drop out of the list between refreshes
    // (the GPS fix lands, a bus leaves). Then no card claims the map panel,
    // and it was left dangling at the bottom of the page.
    if (state.selectedKey && panel.parentNode === document.body) {
      state.selectedKey = null;
      panel.hidden = true;
    }

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
      js.onerror = function () {
        // Forget the failure, so the next tap tries again (the phone may just
        // have been between networks) instead of failing forever.
        state.mapLoading = null;
        js.remove();
        reject(new Error('Leaflet failed to load'));
      };
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
    // A previous failure may have hidden it; every attempt starts clean.
    container.hidden = false;
    $('map-note').textContent =
      'Illustrative. The written instructions above are the accurate part.';

    loadLeaflet().then(function (L) {
      // Each part of the drawing is isolated. One of them failing on some
      // phone used to abort everything after it — route, walk, markers and
      // all — and because the map object had already been created, every
      // later attempt skipped setup and failed the same way: tiles, nothing
      // else, for the rest of the session.
      var problems = [];
      function safely(what, fn) {
        try { fn(); } catch (err) {
          problems.push(what + ': ' + (err && err.message || err));
          if (window.console) console.error('Map: ' + what + ' failed', err);
        }
      }

      if (!state.map) {
        var created = L.map(container, { scrollWheelZoom: false });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors'
        }).addTo(created);
        state.map = created;
        attachLive(L, created);
      }
      var map = state.map;
      if (!state.ghostLayer) {
        state.ghostLayer = L.layerGroup().addTo(map);
        safely('other routes', function () { drawGhostNetwork(L); });
      }
      if (!state.activeLayer) state.activeLayer = L.layerGroup().addTo(map);

      // Leaflet cannot fit a route into a box with no size, and quietly
      // produces a broken view if asked to. Make sure it knows the real size.
      map.invalidateSize();

      state.activeLayer.clearLayers();

      var bounds = [];
      var add = function (pts) { for (var i = 0; i < pts.length; i++) bounds.push(pts[i]); };

      // --- where the bus carries on to, dashed ---
      // Shown so a rider can see that staying on leads somewhere useful. The
      // dashes say "not the recommendation"; the weight and white casing keep
      // it readable over the tiles, where a faint line simply disappeared.
      if (option.kind === 'shuttle') safely('onward route', function () {
        var onward = onwardShape(option);
        if (onward.length > 1) {
          L.polyline(onward, {
            color: '#ffffff', weight: 6, opacity: 0.85, interactive: false
          }).addTo(state.activeLayer);
          L.polyline(onward, {
            color: option.route.colour, weight: 3.5, opacity: 1,
            dashArray: '9 7', lineCap: 'butt', interactive: false
          }).addTo(state.activeLayer);
          add(onward);
        }
        (option.onwardStops || []).forEach(function (n) {
          L.circleMarker([n.stop.lat, n.stop.lng], {
            radius: 5, color: option.route.colour, weight: 2.5,
            fillColor: '#fffdf8', fillOpacity: 1, opacity: 1
          }).addTo(state.activeLayer).bindPopup(
            '<strong>' + n.stop.name + '</strong><br>stay on for this stop' +
            (n.walkMinutes != null
              ? '<br>then about ' + Math.round(n.walkMinutes) + ' min walk' : ''));
        });
      });

      // --- the ridden stretch, in the route's colour ---
      if (option.kind === 'shuttle') safely('bus route', function () {
        var ridden = riddenShape(option);
        if (ridden.length > 1) {
          // A white casing underneath makes the colour legible over any tile.
          L.polyline(ridden, { color: '#ffffff', weight: 8, opacity: 0.9 })
            .addTo(state.activeLayer);
          L.polyline(ridden, {
            color: option.route.colour, weight: 5, opacity: 1, lineJoin: 'round'
          }).addTo(state.activeLayer).bindPopup(
            option.route.name + (option.route.label ? ' · ' + option.route.label : ''));
          add(ridden);
          safely('direction arrows', function () {
            drawDirectionArrows(L, ridden, state.activeLayer, 180);
          });
        }
      });

      // --- stops passed on the way, as small white dots ---
      // So you can see where else the bus stops before yours, and get off
      // earlier if one of them suits you better. Tap one for the walk from it.
      if (option.kind === 'shuttle') safely('stops on the way', function () {
        var byId = {};
        DATA.stops.forEach(function (st) { byId[st.id] = st; });
        for (var si = option.boardIndex + 1; si < option.alightIndex; si++) {
          var stop = byId[option.route.stops[si]];
          if (!stop) continue;
          var tip = '<strong>' + stop.name + '</strong><br>the bus stops here on the way';
          if (state.destination) {
            var w = geo.walk(stop, state.destination, CFG);
            tip += '<br>get off here: about ' + Math.max(1, Math.round(w.minutes)) + ' min walk';
          }
          L.circleMarker([stop.lat, stop.lng], {
            radius: 4, color: option.route.colour, weight: 2,
            fillColor: '#ffffff', fillOpacity: 1, opacity: 1
          }).addTo(state.activeLayer).bindPopup(tip);
        }
      });

      // --- walking legs, dashed, on real paths ---
      var walkColour = CFG.walkColour || '#1b7f4d';
      function drawWalk(from, to) {
        if (!from || !to) return;
        var line = walkLine(from, to);
        if (line.length < 2) return;
        L.polyline(line, {
          color: walkColour, weight: 4, opacity: 0.95,
          dashArray: '2 9', lineCap: 'round'
        }).addTo(state.activeLayer);
        add(line);
      }

      safely('walking route', function () {
        if (option.kind === 'walk') {
          drawWalk(state.origin, state.destination);
        } else {
          drawWalk(state.origin, option.boardStop);
          drawWalk(option.alightStop, state.destination);
        }
      });

      // --- markers ---
      function marker(p, label, colour, radius) {
        if (!p) return;
        L.circleMarker([p.lat, p.lng], {
          radius: radius || 7, color: '#ffffff', weight: 2.5,
          fillColor: colour, fillOpacity: 1
        }).addTo(state.activeLayer).bindPopup(label);
        bounds.push([p.lat, p.lng]);
      }

      safely('stops', function () {
        if (option.kind === 'shuttle') {
          marker(option.boardStop, 'Board here: ' + option.boardStop.name,
                 option.route.colour, 7);
          marker(option.alightStop, 'Get off: ' + option.alightStop.name,
                 option.route.colour, 7);
        }
        // Hollow, like the start dot in the search box — the solid blue dot
        // is reserved for where you are right now.
        if (state.origin) {
          L.circleMarker([state.origin.lat, state.origin.lng], {
            radius: 6, color: '#1a73e8', weight: 3, fillColor: '#ffffff', fillOpacity: 1
          }).addTo(state.activeLayer).bindPopup('Start: ' + state.origin.name);
          bounds.push([state.origin.lat, state.origin.lng]);
        }
        if (state.destination) {
          marker(state.destination, 'Destination: ' + state.destination.name, '#d93025');
        }
      });

      function fit() {
        map.invalidateSize();
        if (bounds.length) map.fitBounds(bounds, { padding: [35, 35], animate: false });
      }
      safely('zoom to the route', fit);
      safely('legend', function () { renderLegend(option); });
      // Again once the panel has settled into the page: on a phone the first
      // measurement can come before layout, which fits the route into nothing.
      setTimeout(function () { safely('zoom to the route', fit); }, 60);
      setTimeout(function () { try { fit(); } catch (e) {} }, 400);

      // Say so, rather than showing an empty map that looks like a working one.
      if (problems.length) {
        $('map-note').textContent = 'Part of this map could not be drawn (' +
          problems.join('; ') + '). The written instructions above are unaffected.';
      }

    }, function () {
      // Only a failure to LOAD the map hides it. A bug while drawing used to
      // land here too, and hid the map for the rest of the session.
      container.hidden = true;
      $('map-legend').innerHTML = '';
      $('map-note').textContent =
        'The map could not load. Everything above still works — the written ' +
        'instructions are the accurate part anyway.';
    }).catch(function (err) {
      if (window.console) console.error('Map drawing failed:', err);
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
    if (option.kind === 'shuttle' && option.alightIndex - option.boardIndex > 1) {
      var stopsItem = el('span', 'legend__item');
      var dot = el('span', 'legend__stopdot');
      dot.style.borderColor = option.route.colour;
      stopsItem.appendChild(dot);
      stopsItem.appendChild(el('span', null, 'Stops on the way'));
      box.appendChild(stopsItem);
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
    var oldNote = $('network-map-note');
    if (oldNote) oldNote.textContent = '';

    loadLeaflet().then(function (L) {
      if (!state.netMap) {
        state.netMap = L.map(container, { scrollWheelZoom: false });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '© OpenStreetMap contributors'
        }).addTo(state.netMap);
        state.netLayer = L.layerGroup().addTo(state.netMap);
        attachLive(L, state.netMap);
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
          L.polyline(shape.line, { color: '#fff', weight: 8, opacity: 0.9 })
            .addTo(state.netLayer);
        }
        L.polyline(shape.line, {
          color: route.colour,
          weight: active ? 5 : 2.5,
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

    }, function () {
      // A note beside the map, not in place of it: replacing the container
      // destroyed it, so the map could never open again even once online.
      var note = $('network-map-note');
      if (!note) {
        note = el('p', 'map-note');
        note.id = 'network-map-note';
        container.parentNode.insertBefore(note, container.nextSibling);
      }
      note.textContent = 'The map could not load. The stop list below still works.';
    }).catch(function (err) {
      if (window.console) console.error('Route map drawing failed:', err);
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
   * thick enough to hold them, so the chevrons are kept small rather than the
   * line made heavy enough to bury everything else on the map.
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
  // Food browser
  //
  // Answers "where can I eat, and how far is it from here" without anyone
  // having to know a canteen's official name or look the place up on a map
  // somewhere else.
  //
  // Everything comes from OpenStreetMap's own categories rather than from
  // matching words in names. "Café 12" and "Food Lab" are places to eat and
  // "Gallant Place" is not, and no amount of string matching knows that.
  // =========================================================================

  var FOOD_GROUPS = [
    { id: null,     label: 'All' },
    { id: 'meal',   label: 'Canteens & restaurants',
      match: ['restaurant', 'canteen', 'food_court', 'fast_food'] },
    { id: 'cafe',   label: 'Cafés',  match: ['cafe'] },
    { id: 'shop',   label: 'Shops',  match: ['convenience', 'supermarket', 'bakery', 'deli'] }
  ];

  var CATEGORY_LABELS = {
    restaurant: 'Restaurant', canteen: 'Canteen', food_court: 'Food court',
    fast_food: 'Fast food', cafe: 'Café', bar: 'Bar', pub: 'Pub',
    ice_cream: 'Ice cream', bakery: 'Bakery', convenience: 'Convenience shop',
    supermarket: 'Supermarket', deli: 'Deli', coffee: 'Coffee shop'
  };

  /** "↑ 44 m" / "↓ 30 m" / "level" — the gradient at a glance. */
  function compactClimb(walk) {
    var d = walk.deltaElevation;
    if (Math.abs(d) < CFG.display.notableElevationMetres) return 'level';
    return (d > 0 ? '↑ ' : '↓ ') + Math.abs(d) + ' m';
  }

  function wireFood() {
    renderFoodChips();
  }

  function renderFoodChips() {
    var box = $('food-chips');
    box.innerHTML = '';
    FOOD_GROUPS.forEach(function (g) {
      var b = el('button', 'chip');
      b.type = 'button';
      b.textContent = g.label;
      b.setAttribute('aria-pressed', String(state.foodGroup === g.id));
      b.addEventListener('click', function () {
        state.foodGroup = g.id;
        renderFoodChips();
        renderFood();
      });
      box.appendChild(b);
    });
  }

  function renderFood() {
    var list = $('food-list');
    var note = $('food-note');
    list.innerHTML = '';

    var group = FOOD_GROUPS.filter(function (g) { return g.id === state.foodGroup; })[0];
    var places = DATA.places.filter(function (p) {
      if (!p.food) return false;
      return !group || !group.match || group.match.indexOf(p.food.category) !== -1;
    });

    // Sorted by how far it is, when we know where the user is standing.
    var from = state.origin;
    if (from) {
      places = places.map(function (p) {
        return { place: p, walk: geo.walk(from, p, CFG) };
      }).sort(function (a, b) { return a.walk.minutes - b.walk.minutes; });
      note.textContent = places.length + ' places, nearest to ' + from.name + ' first. ' +
        'Tap one to plan the trip — or just search for "canteen" or "coffee".';
    } else {
      places = places.map(function (p) { return { place: p, walk: null }; })
        .sort(function (a, b) { return a.place.name.localeCompare(b.place.name); });
      note.textContent = places.length + ' places, alphabetically — set a starting ' +
        'point above and they sort by how far away they are.';
    }

    places.forEach(function (entry) {
      var p = entry.place;
      var li = el('li', 'foodlist__item');

      var btn = el('button', 'foodlist__btn');
      btn.type = 'button';

      var main = el('span', 'foodlist__main');
      main.appendChild(el('span', 'foodlist__name', p.name));

      var sub = [];
      // Some OSM entries repeat the English name in the Chinese field.
      if (p.nameZh && p.nameZh !== p.name) sub.push(p.nameZh);
      sub.push(CATEGORY_LABELS[p.food.category] || p.food.category);
      main.appendChild(el('span', 'foodlist__sub', sub.join(' · ')));

      btn.appendChild(main);

      if (entry.walk) {
        var dist = el('span', 'foodlist__dist');
        dist.appendChild(el('strong', null, formatLeg(entry.walk.minutes)));
        // Compact here, not the prose used on option cards: this is a long
        // list and the wording pushed every name into three wrapped lines.
        dist.appendChild(el('span', null, compactClimb(entry.walk)));
        btn.appendChild(dist);
      }

      btn.addEventListener('click', function () {
        $('dest-input').value = p.name;
        state.destination = p;
        recompute();
        goToPage(PAGE_TRIP);
        $('page-trip').scrollTop = 0;
      });

      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  // =========================================================================
  // Pages
  //
  // Routes, trip and food sit side by side in one horizontal scroller with
  // scroll snapping, so a swipe is the browser's own gesture — momentum,
  // rubber-banding and direction locking all come for free and feel native.
  // The tabs mirror the scroll position and are the way in for a mouse.
  //
  // Each page scrolls vertically on its own, so leaving the food list and
  // coming back finds it where you left it.
  // =========================================================================

  var PAGE_ROUTES = 0, PAGE_TRIP = 1, PAGE_FOOD = 2;
  var currentPage = PAGE_TRIP;

  function goToPage(index, instant) {
    var pager = $('pager');
    pager.scrollTo({ left: index * pager.clientWidth, behavior: instant ? 'auto' : 'smooth' });
    pageShown(index);
  }

  function pageShown(index) {
    if (index === currentPage && state.pagesReady) return;
    currentPage = index;
    state.pagesReady = true;

    Array.prototype.forEach.call(document.querySelectorAll('.tabs__tab'), function (t) {
      t.setAttribute('aria-selected', String(+t.dataset.page === index));
    });

    // Built on first sight rather than at load: the map pulls in Leaflet and
    // tiles, which nobody planning a trip should have to wait for.
    if (index === PAGE_ROUTES) openNetwork();
    // Re-sorted every visit, because "nearest" depends on the current start.
    if (index === PAGE_FOOD) renderFood();
  }

  function wirePager() {
    var pager = $('pager');

    Array.prototype.forEach.call(document.querySelectorAll('.tabs__tab'), function (t) {
      t.addEventListener('click', function () { goToPage(+t.dataset.page); });
    });

    var pending = false;
    pager.addEventListener('scroll', function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        pageShown(Math.round(pager.scrollLeft / pager.clientWidth));
      });
    }, { passive: true });

    // Rotating the phone changes the page width; stay on the same page.
    window.addEventListener('resize', function () {
      pager.scrollLeft = currentPage * pager.clientWidth;
    });

    goToPage(PAGE_TRIP, true);
  }

  // =========================================================================
  // Last bus
  //
  // plan() answers "what should I do now?". Late in the evening the question
  // is "how late can I leave it?", and the answer is a single time per route
  // that is otherwise buried at the bottom of a PDF.
  // =========================================================================

  function homePlace() {
    var h = CFG.lastBus && CFG.lastBus.home;
    if (!h) return null;
    return DATA.places.filter(function (p) { return p.id === h.place; })[0] || null;
  }

  /** The next date whose timetable is the other kind: weekday ↔ Sunday. */
  function otherServiceDay(date) {
    var d = new Date(date);
    var wantSunday = d.getDay() !== 0;
    do { d.setDate(d.getDate() + 1); } while ((d.getDay() === 0) !== wantSunday);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  function renderLastBus() {
    var box = $('lastbus');
    box.innerHTML = '';

    var home = homePlace();
    var dest = state.destination || home;
    if (!dest) { box.hidden = true; return; }

    var label = !state.destination && CFG.lastBus.home.label ? CFG.lastBus.home.label : dest.name;
    var origin = state.origin && state.origin !== dest ? state.origin : null;
    var now = currentWhen();

    var rides = planner.lastRides(dest, DATA, now, origin);
    var upcoming = rides.filter(function (r) { return !r.gone; });

    box.appendChild(el('h2', 'lastbus__title', 'Last bus to ' + label));

    if (!rides.length) {
      box.appendChild(el('p', 'lastbus__none', origin
        ? 'No shuttle today gets you meaningfully closer than walking from ' + origin.name + '.'
        : 'No shuttle runs near there today.'));
    } else if (!upcoming.length) {
      var lastGone = rides[0];
      box.appendChild(el('p', 'lastbus__none lastbus__none--gone',
        'The last one today, ' + lastGone.route.name + ' at ' + lastGone.boardTime +
        ', has gone.'));
    } else {
      var list = el('ul', 'lastbus__list');
      upcoming.slice(0, 3).forEach(function (r) {
        var li = el('li', 'lastbus__row');
        li.style.setProperty('--route-colour', r.route.colour);
        li.appendChild(routeBadge(r.route));
        var text = el('span', 'lastbus__text');
        text.appendChild(el('strong', 'lastbus__time', r.boardTime));
        text.appendChild(document.createTextNode(
          (r.fromFirstStop ? ' leaves ' : ' from ') + r.boardStop.name));
        text.appendChild(el('span', 'lastbus__sub',
          'off at ' + r.alightStop.name +
          (r.walkHome.metres < 30 ? '' : ', then ' + formatLeg(r.walkHome.minutes) + ' walk')));
        li.appendChild(text);
        list.appendChild(li);
      });
      box.appendChild(list);
    }

    // The other timetable, in one line. Sunday's last bus is not Monday's,
    // and the time you need to know is often the one for tomorrow.
    var other = otherServiceDay(now);
    var otherRides = planner.lastRides(dest, DATA, other, origin);
    if (otherRides.length) {
      var o = otherRides[0];
      box.appendChild(el('p', 'lastbus__other',
        (other.getDay() === 0 ? 'Sundays & public holidays'
          : describeDays(o.route.runsOn).replace(/^./, function (c) { return c.toUpperCase(); })) + ': ' +
        o.route.name + ', last at ' + o.boardTime + ' from ' + o.boardStop.name + '.'));
    }

    box.hidden = false;
  }

  // =========================================================================
  // Live location
  //
  // A blue dot on every map that follows you as you walk, so you can check
  // you are still on the right path. It is only ever shown, never used: the
  // start of the journey stays whatever you set, and the dot does not move it.
  //
  // It starts on its own only if location permission is already granted —
  // a map opening should never be what triggers a permission prompt. The
  // locate button on each map starts it otherwise, and centres on you.
  // =========================================================================

  function liveState() {
    if (!state.live) state.live = { watchId: null, fix: null, maps: [], follow: null };
    return state.live;
  }

  function startLive(recentreMap) {
    var live = liveState();
    if (recentreMap) live.follow = recentreMap;
    if (live.fix && recentreMap) {
      recentreMap.setView([live.fix.lat, live.fix.lng], Math.max(recentreMap.getZoom(), 17));
    }
    if (live.watchId !== null || !navigator.geolocation) return;

    live.watchId = navigator.geolocation.watchPosition(function (pos) {
      live.fix = { lat: pos.coords.latitude, lng: pos.coords.longitude,
                   accuracy: pos.coords.accuracy || 0 };
      live.maps.forEach(function (m) { drawLive(m); });
      if (live.follow) {
        var z = live.follow._liveCentred ? live.follow.getZoom() : Math.max(live.follow.getZoom(), 17);
        live.follow._liveCentred = true;
        live.follow.setView([live.fix.lat, live.fix.lng], z, { animate: true });
      }
    }, function () {
      stopLive();
      live.maps.forEach(function (m) { if (m.entry) m.entry.button.setAttribute('aria-pressed', 'false'); });
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });

    live.maps.forEach(function (m) { if (m.entry) m.entry.button.setAttribute('aria-pressed', 'true'); });
  }

  function stopLive() {
    var live = liveState();
    if (live.watchId !== null) navigator.geolocation.clearWatch(live.watchId);
    live.watchId = null;
  }

  function drawLive(m) {
    var fix = liveState().fix;
    if (!fix) return;
    var ll = [fix.lat, fix.lng];
    if (!m.dot) {
      m.halo = window.L.circle(ll, {
        radius: fix.accuracy, color: '#1a73e8', weight: 1, opacity: 0.35,
        fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false
      }).addTo(m.map);
      m.dot = window.L.marker(ll, {
        icon: window.L.divIcon({ className: 'livedot', html: '<span></span>', iconSize: [18, 18] }),
        interactive: false, keyboard: false, zIndexOffset: 1000
      }).addTo(m.map);
    } else {
      m.dot.setLatLng(ll);
      m.halo.setLatLng(ll).setRadius(fix.accuracy);
    }
  }

  /**
   * Live location is an extra. Whatever goes wrong in it — a browser without
   * the Permissions API, one that throws instead of rejecting — must never
   * stop the map itself from drawing.
   */
  function attachLive(L, map) {
    try {
      attachLiveUnsafe(L, map);
    } catch (err) {
      if (window.console) console.warn('Live location unavailable:', err);
    }
  }

  function attachLiveUnsafe(L, map) {
    var live = liveState();
    var m = { map: map, dot: null, halo: null, entry: null };

    var Locate = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd: function () {
        var b = L.DomUtil.create('button', 'locate-btn');
        b.type = 'button';
        b.title = 'Show my location';
        b.setAttribute('aria-label', 'Show and follow my location');
        b.setAttribute('aria-pressed', String(live.watchId !== null));
        b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' +
                      ICON_PATHS.gps + '"/></svg>';
        L.DomEvent.disableClickPropagation(b);
        L.DomEvent.on(b, 'click', function () { map._liveCentred = false; startLive(map); });
        m.entry = { button: b };
        return b;
      }
    });
    map.addControl(new Locate());

    // Dragging the map means "let me look around": stop following, keep the dot.
    map.on('dragstart', function () { if (live.follow === map) live.follow = null; });

    live.maps.push(m);
    drawLive(m);

    if (live.watchId === null && navigator.permissions && navigator.permissions.query) {
      try {
        Promise.resolve(navigator.permissions.query({ name: 'geolocation' })).then(function (p) {
          if (p && p.state === 'granted') startLive(null);
        }).catch(function () {});
      } catch (e) { /* older Safari throws here; the locate button still works */ }
    }
  }

  // Watching GPS drains the battery; nobody needs it while the app is hidden.
  document.addEventListener('visibilitychange', function () {
    var live = state.live;
    if (!live) return;
    if (document.hidden) {
      live.resume = live.watchId !== null;
      stopLive();
    } else if (live.resume) {
      startLive(null);
    }
  });

  // =========================================================================
  // Drop a pin
  //
  // For "that building by the lake, whatever it is called". The map moves
  // under a fixed pin; the nearest named place is shown so you can tell the
  // pin is where you meant, and becomes the label for the journey.
  // =========================================================================

  var PICKER_DEFAULT = [22.4196, 114.2068];   // roughly the middle of campus

  // Places too big to name a spot by. The university's OSM point sits in the
  // middle of campus, so without this every pin there is "near CUHK".
  var TOO_BIG_TO_NAME = { 'the-chinese-university-of-hong-kong': true };

  function nearestPlace(lat, lng) {
    var best = null, bestD = Infinity;
    DATA.places.forEach(function (p) {
      if (TOO_BIG_TO_NAME[p.id]) return;
      var d = geo.haversineMetres({ lat: lat, lng: lng }, p);
      if (d < bestD) { bestD = d; best = p; }
    });
    return best ? { place: best, metres: bestD } : null;
  }

  function pinnedPlace(lat, lng) {
    var near = nearestPlace(lat, lng);
    var point = { lat: lat, lng: lng };
    point.elevation = geo.estimateElevation(point, DATA.places);
    // Right on top of a known place: it IS that place, and the journey should
    // say so. Otherwise name it by what it is next to.
    if (near && near.metres <= 25) {
      point.name = near.place.name;
      point.nameZh = near.place.nameZh || null;
    } else {
      point.name = near && near.metres <= 250 ? 'Pin near ' + near.place.name : 'Dropped pin';
      point.nameZh = null;
    }
    return point;
  }

  function openPicker(which, onPick) {
    var picker = $('picker');
    var isStart = which === 'start';
    $('picker-title').textContent = isStart ? 'Choose start' : 'Choose destination';
    $('picker-ok').textContent = isStart ? 'Set start' : 'Set destination';
    picker.hidden = false;
    $('picker-ok').disabled = false;

    var current = isStart ? state.origin : state.destination;
    var fix = state.live && state.live.fix;
    var centre = current ? [current.lat, current.lng]
               : fix ? [fix.lat, fix.lng]
               : PICKER_DEFAULT;

    loadLeaflet().then(function (L) {
      if (!state.picker) {
        var map = L.map('picker-map', { zoomControl: false, attributionControl: true });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '© OpenStreetMap contributors'
        }).addTo(map);
        map.on('move', updatePickerLabel);
        attachLive(L, map);
        state.picker = { map: map, onPick: null };
      }
      state.picker.onPick = onPick;
      state.picker.map.invalidateSize();
      state.picker.map.setView(centre, current ? 18 : 17, { animate: false });
      updatePickerLabel();
    }, function () {
      $('picker-near').textContent = 'The map could not load. Search by name instead.';
      $('picker-ok').disabled = true;
    }).catch(function (err) {
      if (window.console) console.error('Pin map failed:', err);
    });
  }

  function updatePickerLabel() {
    if (!state.picker) return;
    var c = state.picker.map.getCenter();
    $('picker-near').textContent = pinnedPlace(c.lat, c.lng).name;
  }

  function closePicker() {
    $('picker').hidden = true;
    if (state.live && state.picker && state.live.follow === state.picker.map) state.live.follow = null;
  }

  function wirePicker() {
    $('picker-close').addEventListener('click', closePicker);
    $('picker-ok').addEventListener('click', function () {
      if (!state.picker) return;
      var c = state.picker.map.getCenter();
      var onPick = state.picker.onPick;
      closePicker();
      if (onPick) onPick(pinnedPlace(c.lat, c.lng));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('picker').hidden) closePicker();
    });
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
      // The box already shows the name; repeating it underneath is a wasted row.
      setOriginStatus('');
      $('origin-confirm').hidden = true;
      recompute();
    };

    var pickDestination = function (place) {
      state.destination = place;
      recompute();
    };

    wireAutocomplete('origin-input', 'origin-results', pickOrigin, 'start');
    wireAutocomplete('dest-input', 'dest-results', pickDestination, 'destination');
    wirePicker();

    renderQuickPicks('origin-input', CFG.quickPicks && CFG.quickPicks.from, pickOrigin, 'Start from');
    renderQuickPicks('dest-input', CFG.quickPicks && CFG.quickPicks.to, pickDestination, 'Go to');

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
      setOriginStatus('');
      $('origin-confirm').hidden = true;
      recompute();
    });

    // The departure time is a small chip, not a form row: nearly every trip
    // is "now", so it should cost no space until someone wants it.
    function syncWhen() {
      $('when-label').textContent = state.when
        ? planner.formatHHMM(planner.minutesSinceMidnight(state.when)) : 'Now';
      $('now-btn').hidden = !state.when;
    }

    $('when-input').addEventListener('click', function () {
      // Desktop browsers only open the picker from their own tiny icon.
      try { this.showPicker(); } catch (e) { /* not supported; typing works */ }
    });

    $('when-input').addEventListener('change', function (e) {
      var v = e.target.value;
      if (!v) { state.when = null; syncWhen(); recompute(); return; }
      var parts = v.split(':');
      var d = new Date();
      d.setHours(+parts[0], +parts[1], 0, 0);
      state.when = d;
      syncWhen();
      recompute();
    });

    $('now-btn').addEventListener('click', function () {
      state.when = null;
      $('when-input').value = '';
      syncWhen();
      recompute();
    });

    wireNetwork();
    wireFood();
    wirePager();
    render();

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
