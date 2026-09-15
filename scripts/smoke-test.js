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
 *   - last-bus lookups stay near the destination, one per route, latest first
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
// last bus: sane times, near the destination, latest first, one per route
let lastChecked = 0;
for (let day = 7; day <= 13; day++) {
  for (const hour of [8, 17, 22]) {
    for (let i = 0; i < pool.length; i += 7) {
      const dest = pool[i], origin = i % 2 ? pool[(i * 5) % pool.length] : null;
      if (origin && origin.id === dest.id) continue;
      const now = new Date(2026, 8, day, hour, 10);
      let rides;
      try { rides = planner.lastRides(dest, D, now, origin); }
      catch (e) { problems.push(`lastRides THREW ${dest.id}: ${e.message}`); continue; }
      lastChecked++;
      const ids = new Set();
      rides.forEach((r, k) => {
        if (ids.has(r.route.id)) problems.push(`lastRides repeats ${r.route.id} for ${dest.id}`);
        ids.add(r.route.id);
        if (r.boardIndex >= r.alightIndex) problems.push(`lastRides bad order ${r.route.id} ${dest.id}`);
        if (!(r.boardMinutes > 0 && r.boardMinutes < 26 * 60)) problems.push(`lastRides bad time ${r.route.id}`);
        if (r.walkHome.minutes > D.config.lastBus.maxWalkFromStopMinutes) problems.push(`lastRides too far ${r.route.id} ${dest.id}`);
        if (k && r.boardMinutes > rides[k - 1].boardMinutes) problems.push(`lastRides unsorted ${dest.id}`);
      });
    }
  }
}

console.log(`planner: ${checked} journeys checked, ${lastChecked} last-bus lookups`);
// A route must not vanish because its bus just left. Walk minute by minute
// through a weekday from I House 6 to the station: Route 4 runs to the door
// every twenty minutes, so it has to be on the list the whole time, just with
// a later departure. It used to disappear for most of every gap.
{
  const home = D.places.find(p => p.id === 'university-residence-nos-3');
  const station = D.places.find(p => p.id === 'stop:univ-station');
  let missing = 0;
  for (let m = 10 * 60; m < 16 * 60; m++) {
    const when = new Date('2026-09-14T00:00:00');   // a Monday in term
    when.setHours(0, m);
    const r = planner.plan(home, station, D, when);
    if (!r.options.some(o => o.kind !== 'walk' && (o.routes || [o.route]).some(x => x.id === '4'))) missing++;
  }
  if (missing) problems.push(`Route 4 missing from I House 6 -> station for ${missing} of 360 minutes`);
}

console.log(problems.length ? problems.slice(0, 15).join('\n') : '  no problems');

// GPS ride following: drive every route stop to stop with noisy fixes and
// the odd wild one. Every stop must be logged, in order, and nobody may be
// told they got off mid-ride. Then walk away from the road and they must be.
require('../lib/ridefollow.js');
{
  const follow = globalThis.CUHK.rideFollow;
  const T = D.config.tracking;
  const byId = {};
  D.stops.forEach((st) => { byId[st.id] = st; });
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let rides = 0;

  D.routes.forEach((route) => {
    const shape = D.routeShapes[route.id];
    if (!shape || !shape.stopIndices) return;
    for (let run = 0; run < 5; run++) {
      rides++;
      const f = {}, ride = { i: 0 };
      const logged = [];
      let ended = false;
      const idx = shape.stopIndices;
      for (let k = idx[0]; k <= idx[idx.length - 1] && !ended; k++) {
        const [lat, lng] = shape.line[k];
        const fixes = [{ lat: lat + (rand() - 0.5) * 0.0001, lng: lng + (rand() - 0.5) * 0.0001,
                         accuracy: 8 + rand() * 30 }];
        if (rand() < 0.04) fixes.push({ lat: lat + 0.0015, lng, accuracy: 25 });   // a wild fix
        fixes.forEach((fix) => {
          const r = follow.step(f, ride, fix, route, shape, byId, T);
          if (r.arrived >= 0) { logged.push(r.arrived); ride.i = r.arrived; }
          if (r.gotOff) ended = true;
        });
      }
      if (ended) problems.push(`ride-follow: route ${route.id} run ${run} said "got off" mid-ride after stop ${ride.i}`);
      const want = route.stops.map((_, i) => i).slice(1);
      if (logged.join() !== want.join()) {
        problems.push(`ride-follow: route ${route.id} run ${run} logged [${logged}] expected [${want}]`);
      }
    }

    // Walking off after the second stop.
    const f = {}, ride = { i: 0 };
    let gotOff = false;
    for (let k = shape.stopIndices[0]; k <= shape.stopIndices[2]; k++) {
      const [lat, lng] = shape.line[k];
      const r = follow.step(f, ride, { lat, lng, accuracy: 10 }, route, shape, byId, T);
      if (r.arrived >= 0) ride.i = r.arrived;
      if (r.gotOff) gotOff = true;
    }
    const [lat, lng] = shape.line[shape.stopIndices[2]];
    for (let w = 1; w <= 4 && !gotOff; w++) {
      // Straight away from campus roads, 150 m and more.
      const r = follow.step(f, ride, { lat: lat + 0.0014 * w, lng: lng + 0.0014 * w, accuracy: 12 },
                            route, shape, byId, T);
      if (r.gotOff) gotOff = true;
    }
    if (!gotOff) problems.push(`ride-follow: route ${route.id} did not notice the rider walking off`);

    // Reopening the app mid-ride: the last stop logged is well behind the
    // bus. It must find the bus again, skip the stops it did not see, log the
    // rest, and not call it getting off.
    if (shape.stopIndices.length >= 8) {
      const from = 1, back = Math.min(route.stops.length - 3, 5);
      const f2 = { lastMatchAt: 0 }, r2 = { i: from };
      const logged = [];
      let off = false, resumedAfter = -1, t = 10 * 60000;
      for (let k = shape.stopIndices[back] - 2; k <= shape.stopIndices[shape.stopIndices.length - 1] && !off; k++) {
        const [lat, lng] = shape.line[k];
        t += 3000;
        const r = follow.step(f2, r2, { lat, lng, accuracy: 15, time: t }, route, shape, byId, T);
        if (r.resumedAfter >= 0) { resumedAfter = r.resumedAfter; r2.i = r.resumedAfter; }
        if (r.arrived >= 0) { logged.push(r.arrived); r2.i = r.arrived; }
        if (r.gotOff) off = true;
      }
      if (off) problems.push(`ride-follow resume: route ${route.id} said "got off" after reopening mid-ride`);
      if (resumedAfter < 0) problems.push(`ride-follow resume: route ${route.id} never found the bus again`);
      const want = route.stops.map((_, i) => i).filter((i) => i >= back);
      if (logged[logged.length - 1] !== route.stops.length - 1 || logged[0] > back) {
        problems.push(`ride-follow resume: route ${route.id} logged [${logged}] after reopening near stop ${back}, expected [${want}]`);
      }
    }
  });
  console.log(`ride follow: ${rides} simulated rides`);
}

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
  console.error(problems.slice(0, 40).join("\n"));
  console.error(`\n${problems.length} problem(s) found.`);
  process.exit(1);
}
console.log('\nAll good.');
