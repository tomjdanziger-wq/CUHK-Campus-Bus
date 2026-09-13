#!/usr/bin/env node
/**
 * extract-places.js — one-off (re-runnable) extractor for the CUHK places list.
 *
 * Pipeline:
 *   1. Query the Overpass API for named buildings / amenities inside the CUHK
 *      campus bounding box. OSM gives us `name`, `name:zh` and coordinates.
 *   2. Batch the coordinates through OpenTopoData (SRTM 30m) to fill `elevation`.
 *   3. Emit `data/places.generated.js`, which `data/shuttle-data.js` merges in.
 *
 * We deliberately do NOT use the Google Places API: it needs a key + billing and
 * its terms restrict storing results, which would force live API calls forever.
 * OSM is ODbL — attribution is rendered in the app footer.
 *
 * Usage:  node scripts/extract-places.js [--dry] [--refilter]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Some environments block Node's outbound sockets but permit curl.
const CURL_FALLBACK = !process.argv.includes('--no-curl');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Bounding box for the CUHK Sha Tin campus (south, west, north, east).
// Generous enough to include Chung Chi at the bottom and the residences up top.
const BBOX = [22.4100, 114.1960, 22.4340, 114.2180];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const ELEVATION_ENDPOINT = 'https://api.opentopodata.org/v1/srtm30m';
const ELEVATION_BATCH = 100;   // OpenTopoData public limit: 100 locations/call
const ELEVATION_DELAY_MS = 1200; // public limit: 1 call/sec

const OUT_FILE = path.join(__dirname, '..', 'data', 'places.generated.js');

// OSM objects we care about. Anything named inside the campus that a student
// might plausibly type into a destination box.
const OVERPASS_QUERY = `
[out:json][timeout:90];
(
  nwr["building"]["name"](${BBOX.join(',')});
  nwr["amenity"~"^(college|university|library|hospital|clinic|bank|pharmacy|post_office|theatre|arts_centre|sports_centre|swimming_pool|place_of_worship)$"]["name"](${BBOX.join(',')});
  nwr["amenity"~"^(restaurant|cafe|fast_food|food_court|canteen|bar|pub|ice_cream|bakery)$"](${BBOX.join(',')});
  nwr["shop"~"^(convenience|supermarket|bakery|coffee|deli)$"](${BBOX.join(',')});
  nwr["leisure"~"^(sports_centre|stadium|swimming_pool|pitch|fitness_centre)$"]["name"](${BBOX.join(',')});
  nwr["amenity"="university"]["name"](${BBOX.join(',')});
  nwr["office"]["name"](${BBOX.join(',')});
  nwr["tourism"~"^(museum|gallery)$"]["name"](${BBOX.join(',')});
  nwr["railway"="station"]["name"](${BBOX.join(',')});
);
out center tags;
`;

// Somewhere you can buy food. Kept as a category so the app can list them
// without guessing from the name — "Café 12" and "Food Lab" are canteens,
// "Gallant Place" is not, and no amount of string matching knows that.
const FOOD_AMENITIES = new Set([
  'restaurant', 'cafe', 'fast_food', 'food_court', 'canteen',
  'bar', 'pub', 'ice_cream', 'bakery',
]);
const FOOD_SHOPS = new Set(['convenience', 'supermarket', 'bakery', 'coffee', 'deli']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || 'place';
}

/** Best-effort English name. OSM sometimes puts Chinese in `name`. */
function pickNames(tags) {
  const en = tags['name:en'] || (isLatin(tags.name) ? tags.name : null);
  const zh = tags['name:zh'] || tags['name:zh-Hant'] || tags['name:zh_HK'] ||
             (!isLatin(tags.name) ? tags.name : null);
  return { name: en || zh || null, nameZh: zh || null };
}

function isLatin(s) {
  return !!s && /^[\x20-\x7EÀ-ɏ'’\-().,&/]+$/.test(s);
}

/**
 * POST JSON-ish and parse the response.
 *
 * Tries global fetch first, and falls back to shelling out to `curl` — some
 * corporate / sandboxed environments allow curl but block Node's own sockets.
 */
async function postJson(url, { contentType, body }, label) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } catch (err) {
    if (!CURL_FALLBACK) throw new Error(`${label}: ${err.message}`);
    process.stderr.write(`  (fetch failed, retrying via curl)\n`);
    return postJsonViaCurl(url, { contentType, body }, label);
  }
}

function postJsonViaCurl(url, { contentType, body }, label) {
  const res = spawnSync('curl', [
    '-sS', '--fail-with-body', '--max-time', '120',
    '-H', `Content-Type: ${contentType}`,
    '--data-binary', '@-',
    url,
  ], { input: body, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });

  if (res.error) throw new Error(`${label}: curl unavailable (${res.error.message})`);
  if (res.status !== 0) throw new Error(`${label}: curl exit ${res.status}: ${(res.stderr || res.stdout).slice(0, 200)}`);
  return JSON.parse(res.stdout);
}

