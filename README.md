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

### Routes that are not in the PDF set

`data/routes.generated.js` is rebuilt from whatever route PDFs sit in the
project root, so anything added there by hand is lost on the next run. Routes
that have no PDF go in `extraRoutes` in `data/shuttle-data.js` instead.

**Route 7** is currently one of these. It was not among the saved PDFs; its
stops, departure minutes and hours were read off the Transport Office's own
page for the route and cross-checked against the September 2026 service notice,
which gives the same times. If you save its page as a PDF alongside the others,
delete the `extraRoutes` entry — the extractor is more reliable than
transcription.

Route 7 also needed something the schema did not have: **different hours on
different days** (17:18 on weekdays, 13:18 on Saturdays). A route may now carry
`serviceOverrides`, a list of `{ runsOn, firstDeparture, lastDeparture }` where
the first matching entry wins.

It is also a meet-class service that runs on teaching days only. The app has no
academic calendar and cannot tell a teaching day from a reading week, so that
caveat is carried in the route's `notes` and shown on the card rather than
silently assumed away.

### Quick picks

`config.quickPicks` puts one-tap buttons under the From and To boxes for the
trips someone makes daily:

```js
quickPicks: {
  from: [{ place: 'university-residence-nos-3', label: 'I House 6' }],
  to:   [{ place: 'stop:univ-station',          label: 'MTR' }]
}
```

`place` is an id from the merged places list — a generated OSM id, or
`stop:<stop id>` for a shuttle stop. An id that no longer exists is skipped
rather than breaking the page. They set the field exactly as picking from the
search results would.

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
2. Multiplied by `config.walking.detourFactor` (**1.65**) to approximate the real
   path network. This is measured, not guessed: `scripts/calibrate-walk.js`
   routes 2,739 building-to-stop legs over the campus footpath network and
   reports the ratio of routed to straight-line distance — p25 1.43, **median
   1.69**, p75 2.12. It started life as a guessed 1.3, which underestimated
   every walk on campus by about 30%. 1.65 sits just under the median, because
   OpenStreetMap does not map every covered walkway, podium shortcut and lift,
   so the router detours where a person would not.
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

1. **Grouping.** If several routes run the same stretch — same boarding stop,
   same alighting stop, similar ride time — they collapse into one option
   carrying all their departures. From the rider's side they are the same
   journey: you walk to the stop and take whichever turns up. Shown as separate
   cards they look like a decision, and they hide the thing that actually
   matters, which is the combined frequency. A route that shares both endpoints
   but loops the long way round exceeds `groupRideToleranceMinutes` (4) and
   keeps its own card, because that is a genuinely different ride.
2. **Dominance.** An option must save at least `minWalkSavedMinutes` (3) of *walking* versus going on foot the whole way. This kills suggestions like "walk 5 minutes to a stop and 14 minutes from the next one" to avoid a 17-minute walk. The filter is about walking, not total time — a bus that merely ties with walking still saves you the climb and stays on the list.
3. **Sanity cap.** Options losing to the walk by more than `maxWorseThanWalkMinutes` (15) are dropped. A 58-minute wait next to an 8-minute stroll is honest and useless.
4. **One per boarding stop.** Two ways to leave from the same place is noise.
5. **The 8-minute rule.** A boarding stop further away than the nearest one is surfaced *only* when it beats the best nearby option by `furtherStopThresholdMinutes` (8) or more. Everything here carries roughly ±30% error; recommending a 6-minute uphill walk to save a predicted 3 minutes would often be wrong, and being wrong about that is worse than staying quiet. When it does fire, the card says how much further and how much sooner.
6. **Ties break toward less walking.** At this granularity options tie constantly, and when two get you there at the same moment the one with less walking is simply better advice.

The direct walk is added afterwards and is never filtered out.

---

## The honesty rules, and where they are enforced

These mattered more than features, so each one is enforced in a named place rather than by good intentions.

| Rule | Where |
|---|---|
| Wait shown as the real gap to the next scheduled departure, never an average | the wait row, `renderShuttleCard` |
| Wait kept out of the headline time, but given its own prominent row | `travelMinutes` in `lib/planner.js`; `.waitline` |
| Arrival time on every card, as the one like-for-like comparator | `formatArrivalRange`, `app.js` |
| Durations shown as ranges, rounded to ~5 min | `formatRange`, `app.js` |
| Arrival clock times rounded the same way as durations | `formatArrivalRange`, `app.js` |
| Legs shown separately, never collapsed into one number | `renderShuttleCard`, `app.js` |
| Elevation with direction on every walk | `describeElevation`, `app.js` |
| Capacity warning at peak periods, static text | `peakWarning`, `lib/planner.js` |
| "Scheduled" language throughout; no real-time claims | copy in `index.html` and the leg rows |
| GPS guess always stated and correctable in one tap | `renderOriginConfirmation`, `app.js` |
| Tight connections flagged rather than hidden inside the range | `isTight`, `lib/planner.js` |
| Estimated ride times labelled as estimated, on every leg and in a banner | `meta.rideTimesEstimated`, `renderShuttleCard` |
| Boarding on the wrong side of the road flagged in red, not quietly ranked last | `flagLongWayRound`, `lib/planner.js` |

