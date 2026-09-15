#!/usr/bin/env node
/**
 * export-reports.js — download every rider report to CSV for analysis.
 *
 *     node scripts/export-reports.js
 *
 * Writes exports/sightings.csv and exports/alightings.csv. Reads through the
 * public API with the same rules as the app, 200 documents at a time (the
 * most the rules allow per query), oldest first.
 *
 * Columns
 *   t        when the server received the report (UTC, ISO 8601)
 *   at       when the bus reached the stop by the phone's clock, if sent
 *   route    route id, e.g. 4
 *   stop     stop id, e.g. wu-yee-sun-down
 *   i        the stop's position on the route (routes can pass a stop twice)
 *   trip     random ride id: rows with the same trip are one person's ride
 *   auto     sightings: true if GPS logged the stop, empty if tapped
 *   how      alightings: gps (guess accepted), tap ("I got off"), picked
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

require('../data/firebase-config.js');
const FB = globalThis.FIREBASE_CONFIG;
const OUT = path.join(__dirname, '..', 'exports');

// Node's own fetch where it works; curl where it does not (some networks
// and sandboxes block Node's sockets but not curl).
async function post(url, body) {
  try {
    const res = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    return await res.json();
  } catch (e) {
    const r = spawnSync('curl', ['-sS', '--max-time', '60', '-X', 'POST', url,
      '-H', 'Content-Type: application/json', '--data-binary', '@-'], { input: body, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || 'curl failed');
    return JSON.parse(r.stdout);
  }
}

function value(v) {
  if (!v) return '';
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return v.integerValue;
  if ('booleanValue' in v) return String(v.booleanValue);
  if ('timestampValue' in v) return v.timestampValue;
  return '';
}

function csvCell(s) {
  s = String(s);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function exportCollection(collection, columns) {
  const url = `https://firestore.googleapis.com/v1/projects/${FB.projectId}` +
              `/databases/(default)/documents:runQuery?key=${FB.apiKey}`;
  const rows = [];
  let after = '1970-01-01T00:00:00Z';

  for (;;) {
    const body = JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: 't' }, op: 'GREATER_THAN',
                                value: { timestampValue: after } } },
        orderBy: [{ field: { fieldPath: 't' }, direction: 'ASCENDING' }],
        limit: 200,
      },
    });
    const res = await post(url, body);
    if (!Array.isArray(res) || res[0]?.error) throw new Error(JSON.stringify(res[0]?.error || res));
    const docs = res.filter((r) => r.document).map((r) => r.document.fields);
    docs.forEach((f) => rows.push(columns.map((c) => value(f[c]))));
    if (docs.length < 200) break;
    after = docs[docs.length - 1].t.timestampValue;
  }

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, collection + '.csv');
  fs.writeFileSync(file, [columns].concat(rows).map((r) => r.map(csvCell).join(',')).join('\n') + '\n');
  console.log(`${collection}: ${rows.length} rows → ${path.relative(process.cwd(), file)}`);
}

(async () => {
  await exportCollection('sightings', ['t', 'at', 'route', 'stop', 'i', 'trip', 'auto']);
  await exportCollection('alightings', ['t', 'at', 'route', 'stop', 'i', 'trip', 'how']);
})().catch((err) => {
  console.error('Export failed:', err.message);
  process.exit(1);
});
