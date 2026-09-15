/* ---------------------------------------------------------------------------
 * stats.js — the stats page.
 *
 * Kept out of sight rather than locked: it lives at an unguessable address,
 * is not linked from the app, and asks search engines not to index it. The
 * reports themselves are readable by anyone who goes looking, as the app's
 * own Track page needs them to be — nothing here is secret.
 * ------------------------------------------------------------------------- */

(function () {
  'use strict';

  var DATA = window.SHUTTLE_DATA;
  var planner = window.CUHK.planner;
  var fb = window.firebase;
  var SVGNS = 'http://www.w3.org/2000/svg';

  var stopsById = {}, routesById = {};
  DATA.stops.forEach(function (s) { stopsById[s.id] = s; });
  DATA.routes.forEach(function (r) { routesById[r.id] = r; });

  var all = { sightings: [], spots: [], alightings: [] };
  var view = { days: 7, route: '' };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  // ---- Hong Kong time --------------------------------------------------------

  var HK = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });

  /** { date: a local Date with HK's wall-clock values, minutes: since HK midnight } */
  function hk(ms) {
    var p = {};
    HK.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = +x.value; });
    var hour = p.hour === 24 ? 0 : p.hour;
    return {
      date: new Date(p.year, p.month - 1, p.day, hour, p.minute, p.second),
      minutes: hour * 60 + p.minute + p.second / 60,
      hour: hour,
      label: ('0' + p.day).slice(-2) + '/' + ('0' + p.month).slice(-2) + ' ' +
             ('0' + hour).slice(-2) + ':' + ('0' + p.minute).slice(-2)
    };
  }

  // ---- start ----------------------------------------------------------------------

  function init() {
    if (!window.FIREBASE_CONFIG) {
      $('stats-status').textContent = 'Tracking is not set up for this copy of the app.';
      return;
    }
    if (!fb.apps.length) fb.initializeApp(window.FIREBASE_CONFIG);
    wireFilters();
    loadAll().then(render, function (err) {
      $('stats-status').textContent = 'Could not load the data: ' + ((err && err.message) || err);
    });
  }

  // ---- data ---------------------------------------------------------------------

  function loadCollection(name) {
    var db = fb.firestore();
    var out = [];
    function page(after) {
      // 200 per page: the most the database rules allow per query.
      var q = db.collection(name).orderBy('t').limit(200);
      if (after) q = q.startAfter(after);
      return q.get().then(function (snap) {
        snap.docs.forEach(function (d) {
          var v = d.data();
          out.push({
            id: d.id, kind: name, route: v.route, stop: v.stop, i: v.i, trip: v.trip,
            t: v.t ? v.t.toMillis() : 0,
            at: v.at ? v.at.toMillis() : (v.t ? v.t.toMillis() : 0),
            auto: v.auto === true, how: v.how || ''
          });
        });
        return snap.docs.length === 200 ? page(snap.docs[snap.docs.length - 1]) : out;
      });
    }
    return page(null);
  }

  function loadAll() {
    $('stats-status').textContent = 'Loading…';
    return Promise.all(['sightings', 'spots', 'alightings'].map(loadCollection)).then(function (res) {
      all.sightings = res[0];
      all.spots = res[1];
      all.alightings = res[2];
      $('stats-status').textContent = '';
    });
  }

  function inView(list) {
    var since = view.days ? Date.now() - view.days * 86400000 : 0;
    return list.filter(function (r) {
      return r.at >= since && (!view.route || r.route === view.route) &&
             routesById[r.route] && stopsById[r.stop];
    });
  }

  // ---- analysis -------------------------------------------------------------------

  /**
   * Minutes late (+) or early (−) against the nearest timetabled bus at that
   * stop on that route that day, or null if none is within 20 minutes.
   */
  function delayOf(r) {
    var route = routesById[r.route];
    if (!route || typeof r.i !== 'number') return null;
    var when = hk(r.at);
    if (!planner.runsToday(route, when.date)) return null;
    var deps = planner.departuresFrom(route, r.i, when.minutes - 25, stopsById, DATA.config, when.date);
    var best = null;
    deps.forEach(function (m) {
      var d = when.minutes - m;
      if (Math.abs(d) <= 20 && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    });
    return best;
  }

  function median(xs) {
    if (!xs.length) return null;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /** Consecutive stops one apart within a ride: measured hops. */
  function hops(sightings) {
    var trips = {};
    sightings.forEach(function (r) { if (r.trip) (trips[r.trip] = trips[r.trip] || []).push(r); });
    var out = {};
    Object.keys(trips).forEach(function (k) {
      var list = trips[k].sort(function (a, b) { return a.at - b.at; });
      for (var n = 1; n < list.length; n++) {
        var a = list[n - 1], b = list[n];
        if (a.route !== b.route || b.i !== a.i + 1) continue;
        var sec = (b.at - a.at) / 1000;
        if (sec < 10 || sec > 1200) continue;
        var key = a.route + '|' + a.i;
        (out[key] = out[key] || []).push(sec);
      }
    });
    return out;
  }

  // ---- render ----------------------------------------------------------------------

  function wireFilters() {
    if (wireFilters.done) return;
    wireFilters.done = true;
    Array.prototype.forEach.call(document.querySelectorAll('[data-range]'), function (b) {
      b.addEventListener('click', function () {
        view.days = +b.dataset.range;
        Array.prototype.forEach.call(document.querySelectorAll('[data-range]'), function (x) {
          x.setAttribute('aria-pressed', String(x === b));
        });
        render();
      });
    });
    var sel = $('route-filter');
    DATA.routes.forEach(function (r) {
      var o = el('option', null, 'Route ' + r.id + (r.label ? ' · ' + r.label : ''));
      o.value = r.id;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { view.route = sel.value; render(); });
    $('download').addEventListener('click', downloadCsv);
  }

  function render() {
    $('stats-body').hidden = false;
    var spots = inView(all.spots);
    var sightings = inView(all.sightings);
    var offs = inView(all.alightings);
    var seen = spots.concat(sightings);

    var rideCount = {};
    sightings.forEach(function (r) { if (r.trip) rideCount[r.trip] = (rideCount[r.trip] || 0) + 1; });
    var rides = Object.keys(rideCount).filter(function (k) { return rideCount[k] > 1; }).length;

    $('kpi-spots').textContent = spots.length.toLocaleString();
    $('kpi-sightings').textContent = sightings.length.toLocaleString();
    $('kpi-rides').textContent = rides.toLocaleString();
    $('kpi-offs').textContent = offs.length.toLocaleString();

    renderPunctuality(seen);
    renderHours(seen);
    renderBars($('chart-stops'), countBy(seen, 'stop'), function (id) { return stopsById[id].name; }, 'sightings');
    renderBars($('chart-offs'), countBy(offs, 'stop'), function (id) { return stopsById[id].name; }, 'get-offs');
    renderHops(sightings);
    renderRecent(seen.concat(offs));
  }

  function countBy(list, key) {
    var c = {};
    list.forEach(function (r) { c[r[key]] = (c[r[key]] || 0) + 1; });
    return Object.keys(c).map(function (k) { return { key: k, n: c[k] }; })
      .sort(function (a, b) { return b.n - a.n; });
  }

  function empty(box, text) {
    box.innerHTML = '';
    box.appendChild(el('p', 'card__empty', text));
  }

  // -- tooltip
  var tip = null;
  function attachTip(node, value, label) {
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', label + ': ' + value);
    function show(e) {
      tip = tip || $('tooltip');
      tip.innerHTML = '';
      tip.appendChild(el('strong', null, value));
      tip.appendChild(el('span', null, label));
      tip.hidden = false;
      var r = node.getBoundingClientRect();
      var x = e && e.clientX ? e.clientX : r.left + r.width / 2;
      var y = r.top;
      tip.style.left = Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, x - tip.offsetWidth / 2)) + 'px';
      tip.style.top = Math.max(8, y - tip.offsetHeight - 8) + 'px';
    }
    function hide() { if (tip) tip.hidden = true; }
    node.addEventListener('pointermove', show);
    node.addEventListener('focus', show);
    node.addEventListener('pointerleave', hide);
    node.addEventListener('blur', hide);
  }

  /** Rounded top, square base: a column growing from the baseline. */
  function columnPath(x, y, w, h) {
    var r = Math.min(4, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
           'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }

  function niceMax(v) {
    if (v <= 5) return 5;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / p;
    return (f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  /** Columns over a category axis, with gridlines at clean values. */
  function columns(box, bins, opts) {
    box.innerHTML = '';
    // Drawn at the real width, not scaled: scaled down, 11px labels became 5px.
    var W = Math.max(300, box.clientWidth || 680), H = 220, L = 34, R = 8, T = 12, B = 34;
    var max = niceMax(Math.max.apply(null, bins.map(function (b) { return b.n; })) || 1);
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'group', 'aria-label': opts.title });
    var plotW = W - L - R, plotH = H - T - B;
    var slot = plotW / bins.length;
    var bw = Math.min(24, Math.max(2, slot - 2));

    [0, max / 2, max].forEach(function (v) {
      var y = T + plotH - (v / max) * plotH;
      s.appendChild(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid' }));
      var t = svg('text', { x: L - 6, y: y + 4, 'text-anchor': 'end' });
      t.textContent = Math.round(v).toLocaleString();
      s.appendChild(t);
    });

    bins.forEach(function (b, k) {
      var cx = L + slot * k + slot / 2;
      var h = (b.n / max) * plotH;
      var g = svg('g', { class: 'mark' });
      g.appendChild(svg('rect', { class: 'hit', x: L + slot * k, y: T, width: slot, height: plotH }));
      if (b.n > 0) {
        g.appendChild(svg('path', { class: 'bar', d: columnPath(cx - bw / 2, T + plotH - h, bw, h), fill: b.colour || 'var(--seq)' }));
      }
      attachTip(g, b.n.toLocaleString() + ' ' + opts.unit, b.tip);
      s.appendChild(g);
      if (b.label) {
        var t = svg('text', { x: cx, y: H - B + 16, 'text-anchor': 'middle' });
        t.textContent = b.label;
        s.appendChild(t);
      }
    });
    if (opts.axis) {
      var a = svg('text', { x: L + plotW / 2, y: H - 2, 'text-anchor': 'middle', class: 'axis-label' });
      a.textContent = opts.axis;
      s.appendChild(a);
    }
    box.appendChild(s);
  }

  function renderPunctuality(seen) {
    var box = $('chart-punct');
    var measured = seen.map(function (r) { return { r: r, d: delayOf(r) }; })
      .filter(function (x) { return x.d !== null; });
    if (!measured.length) {
      $('punct-summary').textContent = '';
      empty(box, 'No sightings match a timetabled bus yet.');
      $('table-punct').innerHTML = '';
      return;
    }

    // −10 … +15 minutes, one bin per minute; the ends collect the tails.
    var bins = [];
    for (var m = -10; m <= 15; m++) bins.push({ m: m, n: 0 });
    measured.forEach(function (x) {
      var m = Math.max(-10, Math.min(15, Math.round(x.d)));
      bins[m + 10].n++;
    });
    bins.forEach(function (b) {
      b.colour = b.m < -1 ? 'var(--div-early)' : b.m > 1 ? 'var(--div-late)' : 'var(--div-mid)';
      b.label = b.m % 5 === 0 ? (b.m > 0 ? '+' : '') + b.m : '';
      b.tip = b.m === -10 ? '10+ min early' : b.m === 15 ? '15+ min late'
            : b.m === 0 ? 'on time (±30 s)' : Math.abs(b.m) + ' min ' + (b.m < 0 ? 'early' : 'late');
    });
    columns(box, bins, { title: 'Minutes early or late', unit: 'sightings', axis: '← early   minutes   late →' });

    var ds = measured.map(function (x) { return x.d; });
    var onTime = ds.filter(function (d) { return Math.abs(d) <= 2; }).length;
    var typical = median(ds);
    $('punct-summary').textContent = measured.length + ' matched. Typical: ' +
      (Math.abs(typical) < 0.5 ? 'on time' : fmtDelay(typical).replace(' ', ' min ')) +
      '. Within 2 minutes: ' + Math.round(onTime / ds.length * 100) + '%.';

    // Per route.
    var byRoute = {};
    measured.forEach(function (x) { (byRoute[x.r.route] = byRoute[x.r.route] || []).push(x.d); });
    var table = $('table-punct');
    table.innerHTML = '';
    table.appendChild(headRow(['Route', 'Seen', 'Typical (min)', '≤ 2 min off']));
    DATA.routes.filter(function (r) { return byRoute[r.id]; }).forEach(function (r) {
      var xs = byRoute[r.id];
      var tr = el('tr');
      tr.appendChild(routeCell(r));
      tr.appendChild(el('td', 'num', xs.length));
      tr.appendChild(el('td', 'num', fmtDelay(median(xs))));
      tr.appendChild(el('td', 'num', Math.round(xs.filter(function (d) { return Math.abs(d) <= 2; }).length / xs.length * 100) + '%'));
      table.appendChild(tr);
    });
  }

  function fmtDelay(d) {
    if (d === null) return '–';
    if (Math.abs(d) < 0.5) return 'on time';
    return Math.abs(d).toFixed(1) + (d < 0 ? ' early' : ' late');
  }

  function renderHours(seen) {
    var box = $('chart-hours');
    if (!seen.length) return empty(box, 'Nothing logged in this period.');
    var bins = [];
    for (var h = 6; h <= 23; h++) {
      bins.push({ n: 0, label: h % 3 === 0 ? h + ':00' : '', tip: h + ':00–' + (h + 1) + ':00' });
    }
    seen.forEach(function (r) {
      var h = hk(r.at).hour;
      if (h >= 6) bins[h - 6].n++;
    });
    columns(box, bins, { title: 'Sightings by hour', unit: 'sightings' });
  }

  /** Horizontal bars for a ranked list: label left, value at the tip. */
  function renderBars(box, rows, name, unit) {
    if (!rows.length) return empty(box, 'Nothing logged in this period.');
    rows = rows.slice(0, 12);
    box.innerHTML = '';
    var W = Math.max(300, box.clientWidth || 680), rowH = 28, R = 44;
    var labelW = Math.round(Math.min(250, W * 0.46));
    var H = rows.length * rowH + 4;
    var max = rows[0].n;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'group', 'aria-label': unit + ' by stop' });
    rows.forEach(function (row, k) {
      var y = k * rowH;
      var w = Math.max(2, (row.n / max) * (W - labelW - R));
      var g = svg('g', { class: 'mark' });
      g.appendChild(svg('rect', { class: 'hit', x: 0, y: y, width: W, height: rowH }));
      var label = svg('text', { x: labelW - 10, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'axis-label' });
      label.textContent = truncate(name(row.key), Math.floor(labelW / 7));
      g.appendChild(label);
      var r = Math.min(4, w / 2);
      var bh = 16, by = y + (rowH - bh) / 2;
      g.appendChild(svg('path', { class: 'bar', fill: 'var(--seq)',
        d: 'M' + labelW + ',' + by + 'H' + (labelW + w - r) + 'Q' + (labelW + w) + ',' + by + ' ' + (labelW + w) + ',' + (by + r) +
           'V' + (by + bh - r) + 'Q' + (labelW + w) + ',' + (by + bh) + ' ' + (labelW + w - r) + ',' + (by + bh) + 'H' + labelW + 'Z' }));
      var v = svg('text', { x: labelW + w + 6, y: y + rowH / 2 + 4, class: 'value-label' });
      v.textContent = row.n.toLocaleString();
      g.appendChild(v);
      attachTip(g, row.n.toLocaleString() + ' ' + unit, name(row.key));
      s.appendChild(g);
    });
    box.appendChild(s);
  }

  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function headRow(cols) {
    var tr = el('tr');
    cols.forEach(function (c, k) { tr.appendChild(el('th', k ? 'num' : null, c)); });
    var thead = el('thead');
    thead.appendChild(tr);
    return thead;
  }

  function routeCell(r, withName) {
    var td = el('td', 'routecell');
    var b = el('span', 'badge', r.id);
    b.style.setProperty('--route-colour', r.colour);
    td.appendChild(b);
    if (withName) td.appendChild(el('span', 'muted', r.label || r.name));
    td.title = r.name + (r.label ? ' · ' + r.label : '');
    return td;
  }

  function renderHops(sightings) {
    var measured = hops(sightings);
    var table = $('table-hops');
    var paste = $('hops-paste');
    table.innerHTML = '';
    paste.innerHTML = '';
    if (!Object.keys(measured).length) {
      table.appendChild(el('caption', 'card__empty', 'No rides logged stop by stop in this period yet.'));
      return;
    }
    table.appendChild(headRow(['From → to', 'Median', 'Rides']));
    var lines = [];
    DATA.routes.forEach(function (route) {
      var rows = [], complete = true, minutes = [];
      for (var i = 0; i < route.stops.length - 1; i++) {
        var xs = measured[route.id + '|' + i] || [];
        if (xs.length < 3) complete = false;
        minutes.push(xs.length ? Math.max(0.5, Math.round(median(xs) / 30) / 2) : null);
        if (!xs.length) continue;
        rows.push([stopsById[route.stops[i]], stopsById[route.stops[i + 1]], median(xs), xs.length]);
      }
      if (!rows.length) return;
      var head = el('tr');
      var th = routeCell(route, true);
      th.colSpan = 3;
      head.appendChild(th);
      table.appendChild(head);
      rows.forEach(function (row) {
        var tr = el('tr');
        tr.appendChild(el('td', null, row[0].name + ' → ' + row[1].name));
        var sec = Math.round(row[2]);
        tr.appendChild(el('td', 'num', Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2)));
        tr.appendChild(el('td', 'num', row[3]));
        table.appendChild(tr);
      });
      if (complete) lines.push("'" + route.id + "': [" + minutes.join(', ') + '],');
    });
    if (lines.length) {
      paste.appendChild(document.createTextNode('Every hop measured 3+ times — paste into rideTimes in data/shuttle-data.js:'));
      lines.forEach(function (l) { paste.appendChild(el('code', 'paste', l)); });
    } else {
      paste.textContent = 'A route replaces its estimated ride times once every hop on it has 3 or more rides.';
    }
  }

  function renderRecent(rows) {
    var table = $('table-recent');
    table.innerHTML = '';
    rows = rows.slice().sort(function (a, b) { return b.at - a.at; }).slice(0, 40);
    if (!rows.length) {
      table.appendChild(el('caption', 'card__empty', 'Nothing logged in this period.'));
      return;
    }
    table.appendChild(headRow(['Route', 'Stop', 'When (HK)', 'What']));
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(routeCell(routesById[r.route]));
      tr.appendChild(el('td', null, stopsById[r.stop].name));
      tr.appendChild(el('td', 'num', hk(r.at).label));
      tr.appendChild(el('td', 'num muted',
        r.kind === 'spots' ? 'spotted' :
        r.kind === 'alightings' ? 'got off (' + r.how + ')' :
        r.auto ? 'ride, GPS' : 'ride report'));
      table.appendChild(tr);
    });
  }

  function downloadCsv() {
    var cols = ['kind', 'at_hk', 'at_utc', 'received_utc', 'route', 'stop', 'i', 'trip', 'auto', 'how'];
    var rows = all.sightings.concat(all.spots, all.alightings)
      .sort(function (a, b) { return a.at - b.at; })
      .map(function (r) {
        return [r.kind, hk(r.at).label, new Date(r.at).toISOString(), new Date(r.t).toISOString(),
                r.route, r.stop, r.i, r.trip, r.auto, r.how];
      });
    var csv = [cols].concat(rows).map(function (row) {
      return row.map(function (v) {
        var s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'shuttle-reports-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // Charts are drawn to the page width, so redraw when it changes.
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (!$('stats-body').hidden) render(); }, 150);
  });

  init();
})();
