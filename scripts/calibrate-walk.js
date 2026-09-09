#!/usr/bin/env node
/**
 * calibrate-walk.js — measure the walking detour factor from the real network.
 *
 *     node scripts/calibrate-walk.js
 *
 * WHY
 *   lib/geo.js estimates a walk as straight-line distance × `detourFactor`,
 *   then applies Tobler's hiking function for the gradient. That factor was
 *   originally a guess. It does not have to be: data/shapes.generated.js ships
 *   a routable campus footpath network, so we can route thousands of real legs
 *   and measure the ratio directly.
 *
 *   The sample is deliberately building-to-stop legs, because those are the
 *   walks the app actually estimates — walk to the boarding stop, walk from
 *   the alighting stop to where you are going.
 *
 * WHAT TO DO WITH THE RESULT
 *   Set `config.walking.detourFactor` in data/shuttle-data.js at or slightly
 *   below the median. Slightly below, because OpenStreetMap does not map every
 *   covered walkway, podium shortcut and lift on this campus, so the router
 *   sometimes detours where a person would not.
 *
 *   Do NOT route every leg at runtime instead. It would mean tens of Dijkstra
 *   runs per search on a phone, and 30% of legs fail to snap to a path at all,
 *   which would leave the app mixing two different methods in one ranked list.
 *   A single measured constant keeps the method uniform and the numbers cheap.
 */

'use strict';

require('../lib/walkroute.js');
require('../data/places.generated.js');
require('../data/routes.generated.js');
require('../data/shapes.generated.js');
require('../data/shuttle-data.js');

const DATA = globalThis.SHUTTLE_DATA;
const Router = globalThis.CUHK.WalkRouter;

if (!DATA.walkGraph) {
  console.error('No walking graph. Run: node scripts/extract-geometry.js');
  process.exit(1);
}

const R = 6371000;
const rad = (d) => d * Math.PI / 180;
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const router = new Router(DATA.walkGraph);
const places = DATA.places.filter((p) => p.source === 'osm' || p.source === 'osm+stop');

const MIN_M = 60, MAX_M = 1200, STRIDE = 3, ABSURD_RATIO = 4;

const ratios = [];
const bands = { '60–250 m': [], '250–600 m': [], '600–1200 m': [] };
let tried = 0, unroutable = 0;

for (const stop of DATA.stops) {
  for (let i = 0; i < places.length; i += STRIDE) {
    const p = places[i];
    const straight = haversine(stop, p);
    if (straight < MIN_M || straight > MAX_M) continue;
    tried++;

    const routed = router.route(stop, p);
    if (!routed) { unroutable++; continue; }

    const ratio = routed.metres / straight;
    if (ratio > ABSURD_RATIO) continue;   // disconnected corner of the graph

    ratios.push(ratio);
    const band = straight < 250 ? '60–250 m' : straight < 600 ? '250–600 m' : '600–1200 m';
    bands[band].push(ratio);
  }
}

const q = (arr, f) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * f)];
};
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

console.log(`Sampled ${tried} building-to-stop legs.`);
console.log(`  routed:     ${ratios.length}`);
console.log(`  unroutable: ${unroutable} (${(100 * unroutable / tried).toFixed(0)}% — ` +
            `no footpath within the snap limit)\n`);

console.log('Ratio of routed distance to straight-line distance:');
console.log(`  p10 ${q(ratios, 0.1).toFixed(2)}   p25 ${q(ratios, 0.25).toFixed(2)}   ` +
            `median ${q(ratios, 0.5).toFixed(2)}   p75 ${q(ratios, 0.75).toFixed(2)}   ` +
            `p90 ${q(ratios, 0.9).toFixed(2)}`);
console.log(`  mean ${mean(ratios).toFixed(2)}\n`);

for (const [name, arr] of Object.entries(bands)) {
  if (!arr.length) continue;
  console.log(`  ${name.padEnd(12)} n=${String(arr.length).padStart(4)}   ` +
              `median ${q(arr, 0.5).toFixed(2)}`);
}

const current = DATA.config.walking.detourFactor;
const median = q(ratios, 0.5);
console.log(`\nconfig.walking.detourFactor is currently ${current}.`);
const skew = (median / current - 1) * 100;
if (Math.abs(skew) < 8) {
  console.log('That is consistent with the measurement.');
} else if (skew > 0) {
  console.log(`Walks are being UNDERESTIMATED by roughly ${skew.toFixed(0)}%. ` +
              `Consider raising it toward ${median.toFixed(2)}.`);
} else {
  console.log(`Walks are being OVERESTIMATED by roughly ${(-skew).toFixed(0)}%. ` +
              `Consider lowering it toward ${median.toFixed(2)}.`);
}
