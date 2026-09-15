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
    signal: 'M7.76 16.24C6.67 15.16 6 13.66 6 12s.67-3.16 1.76-4.24l1.42 1.42C8.45 9.9 8 10.9 8 12c0 1.1.45 2.1 1.17 2.83l-1.41 1.41zm8.48 0C17.33 15.16 18 13.66 18 12s-.67-3.16-1.76-4.24l-1.42 1.42C15.55 9.9 16 10.9 16 12c0 1.1-.45 2.1-1.17 2.83l1.41 1.41zM12 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
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
    head.appendChild(mapToggle(o));
    card.appendChild(head);

    // The map opens right under the header, above the details — the way a
    // maps app shows the route first and the steps after it.
    var mapSlot = el('div', 'opt__mapslot');
    attachMapPanel(o, mapSlot);
    if (mapSlot.firstChild) card.appendChild(mapSlot);

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

    // --- what riders have reported ---
    var seen = sightingForOption(o);
    if (seen) {
      var seenRow = el('p', 'seenline');
      seenRow.appendChild(icon('signal'));
      var seenText = el('span', null);
      seenText.appendChild(el('strong', null, 'Rider report'));
      seenText.appendChild(document.createTextNode(
        ' · Route ' + seen.route.id + ' at ' + seen.stop.name + ', ' + agoText(seen.ageMinutes) +
        // Where that is relative to you is the useful part. Stop order is a
        // fair guide, not a certainty, on routes that loop.
        (seen.where === 'before' ? ' — still before your stop'
          : seen.where === 'at' ? ' — at your stop'
          : seen.where === 'after' ? ' — already past your stop' : '')));
      seenRow.appendChild(seenText);
      body.appendChild(seenRow);
    }

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
   * The map icon at the end of an option's header, in the same place as on
   * the walking row. Selecting an option only changes what the map draws. It
   * is not a commitment, and nothing is ever pre-selected on the user's behalf.
   */
  function mapToggle(o) {
    var selected = state.selectedKey === o.key;
    var btn = el('button', 'maptoggle');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(selected));
    btn.setAttribute('aria-label', selected ? 'Hide map' : 'Show on map');
    btn.title = selected ? 'Hide map' : 'Show on map';
    btn.appendChild(icon('map'));
    btn.addEventListener('click', function () {
      state.selectedKey = selected ? null : o.key;
      render();
      if (state.selectedKey) showMapFor(o);
    });
    return btn;
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
          // Deliberately faint and small: these are "if you stayed on", and
          // at full strength they looked just like the stop to get off at.
          L.circleMarker([n.stop.lat, n.stop.lng], {
            radius: 3.5, color: option.route.colour, weight: 1.5,
            fillColor: '#ffffff', fillOpacity: 0.7, opacity: 0.45
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
      // Same protection as the trip map: a failure in one part must not blank
      // the rest, nor leave half-built state that breaks every later attempt.
      var problems = [];
      function safely(what, fn) {
        try { fn(); } catch (err) {
          problems.push(what + ': ' + (err && err.message || err));
          if (window.console) console.error('Route map: ' + what + ' failed', err);
        }
      }

      if (!state.netMap) {
        // Fractional zoom, so the whole network fills the map instead of
        // sitting in its middle third at the nearest whole zoom level.
        var created = L.map(container, { scrollWheelZoom: false, zoomSnap: 0.25 });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '© OpenStreetMap contributors'
        }).addTo(created);
        state.netMap = created;
        attachLive(L, created);
      }
      var map = state.netMap;
      if (!state.netLayer) state.netLayer = L.layerGroup().addTo(map);
      map.invalidateSize();
      state.netLayer.clearLayers();

      var only = state.netRoute;
      var bounds = [];

      // --- route lines ---
      DATA.routes.forEach(function (route) { safely('Route ' + route.id, function () {
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
          shape.line.forEach(function (pt) { bounds.push(pt); });
          if (only) drawDirectionArrows(L, shape.line, state.netLayer);
        }
      }); });

      // --- stop markers ---
      var shown = {};
      DATA.routes.forEach(function (route) {
        if (only && only !== route.id) return;
        route.stops.forEach(function (id) { shown[id] = true; });
      });

      DATA.stops.forEach(function (stop) { safely('stop ' + stop.id, function () {
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
      }); });

      // Fit now, and again once the page has finished sliding into view. On a
      // phone the swipe to this page is still animating when the map is
      // built, so the first measurement is of a map that is not on screen yet
      // and the routes get fitted into a sliver.
      function fit() {
        map.invalidateSize();
        if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], animate: false });
      }
      state.netFit = fit;
      safely('zoom to the routes', fit);
      setTimeout(function () { safely('zoom to the routes', fit); }, 80);
      setTimeout(function () { safely('zoom to the routes', fit); }, 450);

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
      safely('stop labels', syncNetworkLabels);

      var note = $('network-map-note');
      if (problems.length) {
        if (!note) {
          note = el('p', 'map-note');
          note.id = 'network-map-note';
          container.parentNode.insertBefore(note, container.nextSibling);
        }
        note.textContent = 'Part of this map could not be drawn (' + problems.join('; ') + ').';
      }

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
  // Pages
  //
  // Spot, track, routes and trip sit side by side in one horizontal scroller with
  // scroll snapping, so a swipe is the browser's own gesture — momentum,
  // rubber-banding and direction locking all come for free and feel native.
  // The tabs mirror the scroll position and are the way in for a mouse.
  //
  // Each page scrolls vertically on its own, so leaving a page and coming
  // back finds it where you left it.
  // =========================================================================

  var PAGE_SPOT = 0, PAGE_TRACK = 1, PAGE_ROUTES = 2, PAGE_TRIP = 3;
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
    if (index === PAGE_TRACK) openTrack();
    if (index === PAGE_SPOT) openSpot(); else closeSpot();
  }

  function wirePager() {
    var pager = $('pager');

    Array.prototype.forEach.call(document.querySelectorAll('.tabs__tab'), function (t) {
      t.addEventListener('click', function () { goToPage(+t.dataset.page); });
    });

    var pending = false, settle = null;
    pager.addEventListener('scroll', function () {
      // Once the swipe has come to rest, re-measure the route map. It was
      // built while its page was still sliding in.
      clearTimeout(settle);
      settle = setTimeout(function () {
        if (currentPage === PAGE_ROUTES && state.netFit) {
          try { state.netFit(); } catch (e) { /* the map note already says */ }
        }
      }, 150);
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
  // Track: rider reports
  //
  // Someone who has just boarded says where and which bus, in two taps.
  // Reports go to Cloud Firestore. The phone signs in to Firebase
  // anonymously — invisibly, no screen, no name, no email — which is only
  // there so the security rules can tell one phone from another for the
  // cooldown. Everything shown is labelled as a rider report with its age:
  // never "live", never official.
  //
  // If Firebase cannot load (no signal, config removed) the page says
  // tracking is off and everything else carries on.
  // =========================================================================

  var FIREBASE_SDK = 'https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.1/';
  var TRACK = CFG.tracking || { showMinutes: 90, cooldownSeconds: 45,
                                cardMaxAgeMinutes: 20, confirmWindowMinutes: 5 };

  var track = {
    status: 'unknown',     // 'connecting' | 'ok' | 'off' | 'error'
    list: [],
    stop: null,            // selected stop id
    route: null,           // selected route id
    showAllStops: false,
    cooldownUntil: 0,
    ready: null,           // Promise of Firestore
    unsubscribe: null,     // stops both listeners
    lists: { sightings: null, spots: null },
    subscribedAt: 0
  };

  function stopById(id) {
    for (var i = 0; i < DATA.stops.length; i++) if (DATA.stops[i].id === id) return DATA.stops[i];
    return null;
  }
  function routeById(id) {
    for (var i = 0; i < DATA.routes.length; i++) if (DATA.routes[i].id === id) return DATA.routes[i];
    return null;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var js = document.createElement('script');
      js.src = src;
      js.onload = resolve;
      js.onerror = function () { js.remove(); reject(new Error('failed: ' + src)); };
      document.head.appendChild(js);
    });
  }

  /**
   * Firebase, loaded only when tracking is first needed, and signed in
   * anonymously. Resolves to the Firestore handle. A failure is forgotten, so
   * the next attempt tries again.
   */
  function firebaseReady() {
    if (!window.FIREBASE_CONFIG) return Promise.reject(new Error('off'));
    if (track.ready) return track.ready;

    track.ready = loadScript(FIREBASE_SDK + 'firebase-app-compat.min.js')
      .then(function () {
        return Promise.all([
          loadScript(FIREBASE_SDK + 'firebase-auth-compat.min.js'),
          loadScript(FIREBASE_SDK + 'firebase-firestore-compat.min.js')
        ]);
      })
      .then(function () {
        var fb = window.firebase;
        if (!fb.apps.length) fb.initializeApp(window.FIREBASE_CONFIG);
        return fb.auth().currentUser ? fb.auth().currentUser : fb.auth().signInAnonymously();
      })
      .then(function () { return window.firebase.firestore(); })
      .catch(function (err) {
        track.ready = null;
        throw err;
      });
    return track.ready;
  }

  function toMillis(t) {
    if (!t) return Date.now();                  // pending server timestamp
    return typeof t.toMillis === 'function' ? t.toMillis() : +t;
  }

  /**
   * Keep a live listener on the last `showMinutes` of reports. Only changes
   * are sent and billed, so this is cheaper than polling as well as quicker.
   * The window is fixed when the listener starts, so it is renewed regularly.
   */
  /**
   * Keep live listeners on the last `showMinutes` of reports: rides
   * (sightings) and buses spotted from the kerb (spots). Only changes are
   * sent and billed, so this is cheaper than polling as well as quicker. The
   * window is fixed when a listener starts, so it is renewed regularly.
   */
  function fetchSightings() {
    return firebaseReady().then(function (db) {
      if (track.unsubscribe && Date.now() - track.subscribedAt < 10 * 60000) return;
      stopListening();

      var since = window.firebase.firestore.Timestamp.fromMillis(Date.now() - TRACK.showMinutes * 60000);
      track.subscribedAt = Date.now();
      track.lists = { sightings: null, spots: null };
      track.failed = {};

      var offs = ['sightings', 'spots'].map(function (name) {
        return db.collection(name)
          .where('t', '>=', since)
          .orderBy('t', 'desc')
          .limit(200)
          .onSnapshot({ includeMetadataChanges: true }, function (snap) {
            // Firestore answers from its local cache first and quietly waits
            // for the server. An empty cache is not "no reports", so say
            // "connecting" until the server has actually replied.
            if (snap.metadata.fromCache && track.status !== 'ok') {
              track.status = 'connecting';
              sightingsChanged();
              return;
            }
            track.lists[name] = snap.docs.map(function (d) {
              var v = d.data({ serverTimestamps: 'estimate' });
              return {
                id: d.id, stop: v.stop, route: v.route, i: v.i,
                // A spotter's session id is not a ride: every spot stands
                // on its own in the list.
                trip: name === 'spots' ? null : v.trip,
                // Who reported it — a ride, or a spotter's session — so one
                // person's reports are never merged into a single bus.
                reporter: v.trip || null,
                spot: name === 'spots',
                t: toMillis(v.at || v.t)
              };
            });
            mergeLists();
          }, function (err) {
            // One collection refused (rules not yet published for it, say)
            // must not take the other down with it. Carry on with an empty
            // list for this one; only if both fail is tracking unavailable.
            if (window.console) console.warn(name + ' listener:', err);
            track.failed = track.failed || {};
            track.failed[name] = true;
            track.lists[name] = [];
            if (track.failed.sightings && track.failed.spots) {
              track.status = 'error';
              stopListening();
              sightingsChanged();
            } else {
              mergeLists();
            }
          });
      });
      track.unsubscribe = function () { offs.forEach(function (off) { off(); }); };
    }).catch(function (err) {
      track.status = err && err.message === 'off' ? 'off' : 'error';
      sightingsChanged();
    });
  }

  function stopListening() {
    if (track.unsubscribe) track.unsubscribe();
    track.unsubscribe = null;
  }

  function mergeLists() {
    if (track.lists.sightings === null && track.lists.spots === null) return;
    track.status = 'ok';
    track.list = (track.lists.sightings || []).concat(track.lists.spots || [])
      .filter(function (sg) { return Date.now() - sg.t <= TRACK.showMinutes * 60000; })
      .sort(function (a, b) { return b.t - a.t; });
    sightingsChanged();
  }

  function sightingsChanged() {
    if (currentPage === PAGE_TRACK) { renderSightings(); if (!track.ride) renderReport(); }
    if (currentPage === PAGE_SPOT) renderSpotLog();
    if (state.origin && state.destination) render();
  }

  function minutesAgo(t) {
    return Math.max(0, (Date.now() - t) / 60000);
  }

  function agoText(min) {
    if (min < 1) return 'just now';
    if (min < 60) return Math.round(min) + ' min ago';
    return Math.floor(min / 60) + ' h ' + Math.round(min % 60) + ' min ago';
  }

  /**
   * The most recent report of a bus this option could put you on, if it is
   * recent enough to mean anything.
   */
  function sightingForOption(o) {
    if (track.status !== 'ok' || !track.list.length) return null;
    var routes = o.routes || [o.route];
    var ids = routes.map(function (r) { return r.id; });
    for (var i = 0; i < track.list.length; i++) {       // newest first
      var sg = track.list[i];
      if (ids.indexOf(sg.route) === -1) continue;
      var age = minutesAgo(sg.t);
      if (age > TRACK.cardMaxAgeMinutes) return null;
      var route = routeById(sg.route), stop = stopById(sg.stop);
      if (!route || !stop) continue;
      var idx = route.stops.indexOf(sg.stop);
      var boardIdx = route.stops.indexOf(o.boardStop.id);
      var where = idx === -1 || boardIdx === -1 ? null
        : idx < boardIdx ? 'before' : idx === boardIdx ? 'at' : 'after';
      return { route: route, stop: stop, ageMinutes: age, where: where };
    }
    return null;
  }

  /** Where to measure "closest stop" from: where you are, if we know. */
  function trackReference() {
    if (state.live && state.live.fix) return state.live.fix;
    if (state.origin && state.originSource === 'gps') return state.origin;
    return null;
  }

  function renderReportStops() {
    var box = $('report-stops');
    box.innerHTML = '';
    var ref = trackReference();

    var stops = DATA.stops.slice();
    var dist = {};
    if (ref) {
      stops.forEach(function (st) { dist[st.id] = geo.haversineMetres(ref, st); });
      stops.sort(function (a, b) { return dist[a.id] - dist[b.id]; });
    } else {
      stops.sort(function (a, b) { return a.name.localeCompare(b.name); });
    }

    var shown = track.showAllStops || !ref ? stops : stops.slice(0, 6);
    // A toggle both ways: once the whole list was open it could not be closed.
    $('report-more').hidden = !ref;
    $('report-more').textContent = track.showAllStops ? 'Show fewer stops' : 'Show all stops';

    shown.forEach(function (st) {
      var b = el('button', 'report__stop');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(track.stop === st.id));
      b.appendChild(el('span', 'report__stopname', st.name));
      if (ref) {
        var d = dist[st.id];
        b.appendChild(el('span', 'report__stopdist',
          d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(1) + ' km'));
      }
      b.addEventListener('click', function () {
        // Tapping the chosen stop again un-chooses it and folds the buses away.
        if (track.stop === st.id) {
          track.stop = null;
          track.route = null;
          renderReport();
          return;
        }
        track.stop = st.id;
        var serving = DATA.routes.filter(function (r) {
          return r.stops.indexOf(st.id) !== -1 && planner.runsToday(r, new Date());
        });
        track.route = serving.length === 1 ? serving[0].id : null;
        renderReport();
      });
      box.appendChild(b);
    });
  }

  function renderReport() {
    renderReportStops();

    var routeBox = $('report-route-box');
    var chips = $('report-routes');
    chips.innerHTML = '';
    routeBox.hidden = !track.stop;
    if (track.stop) {
      // Only buses that run today: nobody just boarded the holiday service
      // on a Tuesday. If that leaves nothing (a data gap), offer them all.
      var serving = DATA.routes.filter(function (r) { return r.stops.indexOf(track.stop) !== -1; });
      var today = serving.filter(function (r) { return planner.runsToday(r, new Date()); });
      (today.length ? today : serving)
        .forEach(function (r) {
          var c = el('button', 'chip chip--colour');
          c.type = 'button';
          c.style.setProperty('--chip-colour', r.colour);
          c.setAttribute('aria-pressed', String(track.route === r.id));
          c.appendChild(el('span', 'chip__dot'));
          c.appendChild(el('span', null, r.id));
          c.title = r.name + (r.label ? ' · ' + r.label : '');
          c.addEventListener('click', function () { track.route = r.id; renderReport(); });
          chips.appendChild(c);
        });
    }

    var send = $('report-send');
    var wait = Math.ceil((track.cooldownUntil - Date.now()) / 1000);
    if (track.status === 'off') {
      send.disabled = true;
      send.textContent = 'Tracking is not switched on yet';
    } else if (wait > 0) {
      send.disabled = true;
      send.textContent = 'Thanks! You can report again in ' + wait + ' s';
    } else if (!track.stop) {
      send.disabled = true;
      send.textContent = 'Choose a stop';
    } else if (!track.route) {
      send.disabled = true;
      send.textContent = 'Choose the bus';
    } else {
      send.disabled = false;
      send.textContent = 'Report Route ' + track.route + ' at ' + stopById(track.stop).name;
    }
  }

  /** A random id for one ride. Nothing links it to the phone or person. */
  function newTripId() {
    var bytes = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  /**
   * Write one report: this stop, at this position on this route, as part of
   * this ride. Rejects with { code } — 'off', 'permission-denied' (cooldown),
   * 'slow', or whatever Firestore said.
   */
  function postSighting(route, i, stop, trip, extra) {
    return postRideEvent('sightings', route, i, stop, trip, extra);
  }

  /** Where a rider got off. `how`: 'gps' (guessed and accepted), 'tap'
   *  (they said "I got off" at the stop we had them at), 'picked' (chose it). */
  function postAlighting(route, i, stop, trip, at, how) {
    return postRideEvent('alightings', route, i, stop, trip, { at: at, how: how });
  }

  function postRideEvent(collection, route, i, stop, trip, extra) {
    extra = extra || {};
    return firebaseReady().then(function (db) {
      var fb = window.firebase;
      var uid = fb.auth().currentUser.uid;
      var now = fb.firestore.FieldValue.serverTimestamp();

      // One batch, two writes: the report, and this phone's cooldown marker.
      // The rules only accept the report if the marker moves in the same
      // batch, and only let the marker move once the cooldown has passed —
      // a short one when it is the next stop of the same ride.
      var batch = db.batch();
      var doc = {
        stop: stop, route: route, i: i, trip: trip, t: now,
        // Firestore's TTL policy deletes the document after this time.
        expireAt: fb.firestore.Timestamp.fromMillis(Date.now() + TRACK.keepDays * 86400000)
      };
      // When the bus actually got there, by the phone's clock. Differs from
      // `t` when the report had to wait for signal or for the cooldown, and
      // it is what the ride-time measurement uses.
      if (extra.at) doc.at = fb.firestore.Timestamp.fromMillis(extra.at);
      if (extra.auto) doc.auto = true;
      if (extra.how) doc.how = extra.how;
      batch.set(db.collection(collection).doc(), doc);
      batch.set(db.collection('throttle').doc(uid), { t: now, trip: trip });

      // Firestore never fails a write for lack of signal; it queues it and
      // keeps trying. Don't leave a button on "Sending…" forever.
      return Promise.race([
        batch.commit(),
        new Promise(function (resolve, reject) {
          setTimeout(function () { reject({ code: 'slow' }); }, 12000);
        })
      ]);
    }, function (err) {
      throw { code: err && err.message === 'off' ? 'off' : 'unavailable' };
    });
  }

  function describeFailure(err, cooldownText) {
    var code = err && err.code;
    if (code === 'off') { track.status = 'off'; return 'Tracking is not switched on yet.'; }
    if (code === 'permission-denied') return cooldownText;
    if (code === 'slow') return 'Slow connection — it will go through as soon as it can.';
    if (code === 'unavailable' || !navigator.onLine) return 'No connection. Try again when you have signal.';
    if (window.console) console.warn('Report failed:', err);
    return 'That did not go through. Try again.';
  }

  function sendReport() {
    if (!track.stop || !track.route) return;
    var stop = track.stop, route = routeById(track.route);
    var i = route.stops.indexOf(stop);
    var trip = newTripId();
    var status = $('report-status');
    $('report-send').disabled = true;
    status.textContent = 'Sending…';

    postSighting(route.id, i, stop, trip).then(started, function (err) {
      if (err && err.code === 'slow') return started();    // queued; carry on
      status.textContent = describeFailure(err, 'You just reported. Try again in a moment.');
      if (err && err.code === 'permission-denied') {
        track.cooldownUntil = Date.now() + TRACK.cooldownSeconds * 1000;
        tickCooldown();
      }
      renderReport();
    });

    function started() {
      status.textContent = '';
      track.cooldownUntil = Date.now() + TRACK.cooldownSeconds * 1000;
      track.stop = null;
      track.route = null;
      // Straight into logging the ride: the next useful tap is the next stop,
      // and "I got off" is one tap away for anyone who only wanted to report.
      track.ride = { trip: trip, route: route.id, i: i,
                     log: [{ i: i, stop: stop, t: Date.now() }], queue: [],
                     nextAllowed: Date.now() + TRACK.rideTapSeconds * 1000, follow: true };
      saveRide();
      renderTrackMode();
      startRideFollow();
      fetchSightings();
    }
  }

  // ---- ride mode ------------------------------------------------------------

  function saveRide() {
    try {
      if (track.ride) localStorage.setItem('ride', JSON.stringify(track.ride));
      else localStorage.removeItem('ride');
    } catch (e) { /* private mode: the ride just won't survive a reload */ }
  }

  function loadRide() {
    try {
      var r = JSON.parse(localStorage.getItem('ride') || 'null');
      var last = r && r.log && r.log.length ? r.log[r.log.length - 1].t : 0;
      if (r && routeById(r.route) && Date.now() - last < TRACK.rideIdleMinutes * 60000) {
        r.sending = false;             // a send cut off by closing the app
        delete r.pumpTimer;
        r.queue = r.queue || [];
        return r;
      }
      localStorage.removeItem('ride');
    } catch (e) { /* ignore */ }
    return null;
  }

  function clock(t) {
    var d = new Date(t);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' +
           ('0' + d.getSeconds()).slice(-2);
  }

  function span(ms) {
    var sec = Math.max(0, Math.round(ms / 1000));
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }

  function endRide(message) {
    stopRideFollow();
    if (track.ride) clearTimeout(track.ride.endTimer);
    track.ride = null;
    saveRide();
    renderTrackMode();
    $('report-status').textContent = message || '';
  }

  function renderRide() {
    var ride = track.ride;
    var route = routeById(ride.route);
    var title = $('ride-title');
    title.innerHTML = '';
    title.appendChild(routeBadge(route));
    title.appendChild(document.createTextNode(' On ' + route.name));

    $('ride-live').hidden = !!ride.ending;
    $('ride-off').hidden = !ride.ending;
    if (ride.ending) { renderEnding(); renderRideLog(); return; }

    var next = ride.i + 1;
    var tap = $('ride-tap');
    if (next >= route.stops.length) {
      endRide('End of the route. Thanks for logging it!');
      return;
    }
    var nextStop = stopById(route.stops[next]);
    tap.disabled = false;
    tap.textContent = 'At ' + (nextStop ? nextStop.name : 'the next stop');

    var follow = $('ride-follow');
    var f = track.follow;
    follow.setAttribute('aria-pressed', String(!!ride.follow));
    follow.textContent = !ride.follow ? 'Log stops from my location'
      : f && f.error ? 'Location unavailable — tap the stops instead'
      : f && f.fixes ? 'Logging stops from your location · keep the app open'
      : 'Waiting for your location…';

    var queued = (ride.queue || []).length;
    $('ride-queue').textContent = queued
      ? queued + (queued === 1 ? ' stop' : ' stops') + ' waiting to send' : '';

    renderRideLog();
  }

  function renderRideLog() {
    var ride = track.ride;
    var log = $('ride-log');
    log.innerHTML = '';
    ride.log.slice().reverse().forEach(function (e, k, arr) {
      var li = el('li', 'ride__entry');
      var st = stopById(e.stop);
      var name = el('span', 'ride__stop', st ? st.name : e.stop);
      if (e.auto) name.appendChild(el('span', 'ride__auto', ' · GPS'));
      li.appendChild(name);
      var prev = arr[k + 1];
      li.appendChild(el('span', 'ride__time',
        clock(e.t) + (prev ? ' · +' + span(e.t - prev.t) : ' · got on')));
      log.appendChild(li);
    });
  }

  /**
   * The bus has reached stop `j` on the route at time `t`. Logged at once;
   * sent when the cooldown and the signal allow, in order. Stops between the
   * last one and `j` were passed without a report, which leaves a gap the
   * ride-time measurement skips over.
   */
  function recordArrival(j, t, auto) {
    var ride = track.ride;
    if (!ride || j <= ride.i) return;
    var route = routeById(ride.route);
    if (j >= route.stops.length) return;
    var entry = { i: j, stop: route.stops[j], t: t, auto: !!auto };
    ride.i = j;
    ride.log.push(entry);
    ride.queue = ride.queue || [];
    ride.queue.push(entry);
    saveRide();
    renderRide();
    pumpRide();
  }

  function pumpRide() {
    var ride = track.ride;
    if (!ride || ride.sending || !ride.queue || !ride.queue.length) return;
    var wait = ride.nextAllowed - Date.now();
    if (wait > 0) {
      clearTimeout(ride.pumpTimer);
      ride.pumpTimer = setTimeout(pumpRide, wait + 50);
      return;
    }

    var e = ride.queue[0];
    ride.sending = true;
    postSighting(ride.route, e.i, e.stop, ride.trip, { at: e.t, auto: e.auto })
      .then(sent, function (err) {
        if (err && err.code === 'slow') return sent();   // Firestore queued it
        ride.sending = false;
        if (track.ride !== ride) return;
        if (err && err.code === 'off') { $('ride-status').textContent = describeFailure(err); return; }
        // Cooldown, or no signal: try again shortly. Nothing is lost.
        ride.nextAllowed = Date.now() + (err && err.code === 'permission-denied'
          ? TRACK.rideTapSeconds * 1000 : 15000);
        e.attempts = (e.attempts || 0) + 1;
        if (e.attempts > 8) ride.queue.shift();
        saveRide();
        renderRide();
        pumpRide();
      });

    function sent() {
      ride.sending = false;
      if (track.ride !== ride) return;
      ride.queue.shift();
      ride.nextAllowed = Date.now() + TRACK.rideTapSeconds * 1000;
      $('ride-status').textContent = '';
      saveRide();
      renderRide();
      pumpRide();
    }
  }

  // ---- getting off ----------------------------------------------------------

  var AUTO_SAVE_SECONDS = 60;

  /**
   * Ask where the rider got off. From GPS it is a guess, shown with a
   * countdown and saved by itself if nobody answers — most people will have
   * put the phone away by then. From "I got off" it waits for them.
   */
  function startEnding(i, how, at) {
    var ride = track.ride;
    if (!ride) return;
    stopRideFollow();
    ride.ending = { i: i, how: how, at: at, picked: false,
                    deadline: how === 'gps' ? Date.now() + AUTO_SAVE_SECONDS * 1000 : null };
    saveRide();
    renderRide();
    tickEnding();
  }

  function tickEnding() {
    var ride = track.ride;
    if (!ride || !ride.ending) return;
    clearTimeout(ride.endTimer);
    if (ride.ending.deadline && !ride.ending.picked) {
      if (Date.now() >= ride.ending.deadline) { confirmEnding(); return; }
      ride.endTimer = setTimeout(function () { renderEnding(); tickEnding(); }, 1000);
    }
  }

  /** The stops someone could plausibly have got off at: from where they got
   *  on to a few stops past the last one logged. */
  function endingCandidates(ride) {
    var route = routeById(ride.route);
    var from = ride.log.length ? ride.log[0].i : 0;
    var to = Math.min(route.stops.length - 1, ride.i + 3);
    var out = [];
    for (var i = from; i <= to; i++) out.push(i);
    return out;
  }

  function renderEnding() {
    var ride = track.ride;
    var e = ride.ending;
    var route = routeById(ride.route);
    var chosen = stopById(route.stops[e.i]);

    $('ride-off-question').textContent = e.how === 'gps' && !e.picked
      ? 'Looks like you got off at ' + (chosen ? chosen.name : 'this stop') + '. Right?'
      : 'Where did you get off?';

    var box = $('ride-off-stops');
    box.innerHTML = '';
    endingCandidates(ride).slice().reverse().forEach(function (i) {
      var st = stopById(route.stops[i]);
      if (!st) return;
      var b = el('button', 'report__stop');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(i === e.i));
      b.appendChild(el('span', 'report__stopname', st.name));
      var logged = ride.log.filter(function (x) { return x.i === i; })[0];
      if (logged) b.appendChild(el('span', 'report__stopdist', clock(logged.t).slice(0, 5)));
      b.addEventListener('click', function () {
        e.i = i;
        e.picked = true;          // a person chose it: stop the countdown
        e.how = 'picked';
        clearTimeout(ride.endTimer);
        saveRide();
        renderEnding();
      });
      box.appendChild(b);
    });

    $('ride-off-confirm').textContent = 'Got off at ' + (chosen ? chosen.name : 'this stop');
    var left = e.deadline && !e.picked ? Math.ceil((e.deadline - Date.now()) / 1000) : 0;
    $('ride-off-countdown').textContent = left > 0 ? 'Saved automatically in ' + left + ' s' : '';
  }

  function confirmEnding() {
    var ride = track.ride;
    if (!ride || !ride.ending || ride.ending.saving) return;
    var e = ride.ending;
    var route = routeById(ride.route);
    var stop = route.stops[e.i];
    var name = (stopById(stop) || {}).name || 'your stop';
    var n = ride.log.length;
    e.saving = true;
    clearTimeout(ride.endTimer);

    // Whatever is still queued goes first, so the rules see the same ride.
    var send = function () {
      return postAlighting(route.id, e.i, stop, ride.trip,
                           e.how === 'picked' ? Date.now() : e.at, e.how);
    };
    var done = function () {
      endRide('Got off at ' + name + ' — logged' +
              (n > 1 ? ', with ' + n + ' stops. Thank you!' : '. Thank you!'));
    };
    waitForQueue(ride).then(send).then(done, function (err) {
      if (err && err.code === 'slow') return done();
      e.saving = false;
      if (err && err.code === 'permission-denied') {
        // The 10 s gap since the last stop was sent. Try once more.
        setTimeout(function () { if (track.ride === ride) confirmEnding(); }, TRACK.rideTapSeconds * 1000);
        return;
      }
      $('ride-status').textContent = describeFailure(err);
      renderRide();
    });
  }

  function waitForQueue(ride) {
    return new Promise(function (resolve) {
      (function check() {
        if (track.ride !== ride || !ride.queue || !ride.queue.length) {
          var wait = Math.max(0, (ride.nextAllowed || 0) - Date.now());
          return setTimeout(resolve, wait);
        }
        pumpRide();
        setTimeout(check, 500);
      })();
    });
  }

  function cancelEnding() {
    var ride = track.ride;
    if (!ride || !ride.ending) return;
    clearTimeout(ride.endTimer);
    ride.ending = null;
    saveRide();
    renderRide();
    startRideFollow();
  }

  /** "I got off": our best guess at where, for them to confirm or change. */
  function guessStopNow(ride) {
    var route = routeById(ride.route);
    var fix = state.live && state.live.fix;
    var shape = DATA.routeShapes[ride.route];
    if (!fix || !shape || !shape.stopIndices || fix.accuracy > TRACK.gpsMaxAccuracyMetres) return ride.i;
    var best = ride.i, bestD = Infinity;
    endingCandidates(ride).forEach(function (i) {
      var k = shape.stopIndices[i];
      if (typeof k !== 'number') return;
      var d = geo.haversineMetres(fix, { lat: shape.line[k][0], lng: shape.line[k][1] });
      if (d < bestD) { bestD = d; best = i; }
    });
    return bestD <= 150 ? best : ride.i;
  }

  function rideTap() {
    if (!track.ride) return;
    recordArrival(track.ride.i + 1, Date.now(), false);
    syncProgress();
  }

  /** After a tap or skip, GPS carries on from that stop's point on the road. */
  function syncProgress() {
    var ride = track.ride;
    if (ride && track.follow) follower.syncToStop(track.follow, DATA.routeShapes[ride.route], ride.i);
  }

  function rideSkip() {
    var ride = track.ride;
    if (!ride) return;
    // The bus drove past without stopping. Move on without a report — and
    // the gap in the log keeps this hop out of the timing.
    ride.i += 1;
    syncProgress();
    saveRide();
    renderRide();
  }

  // ---- following the ride by GPS ------------------------------------------
  //
  // While the app is open, the phone's location logs each stop by itself and
  // notices when you have got off. A web page cannot do this with the screen
  // locked or the app in the background — iOS and Android pause it — so the
  // screen is kept awake during a ride, and the buttons stay for when GPS is
  // poor (it often is between tall buildings) or the app was closed.

  var follower = window.CUHK.rideFollow;

  function onRideFix(pos) {
    var ride = track.ride;
    var f = track.follow;
    if (!ride || !f) return;
    var fix = { lat: pos.coords.latitude, lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy || 999, time: pos.timestamp || Date.now() };
    f.fixes = (f.fixes || 0) + 1;
    f.error = null;
    liveState().fix = fix;                          // the blue dot on the maps

    var route = routeById(ride.route);
    var byId = {};
    DATA.stops.forEach(function (st) { byId[st.id] = st; });
    var res = follower.step(f, ride, fix, route, DATA.routeShapes[ride.route], byId, TRACK);

    if (res.resumedAfter > ride.i) {
      // Tracking was away (app closed, screen locked, GPS lost) and has found
      // the bus again further along. The stops in between were not seen:
      // skip them rather than make up times. The "got on" report stands.
      var skipped = res.resumedAfter - ride.i;
      ride.i = res.resumedAfter;
      saveRide();
      $('ride-status').textContent = 'Found the bus again — ' + skipped +
        (skipped === 1 ? ' stop' : ' stops') + ' passed while tracking was paused.';
    }
    if (res.arrived >= 0) recordArrival(res.arrived, pos.timestamp || Date.now(), true);

    if (res.gotOff) {
      // Not the end yet: say where we think they got off, and let them
      // confirm, correct it, or say they are still on. Saved by itself if
      // they have already put the phone away.
      startEnding(ride.i, 'gps', f.offSince || Date.now());
      return;
    }
    // When the walking-away started, for the time they got off.
    if (f.offRoute === 1) f.offSince = pos.timestamp || Date.now();
    if (track.ride && track.ride.i >= route.stops.length - 1) {
      endRide('End of the route. ' + track.ride.log.length + ' stops logged — thank you!');
      return;
    }
    if (track.ride) renderRide();
  }

  function startRideFollow() {
    var ride = track.ride;
    if (!ride || !ride.follow || track.follow || !navigator.geolocation) return;
    // Starting (or restarting) to follow: the last thing known is the last
    // stop logged. If that was a while ago, the follower treats it as a gap
    // and looks for where the bus is now.
    var lastLogged = ride.log.length ? ride.log[ride.log.length - 1].t : Date.now();
    track.follow = { watchId: null, fixes: 0, offRoute: 0, error: null, lock: null,
                     lastMatchAt: lastLogged };
    try {
      track.follow.watchId = navigator.geolocation.watchPosition(onRideFix, function (err) {
        if (!track.follow) return;
        track.follow.error = err;
        if (track.ride) renderRide();
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    } catch (e) {
      track.follow.error = e;
    }
    keepAwake();
    renderRide();
  }

  function stopRideFollow() {
    var f = track.follow;
    if (!f) return;
    if (f.watchId !== null) { try { navigator.geolocation.clearWatch(f.watchId); } catch (e) {} }
    if (f.lock) { try { f.lock.release(); } catch (e) {} }
    track.follow = null;
  }

  /** Stop the phone locking itself mid-ride, where the browser allows it. */
  function keepAwake() {
    var f = track.follow;
    if (!f || !navigator.wakeLock || document.hidden) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      if (track.follow === f) f.lock = lock; else lock.release();
    }).catch(function () { /* not allowed here; the ride still works */ });
  }

  document.addEventListener('visibilitychange', function () {
    if (!track.ride) return;
    if (document.hidden) {
      stopRideFollow();
    } else {
      if (!track.ride.ending) startRideFollow();   // and re-takes the wake lock
      else tickEnding();
      pumpRide();
    }
  });

  /** The Track page shows either the ride in progress or the report form. */
  function renderTrackMode() {
    var riding = !!track.ride;
    $('ride').hidden = !riding;
    $('report').hidden = riding;
    if (riding) renderRide(); else renderReport();
  }

  function tickCooldown() {
    renderReport();
    if (Date.now() < track.cooldownUntil) setTimeout(tickCooldown, 1000);
  }

  function renderSightings() {
    var list = $('sightings-list');
    var note = $('sightings-note');
    list.innerHTML = '';

    if (track.status === 'off') {
      note.textContent = 'Tracking is not switched on for this copy of the app yet.';
      return;
    }
    if (track.status === 'error') {
      note.textContent = 'Could not load reports. Check your connection.';
      return;
    }
    if (track.status === 'unknown' || track.status === 'connecting') {
      note.textContent = 'Connecting…';
      return;
    }

    // A rider logging a ride leaves a report at every stop. Show only where
    // that bus was last seen, not a trail of every stop it passed.
    var latest = [], seenTrip = {}, tripSize = {};
    track.list.forEach(function (sg) {
      if (sg.trip) tripSize[sg.trip] = (tripSize[sg.trip] || 0) + 1;
    });
    track.list.forEach(function (sg) {                     // newest first
      if (sg.trip && seenTrip[sg.trip]) return;
      if (sg.trip) seenTrip[sg.trip] = true;
      latest.push(sg);
    });

    // Reports become bus arrivals (lib/arrivals.js): several people reporting
    // the same bus at the same stop are one arrival, confirmed; one person
    // reporting it twice is two buses.
    var groups = window.CUHK.arrivals.group(latest.filter(function (sg) {
      return routeById(sg.route) && stopById(sg.stop);
    }).map(function (sg) {
      return { route: sg.route, stop: sg.stop, at: sg.t, reporter: sg.reporter,
               onBoard: !!(sg.trip && tripSize[sg.trip] > 1), spot: !!sg.spot };
    }), TRACK.confirmWindowMinutes * 60000).map(function (a) {
      return {
        route: a.route, stop: a.stop, t: a.last, count: a.reporters,
        onBoard: a.reports.some(function (r) { return r.onBoard; }),
        spotted: a.reports.every(function (r) { return r.spot; })
      };
    });

    groups.forEach(function (g) {
      var route = routeById(g.route), stop = stopById(g.stop);
      if (!route || !stop) return;
      var li = el('li', 'sightings__item');
      li.appendChild(routeBadge(route));
      var text = el('span', 'sightings__text');
      text.appendChild(el('span', 'sightings__stop', stop.name));
      text.appendChild(el('span', 'sightings__sub',
        agoText(minutesAgo(g.t)) + (g.count > 1 ? ' · ' + g.count + ' people reported it' : '') +
        (g.onBoard ? ' · rider on board, logging stops' : '') +
        (g.spotted ? ' · seen from the stop' : '')));
      li.appendChild(text);
      list.appendChild(li);
    });

    note.textContent = groups.length ? ''
      : 'No reports in the last ' + TRACK.showMinutes + ' minutes. Be the first.';
  }

  function openTrack() {
    renderTrackMode();
    renderSightings();
    fetchSightings();

    // A fresh position makes "closest stops" right. Only asked for here,
    // where you came to report where you are.
    if (!trackReference() && navigator.geolocation) {
      try {
        navigator.geolocation.getCurrentPosition(function (pos) {
          liveState().fix = { lat: pos.coords.latitude, lng: pos.coords.longitude,
                              accuracy: pos.coords.accuracy || 0 };
          if (currentPage === PAGE_TRACK) renderReport();
        }, function () {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
      } catch (e) { /* alphabetical list still works */ }
    }
  }

  function wireTrack() {
    $('report-more').addEventListener('click', function () {
      track.showAllStops = !track.showAllStops;
      renderReport();
    });
    $('report-send').addEventListener('click', sendReport);
    $('ride-tap').addEventListener('click', rideTap);
    $('ride-skip').addEventListener('click', rideSkip);
    $('ride-follow').addEventListener('click', function () {
      if (!track.ride) return;
      track.ride.follow = !track.ride.follow;
      saveRide();
      if (track.ride.follow) startRideFollow(); else { stopRideFollow(); renderRide(); }
    });
    $('ride-end').addEventListener('click', function () {
      if (!track.ride) return;
      startEnding(guessStopNow(track.ride), 'tap', Date.now());
    });
    $('ride-off-confirm').addEventListener('click', confirmEnding);
    $('ride-off-back').addEventListener('click', cancelEnding);
    $('ride-off-skip').addEventListener('click', function () {
      var n = track.ride ? track.ride.log.length : 0;
      endRide(n > 1 ? 'Thanks — ' + n + ' stops logged.' : '');
    });
    track.ride = loadRide();
    if (track.ride) {
      if (track.ride.ending) { track.ride.ending.saving = false; tickEnding(); }
      else startRideFollow();
      pumpRide();
    }

    fetchSightings();
    // New reports arrive through the listener. This only re-draws the ages
    // ("3 min ago") and renews the listener's time window now and then.
    setInterval(function () {
      if (document.hidden) return;
      fetchSightings();
      if (currentPage === PAGE_TRACK) renderSightings();
    }, 30000);

    // No listening while the app is in the background.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && track.unsubscribe) {
        stopListening();
      } else if (!document.hidden) {
        fetchSightings();
      }
    });
  }

  // =========================================================================
  // Spot: buses seen from the kerb
  //
  // Walking across campus you pass stops, and buses pull in. Each one tapped
  // is an arrival time at a known stop — the raw material for punctuality —
  // without anyone having to ride. So this is built for speed: the stop is
  // picked from GPS as you walk, one tap per bus, no confirm step. Taps wait
  // five seconds before sending so a wrong one can be undone (reports cannot
  // be deleted once stored), then go out one by one within the cooldown.
  //
  // Spots are their own collection. They share nothing with ride logs, so a
  // bus spotted at one stop and the same route spotted at the next can never
  // be mistaken for someone riding between them.
  // =========================================================================

  var SPOT_UNDO_MS = 5000;

  var spot = {
    stop: null,            // chosen stop id
    manual: false,         // chosen by hand (GPS will not override nearby)
    showAll: false,
    watchId: null,
    fix: null,
    session: null,         // random id for this phone's spotting session
    log: [],               // newest first: { key, route, stop, i, at, sendAfter, session, state }
    queue: [],
    nextAllowed: 0,
    sending: false,
    timer: null
  };

  function openSpot() {
    firebaseReady().catch(function () {});        // sign in early
    fetchSightings();
    startSpotWatch();
    renderSpot();
  }

  function closeSpot() {
    if (spot.watchId !== null && navigator.geolocation) {
      try { navigator.geolocation.clearWatch(spot.watchId); } catch (e) {}
    }
    spot.watchId = null;
  }

  function startSpotWatch() {
    if (spot.watchId !== null || !navigator.geolocation) return;
    try {
      spot.watchId = navigator.geolocation.watchPosition(function (pos) {
        spot.fix = { lat: pos.coords.latitude, lng: pos.coords.longitude,
                     accuracy: pos.coords.accuracy || 999 };
        liveState().fix = spot.fix;
        autoPickStop();
        if (currentPage === PAGE_SPOT) renderSpot();
      }, function () {
        spot.fix = null;
        if (currentPage === PAGE_SPOT) renderSpot();
      }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    } catch (e) { /* the stop list still works */ }
  }

  function stopsByDistance(fix) {
    return DATA.stops.map(function (st) {
      return { stop: st, d: geo.haversineMetres(fix, st) };
    }).sort(function (a, b) { return a.d - b.d; });
  }

  /** Follow the nearest stop while walking — unless one was picked by hand
   *  and you are still near it. */
  function autoPickStop() {
    if (!spot.fix || spot.fix.accuracy > 80) return;
    var near = stopsByDistance(spot.fix)[0];
    if (spot.manual) {
      var chosen = stopById(spot.stop);
      if (chosen && geo.haversineMetres(spot.fix, chosen) < 150) return;
      spot.manual = false;
    }
    spot.stop = near && near.d <= 90 ? near.stop.id : null;
  }

  function pickSpotStop(id) {
    spot.stop = id;
    spot.manual = true;
    spot.showAll = false;
    renderSpot();
  }

  function renderSpot() {
    var where = $('spot-where');
    var chosen = stopById(spot.stop);
    var near = spot.fix ? stopsByDistance(spot.fix) : null;

    if (chosen) {
      var d = spot.fix ? Math.round(geo.haversineMetres(spot.fix, chosen) / 5) * 5 : null;
      where.textContent = 'At ' + chosen.name + (d !== null && !spot.manual ? ' · ' + d + ' m' : '');
    } else {
      where.textContent = near ? 'Not at a stop — pick one:' : 'Which stop are you at?';
    }

    // The closest few as chips, for a one-tap correction (the other side of
    // the road is usually the one GPS got wrong).
    var chips = $('spot-stops');
    chips.innerHTML = '';
    var options = near ? near.slice(0, 4).map(function (n) { return n.stop; }) : [];
    if (chosen && options.indexOf(chosen) === -1) options.unshift(chosen);
    options.forEach(function (st) {
      var c = el('button', 'chip');
      c.type = 'button';
      c.setAttribute('aria-pressed', String(st.id === spot.stop));
      c.textContent = st.name;
      c.addEventListener('click', function () { pickSpotStop(st.id); });
      chips.appendChild(c);
    });
    chips.hidden = !options.length;

    $('spot-all').textContent = spot.showAll ? 'Hide the list' : (options.length ? 'Other stop' : 'Choose from all stops');
    var list = $('spot-list');
    list.hidden = !spot.showAll;
    list.innerHTML = '';
    if (spot.showAll) {
      DATA.stops.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
        .forEach(function (st) {
          var b = el('button', 'report__stop');
          b.type = 'button';
          b.setAttribute('aria-pressed', String(st.id === spot.stop));
          b.appendChild(el('span', 'report__stopname', st.name));
          b.addEventListener('click', function () { pickSpotStop(st.id); });
          list.appendChild(b);
        });
    }

    // One big button per bus that calls here today.
    var box = $('spot-routes');
    box.innerHTML = '';
    if (chosen) {
      var serving = DATA.routes.filter(function (r) { return r.stops.indexOf(chosen.id) !== -1; });
      var today = serving.filter(function (r) { return planner.runsToday(r, new Date()); });
      (today.length ? today : serving).forEach(function (r) {
        var b = el('button', 'spot__bus');
        b.type = 'button';
        b.style.setProperty('--route-colour', r.colour);
        b.appendChild(el('span', 'spot__busid', r.id));
        b.appendChild(el('span', 'spot__busname', r.label || r.name));
        b.setAttribute('aria-label', 'Spotted Route ' + r.id + ' at ' + chosen.name);
        b.addEventListener('click', function () { spotBus(r, chosen); });
        box.appendChild(b);
      });
    }

    if (track.status === 'off') $('spot-status').textContent = 'Tracking is not switched on yet.';
    renderSpotLog();
  }

  function spotBus(route, stop) {
    var now = Date.now();
    // A double tap is not two buses.
    var last = spot.log[0];
    if (last && last.route === route.id && last.stop === stop.id && now - last.at < 3000) return;

    var entry = {
      // A fixed document id, chosen now: if a send is retried after the app
      // was closed mid-way, the same report cannot be stored twice.
      key: newTripId() + newTripId().slice(0, 4),
      route: route.id, stop: stop.id, i: route.stops.indexOf(stop.id),
      at: now,                        // when the bus was there — never changed
      sendAfter: now + SPOT_UNDO_MS,  // when it may go out
      session: spot.session,
      state: 'waiting'
    };
    spot.log.unshift(entry);
    spot.queue.push(entry);
    saveSpots();
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
    renderSpotLog();
    pumpSpots();
  }

  function undoSpot(entry) {
    if (entry.state !== 'waiting' || Date.now() >= entry.sendAfter) return;
    spot.queue = spot.queue.filter(function (e) { return e !== entry; });
    spot.log = spot.log.filter(function (e) { return e !== entry; });
    saveSpots();
    renderSpotLog();
  }

  /**
   * Waiting taps live on the phone until the database has them. No signal,
   * the app closed, a cooldown refusal — they stay, with the time the bus
   * was actually there, and go out the next time the app is open.
   */
  function saveSpots() {
    try {
      localStorage.setItem('spotQueue', JSON.stringify({
        session: spot.session,
        queue: spot.queue.map(function (e) {
          return { key: e.key, route: e.route, stop: e.stop, i: e.i, at: e.at,
                   sendAfter: e.sendAfter, session: e.session };
        })
      }));
    } catch (e) { /* private mode: they just won't survive closing the app */ }
  }

  function loadSpots() {
    try {
      var saved = JSON.parse(localStorage.getItem('spotQueue') || 'null');
      if (!saved) return;
      // Keep the session, so the database sees the same spotter and the short
      // cooldown applies instead of the long one.
      spot.session = saved.session || spot.session;
      (saved.queue || []).forEach(function (e) {
        // Older than the rules accept: nothing can be done with it.
        if (Date.now() - e.at > TRACK.spotMaxAgeHours * 3600000) return;
        e.state = 'waiting';
        e.restored = true;
        spot.queue.push(e);
        spot.log.push(e);
      });
      spot.log.sort(function (a, b) { return b.at - a.at; });
    } catch (e) { /* ignore */ }
  }

  function pumpSpots() {
    clearTimeout(spot.timer);
    if (spot.sending || !spot.queue.length || !navigator.onLine) return;

    // Everything whose undo window has passed goes in ONE write — up to ten,
    // all from the same session (the cooldown is per session). Three buses
    // arriving together no longer wait for each other.
    var session = spot.queue[0].session;
    var now = Date.now();
    var mine = spot.queue.filter(function (e) { return e.session === session; });

    // Taps close together travel together: if another will be ready within
    // the cooldown anyway, wait for it rather than send the first alone and
    // make the second sit out the cooldown.
    var sendAt = Math.max(mine[0].sendAfter, spot.nextAllowed);
    mine.forEach(function (e) {
      if (e.sendAfter > sendAt && e.sendAfter - sendAt <= TRACK.rideTapSeconds * 1000) sendAt = e.sendAfter;
    });
    var due = mine.filter(function (e) { return e.sendAfter <= sendAt; }).slice(0, 10);
    var wait = sendAt - now;
    if (!due.length || wait > 0) {
      spot.timer = setTimeout(pumpSpots, Math.max(wait, 250) + 50);
      renderSpotLog();
      return;
    }

    spot.sending = true;
    due.forEach(function (e) { e.state = 'sending'; });
    renderSpotLog();

    sendSpotBatch(due, session).then(function () {
      done(due);
    }, function (err) {
      var code = err && err.code;
      if (code === 'slow') {
        // Handed to Firestore but not confirmed. Leave them saved on the
        // phone: if the app closes before it gets through, they are sent
        // again next time (their fixed ids stop them doubling up).
        due.forEach(function (e) { e.state = 'queued'; });
        err.pending.then(function () { done(due); }, function () { retry(due, 15000); });
        spot.sending = false;
        renderSpotLog();
        return;
      }
      if (code === 'off') {
        spot.sending = false;
        $('spot-status').textContent = describeFailure(err);
        due.forEach(function (e) { e.state = 'waiting'; });
        renderSpotLog();
        return;
      }
      if (code === 'permission-denied') {
        // Either the cooldown, or some of these were already stored by an
        // earlier attempt (a create on an existing id is refused). The first
        // refusal is most likely the cooldown: wait it out and try again.
        // Refused again after that, find out which were already stored.
        var fresh = due.filter(function (e) { return !e.deniedOnce; });
        if (fresh.length) {
          due.forEach(function (e) { e.deniedOnce = true; });
          return retry(due, TRACK.cooldownSeconds * 1000 + 500);
        }
        return alreadyStored(due).then(function (stored) {
          if (stored.length) done(stored, true);
          retry(due.filter(function (e) { return stored.indexOf(e) === -1; }),
                TRACK.rideTapSeconds * 1000 + 500);
        }, function () { retry(due, 15000); });
      }
      retry(due, 15000);
    });

    function done(entries, silently) {
      spot.failures = 0;
      entries.forEach(function (e) { e.state = 'sent'; });
      spot.queue = spot.queue.filter(function (e) { return entries.indexOf(e) === -1; });
      spot.sending = false;
      spot.nextAllowed = Date.now() + TRACK.rideTapSeconds * 1000 + 300;
      if (!silently) $('spot-status').textContent = '';
      saveSpots();
      renderSpotLog();
      pumpSpots();
    }

    function retry(entries, delay) {
      // Back off when it keeps failing, so a refusal that is not the cooldown
      // (rules not published yet, say) does not become a loop of requests.
      spot.failures = (spot.failures || 0) + 1;
      if (spot.failures >= 3) delay = Math.max(delay, Math.min(120000, 5000 * Math.pow(2, spot.failures - 3)));
      if (spot.failures >= 4) {
        $('spot-status').textContent = 'The database is not accepting these right now. They are saved on your phone and will keep trying.';
      }
      entries.forEach(function (e) { e.state = 'waiting'; });
      spot.sending = false;
      spot.nextAllowed = Date.now() + delay;
      saveSpots();
      renderSpotLog();
      pumpSpots();
    }
  }

  function sendSpotBatch(entries, session) {
    return firebaseReady().then(function (db) {
      var fb = window.firebase;
      var uid = fb.auth().currentUser.uid;
      var now = fb.firestore.FieldValue.serverTimestamp();
      var batch = db.batch();
      entries.forEach(function (e) {
        batch.set(db.collection('spots').doc(e.key), {
          stop: e.stop, route: e.route, i: e.i, trip: session, t: now,
          at: fb.firestore.Timestamp.fromMillis(e.at),
          expireAt: fb.firestore.Timestamp.fromMillis(Date.now() + TRACK.keepDays * 86400000)
        });
      });
      batch.set(db.collection('throttle').doc(uid), { t: now, trip: session });

      var commit = batch.commit();
      return Promise.race([
        commit,
        new Promise(function (resolve, reject) {
          setTimeout(function () { reject({ code: 'slow', pending: commit }); }, 12000);
        })
      ]);
    }, function (err) {
      throw { code: err && err.message === 'off' ? 'off' : 'unavailable' };
    });
  }

  /** Which of these reports are already in the database? */
  function alreadyStored(entries) {
    return firebaseReady().then(function (db) {
      return Promise.all(entries.map(function (e) {
        return db.collection('spots').doc(e.key).get({ source: 'server' })
          .then(function (d) { return d.exists ? e : null; });
      }));
    }).then(function (found) { return found.filter(Boolean); });
  }

  function renderSpotLog() {
    var list = $('spot-log');
    if (!list) return;
    list.innerHTML = '';
    var now = Date.now();
    spot.log.slice(0, 30).forEach(function (e) {
      var route = routeById(e.route), stop = stopById(e.stop);
      if (!route || !stop) return;
      var li = el('li', 'sightings__item');
      li.appendChild(routeBadge(route));
      var text = el('span', 'sightings__text');
      text.appendChild(el('span', 'sightings__stop', stop.name));
      var left = Math.ceil((e.sendAfter - now) / 1000);
      text.appendChild(el('span', 'sightings__sub', clock(e.at).slice(0, 5) + ' · ' + (
        e.state === 'sent' ? 'sent' :
        e.state === 'sending' ? 'sending…' :
        e.state === 'queued' ? 'saved on phone, sending when there is signal' :
        !navigator.onLine ? 'saved on phone, sends when you are back online' :
        left > 0 ? 'sends in ' + left + ' s' :
        e.restored ? 'saved from last time, sending…' : 'waiting to send')));
      li.appendChild(text);
      if (e.state === 'waiting' && left > 0) {
        var undo = el('button', 'report__more spot__undo', 'Undo');
        undo.type = 'button';
        undo.addEventListener('click', function () { undoSpot(e); });
        li.appendChild(undo);
      }
      list.appendChild(li);
    });
    $('spot-log-note').textContent = spot.log.length ? '' :
      'Nothing yet. Every bus you tap helps work out how punctual the routes are.';

    // Keep the countdown moving while anything is still undoable.
    if (spot.log.some(function (e) { return e.state === 'waiting' && e.sendAfter > now; })) {
      clearTimeout(spot.tick);
      spot.tick = setTimeout(renderSpotLog, 1000);
    }
  }

  function wireSpot() {
    $('spot-all').addEventListener('click', function () {
      spot.showAll = !spot.showAll;
      renderSpot();
    });

    // Taps saved on the phone last time go out as soon as the app is open.
    loadSpots();
    if (!spot.session) spot.session = newTripId();
    if (spot.queue.length) pumpSpots();

    window.addEventListener('online', pumpSpots);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        closeSpot();
        // Leaving the app ends the undo window: send what can be sent now.
        // Only when to send changes — never when the bus was there.
        var now = Date.now();
        spot.queue.forEach(function (e) { e.sendAfter = Math.min(e.sendAfter, now); });
        saveSpots();
        pumpSpots();
      } else {
        if (currentPage === PAGE_SPOT) startSpotWatch();
        pumpSpots();
      }
    });
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
    wireTrack();
    wireSpot();
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
