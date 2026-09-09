# CUHK Shuttle Helper

A small static web app that answers one question: **"I'm at A and need to get to B — should I walk or take the shuttle?"**

It shows both options side by side with approximate times, and lets you decide. It does not decide for you.

---

## ⚠ Before you deploy this

**The timetable in `data/shuttle-data.js` is invented.** The stop coordinates and elevations are real (extracted from OpenStreetMap), but the routes, departure times, running times and service days are plausible-looking placeholders.

While `meta.isPlaceholder` is `true` the app shows a permanent red warning banner. Replace the routes with the published CUHK timetable, then set the flag to `false`.

Do not remove the banner instead of the flag.

---

## Running it

No build step, no dependencies, no API keys.

```bash
python3 -m http.server 4321
```

Then open <http://127.0.0.1:4321>. Opening `index.html` directly from the filesystem also works — the scripts are plain `<script>` tags, not ES modules, precisely so that it does.

## Deploying

It is a static site. Push the repo and point Vercel at it — no configuration, no framework preset, no build command. Every other static host works the same way.

The only external request the app ever makes is loading Leaflet and OSM tiles for the optional map, and it is lazy: the app is fully functional with no network at all.

---

## Updating the timetable each term

Everything you need to change lives in **one file**: `data/shuttle-data.js`. No route, stop or timetable data is hard-coded anywhere in the app logic.

1. Edit the `routes` array.
2. Edit `stops` if stops were added, moved or renamed.
3. Update `meta.validFrom`, `meta.validUntil` and `meta.lastUpdated` — these are displayed in the footer so students can see whether the data is stale.
4. Set `meta.isPlaceholder` to `false`.

### Route schema

```js
{
  id: '2',
  name: 'Route 2',
  nameZh: '二號線',
  stops: ['univ-station', 'chung-chi', 'new-asia'],  // ordered, first → last
  segmentMinutes: [2, 3],        // ride time per hop; length = stops.length - 1
  departureMinutes: [10, 25, 40, 55],   // minutes past the hour, at the FIRST stop
  firstDeparture: '07:45',       // earliest departure from the first stop
  lastDeparture: '19:10',        // latest departure from the first stop
  runsOn: 'mon-sat',             // mon-fri | mon-sat | sat | sun-ph | daily | 'mon,wed,fri'
  notes: 'Shown on the option card'
}
```

> **`segmentMinutes` is an addition to the schema in the original spec.** The spec's route shape had stop sequences and departure times but no running times, so there was no way to compute the ride leg or to work out when a bus reaches a stop that isn't the first one. It is optional: omit it and the app falls back to estimating from distance at `config.bus.fallbackSpeedKmh`, and labels that leg "ride time estimated from distance" on the card. Fill it in if you have real running times — the fallback is noticeably worse.

Departure times for stops after the first are derived by adding the cumulative ride time to the departure from the first stop.

### Stop schema

```js
{ id: 'univ-station', name: 'University MTR Station', nameZh: '大學站',
  lat: 22.414143, lng: 114.210574, elevation: 6 }
```

`elevation` is metres above sea level and is **required** — it drives the whole walking estimate. A stop with a wrong elevation produces confidently wrong advice.

---

## Regenerating the place list

The searchable destination list (~550 buildings and amenities) is extracted from OpenStreetMap, not typed by hand.

```bash
node scripts/extract-places.js
```

This queries the Overpass API for named features in the campus bounding box, batches the coordinates through OpenTopoData (SRTM 30 m) for elevations, and writes `data/places.generated.js`. It takes about a minute. If your environment blocks Node's outbound sockets, the script automatically retries through `curl`.

**Hand-written aliases are safe.** They live in `placeAliases` in `data/shuttle-data.js` and are merged over the generated list at load time, so regenerating never clobbers them. Add whatever shorthand students actually use — `UC`, `YIA`, `SHHO`.

OSM data is imperfect: some buildings are unnamed, some names differ from what people call them, and a handful of extracted entries are substations and pump houses. The fuzzy search ranks by match quality, so the noise mostly stays out of the way.

Google Places is deliberately not used: it needs a key and billing, and its terms restrict storing results, which would force live API calls forever.

---

## How the times are calculated

### Walking

No routing API. From `lib/geo.js`:

1. Haversine distance between the two points.
2. Multiplied by `config.walking.detourFactor` (1.3) to approximate the real path network.
3. Converted to time by **Tobler's hiking function**, `v = 6 · exp(−3.5 · |slope + 0.05|)` km/h, using the average gradient. It peaks at a gentle downhill and falls off sharply uphill, which matches how this campus actually feels. Scaled by `toblerCalibration` (0.85) to a realistic student pace — about 4.3 km/h on the flat.
4. Widened into a range (`rangeLow` 0.8, `rangeHigh` 1.35). Asymmetric, because these estimates fail long far more often than short.

**Where this is wrong**, and knowingly so:

- It uses the *average* gradient. A path that drops 40 m and climbs back looks flat to the model. On terraced ground some estimates are optimistic.
- It knows nothing about stairs, lifts, covered walkways, or lines blocked by a building.
- One detour factor for the whole campus.

