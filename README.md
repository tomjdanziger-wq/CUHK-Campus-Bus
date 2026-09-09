# CUHK Shuttle Helper

A small static web app that answers one question: **"I'm at A and need to get to B — should I walk or take the shuttle?"**

It shows both options side by side with approximate times, and lets you decide. It does not decide for you.

---

## Data status

**The timetable is real.** Stop sequences, service hours, departure minutes and
service days are extracted from the CUHK Transport Office's own published route
pages (`scripts/extract-timetable.py`). Stop positions and bilingual names come
from OpenStreetMap's mapped CUHK shuttle stops; elevations from SRTM 30 m.

**Two things are still estimated, and the app says so on screen:**

| | Status |
|---|---|
| Departure times, stop order, service days | Published. Real. |
| Stop positions, elevations | Real (OSM + SRTM). |
| **Time spent on the bus between stops** | **Estimated from distance and gradient.** CUHK does not publish running times. An amber banner says this, and every ride leg is labelled "ride time estimated from distance". |
| **Peak-period capacity warnings** | **Guesses**, not measured. Configured in `config.peakPeriods`. |

Ride-time estimates are the largest error source in the app. If you time the
routes with a stopwatch, add a `segmentMinutes` array to `rideTimes` in
`data/shuttle-data.js` (one entry per hop) and the estimate is replaced by your
measurement. Set `meta.rideTimesEstimated` to `false` once every route has one.

Two stops — Campus Circuit East and Campus Circuit North — are roadside stops
that OpenStreetMap does not map. Their positions are approximate to within
about 100 m and are commented as such in the data file.

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

The timetable is extracted from the Transport Office's own pages, so updating is
a re-run, not a retype.

1. Save each route page from <https://www.cuhk.edu.hk/campus-shuttle/> as a PDF
   into the project root. One file per route; the leading characters of the
   filename become the route id, e.g. `2S NA:UC (S).pdf` → Route 2S. (Filenames
   cannot contain `/`, so `NA : UC` is read back as `NA / UC`.)

2. Regenerate and check:

   ```bash
   python3 scripts/extract-timetable.py *.pdf > data/routes.generated.js
   node scripts/validate-data.js
   ```

3. Update `meta.lastUpdated` and `meta.extractedOn` in `data/shuttle-data.js`.

If a new stop appears, the extractor prints `!! unmapped stop label` and skips
it. Add the stop to `stops` in `data/shuttle-data.js` and map its printed label
in `STOP_IDS` in `scripts/extract-timetable.py`.

`scripts/validate-data.js` exits non-zero on failure, so it can gate a deploy.
It checks that every referenced stop exists, that no stop repeats back-to-back,
that consecutive stops are geographically plausible, that `segmentMinutes`
lengths match, and that the timetable fields parse. It also prints each route's
elevation profile.

### How the PDFs are read

The route pages are diagrams, not tables, and the PDFs use subsetted fonts, so
raw string bytes are glyph indices rather than characters — digits come out as
`!"#$%`. `scripts/extract-timetable.py` decodes each font through its ToUnicode
CMap and tracks the full graphics state (CTM stack and text matrix) to recover
where every text run sits on the page.

Each route is drawn as a tall loop: the bus leaves the bottom row, climbs the
**left** column bottom-to-top, crosses the top, and descends the **right**
column top-to-bottom.

Three independent checks confirm that reading:

1. The "First Stop" badge is drawn at the left end of the bottom row and the
   "Last Stop" badge at the right end — the ends adjacent to the upward and
   downward columns.
2. Route 1 decodes to the known Main Campus circuit.
3. Elevations rise up the left column and fall down the right one. Route 2
   reads 10 → 45 → 102 → 113 → 136 → 142 → 133 → 100 → 49 → 7 m. A campus loop
   that climbs one side and descends the other cannot read any other way.

Check 3 is why `validate-data.js` prints elevation profiles: a future layout
change that breaks the assumption shows up as a saw-tooth rather than passing
silently.

### Route schema

`data/routes.generated.js` is auto-generated — do not hand-edit it. The shape:

