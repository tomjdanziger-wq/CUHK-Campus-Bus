#!/usr/bin/env node
/**
 * extract-geometry.js — build the map geometry: what streets each bus actually
 * drives, and a walking network the app can route on in the browser.
 *
 * WHY
 *   The map used to join consecutive stops with straight lines, which drew
 *   buses straight through buildings and across the valley. A route line that
 *   is visibly wrong undermines the written directions next to it.
 *
 * WHAT IT PRODUCES  ->  data/shapes.generated.js
 *
 *   routeShapes   For every route, the real road polyline from its first stop
 *                 to its last, snapped to the OSM road network and honouring
 *                 one-way restrictions. Computed once, shipped static.
 *
 *   walkGraph     A compact routable footpath + road network for the campus.
 *                 Walking legs start from arbitrary coordinates (a GPS fix, a
 *                 searched building), so they cannot be precomputed — the app
 *                 runs Dijkstra over this in the browser. Coordinates are
 *                 stored as integers scaled by 1e6 to keep the file small.
 *
 * USAGE
 *   node scripts/extract-geometry.js            # fetches, then builds
 *   node scripts/extract-geometry.js --cache F  # reuse a saved Overpass reply
 *
 * The Overpass reply is cached next to the output so a rebuild does not
 * re-download it. OSM data is ODbL; attribution is rendered in the app footer.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

require('../data/routes.generated.js');
require('../data/places.generated.js');
require('../data/shuttle-data.js');

const DATA = globalThis.SHUTTLE_DATA;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BBOX = [22.4085, 114.1960, 22.4320, 114.2170];   // s, w, n, e

const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const OUT = path.join(__dirname, '..', 'data', 'shapes.generated.js');
const CACHE = path.join(__dirname, '..', '.overpass-roads.json');

// Ways a shuttle bus can drive along.
const DRIVABLE = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'service', 'living_street', 'busway',
]);

// Ways a person can walk along. Motorways are excluded — you cannot walk the
// Tate's Cairn Highway, and leaving it in lets the router "walk" the bypass.
const WALKABLE = new Set([
  'trunk', 'primary', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'service', 'living_street',
  'footway', 'path', 'steps', 'pedestrian', 'cycleway', 'track', 'corridor',
]);

// How far a stop may be from the road network before we give up snapping it.
const SNAP_LIMIT_M = 150;

// Tighter box for the shipped walking graph — the query box reaches into
// Science Park and the highway, which nobody is walking to.
const WALK_BOX = [22.4110, 114.1985, 22.4300, 114.2150];

const R = 6371000;
const rad = (d) => d * Math.PI / 180;

function haversine(a, b) {
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const QUERY = `[out:json][timeout:180];
way["highway"](${BBOX.join(',')});
out geom tags;`;

function post(url, body) {
  // Node's sockets are blocked in some sandboxes; curl usually is not.
  const res = spawnSync('curl', [
    '-sS', '--fail-with-body', '--max-time', '240',
    '-H', 'Content-Type: application/x-www-form-urlencoded',
    '--data-binary', '@-', url,
  ], { input: body, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`curl exit ${res.status}: ${(res.stderr || '').slice(0, 200)}`);
  return res.stdout;
}

function loadWays(cacheArg) {
  const cachePath = cacheArg || CACHE;
  if (fs.existsSync(cachePath)) {
    process.stderr.write(`→ using cached ${path.basename(cachePath)}\n`);
    return JSON.parse(fs.readFileSync(cachePath, 'utf8')).elements;
  }
  for (const ep of ENDPOINTS) {
    process.stderr.write(`→ Overpass: ${ep}\n`);
    try {
      const text = post(ep, 'data=' + encodeURIComponent(QUERY));
      if (!text.trimStart().startsWith('{')) throw new Error(text.slice(0, 160));
      fs.writeFileSync(cachePath, text);
      return JSON.parse(text).elements;
    } catch (err) {
      process.stderr.write(`  failed: ${err.message}\n`);
    }
  }
  throw new Error('could not fetch the road network from any Overpass mirror');
}

// ---------------------------------------------------------------------------
// Graph
//
// Overpass `out geom` gives coordinates but no node ids, so ways are joined
// where they share an exact coordinate. OSM emits shared nodes with identical
// values, so this reconstructs the topology faithfully.
// ---------------------------------------------------------------------------

function buildGraph(ways, allowed, { directed }) {
  const index = new Map();     // "lat,lng" -> node index
  const coords = [];           // [lat, lng]
  const adj = [];              // node -> [[neighbour, metres], ...]

  const nodeAt = (p) => {
    const key = p.lat.toFixed(7) + ',' + p.lon.toFixed(7);
    let i = index.get(key);
    if (i === undefined) {
      i = coords.length;
      index.set(key, i);
      coords.push([p.lat, p.lon]);
      adj.push([]);
    }
    return i;
  };

  const link = (a, b, w) => {
    if (a !== b) adj[a].push([b, w]);
  };

  for (const w of ways) {
    const tags = w.tags || {};
    if (!allowed.has(tags.highway)) continue;
    const geom = w.geometry;
    if (!geom || geom.length < 2) continue;

    const oneway = directed
      ? (tags.oneway === 'yes' || tags.oneway === 'true' || tags.oneway === '1' ? 1
        : tags.oneway === '-1' || tags.oneway === 'reverse' ? -1 : 0)
      : 0;

    let prev = nodeAt(geom[0]);
    for (let i = 1; i < geom.length; i++) {
      const cur = nodeAt(geom[i]);
      const d = haversine(coords[prev], coords[cur]);
      if (oneway === 1) link(prev, cur, d);
      else if (oneway === -1) link(cur, prev, d);
      else { link(prev, cur, d); link(cur, prev, d); }
      prev = cur;
    }
  }
  return { coords, adj };
}

/** Minimal binary heap keyed on distance. */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node, d) {
    this.a.push([d, node]);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p][0] <= this.a[i][0]) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  pop() {
    const top = this.a[0], last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < this.a.length && this.a[l][0] < this.a[s][0]) s = l;
        if (r < this.a.length && this.a[r][0] < this.a[s][0]) s = r;
        if (s === i) break;
        [this.a[s], this.a[i]] = [this.a[i], this.a[s]];
        i = s;
      }
    }
    return top;
  }
}