// ---------------------------------------------------------------------------
// Step 1 — Overpass
// ---------------------------------------------------------------------------

async function fetchOverpass() {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      process.stderr.write(`→ Overpass: ${endpoint}\n`);
      const json = await postJson(endpoint, {
        contentType: 'application/x-www-form-urlencoded',
        body: 'data=' + encodeURIComponent(OVERPASS_QUERY),
      }, 'Overpass');
      process.stderr.write(`  ${json.elements.length} raw elements\n`);
      return json.elements;
    } catch (err) {
      process.stderr.write(`  failed: ${err.message}\n`);
      lastErr = err;
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Step 2 — normalise + dedupe
// ---------------------------------------------------------------------------

function normalise(elements) {
  const byKey = new Map();

  for (const el of elements) {
    const tags = el.tags || {};
    const { name, nameZh } = pickNames(tags);
    if (!name) continue;

    // Skip generic / structural names that are useless as destinations.
    if (/^(building|car park|carpark|toilets?|shelter|entrance|bus stop|footbridge)$/i.test(name)) continue;

    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    // Dedupe on name: OSM often has a building way AND an amenity node for the
    // same thing. Prefer whichever carries the most tags.
    const key = name.toLowerCase();
    const category = FOOD_AMENITIES.has(tags.amenity) ? tags.amenity
                   : FOOD_SHOPS.has(tags.shop) ? tags.shop
                   : null;

    const cand = {
      id: slugify(name),
      name,
      nameZh: nameZh || null,
      aliases: [],
      lat: +lat.toFixed(6),
      lng: +lng.toFixed(6),
      elevation: null,
      // Only carried for food places, to keep the shipped file small.
      food: category ? {
        category,
        cuisine: tags.cuisine || null,
        // OSM opening-hours syntax, e.g. "Mo-Fr 08:00-20:00; Sa 11:00-18:00".
        hours: tags.opening_hours || null,
      } : null,
      _score: Object.keys(tags).length,
      _osm: `${el.type}/${el.id}`,
    };
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, cand); continue; }
    // Prefer whichever entry knows it sells food; otherwise the richer one.
    const better = (cand.food && !prev.food) ||
                   (!!cand.food === !!prev.food && cand._score > prev._score);
    if (better) byKey.set(key, cand);
  }

  // Ensure ids are unique after slugification.
  const seen = new Set();
  const out = [];
  for (const p of [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    let id = p.id, n = 2;
    while (seen.has(id)) id = `${p.id}-${n++}`;
    seen.add(id);
    out.push({ ...p, id });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 3 — elevation
// ---------------------------------------------------------------------------

async function fillElevations(places) {
  for (let i = 0; i < places.length; i += ELEVATION_BATCH) {
    const batch = places.slice(i, i + ELEVATION_BATCH);
    const locations = batch.map((p) => `${p.lat},${p.lng}`).join('|');
    process.stderr.write(`→ Elevation ${i + 1}–${i + batch.length} of ${places.length}\n`);
    try {
      const json = await postJson(ELEVATION_ENDPOINT, {
        contentType: 'application/json',
        body: JSON.stringify({ locations }),
      }, 'OpenTopoData');
      (json.results || []).forEach((r, k) => {
        if (r && typeof r.elevation === 'number') batch[k].elevation = Math.round(r.elevation);
      });
    } catch (err) {
      process.stderr.write(`  batch failed: ${err.message}\n`);
    }
    if (i + ELEVATION_BATCH < places.length) await sleep(ELEVATION_DELAY_MS);
  }

  const missing = places.filter((p) => p.elevation === null);
  if (missing.length) {
    process.stderr.write(`! ${missing.length} places have no elevation; defaulting to 0\n`);
    missing.forEach((p) => { p.elevation = 0; });
  }
}

// ---------------------------------------------------------------------------
// Step 3b — keep what is actually on campus
// ---------------------------------------------------------------------------

// The bounding box is a rectangle and the campus is not. Before this filter,
// 363 of 570 "places" were Science Park towers, Fo Tan housing estates and
// village houses in Cheung Shue Tan: unreachable on campus footpaths, and
// noise in search — "Block 6" of some estate sitting next to I House Block 6.
//
// So a place stays if it is inside the university's own OSM boundary, or close
// enough to a shuttle stop that someone would plausibly walk there from one
// (the shops in University Station are just outside the boundary line), or it
// is a CUHK facility that happens to sit off the main campus.
const CAMPUS_RELATION = 7802779;   // 香港中文大學 The Chinese University of Hong Kong
const CAMPUS_CACHE = path.join(__dirname, '..', '.overpass-campus.json');
const NEAR_STOP_M = 150;
const CUHK_FACILITY = /CUHK|Chinese University|Vice-Chancellor/i;

async function fetchCampusBoundary() {
  if (fs.existsSync(CAMPUS_CACHE)) {
    process.stderr.write(`→ using cached ${path.basename(CAMPUS_CACHE)}\n`);
    return JSON.parse(fs.readFileSync(CAMPUS_CACHE, 'utf8'));
  }
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      process.stderr.write(`→ campus boundary: ${endpoint}\n`);
      const json = await postJson(endpoint, {
        contentType: 'application/x-www-form-urlencoded',
        body: 'data=' + encodeURIComponent(`[out:json][timeout:120];relation(${CAMPUS_RELATION});out geom;`),
      }, 'Overpass');
      fs.writeFileSync(CAMPUS_CACHE, JSON.stringify(json));
      return json;
    } catch (err) {
      process.stderr.write(`  failed: ${err.message}\n`);
      lastErr = err;
    }
  }
  throw lastErr;
}