The last one is not in the original spec and was added because the numbers demanded it: the total assumes you catch the bus, so when the slow end of the walking estimate lands after the departure, the range is quietly optimistic in a way the user cannot see. The card now says so and names the fallback departure.

---

## Map

The map is secondary — the written instructions are the product — but it is no
longer decorative. Route lines follow the actual streets, because a line drawn
straight through a building undermines the directions printed next to it.

**Bus routes** are precomputed offline by `scripts/extract-geometry.js`. It
pulls the campus road network from Overpass, builds a directed graph honouring
one-way streets (joining ways where they share a coordinate, since Overpass's
`out geom` gives no node ids), snaps every stop to it, and runs Dijkstra between
consecutive stops. The result ships as static geometry in
`data/shapes.generated.js` — no routing service, no key, no runtime cost.

The script also records the polyline vertex of each stop, so the app can
highlight exactly the stretch you would ride. Deriving that by proximity would
be ambiguous on a loop that passes the same point twice.

**Walking legs** cannot be precomputed — they start wherever you are standing.
So the same script ships a compact routable footpath network (7,532 nodes, 8,020
edges, coordinates as integers scaled by 1e6) and `lib/walkroute.js` runs
Dijkstra over it in the browser, in a couple of milliseconds.

The map opens directly beneath whichever option you asked to see, rather than in
a section further down the page. There is one map instance, moved into the card
that is showing it — rebuilding it per card would re-fetch every tile.

**What you see:** every shuttle route drawn faintly, so the shape of the network
is visible; the option you are looking at drawn on top in that route's own
colour, for the ridden stretch only; your walking legs dashed in green on real
footpaths. The basemap is desaturated so the route colours carry the meaning.
Route colours live in `config.routeColours`.

Direction is drawn as white chevrons sitting *on* the coloured line, the way
transit maps do it, rather than glyphs floating beside it — which is why the
active route is drawn heavier than the rest, to give them room. They appear only
when a single route is selected: eight overlapping sets of arrows tell you
nothing.

The whole thing is 312 KB raw, 64 KB gzipped, and lazy-loaded: if Leaflet or the
tiles fail, the map hides itself and every written instruction still works.

### Regenerating the geometry

```bash
node scripts/extract-geometry.js     # re-routes every line; caches the Overpass reply
node scripts/calibrate-walk.js       # re-measures the walking detour factor
```

Run these after changing stops or routes. `extract-geometry.js` names any hop it
could not route on roads and falls back to a straight line for it — currently
none do.

> The router's sanity check on a routed hop is deliberately loose (6× the
> straight-line distance). This campus climbs 140 m in a kilometre, so roads
> switchback hard: the 142 m hop from Science Centre to New Asia Circle gains
> 39 m, which would be a 27% grade in a straight line, and is really 506 m of
> road. A tighter ratio rejects correct geometry.

## Time on the bus, and time waiting for it

The headline figure on a shuttle option is **travel time** — walk, ride, walk.
The wait is not folded into it. Rolling a nineteen-minute wait into "the bus
takes thirty minutes" misrepresents the bus: the wait is a fact about when you
turned up, not about the journey.

The wait gets its own row instead, in amber, naming the departure it refers to.
That makes it more prominent than it was when buried in the leg list, not less.

Two things keep this honest, because a travel-only headline could otherwise
flatter the bus against walking:

- **Ranking still uses total time including the wait.** Arriving sooner is what
  matters, and a bus you would wait forty minutes for should not outrank walking
  because the ride itself is quick.
- **Every card shows its arrival time**, at the same size and weight. That is
  the one figure that is like-for-like between a bus and a walk, and often the
  two are closer than the headlines suggest.

## Which side of the road

Almost every CUHK route is a one-way loop, and several stops exist as an
(Upward)/(Downward) pair on opposite kerbs of the same road. They are the same
place to walk to and a completely different journey to board: from the downhill
side of Wu Yee Sun the station is nine minutes, from the uphill side the bus
goes right round the campus and takes twenty-one.

So the app does three things:

- Keeps the two halves as separate stops everywhere — in search, in the
  planner, on the map, and in the network browser, where their short codes carry
  ↑ and ↓.
- Says which kerb it means. "(Downward)" is the Transport Office's wording and
  means nothing to somebody new, so the card adds *"the downhill side of the
  road — buses heading down the hill."*
- Marks the long way round **in red** — the only red in the interface. An
  option that loses to the best one by `longWayRoundThresholdMinutes` (8) while
  boarding within `longWayRoundWalkMinutes` (4) of it is somewhere you could
  just as easily have stood, so taking it is a mistake rather than a trade-off.

These options are not hidden. Sometimes you want to sit down, or it is raining,
or the quick bus is half an hour away. The card just says plainly that this is
the slow way and names the stop that is not, so nobody boards it by accident.

A stop that is genuinely further away and slower is not flagged. That is not a
mistake, it is just further away — the eight-minute rule already covers it.