function shortestPath(graph, from, to) {
  const { adj } = graph;
  const dist = new Float64Array(adj.length).fill(Infinity);
  const prev = new Int32Array(adj.length).fill(-1);
  const done = new Uint8Array(adj.length);
  const heap = new Heap();

  dist[from] = 0;
  heap.push(from, 0);

  while (heap.size) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === to) break;
    for (const [v, w] of adj[u]) {
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(v, nd); }
    }
  }
  if (dist[to] === Infinity) return null;

  const out = [];
  for (let n = to; n !== -1; n = prev[n]) out.push(n);
  out.reverse();
  return { nodes: out, metres: dist[to] };
}

function nearestNode(graph, lat, lng) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < graph.coords.length; i++) {
    const d = haversine(graph.coords[i], [lat, lng]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { node: best, metres: bestD };
}

// ---------------------------------------------------------------------------
// Route shapes
// ---------------------------------------------------------------------------

function routeShapes(ways) {
  const drive = buildGraph(ways, DRIVABLE, { directed: true });
  const driveFree = buildGraph(ways, DRIVABLE, { directed: false });
  process.stderr.write(`  road graph: ${drive.coords.length} nodes\n`);

  const byId = {};
  DATA.stops.forEach((s) => { byId[s.id] = s; });

  const shapes = {};
  const fallbacks = [];

  for (const route of DATA.routes) {
    const line = [];
    // Vertex index of each stop along the finished polyline. Lets the app
    // highlight exactly the ridden portion of a route without re-deriving it
    // by proximity, which is ambiguous on a loop that passes a point twice.
    const stopIndices = [];
    let straightHops = 0;

    for (let i = 0; i < route.stops.length - 1; i++) {
      const a = byId[route.stops[i]], b = byId[route.stops[i + 1]];
      const an = nearestNode(drive, a.lat, a.lng);
      const bn = nearestNode(drive, b.lat, b.lng);

      let seg = null;
      if (an.metres < SNAP_LIMIT_M && bn.metres < SNAP_LIMIT_M) {
        const p = shortestPath(drive, an.node, bn.node);
        // A one-way restriction can make a hop unroutable in the stored
        // direction — usually because the stop pair straddles a divided road.
        // Retry ignoring direction before giving up on the geometry.
        const q = p || (() => {
          const a2 = nearestNode(driveFree, a.lat, a.lng);
          const b2 = nearestNode(driveFree, b.lat, b.lng);
          const r = shortestPath(driveFree, a2.node, b2.node);
          return r ? { nodes: r.nodes, metres: r.metres, graph: driveFree } : null;
        })();
        if (q) {
          const g = q.graph || drive;
          // Sanity check against router nonsense — but a generous one. This
          // campus climbs 140 m in a kilometre, so roads switchback hard: the
          // 142 m hop from Science Centre to New Asia Circle gains 39 m, which
          // would be a 27% grade in a straight line and is really 506 m of
          // road. A tight ratio here rejects correct geometry.
          const direct = haversine([a.lat, a.lng], [b.lat, b.lng]);
          if (q.metres < Math.max(600, direct * 6)) {
            seg = q.nodes.map((n) => g.coords[n]);
          } else {
            process.stderr.write(`      [reject] ${a.name} → ${b.name}: routed ${
              Math.round(q.metres)} m vs ${Math.round(direct)} m direct\n`);
          }
        }
      }

      if (!seg) {
        seg = [[a.lat, a.lng], [b.lat, b.lng]];
        straightHops++;
        fallbacks.push(`${route.name}: ${a.name} → ${b.name} (${Math.round(
          haversine([a.lat, a.lng], [b.lat, b.lng]))} m direct, snap ${
          Math.round(an.metres)}/${Math.round(bn.metres)} m)`);
      }

      // Join segments without repeating the shared point.
      if (i === 0) stopIndices.push(0);
      for (const pt of seg) {
        const last = line[line.length - 1];
        if (!last || last[0] !== pt[0] || last[1] !== pt[1]) line.push(pt);
      }
      stopIndices.push(Math.max(0, line.length - 1));
    }

    shapes[route.id] = {
      line: line.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]),
      stopIndices: stopIndices
    };
    process.stderr.write(
      `  ${route.name.padEnd(9)} ${String(line.length).padStart(4)} points` +
      (straightHops ? `   (${straightHops} hop(s) fell back to a straight line)` : '') + '\n');
  }

  if (fallbacks.length) {
    process.stderr.write(`\n! ${fallbacks.length} hop(s) drawn as a straight line ` +
                         `because no road path was found:\n`);
    fallbacks.forEach((f) => process.stderr.write(`    ${f}\n`));
  }
  return shapes;
}

