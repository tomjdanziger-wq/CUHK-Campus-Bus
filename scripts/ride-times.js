#!/usr/bin/env node
/**
 * ride-times.js — turn logged rides into measured stop-to-stop times.
 *
 *     node scripts/ride-times.js            # summary per route
 *     node scripts/ride-times.js --days 30  # only the last 30 days
 *
 * Riders on the Track page tap each time their bus reaches a stop. Every tap
 * is a report in Firestore carrying the ride id, the route, and the stop's
 * position on the route. Two consecutive taps in one ride, one stop apart,
 * are one measured hop.
 *
 * WHAT IT MEASURES
 *   Arrival to arrival, so each hop includes the dwell at the stop before it.
 *   That is what a rider experiences, and it is what `rideTimes` in
 *   data/shuttle-data.js should hold.
 *
 * WHAT TO DO WITH IT
 *   When every hop of a route has enough samples, the script prints a
 *   `rideTimes` line for it. Paste it into data/shuttle-data.js; that route's
 *   rides then use the measurements instead of the distance estimate.
 *   Hops without enough data are listed so you can see what is missing.
 *
 * The medians are robust to the odd bad tap; hops under 10 s or over 20 min
 * are thrown out as mistakes (a late tap, a bus that sat at a terminus).
 */

'use strict';

require('../data/places.generated.js');
require('../data/routes.generated.js');
require('../data/shuttle-data.js');
require('../data/firebase-config.js');

const DATA = globalThis.SHUTTLE_DATA;
const FB = globalThis.FIREBASE_CONFIG;
const MIN_SAMPLES = 3;
const MIN_SEC = 10, MAX_SEC = 20 * 60;

const daysArg = process.argv.indexOf('--days');
const days = daysArg > -1 ? +process.argv[daysArg + 1] : 365;

// Node's own fetch where it works; curl where it does not (some networks
// and sandboxes block Node's sockets but not curl).
async function post(url, body) {
  try {
    const res = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    return await res.json();
  } catch (e) {
    const r = require('child_process').spawnSync('curl', ['-sS', '--max-time', '60', '-X', 'POST', url,
      '-H', 'Content-Type: application/json', '--data-binary', '@-'], { input: body, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || 'curl failed');
    return JSON.parse(r.stdout);
  }
}

async function fetchAll() {
  const url = `https://firestore.googleapis.com/v1/projects/${FB.projectId}` +
              `/databases/(default)/documents:runQuery?key=${FB.apiKey}`;
  const out = [];
  let after = new Date(Date.now() - days * 86400000).toISOString();

  for (;;) {
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'sightings' }],
        where: { fieldFilter: { field: { fieldPath: 't' }, op: 'GREATER_THAN',
                                value: { timestampValue: after } } },
        orderBy: [{ field: { fieldPath: 't' }, direction: 'ASCENDING' }],
        limit: 200,   // the security rules allow at most 200 per query
      },
    };
    const rows = await post(url, JSON.stringify(body));
    if (!Array.isArray(rows) || rows[0]?.error) throw new Error(JSON.stringify(rows[0]?.error || rows));
    const docs = rows.filter((r) => r.document).map((r) => r.document.fields);
    docs.forEach((f) => out.push({
      trip: f.trip?.stringValue, route: f.route?.stringValue, stop: f.stop?.stringValue,
      i: f.i ? +f.i.integerValue : null,
      // When the bus got there, if the phone said; the server's receive time
      // otherwise (which can lag behind when signal was poor).
      t: Date.parse(f.at?.timestampValue || f.t?.timestampValue),
      auto: f.auto?.booleanValue === true,
    }));
    if (docs.length < 200) break;
    after = docs[docs.length - 1].t.timestampValue;
  }
  return out;
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

(async () => {
  const reports = await fetchAll();
  const trips = {};
  reports.forEach((r) => {
    if (!r.trip || r.i == null || !r.t) return;
    (trips[r.trip] = trips[r.trip] || []).push(r);
  });

  // hops[route][i] = seconds from stop i to stop i+1
  const hops = {};
  let rides = 0;
  Object.values(trips).forEach((list) => {
    list.sort((a, b) => a.t - b.t);
    if (list.length > 1) rides++;
    for (let k = 1; k < list.length; k++) {
      const a = list[k - 1], b = list[k];
      if (a.route !== b.route || b.i !== a.i + 1) continue;   // skipped stop, or noise
      const sec = (b.t - a.t) / 1000;
      if (sec < MIN_SEC || sec > MAX_SEC) continue;
      ((hops[a.route] = hops[a.route] || {})[a.i] = hops[a.route][a.i] || []).push(sec);
    }
  });

  console.log(`${reports.length} reports, ${rides} logged rides, last ${days} days.\n`);

  DATA.routes.forEach((route) => {
    const h = hops[route.id];
    if (!h) return;
    console.log(`Route ${route.id} — ${route.name}`);
    const minutes = [];
    let complete = true;
    for (let i = 0; i < route.stops.length - 1; i++) {
      const xs = h[i] || [];
      const from = route.stops[i], to = route.stops[i + 1];
      if (xs.length) {
        const m = median(xs) / 60;
        minutes.push(Math.max(0.5, Math.round(m * 2) / 2));
        console.log(`  ${from} → ${to}`.padEnd(58) +
                    `${m.toFixed(1)} min  (n=${xs.length})`);
      } else {
        minutes.push(null);
        console.log(`  ${from} → ${to}`.padEnd(58) + 'no data');
      }
      if (xs.length < MIN_SAMPLES) complete = false;
    }
    if (complete) {
      console.log(`  → paste into rideTimes:  '${route.id}': [${minutes.join(', ')}],`);
    } else {
      console.log(`  (needs ${MIN_SAMPLES}+ samples on every hop before it can replace the estimate)`);
    }
    console.log('');
  });

  if (!Object.keys(hops).length) console.log('No measured hops yet.');
})().catch((err) => {
  console.error('Could not read reports:', err.message);
  process.exit(1);
});
