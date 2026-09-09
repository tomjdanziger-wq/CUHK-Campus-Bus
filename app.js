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
    mapLoading: false
  };

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

    var m = DATA.meta;
    $('validity').textContent =
      'Timetable: ' + m.timetableLabel +
      ' · valid ' + m.validFrom + ' to ' + m.validUntil +
      ' · last updated ' + m.lastUpdated + '.';

    $('attribution').textContent = DATA.attribution;
  }

  // =========================================================================
  // Autocomplete
  // =========================================================================

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
    head.appendChild(el('span', 'opt__icon', '🚶'));

    var titles = el('div', 'opt__titles');
    titles.appendChild(el('h2', 'opt__mode', 'Walk the whole way'));
    titles.appendChild(el('span', 'opt__mode-zh', '步行'));
    head.appendChild(titles);

    var time = el('div', 'opt__time');
    time.appendChild(el('strong', 'opt__time-range', formatRange(o.totalLow, o.totalHigh)));
    time.appendChild(el('span', 'opt__time-unit', 'minutes'));
    time.appendChild(el('span', 'opt__arrive', o.arrivalLabel));
    head.appendChild(time);
    card.appendChild(head);

    var body = el('div', 'opt__body');
    body.appendChild(el('p', 'board__walk', describeWalk(o.walk)));

    // The elevation note is not optional. A flat time estimate on this campus
    // is misleading — the same route is a different journey in each direction.
    if (o.walk.climb >= CFG.display.notableElevationMetres) {
      var climb = el('p', 'flag flag--climb');
      climb.appendChild(el('span', null, '⛰'));
      climb.appendChild(el('span', null,
        'That climb is the part the clock does not show. Expect it to feel ' +
        'longer than the number suggests, especially in the heat.'));
      body.appendChild(climb);
    }

    card.appendChild(body);
    return card;
  }

  function renderShuttleCard(o) {
    var card = el('div', 'opt opt--bus' + (o.isBest ? ' opt--best' : ''));

    // --- header: route and total time ---
    var head = el('div', 'opt__head');
    head.appendChild(el('span', 'opt__icon', '🚌'));

    var titles = el('div', 'opt__titles');
    titles.appendChild(el('h2', 'opt__mode', o.route.name));
    if (o.route.nameZh) titles.appendChild(el('span', 'opt__mode-zh', o.route.nameZh));
    head.appendChild(titles);

    var time = el('div', 'opt__time');
    time.appendChild(el('strong', 'opt__time-range', formatRange(o.totalLow, o.totalHigh)));
    time.appendChild(el('span', 'opt__time-unit', 'minutes'));
    time.appendChild(el('span', 'opt__arrive', o.arrivalLabel));
    head.appendChild(time);
    card.appendChild(head);

    // --- the single most important field on the screen ---
    // The most common failure for a new student is waiting at the wrong stop,
    // so the boarding stop gets its own block, the largest type on the card
    // after the total, and both languages.
    var board = el('div', 'board');
    board.appendChild(el('p', 'board__label', 'Board at'));
    var name = el('p', 'board__name', o.boardStop.name);
    if (o.boardStop.nameZh) name.appendChild(el('span', 'board__zh', o.boardStop.nameZh));
    board.appendChild(name);
    // Don't say "~1 min walk · you are basically there already" — pick one.
    board.appendChild(el('p', 'board__walk',
      o.walkToStop.metres < 30
        ? 'You are already at this stop.'
        : formatLeg(o.walkToStop.minutes) + ' walk from here · ' + describeWalk(o.walkToStop)));
    card.appendChild(board);

    var body = el('div', 'opt__body');

    // --- "walk further for a better bus" ---
    if (o.worthTheExtraWalk) {
      var w = o.worthTheExtraWalk;
      var flag = el('p', 'flag flag--warn');
      flag.appendChild(el('span', null, '↗'));
      var txt = el('span');
      txt.appendChild(el('strong', null, 'Worth the extra walk. '));
      txt.appendChild(document.createTextNode(
        'This stop is about ' + Math.round(w.extraWalkMinutes) + ' min further than ' +
        w.insteadOf.name + ', but gets you there roughly ' +
        Math.round(w.savingMinutes) + ' min sooner.'));
      flag.appendChild(txt);
      body.appendChild(flag);
    }

    // --- leg breakdown, deliberately NOT collapsed into one number ---
    var legs = el('ul', 'legs');

    legs.appendChild(o.walkToStop.metres < 30
      ? legRow('📍', 'You are already at this stop', null, '—')
      : legRow('🚶', 'Walk to ' + o.boardStop.name,
               describeWalk(o.walkToStop), formatLeg(o.walkToStop.minutes)));

    legs.appendChild(legRow('⏱', 'Wait for the ' + o.departureTime,
      'scheduled departure — the real gap, not an average',
      formatWait(o.waitMinutes), 'leg--wait'));

    legs.appendChild(legRow('🚌', 'Ride to ' + o.alightStop.name,
      (o.alightStop.nameZh ? o.alightStop.nameZh + ' · ' : '') +
      (o.rideIsEstimated ? 'ride time estimated from distance' : 'scheduled running time'),
      '~' + Math.round(o.rideMinutes) + ' min'));

    legs.appendChild(o.walkFromStop.metres < 30
      ? legRow('📍', 'The stop is your destination', null, '—')
      : legRow('🚶', 'Walk to your destination',
               describeWalk(o.walkFromStop), formatLeg(o.walkFromStop.minutes)));

    body.appendChild(legs);

    // --- upcoming departures ---
    var deps = el('p', 'deps');
    deps.appendChild(el('span', 'deps__label', 'Next scheduled from this stop: '));
    deps.appendChild(el('span', 'deps__times', o.upcomingDepartures.join('  ·  ')));
    body.appendChild(deps);

    // --- tight connection ---
    if (o.isTight) {
      var tight = el('p', 'flag flag--warn');
      tight.appendChild(el('span', null, '⏳'));
      var tt = el('span');
      tt.appendChild(el('strong', null, 'Tight. '));
      tt.appendChild(document.createTextNode(
        'If the walk takes you longer than estimated you may watch this one leave' +
        (o.fallbackDeparture
          ? '. The one after is scheduled for ' + o.fallbackDeparture + '.'
          : ', and it is the last one in the next hour.')));
      tight.appendChild(tt);
      body.appendChild(tight);
    }

    // --- capacity warning: static, we have no occupancy data ---
    if (o.capacityWarning) {
      var cap = el('p', 'flag flag--warn');
      cap.appendChild(el('span', null, '⚠'));
      cap.appendChild(el('span', null, o.capacityWarning));
      body.appendChild(cap);
    }

    if (o.route.notes) {
      var note = el('p', 'flag flag--info');
      note.appendChild(el('span', null, 'ℹ'));
      note.appendChild(el('span', null, o.route.notes));
      body.appendChild(note);
    }

    // Selecting an option only changes what the map draws. It is not a
    // commitment and nothing is pre-selected.
    var pick = el('button', 'pick', 'Show this on the map');
    pick.type = 'button';
    pick.setAttribute('aria-pressed', String(state.selectedKey === o.key));
    if (state.selectedKey === o.key) pick.textContent = 'Shown on the map below';
    pick.addEventListener('click', function () {
      state.selectedKey = state.selectedKey === o.key ? null : o.key;
      render();
      if (state.selectedKey) showMapFor(o);
    });
    body.appendChild(pick);

    card.appendChild(body);
    return card;
  }

  function legRow(icon, main, sub, timeText, extraClass) {
    var li = el('li', extraClass || null);
    li.appendChild(el('span', 'leg__icon', icon));
    var text = el('div', 'leg__text');
    text.appendChild(document.createTextNode(main));
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
    out.innerHTML = '';

    if (!state.origin || !state.destination) {
      $('empty-state').hidden = false;
      $('map-section').hidden = true;
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

    $('map-section').hidden = false;
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

  function showMapFor(option) {
    var container = $('map');
    var toggle = $('map-toggle');

    container.hidden = false;
    $('map-note').hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.textContent = 'Hide map';

    loadLeaflet().then(function (L) {
      if (!state.map) {
        state.map = L.map(container, { scrollWheelZoom: false });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors'
        }).addTo(state.map);
      }
      var map = state.map;

      // Clear previous drawing.
      map.eachLayer(function (layer) {
        if (layer instanceof L.TileLayer) return;
        map.removeLayer(layer);
      });

      var points = [];

      function marker(p, label, colour) {
        if (!p) return;
        L.circleMarker([p.lat, p.lng], {
          radius: 9, color: '#fff', weight: 3, fillColor: colour, fillOpacity: 1
        }).addTo(map).bindPopup(label);
        points.push([p.lat, p.lng]);
      }

      marker(state.origin, 'Start: ' + state.origin.name, '#1c6b45');
      marker(state.destination, 'Destination: ' + state.destination.name, '#a11919');

      if (option.kind === 'shuttle') {
        var line = option.route.stops
          .slice(option.boardIndex, option.alightIndex + 1)
          .map(function (id) {
            var s = DATA.stops.filter(function (x) { return x.id === id; })[0];
            return s ? [s.lat, s.lng] : null;
          })
          .filter(Boolean);

        L.polyline(line, { color: '#0b4f8f', weight: 6, opacity: 0.75 }).addTo(map);
        line.forEach(function (pt) { points.push(pt); });

        marker(option.boardStop, 'Board here: ' + option.boardStop.name, '#0b4f8f');
        marker(option.alightStop, 'Get off: ' + option.alightStop.name, '#0b4f8f');
      }

      if (points.length) map.fitBounds(points, { padding: [40, 40] });
      setTimeout(function () { map.invalidateSize(); }, 0);

    }).catch(function () {
      container.hidden = true;
      $('map-note').hidden = false;
      $('map-note').textContent =
        'The map could not load. Everything above still works — the written ' +
        'instructions are the accurate part anyway.';
    });
  }

  function wireMapToggle() {
    var toggle = $('map-toggle');
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      if (open) {
        $('map').hidden = true;
        $('map-note').hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = 'Show map';
        return;
      }
      var result = planner.plan(state.origin, state.destination, DATA, currentWhen());
      var chosen = result.options.filter(function (o) { return o.key === state.selectedKey; })[0]
                || result.options[0];
      state.selectedKey = chosen.key;
      render();
      showMapFor(chosen);
    });
  }

  // =========================================================================
  // Wiring
  // =========================================================================

  function init() {
    renderChrome();

    wireAutocomplete('origin-input', 'origin-results', function (place) {
      state.origin = place;
      state.originSource = 'manual';
      state.originCorrected = true;
      $('gps-btn').setAttribute('aria-pressed', 'false');
      setOriginStatus('Starting from ' + place.name + (place.nameZh ? ' ' + place.nameZh : '') + '.', 'ok');
      $('origin-confirm').hidden = true;
      recompute();
    });

    wireAutocomplete('dest-input', 'dest-results', function (place) {
      state.destination = place;
      $('dest-status').textContent =
        'Going to ' + place.name + (place.nameZh ? ' ' + place.nameZh : '') + '.';
      $('dest-status').className = 'field__status field__status--ok';
      recompute();
    });

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

    wireMapToggle();

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
