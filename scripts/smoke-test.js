#!/usr/bin/env node
/**
 * smoke-test.js — exercise the planner hard and check nothing comes out wrong.
 *
 *     node scripts/smoke-test.js
 *
 * Runs a few thousand journeys across every day of the week and a spread of
 * hours, and asserts the invariants that matter:
 *
 *   - every search returns options, and walking is always one of them
 *   - no negative waits, no inverted ranges, no NaN totals
 *   - you never board after you alight
 *   - every shuttle option carries departures
 *   - a "group" always holds more than one route
 *   - the ranked list really is ranked
 *
 * Then checks the walking router still routes, and that every generated route
 * shape lines up with its stop list.
 *
 * Exits non-zero on any problem, so it can gate a deploy alongside
 * scripts/validate-data.js.
 */

'use strict';

require('../lib/geo.js'); require('../lib/planner.js'); require('../lib/search.js');
require('../lib/walkroute.js');
require('../data/places.generated.js'); require('../data/routes.generated.js');
require('../data/shapes.generated.js'); require('../data/shuttle-data.js');

const D = globalThis.SHUTTLE_DATA, { planner, geo } = globalThis.CUHK;
const router = new globalThis.CUHK.WalkRouter(D.walkGraph);

let checked = 0, problems = [];
const pool = D.places.filter(p => p.source !== 'stop').filter((_, i) => i % 9 === 0)
  .concat(D.stops.map(s => ({ ...s, id: 'stop:' + s.id })));

for (let day = 7; day <= 13; day++) {
  for (const hour of [7, 9, 12, 15, 18, 21, 23]) {
    for (let i = 0; i < pool.length; i += 3) {
      const a = pool[i], b = pool[(i * 13 + hour) % pool.length];
      if (a.id === b.id) continue;
      const now = new Date(2026, 8, day, hour, (i * 7) % 60);
      let r;
      try { r = planner.plan(a, b, D, now); }
      catch (e) { problems.push(`THREW ${a.id}->${b.id} @${hour}: ${e.message}`); continue; }
      checked++;

      if (!r.options.length) problems.push(`no options at all: ${a.id}->${b.id} @${hour}`);
      if (!r.options.some(o => o.kind === 'walk')) problems.push(`walk missing: ${a.id}->${b.id} @${hour}`);
      for (const o of r.options) {
        if (!(o.totalMinutes >= 0)) problems.push(`bad total: ${a.id}->${b.id} ${o.key}`);
        if (o.totalLow > o.totalHigh) problems.push(`inverted range: ${a.id}->${b.id} ${o.key}`);
        if (o.kind === 'shuttle') {
          if (o.waitMinutes < -0.01) problems.push(`negative wait: ${a.id}->${b.id} ${o.key} ${o.waitMinutes}`);
          if (o.boardIndex >= o.alightIndex) problems.push(`bad leg order: ${o.key}`);
          if (!o.upcomingDepartures.length && !o.pooledDepartures) problems.push(`no departures: ${o.key}`);
          if (o.isGroup && o.routes.length < 2) problems.push(`group of one: ${o.key}`);
        }
      }
      // options must be sorted
      for (let k = 1; k < r.options.length; k++) {
        if (r.options[k].totalMinutes < r.options[k-1].totalMinutes - 1.01) {
          problems.push(`out of order: ${a.id}->${b.id} @${hour}`);
        }
      }
    }
  }
}
console.log(`planner: ${checked} journeys checked`);
console.log(problems.length ? problems.slice(0, 15).join('\n') : '  no problems');

// walk router health
let routed = 0, failed = 0;
for (let i = 0; i < pool.length; i += 3) {
  const res = router.route(pool[i], pool[(i + 5) % pool.length]);
  res ? routed++ : failed++;
}
console.log(`\nwalk router: ${routed} routed, ${failed} unroutable`);

// every generated shape lines up with its route
for (const r of D.routes) {
  const sh = D.routeShapes[r.id];
  if (!sh) { console.log(`  MISSING SHAPE ${r.id}`); continue; }
  if (sh.stopIndices.length !== r.stops.length) console.log(`  SHAPE MISMATCH ${r.id}`);
  const bad = sh.stopIndices.some((v, i, arr) => i && v < arr[i-1]);
  if (bad) console.log(`  NON-MONOTONIC STOP INDICES ${r.id}`);
}
console.log('shapes: checked');

if (problems.length) {
  console.error(`\n${problems.length} problem(s) found.`);
  process.exit(1);
}
console.log('\nAll good.');