// ---------------------------------------------------------------------------
// Walking graph
// ---------------------------------------------------------------------------

function walkGraph(ways) {
  const g = buildGraph(ways, WALKABLE, { directed: false });

  // Clip to the campus, then drop anything orphaned by the clip.
  const keep = g.coords.map(([lat, lng]) =>
    lat >= WALK_BOX[0] && lat <= WALK_BOX[2] && lng >= WALK_BOX[1] && lng <= WALK_BOX[3]);

  const remap = new Int32Array(g.coords.length).fill(-1);
  const coords = [];
  for (let i = 0; i < g.coords.length; i++) {
    if (keep[i]) { remap[i] = coords.length; coords.push(g.coords[i]); }
  }

  const seen = new Set();
  const edges = [];
  for (let u = 0; u < g.adj.length; u++) {
    if (remap[u] < 0) continue;
    for (const [v] of g.adj[u]) {
      if (remap[v] < 0) continue;
      const a = remap[u], b = remap[v];
      const key = a < b ? a + ':' + b : b + ':' + a;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a, b);
    }
  }

  process.stderr.write(`  walk graph: ${coords.length} nodes, ${edges.length / 2} edges\n`);

  // Integers scaled by 1e6 — about half the characters of decimal strings, and
  // 1e-6 degrees is ~0.1 m, far finer than anything here needs.
  return {
    lat: coords.map((c) => Math.round(c[0] * 1e6)),
    lng: coords.map((c) => Math.round(c[1] * 1e6)),
    edges,
  };
}

// ---------------------------------------------------------------------------

function main() {
  const cacheIdx = process.argv.indexOf('--cache');
  const ways = loadWays(cacheIdx > -1 ? process.argv[cacheIdx + 1] : null);
  process.stderr.write(`  ${ways.length} ways\n`);

  const shapes = routeShapes(ways);
  const walk = walkGraph(ways);

  const src = `/**
 * shapes.generated.js — AUTO-GENERATED. Do not edit by hand.
 *
 * Regenerate with:  node scripts/extract-geometry.js
 *
 *   routeShapes  the real road polyline each shuttle route drives, snapped to
 *                the OpenStreetMap road network and honouring one-way streets
 *   walkGraph    a routable campus footpath network, so the app can draw the
 *                actual walking route rather than a straight line. Coordinates
 *                are integers scaled by 1e6.
 *
 * Source: OpenStreetMap contributors (ODbL), via the Overpass API.
 * Generated: ${new Date().toISOString().slice(0, 10)}
 */
(function (root) {
  'use strict';
  root.CUHK_SHAPES_GENERATED = {
    routeShapes: ${JSON.stringify(shapes)},
    walkGraph: ${JSON.stringify(walk)}
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
  fs.writeFileSync(OUT, src);
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  process.stderr.write(`✓ wrote ${OUT} (${kb} KB)\n`);
}

main();