## Where the bus goes next

Under each shuttle option is **Or stay on for** — the stops the bus continues to
after the one you were told to get off at, each with how far it would leave you
from your destination on foot.

The planner already weighed all of those and picked the best by arrival time.
But its walking model is an estimate over an imperfectly mapped campus, and it
values a minute uphill in August exactly the same as a minute sitting on a bus.
Anyone who knows the ground can overrule it — and a later stop that leaves you
meaningfully closer on foot is highlighted rather than hidden. It also shows the
reasoning instead of just asserting the answer.

On the map the continuation is drawn in the route's colour as a long dash, with
hollow markers at those stops: context, visibly not the recommendation.

## Browsing the network

The planner answers "how do I get from A to B". **Browse all routes & stops**
answers the other question people actually have — *where do these buses go?* —
which is what you want once you know the campus and would rather pick the route
yourself.

Pick a route and you get its line on the map in its own colour, its stops
labelled with short codes, **arrows showing which way round it runs**, and the
full stop sequence listed in travel order with service hours and departure
minutes.

Direction is the point. Nearly every CUHK route is a one-way loop, so boarding
on the wrong side of the road can mean riding most of the campus to reach
somewhere two minutes' walk away. That is also why the (Upward) and (Downward)
stops of a pair are kept separate everywhere in this app, and why their short
codes carry ↑ and ↓.

Stop codes live in the `abbr` field of each stop in `data/shuttle-data.js`. On a
campus-wide view the labels collapse to dots — twenty-nine of them at that zoom
overlap into an unreadable pile — and reappear when you select a route or zoom in.

## Searching

Fuzzy matching runs over English names, Chinese names and hand-written aliases,
with exact matches, prefixes, word-starts, initialisms and typos all scored
differently.

Three things live in `data/shuttle-data.js`:

- **`stopAliases`** — what people actually call the stops. The Transport Office
  calls it "University Station"; everybody says "MTR". Aliases are merged into
  the stop's searchable entry, so "MTR", "KCR" and "train station" all land on
  the right stop.
- **`placeAliases`** — shorthand for buildings: `UC`, `YIA`, `WMY`, `AB1`,
  `LSK`, `business school`, `clinic`, `running track`. Keyed by id from
  `data/places.generated.js`, and merged over it at load time, so re-running the
  extractor never clobbers them.
- **`extraPlaces`** — destinations OpenStreetMap simply does not have. The
  extract is good but not complete: campus gates, the post office and the
  swimming pool are all missing. Add them here rather than editing
  `places.generated.js`, which is overwritten on every extractor run.

Search also matches word by word, which is what makes `residence 3` find
*University Residence Nos. 3* rather than *University Residence No. 13*. Plain
substring matching fails on both — "Nos." sits between the words — and then both
fall through to fuzzy matching and tie. Matching word by word, `3` starts the
word `3` but does not start `13`.

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

## Design

A document, not a dashboard. Options are separated by hairline rules rather than
boxed into cards — a stack of bordered, rounded, shadowed panels reads as chrome
competing with the content, and there is very little content here that is not a
name or a number.

Colour is reserved for information. Each shuttle route has a colour, and it
appears in exactly two places: a short bar beside that route's name in the
results, and its line on the map. Warnings are amber. Everything else is ink on
cream. The basemap is desaturated for the same reason — the routes drawn on top
are the point.

Constraints that do not bend, because of where this gets used: body text at
16px and times at 22px, prose never below 13px, every tappable thing at least
44px tall including the ones styled as plain text, and contrast well clear of
AA (15:1 for primary text on the cream ground).

Run `node scripts/smoke-test.js` and `node scripts/validate-data.js` before
deploying; both exit non-zero on failure.

## Layout

```
index.html                    markup
assets/styles.css             mobile-first, high contrast, cream light + warm dark
app.js                        UI, formatting, GPS, map
lib/geo.js                    distance, Tobler walking model, elevation interpolation
lib/planner.js                journey search, ranking, departures, peak warnings
lib/search.js                 fuzzy matching over English, Chinese and aliases
lib/walkroute.js              in-browser Dijkstra over the campus footpath network

data/shuttle-data.js          ← stops, config, aliases. The file you edit.
data/routes.generated.js      auto-generated from the timetable PDFs
data/places.generated.js      auto-generated from OpenStreetMap
data/shapes.generated.js      auto-generated road geometry + walking graph

scripts/extract-timetable.py  PDFs → routes.generated.js
scripts/_pdfpos.py            positional PDF text extraction (used by the above)
scripts/extract-places.js     Overpass + elevations → places.generated.js
scripts/extract-geometry.js   road network → route polylines + walking graph
scripts/calibrate-walk.js     measures the walking detour factor from real paths
scripts/validate-data.js      sanity-checks the data; exits non-zero on failure
scripts/smoke-test.js         runs ~1,400 journeys and asserts the invariants
```

## Attribution

Place data © OpenStreetMap contributors, ODbL. Elevations from SRTM via OpenTopoData. Map tiles © OpenStreetMap contributors. The attribution is rendered in the app footer, as ODbL requires.