All of it is acceptable because the output is shown as a wide range and the user decides. None of it would be acceptable if the app claimed precision.

Every constant is in the `config` block at the top of `data/shuttle-data.js`, so it can be calibrated after real-world testing without touching any logic.

### GPS elevation

A GPS fix arrives without a usable elevation, and defaulting to 0 m would place someone at sea level while they stand outside New Asia at 146 m — making every number on the screen wrong in the same direction. So `geo.estimateElevation` interpolates from the nearest known campus points by inverse-distance weighting. It is accurate to a few metres, well inside the error bars.

### Finding the options

`lib/planner.js`, brute force on purpose — around 16 stops and 6 routes is a few thousand combinations, which is nothing:

```
for each stop S within walking distance of the origin
  for each route R serving S
    for each stop T later on R, within walking distance of the destination
      total = walk(O→S) + wait for next departure + ride(S→T) + walk(T→D)
```

Plus the direct walk, always.

It deliberately does **not** assume the nearest stop is the right stop. Sometimes walking a few minutes to a different stop catches a route that saves far more overall.

### Which options get shown

1. **Dominance.** An option must save at least `minWalkSavedMinutes` (3) of *walking* versus going on foot the whole way. This kills suggestions like "walk 5 minutes to a stop and 14 minutes from the next one" to avoid a 17-minute walk. The filter is about walking, not total time — a bus that merely ties with walking still saves you the climb and stays on the list.
2. **Sanity cap.** Options losing to the walk by more than `maxWorseThanWalkMinutes` (15) are dropped. A 58-minute wait next to an 8-minute stroll is honest and useless.
3. **One per route.** Two ways to catch the same bus is noise.
4. **The 8-minute rule.** A boarding stop further away than the nearest one is surfaced *only* when it beats the best nearby option by `furtherStopThresholdMinutes` (8) or more. Everything here carries roughly ±30% error; recommending a 6-minute uphill walk to save a predicted 3 minutes would often be wrong, and being wrong about that is worse than staying quiet. When it does fire, the card says how much further and how much sooner.
5. **Ties break toward less walking.** At this granularity options tie constantly, and when two get you there at the same moment the one with less walking is simply better advice.

The direct walk is added afterwards and is never filtered out.

---

## The honesty rules, and where they are enforced

These mattered more than features, so each one is enforced in a named place rather than by good intentions.

| Rule | Where |
|---|---|
| Wait shown as the real gap to the next scheduled departure, never an average | `formatWait`, `app.js` |
| Durations shown as ranges, rounded to ~5 min | `formatRange`, `app.js` |
| Arrival clock times rounded the same way as durations | `formatArrivalRange`, `app.js` |
| Legs shown separately, never collapsed into one number | `renderShuttleCard`, `app.js` |
| Elevation with direction on every walk | `describeElevation`, `app.js` |
| Capacity warning at peak periods, static text | `peakWarning`, `lib/planner.js` |
| "Scheduled" language throughout; no real-time claims | copy in `index.html` and the leg rows |
| GPS guess always stated and correctable in one tap | `renderOriginConfirmation`, `app.js` |
| Tight connections flagged rather than hidden inside the range | `isTight`, `lib/planner.js` |

The last one is not in the original spec and was added because the numbers demanded it: the total assumes you catch the bus, so when the slow end of the walking estimate lands after the departure, the range is quietly optimistic in a way the user cannot see. The card now says so and names the fallback departure.

---

## Deliberately not built (v1)

- Real-time tracking. There is no data source, and no amount of UI would make one up honestly.
- Public transport beyond campus — KMB, MTR, minibuses.
- Accounts, saved trips, notifications.
- Off-campus destinations.
- **Transfers between shuttle routes.** Single-route journeys only.

### On transfers

The spec asked for this to be flagged if the campus layout genuinely requires it. Against the placeholder route set it does not: the routes radiate from University Station and the Chung Chi area, so almost every pair of points is connected by a single route, and where one isn't, the walk is competitive anyway — the app offers it and says so.

That conclusion is only as good as the placeholder routes. **Re-check it once the real timetable is in.** The pairs to watch are peripheral-to-peripheral, such as New Asia to Shaw College: two points that are both far from the station and on different spurs. If several such pairs come back with no usable single-route option and a long uphill walk, transfers are worth adding — the search in `lib/planner.js` extends to two legs without restructuring.

---

## Layout

```
index.html                  markup
assets/styles.css           mobile-first, high contrast, light + dark
app.js                      UI, formatting, GPS, map
lib/geo.js                  distance, Tobler walking model, elevation interpolation
lib/planner.js              journey search, ranking, departures, peak warnings
lib/search.js               fuzzy matching over English, Chinese and aliases
data/shuttle-data.js        ← the only file you edit each term
data/places.generated.js    auto-generated, do not hand-edit
scripts/extract-places.js   regenerates the above
```

## Attribution

Place data © OpenStreetMap contributors, ODbL. Elevations from SRTM via OpenTopoData. Map tiles © OpenStreetMap contributors. The attribution is rendered in the app footer, as ODbL requires.
