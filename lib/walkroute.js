/* ---------------------------------------------------------------------------
 * walkroute.js — route a walk over the campus footpath network, in the browser.
 *
 * Bus routes have fixed stops, so their road geometry is precomputed offline by
 * scripts/extract-geometry.js. Walking legs cannot be: they start wherever the
 * user is standing. So the app ships a compact campus footpath graph and runs
 * Dijkstra over it here.
 *
 * This is for DRAWING only. The walking *time* estimate still comes from
 * lib/geo.js — straight-line distance × a detour factor, adjusted for gradient.
 * Routing every candidate option would mean a hundred Dijkstra runs per search,
 * on a phone, on every keystroke. The map draws the real path; the numbers stay
 * cheap and honest about being estimates.
 *
 * Graph format (from data/shapes.generated.js):
 *   lat, lng   parallel arrays of integers, degrees × 1e6
 *   edges      flat pairs of node indices, undirected
 * ------------------------------------------------------------------------- */

(function (root) {
  'use strict';

  var SCALE = 1e6;

  // Give up if the nearest path node is further than this from the point —
  // beyond it we would be drawing a route to somewhere the user is not.
  var SNAP_LIMIT_M = 250;

  // How much further than the closest node another entry point may be before
  // it stops counting as an alternative way onto the network.
  var CANDIDATE_SPREAD_M = 70;
  var MAX_CANDIDATES = 12;

  var EARTH_R = 6371000;
  function rad(d) { return d * Math.PI / 180; }

  function metres(aLat, aLng, bLat, bLng) {
    var dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function Router(graph) {
    this.ok = !!(graph && graph.lat && graph.lat.length);
    if (!this.ok) return;

    this.lat = graph.lat;
    this.lng = graph.lng;
    this.n = graph.lat.length;

    // Build CSR adjacency once: counting sort into flat arrays. Faster to
    // traverse than an array of arrays, and allocated exactly once.
    var edges = graph.edges, m = edges.length / 2;
    var deg = new Int32Array(this.n);
    var i;
    for (i = 0; i < m; i++) { deg[edges[2 * i]]++; deg[edges[2 * i + 1]]++; }

    var head = new Int32Array(this.n + 1);
    for (i = 0; i < this.n; i++) head[i + 1] = head[i] + deg[i];

    var cursor = head.slice(0, this.n);
    var to = new Int32Array(m * 2);
    var cost = new Float32Array(m * 2);

    for (i = 0; i < m; i++) {
      var a = edges[2 * i], b = edges[2 * i + 1];
      var w = metres(this.lat[a] / SCALE, this.lng[a] / SCALE,
                     this.lat[b] / SCALE, this.lng[b] / SCALE);
      to[cursor[a]] = b; cost[cursor[a]] = w; cursor[a]++;
      to[cursor[b]] = a; cost[cursor[b]] = w; cursor[b]++;
    }

    this.head = head; this.to = to; this.cost = cost;

    // Scratch buffers, reused across calls.
    this.dist = new Float64Array(this.n);
    this.prev = new Int32Array(this.n);
    this.seen = new Int32Array(this.n);
    this.stamp = 0;

    this.cache = {};
  }

  /** Nearest graph node to a coordinate, or -1 if nothing is close enough. */
  Router.prototype.snap = function (lat, lng) {
    var near = this.candidates(lat, lng, 1);
    return near.length ? near[0].node : -1;
  };

  /**
   * Every graph node worth entering the network at, with the cost of walking
   * to it from the given point.
   *
   * Snapping to the single nearest node is wrong, and wrong in a way that
   * produces confidently silly routes. Outside University Residence No. 3 the
   * nearest node is a dead-end stub 26 m away serving the building's steps;
   * the road you actually cross to reach Wu Yee Sun is a node 33 m away. Snap
   * to the closer one and the only way out is back down the stub, which turned
   * a 95 m walk into a 355 m one — up a staircase nobody uses.
   *
   * So we hand the search several places to start and let it work out which
   * entrance leads somewhere, instead of deciding that by proximity alone.
   */
  Router.prototype.candidates = function (lat, lng, limit) {
    var found = [];
    var latI = lat * SCALE, lngI = lng * SCALE, box = 0.004 * SCALE;

    for (var i = 0; i < this.n; i++) {
      if (Math.abs(this.lat[i] - latI) > box) continue;
      if (Math.abs(this.lng[i] - lngI) > box) continue;
      var d = metres(lat, lng, this.lat[i] / SCALE, this.lng[i] / SCALE);
      if (d <= SNAP_LIMIT_M) found.push({ node: i, access: d });
    }
    if (!found.length) return [];

    found.sort(function (a, b) { return a.access - b.access; });

    // Everything within a short detour of the closest option. A node much
    // further away is not a different entrance, it is a different place.
    var cutoff = found[0].access + CANDIDATE_SPREAD_M;
    return found
      .filter(function (c) { return c.access <= cutoff; })
      .slice(0, limit || MAX_CANDIDATES);
  };

  /**
   * Walk route between two coordinates.
   * Returns { points: [[lat,lng], ...], metres } or null when unroutable.
   *
   * The returned line is stitched to the true endpoints, so it starts at the
   * user's actual position rather than at whatever path node was nearest.
   */
  Router.prototype.route = function (from, to) {
    if (!this.ok) return null;

    var key = from.lat.toFixed(5) + ',' + from.lng.toFixed(5) + '|' +
              to.lat.toFixed(5) + ',' + to.lng.toFixed(5);
    if (this.cache[key] !== undefined) return this.cache[key];

    var sources = this.candidates(from.lat, from.lng);
    var targets = this.candidates(to.lat, to.lng);
    if (!sources.length || !targets.length) return (this.cache[key] = null);

    var direct = metres(from.lat, from.lng, to.lat, to.lng);
    var result = null;

    var path = this._search(sources, targets);
    if (path) {
      var pts = [[from.lat, from.lng]];
      for (var i = 0; i < path.length; i++) {
        pts.push([this.lat[path[i]] / SCALE, this.lng[path[i]] / SCALE]);
      }
      pts.push([to.lat, to.lng]);
      result = { points: pts, metres: this.lastMetres };
    }

    // Walking onto the network and straight back off it is not a route.
    if (!result || result.metres > direct * 6 + 60) {
      result = { points: [[from.lat, from.lng], [to.lat, to.lng]], metres: direct,
                 straightLine: true };
    }

    this.cache[key] = result;
    return result;
  };

  /**
   * Dijkstra from every source at once, finishing at whichever target gives
   * the shortest total including the walk on and off the network.
   */
  Router.prototype._search = function (sources, targets) {
    var dist = this.dist, prev = this.prev, seen = this.seen;
    var head = this.head, to = this.to, cost = this.cost;
    var stamp = ++this.stamp;

    // A plain binary heap. The graph is a few thousand nodes, so this runs in
    // a couple of milliseconds — no need for anything cleverer.
    var heapD = [], heapN = [];

    function push(node, d) {
      heapD.push(d); heapN.push(node);
      var i = heapD.length - 1;
      while (i > 0) {
        var p = (i - 1) >> 1;
        if (heapD[p] <= heapD[i]) break;
        var td = heapD[p]; heapD[p] = heapD[i]; heapD[i] = td;
        var tn = heapN[p]; heapN[p] = heapN[i]; heapN[i] = tn;
        i = p;
      }
    }

    function pop() {
      var topD = heapD[0], topN = heapN[0];
      var lastD = heapD.pop(), lastN = heapN.pop();
      if (heapD.length) {
        heapD[0] = lastD; heapN[0] = lastN;
        var i = 0;
        for (;;) {
          var l = 2 * i + 1, r = l + 1, sm = i;
          if (l < heapD.length && heapD[l] < heapD[sm]) sm = l;
          if (r < heapD.length && heapD[r] < heapD[sm]) sm = r;
          if (sm === i) break;
          var td = heapD[sm]; heapD[sm] = heapD[i]; heapD[i] = td;
          var tn = heapN[sm]; heapN[sm] = heapN[i]; heapN[i] = tn;
          i = sm;
        }
      }
      return [topD, topN];
    }

    // Each source starts already carrying the cost of walking to it.
    for (var si = 0; si < sources.length; si++) {
      var sn = sources[si].node;
      if (seen[sn] === stamp && dist[sn] <= sources[si].access) continue;
      seen[sn] = stamp; dist[sn] = sources[si].access; prev[sn] = -1;
      push(sn, sources[si].access);
    }

    var settled = {};
    while (heapD.length) {
      var top = pop(), d = top[0], u = top[1];
      if (settled[u]) continue;
      settled[u] = 1;
      if (d > dist[u]) continue;

      for (var e = head[u]; e < head[u + 1]; e++) {
        var v = to[e], nd = d + cost[e];
        if (seen[v] !== stamp || nd < dist[v]) {
          seen[v] = stamp; dist[v] = nd; prev[v] = u;
          push(v, nd);
        }
      }
    }

    // Pick the exit that gives the shortest door-to-door total.
    var best = -1, bestTotal = Infinity;
    for (var ti = 0; ti < targets.length; ti++) {
      var tn = targets[ti].node;
      if (seen[tn] !== stamp) continue;
      var total = dist[tn] + targets[ti].access;
      if (total < bestTotal) { bestTotal = total; best = tn; }
    }
    if (best < 0) return null;

    this.lastMetres = bestTotal;

    var out = [];
    for (var n = best; n !== -1; n = prev[n]) out.push(n);
    out.reverse();
    return out;
  };

  root.CUHK = root.CUHK || {};
  root.CUHK.WalkRouter = Router;

})(typeof globalThis !== 'undefined' ? globalThis : this);