```js
{
  id: '2',
  name: 'Route 2',
  nameZh: '新亞聯合線',
  label: 'NA / UC',
  stops: ['station-piazza', 'univ-sports-centre', ...],  // ordered, first → last
  departureMinutes: [15, 45],    // minutes past the hour, at the FIRST stop
  firstDeparture: '07:45',
  lastDeparture: '18:45',
  runsOn: 'mon-sat',             // mon-fri | mon-sat | sat | sun-ph | daily
  notes: 'Buses departing from 31 to 00 minutes will stop at Sir Run Run Shaw Hall'
}
```

> **`segmentMinutes` is an addition to the schema in the original spec.** The
> spec's route shape had stop sequences and departure times but no running
> times, so there was no way to compute the ride leg or work out when a bus
> reaches a stop that isn't the first one. It is optional: without it the app
> estimates from distance at `config.bus.fallbackSpeedKmh` and labels the leg
> "ride time estimated from distance". Add real times via `rideTimes` in
> `data/shuttle-data.js`.

Departure times for stops after the first are derived by adding the cumulative
ride time to the departure from the first stop.

### Stop schema

```js
{ id: 'univ-station', name: 'University Station', nameZh: '大學站',
  lat: 22.414537, lng: 114.210221, elevation: 7 }
```

`elevation` is metres above sea level and is **required** — it drives the whole
walking estimate. A stop with a wrong elevation produces confidently wrong
advice.

Several stops exist as an (Upward)/(Downward) pair on opposite sides of the
road, and are kept as separate stops: telling a new student to wait on the wrong
side is exactly the failure this app exists to prevent. Where OSM maps only one
of a pair, both share that position — they are metres apart, well inside the
walking model's error.

### Conditional stops

Some stops are served only by certain departures ("Buses departing from 31 to 00
minutes will stop at Sir Run Run Shaw Hall") or only on teaching days. The data
model has no way to express per-departure variation, so these stops are included
and the published caveat is carried in the route's `notes`, which the option
card displays. Erring toward showing the option with its caveat attached beats
silently hiding it.

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
| Estimated ride times labelled as estimated, on every leg and in a banner | `meta.rideTimesEstimated`, `renderShuttleCard` |

The last one is not in the original spec and was added because the numbers demanded it: the total assumes you catch the bus, so when the slow end of the walking estimate lands after the departure, the range is quietly optimistic in a way the user cannot see. The card now says so and names the fallback departure.

---

## Deliberately not built (v1)

- Real-time tracking. There is no data source, and no amount of UI would make one up honestly.
- Public transport beyond campus — KMB, MTR, minibuses.
- Accounts, saved trips, notifications.
- Off-campus destinations.
- **Transfers between shuttle routes.** Single-route journeys only.

### On transfers

The spec asked for this to be flagged if the campus layout genuinely requires
it. With the real timetable loaded, it mostly does not: Routes 1, 2, 2S, 3, 4
and 8 all touch the University Station / Station Piazza area, so almost every
pair of points is joined by a single route.

Two real limitations remain, both of which cause the app to **omit** options
rather than invent them:

- **No wrap-around on loop routes.** A route is stored as an ordered list and
  the search only rides forward through it, so you can board at position *i*
  and alight at *j > i*. On a loop, riding past the terminus and round again is
  a real journey the app will not offer. It was left out deliberately: allowing
  it would also let the app propose riding twenty minutes around the whole
  campus to reach a stop five minutes' walk away.
- **No route-to-route transfers**, as scoped.

In both cases the direct walk is always present, so the user is never left with
nothing — just occasionally with less than the full set.

## Layout

```
index.html                    markup
assets/styles.css             mobile-first, high contrast, light + dark
app.js                        UI, formatting, GPS, map
lib/geo.js                    distance, Tobler walking model, elevation interpolation
lib/planner.js                journey search, ranking, departures, peak warnings
lib/search.js                 fuzzy matching over English, Chinese and aliases

data/shuttle-data.js          ← stops, config, aliases. The file you edit.
data/routes.generated.js      auto-generated from the timetable PDFs
data/places.generated.js      auto-generated from OpenStreetMap

scripts/extract-timetable.py  PDFs → routes.generated.js
scripts/_pdfpos.py            positional PDF text extraction (used by the above)
scripts/extract-places.js     Overpass + elevations → places.generated.js
scripts/validate-data.js      sanity-checks the data; exits non-zero on failure
```

## Attribution

Place data © OpenStreetMap contributors, ODbL. Elevations from SRTM via OpenTopoData. Map tiles © OpenStreetMap contributors. The attribution is rendered in the app footer, as ODbL requires.