function keepOnCampus(places, boundary) {
  // Even-odd ray casting over every member way's segments. The multipolygon's
  // ways are not assembled into rings first, and do not need to be: as long as
  // they close (they do), each crossing flips inside/outside all the same, and
  // inner rings — holes — fall out of the parity for free.
  const segs = [];
  for (const m of boundary.elements[0].members) {
    const g = m.geometry || [];
    for (let i = 1; i < g.length; i++) segs.push([g[i - 1], g[i]]);
  }
  const inside = (lat, lng) => {
    let c = false;
    for (const [a, b] of segs) {
      if ((a.lat > lat) !== (b.lat > lat) &&
          lng < a.lon + (lat - a.lat) * (b.lon - a.lon) / (b.lat - a.lat)) c = !c;
    }
    return c;
  };

  // Stop coordinates come from the hand-maintained data file.
  require('../data/routes.generated.js');
  require('../data/shuttle-data.js');
  const stops = globalThis.SHUTTLE_DATA.stops;
  const nearStop = (p) => stops.some((s) =>
    Math.hypot((s.lat - p.lat) * 111320, (s.lng - p.lng) * 103000) <= NEAR_STOP_M);

  const kept = places.filter((p) =>
    inside(p.lat, p.lng) || nearStop(p) || CUHK_FACILITY.test(p.name));
  process.stderr.write(`  ${kept.length} of ${places.length} places are on or next to campus\n`);
  return kept;
}

// ---------------------------------------------------------------------------
// Step 4 — emit
// ---------------------------------------------------------------------------

function emit(places) {
  const clean = places.map(({ _score, _osm, food, ...p }) => {
    const out = { ...p, osm: _osm };
    if (food) out.food = food;     // omitted entirely for non-food places
    return out;
  });
  const body = clean
    .map((p) => '  ' + JSON.stringify(p).replace(/","/g, '", "'))
    .join(',\n');

  const src = `/**
 * places.generated.js — AUTO-GENERATED. Do not edit by hand.
 *
 * Regenerate with:  node scripts/extract-places.js
 *
 * Source: OpenStreetMap contributors, via the Overpass API (ODbL).
 * Elevations: OpenTopoData / SRTM 30m, in metres above sea level.
 *
 * Hand-written aliases live in data/shuttle-data.js (PLACE_ALIASES) and are
 * merged over this list at load time, so re-running the extractor never
 * clobbers them.
 *
 * Generated: ${new Date().toISOString().slice(0, 10)}   (${clean.length} places)
 */
(function (root) {
  'use strict';
  var PLACES = [
${body}
  ];
  root.CUHK_PLACES_GENERATED = PLACES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
  fs.writeFileSync(OUT_FILE, src);
  const food = clean.filter((p) => p.food).length;
  const withHours = clean.filter((p) => p.food && p.food.hours).length;
  process.stderr.write(
    `✓ wrote ${OUT_FILE} (${clean.length} places, ${food} of them food, ` +
    `${withHours} with opening hours)\n`);
}

// ---------------------------------------------------------------------------

async function main() {
  const boundary = await fetchCampusBoundary();

  // --refilter re-applies the campus filter to the shipped file without
  // re-querying Overpass or re-fetching every elevation.
  if (process.argv.includes('--refilter')) {
    require(OUT_FILE);
    const existing = globalThis.CUHK_PLACES_GENERATED.map(({ osm, ...p }) => ({ ...p, _osm: osm }));
    emit(keepOnCampus(existing, boundary));
    return;
  }

  const elements = await fetchOverpass();
  const places = keepOnCampus(normalise(elements), boundary);
  process.stderr.write(`  ${places.length} named places after dedupe\n`);
  if (!process.argv.includes('--dry')) await fillElevations(places);
  emit(places);
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.stack}\n`);
  process.exit(1);
});
