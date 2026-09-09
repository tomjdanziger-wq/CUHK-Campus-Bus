#!/usr/bin/env node
/**
 * validate-data.js — sanity-check the extracted timetable before shipping it.
 *
 *     node scripts/validate-data.js
 *
 * The route data is parsed out of a PDF *diagram*, so the failure mode to
 * guard against is a plausible-looking but wrongly-ordered stop sequence. That
 * would produce confidently wrong advice, which is the one thing this app is
 * built not to do. These checks are cheap and catch it.
 *
 * Checks:
 *   1. Every stop id referenced by a route exists.
 *   2. No stop is listed twice in a row.
 *   3. Consecutive stops are geographically close. A parsing error that
 *      shuffles the sequence shows up immediately as an implausible hop.
 *   4. `segmentMinutes`, where present, has one entry per hop.
 *   5. Departure minutes are in range and service hours parse.
 *   6. Every stop is served by at least one route.
 *
 * It also prints each route's elevation profile. A campus loop climbs one side
 * and descends the other; a profile that saw-tooths is worth a second look.
 *
 * Exits non-zero if anything fails, so it can gate a deploy.
 */

'use strict';

require('../data/places.generated.js');
require('../data/routes.generated.js');
require('../data/shuttle-data.js');
require('../lib/geo.js');

const DATA = globalThis.SHUTTLE_DATA;
const geo = globalThis.CUHK.geo;

const MAX_HOP_METRES = 1200;   // generous: the longest real hop is well under this

let errors = 0;
let warnings = 0;

const fail = (msg) => { console.error('  ✗ ' + msg); errors++; };
const warn = (msg) => { console.warn('  ! ' + msg); warnings++; };

const byId = {};
DATA.stops.forEach((s) => { byId[s.id] = s; });

console.log(`Stops: ${DATA.stops.length}   Routes: ${DATA.routes.length}   ` +
            `Searchable places: ${DATA.places.length}\n`);

const served = new Set();

for (const r of DATA.routes) {
  console.log(`${r.name}${r.label ? ' — ' + r.label : ''}  ` +
              `${r.firstDeparture}–${r.lastDeparture}  ` +
              `at :${r.departureMinutes.join(', :')}  ${r.runsOn}`);

  // 1 & 2 — stop ids resolve, and no immediate repeats.
  let ok = true;
  r.stops.forEach((id, i) => {
    if (!byId[id]) { fail(`${r.name}: unknown stop id "${id}" at position ${i}`); ok = false; }
    if (i > 0 && r.stops[i - 1] === id) fail(`${r.name}: "${id}" repeated back-to-back at ${i}`);
    served.add(id);
  });
  if (!ok) { console.log(''); continue; }

  // 3 — consecutive hops must be plausible.
  const profile = [];
  for (let i = 0; i < r.stops.length - 1; i++) {
    const a = byId[r.stops[i]], b = byId[r.stops[i + 1]];
    const d = Math.round(geo.haversineMetres(a, b));
    if (d > MAX_HOP_METRES) {
      fail(`${r.name}: implausible hop ${a.name} → ${b.name} (${d} m). ` +
           `Stop order may have been parsed wrongly.`);
    }
    profile.push(`${byId[r.stops[i]].elevation}`);
  }
  profile.push(`${byId[r.stops[r.stops.length - 1]].elevation}`);
  console.log(`  elevation: ${profile.join(' → ')} m`);

  // 4 — segmentMinutes length.
  if (r.segmentMinutes && r.segmentMinutes.length !== r.stops.length - 1) {
    fail(`${r.name}: segmentMinutes has ${r.segmentMinutes.length} entries, ` +
         `needs ${r.stops.length - 1}`);
  }
  if (!r.segmentMinutes) {
    console.log('  ride times: ESTIMATED from distance (no published running times)');
  }

  // 5 — timetable fields.
  if (!/^\d{1,2}:\d{2}$/.test(r.firstDeparture || '')) fail(`${r.name}: bad firstDeparture`);
  if (!/^\d{1,2}:\d{2}$/.test(r.lastDeparture || '')) fail(`${r.name}: bad lastDeparture`);
  if (!r.departureMinutes.length) fail(`${r.name}: no departure minutes`);
  r.departureMinutes.forEach((m) => {
    if (!(m >= 0 && m <= 59)) fail(`${r.name}: departure minute ${m} out of range`);
  });

  console.log('');
}

// 6 — orphan stops.
DATA.stops.forEach((s) => {
  if (!served.has(s.id)) warn(`stop "${s.id}" (${s.name}) is not on any route`);
});

if (DATA.meta.isPlaceholder) {
  warn('meta.isPlaceholder is true — the app will show the demo-data banner.');
}
if (DATA.meta.rideTimesEstimated) {
  console.log('Note: meta.rideTimesEstimated is true — ride legs are estimated ' +
              'from distance and the app says so.');
}

console.log(`\n${errors} error(s), ${warnings} warning(s).`);
process.exit(errors ? 1 : 0);
