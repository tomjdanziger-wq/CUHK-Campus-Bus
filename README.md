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
| **Time spent on the bus between stops** | **Estimated from distance and gradient.** CUHK does not publish running times. The footer says this, and every ride leg is labelled "ride time estimated from distance". |
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

Rider tracking stores its reports in Firebase (Cloud Firestore), straight from the browser; see [Rider tracking](#rider-tracking) for the one-time setup.

Beyond that, the app loads Leaflet and OSM tiles for the optional map (lazily — it is fully functional with no network at all) and Firebase only once tracking is used.

**Analytics:** Vercel Web Analytics, via the plain-HTML snippet at the bottom of `index.html` (the npm `@vercel/analytics` package is for React/Next and would need a build step). It counts page views without cookies. Switch it on under the project's **Analytics** tab in Vercel; until then, and on any other host, the script simply is not there.

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

It is currently empty, and best kept that way. Route 7 lived there briefly,
transcribed from the Transport Office website, and when the PDF arrived it had
two stops the web page had not shown — the extractor reads the published
diagram and is more reliable than any transcription, including mine.

### Routes with different hours on different days

The meet-class routes — 5, 6A, 6B and 7 — publish two service blocks: a
Monday-to-Friday one and a shorter Saturday one. Route 7 finishes at 17:18 on
weekdays and 13:18 on Saturdays; route 6B does not run on Saturday at all.

A route therefore carries `serviceOverrides`: a list of
`{ runsOn, firstDeparture, lastDeparture, departureMinutes }` where the first
entry matching the day wins. `scripts/extract-timetable.py` reads every
"Service Hours" block on the page and emits them automatically, and `runsToday`
counts a day covered by an override as a day the route runs.

These are also meet-class services running on **teaching days only**. The app
has no academic calendar and cannot tell a teaching day from a reading week, so
that caveat is carried in the route's `notes` and shown on the card rather than
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
2. Multiplied by `config.walking.detourFactor` (**1.45**) to approximate the real
   path network. This is measured, not guessed: `scripts/calibrate-walk.js`
   routes ~1,900 building-to-stop legs over the campus footpath network and
   reports the ratio of routed to straight-line distance — p25 1.29, **median
   1.46**, p75 1.72. It started as a guessed 1.3 (walks ~30% short), then a first
   measurement of 1.69 that was skewed by off-campus places and by snapping to
   dead-end footpath stubs.
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
3. **Sanity cap.** Options whose walking plus riding loses to the walk by more than `maxWorseThanWalkMinutes` (15) are dropped. The wait is deliberately not counted: a route whose bus has just left stays on the list with its next departure instead of vanishing, ranked below the quicker options.
4. **One per bus, per stop.** Two options from the same stop that share a
   route are the same bus — the only difference is where you get off, which
   "Or stay on for" already covers. Kept greedily, best first.

   Deliberately *not* one option per boarding stop. From the downhill kerb at
   Wu Yee Sun, Route 4 runs to the station door while routes 3, 7 and 6A stop
   at the Piazza three minutes short. Standing in the same spot, those are two
   real choices.
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
| Estimated ride times labelled as estimated, on every leg and in the footer | `meta.rideTimesEstimated`, `renderShuttleCard` |
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
  option that spends `longWayRoundThresholdMinutes` (6) longer **riding** than
  a bus you could catch from within `longWayRoundWalkMinutes` (4) is somewhere
  you could just as easily have stood, so taking it is a mistake rather than a
  trade-off.

  The comparison is riding time, not total time, and that distinction is the
  whole thing. Measured on total, this flagged Route 4 from Wu Yee Sun — the
  direct bus to the station door, boarding on the correct kerb — purely because
  its next departure was fifteen minutes away. Telling someone they are on the
  wrong side of the road when they have simply just missed the bus is worse
  than saying nothing. On the real cases the penalty is about eight extra
  minutes in the vehicle; on a missed bus the ride is the same length or
  shorter and every lost minute is in the wait.

These options are not hidden, but they do not get a slot ahead of a sensible
one: the list fills with unflagged options first, and only then with flagged
ones. Nothing is lost by that, since an option is only flagged when some
unflagged bus already beats it. Sometimes you want to sit down, or it is
raining, or the quick bus is half an hour away — the card just says plainly
that this is the slow way and names the stop that is not.

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

## The last bus

Late in the evening the question stops being "what should I do now?" and
becomes "how late can I leave it?". The trip page answers that directly:
**Last bus to I House 6** before anything is entered, and **Last bus to**
wherever you are going once you have chosen a destination.

For each route that runs today and drops you within
`config.lastBus.maxWalkFromStopMinutes` (8) of the destination, it shows the
final scheduled departure — from the best stop near your starting point if you
have given one, otherwise from the route's first stop. Latest first, so the
Night Service leads. Buses you can no longer reach are dropped, and if all of
them have gone it says so in red. One more line gives the last bus on the
*other* timetable (Sundays and public holidays, or the weekday one), since the
time you need is often tomorrow's.

The home is `config.lastBus.home` in `data/shuttle-data.js`. The logic is
`planner.lastRides()`.

## Browsing the network

The app is three pages side by side — **Routes**, **Go**, **Food** — with the
trip planner in the middle. Swipe right for the route map, left for food, or
use the bottom navigation bar. The look follows Google Maps on purpose: a
search card with start and destination joined by a dotted line, shortcut chips
(I House 6, MTR) on the left beneath it, the departure time as a small chip on
the right, and route numbers as coloured badges. It is one horizontal scroller with CSS scroll snapping,
so the swipe is the browser's own gesture, and each page keeps its own scroll
position. Nothing on screen exists only to expand something else.

The planner answers "how do I get from A to B". The **Routes** page
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

## Canteens and other food places

All 36 canteens, cafés, restaurants and food shops on campus are searchable
destinations, and **findable without knowing their names**. Typing `canteen`,
`coffee`, `food`, `lunch`, `食堂` or `咖啡` into the To box lists them; picking
one plans the trip like any other destination.

That is the point — you should not have to already know that the place you want
is called "Café 12" or "The Harmony", nor leave the app to look it up on a map
somewhere else.

They are identified by **OpenStreetMap's own categories**, not by matching words
in names. Name matching finds well under half of them: it misses "Café 12", "Food Lab" and
"The Harmony" while happily picking up anything with "Kitchen" in the name that
is not a kitchen. `scripts/extract-places.js` stores a `food` block — category,
cuisine, opening hours — on the places that have one and nothing on the places
that do not, which costs about 8 KB.

The category becomes a set of search aliases in `foodSearchTerms`
(`data/shuttle-data.js`), so it works through the same fuzzy search as
everything else: no separate mode, no category picker to learn. A place whose
own name also contains the word ranks above one that merely carries the
category, so `canteen` reaches Shaw College Student Canteen before it reaches a
noodle bar that happens to be tagged as one.

The **Food** page is a second way in: the same list sorted by how far each one
is from wherever you have said you are, filterable by kind. It is a finder, not
a food guide — it deliberately shows only name, kind and distance.

Opening hours are stored where OpenStreetMap has them (11 of 36) but are not
displayed. The Finance Office publishes authoritative hours for the ten
centrally-run outlets, in a PDF whose text sits inside Form XObjects that
`scripts/_pdfpos.py` does not recurse into; college canteens are on each
college's own site in a different format every time. Wiring either in is a
bigger job than the data is currently worth.

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

### Building codes

Timetables and calendars name rooms by CUSIS building code — `ERB 407`,
`LSK LT6`, `YIA LT8`. Every code on the Graduate School's
[building abbreviations list](https://www.gs.cuhk.edu.hk/academics/teaching-timetable/building-abbreviation)
that matches a building in the app is an alias in `placeAliases`. Search
ignores a trailing room (anything with a digit, or `LT`), so a calendar entry
can be pasted as it is, with or without the space (`erb407`). The result shows
the full building name with the code beside it.

When the list changes, add the code to the building's `placeAliases` entry. A
code only counts as a match on its own once the room is stripped, so `ERB 407`
finds ERB and not every building with "erb" somewhere in its name.

### Choosing on the map

Every search box ends with **Choose on map**: a full-screen map with a fixed pin
you move the map under, for places you can find but cannot name. The spot is
named after the nearest place (`Pin near Pi Ch'iu Building`), or takes that
place's name outright within 25 m, and gets its elevation interpolated from
nearby known points, the same way a GPS fix does.

## Live location

Every map (trip, route browser, pin picker) has a locate button. It shows a
blue dot with an accuracy circle and follows you as you walk; drag the map and
it stops following but keeps the dot. The dot never changes the journey: the
start stays whatever you set.

It starts on its own only when location permission is already granted, so
opening a map never causes a permission prompt, and it stops watching while
the app is in the background to save battery. The start marker on the trip map
is a hollow ring, like the start dot in the search box, so the solid dot always
means "you, now".

## Spotting buses from a stop

The **Spot** page (the first tab) is for filling the database quickly without riding: walking across campus, you log every bus you see pull in at a stop.

- **The stop follows you.** GPS picks the nearest stop within 90 m as you walk; the four nearest are chips for a one-tap correction (usually to the other side of the road), and a stop picked by hand sticks until you are 150 m away from it.
- **One tap per bus.** Big buttons in each route's colour, only for routes that call at that stop and run today. No confirm step; a double tap within 3 s counts once.
- **Five seconds to undo.** Reports cannot be deleted once stored, so a tap waits five seconds with an *Undo* before it goes out. Everything due is then sent in one write (up to ten), so buses arriving together do not wait for each other; the next write from the same session only needs 3 seconds. Each report carries the time you tapped. Leaving the app ends the undo window.
- **Saved on the phone until the database has it.** No signal, the app closed mid-send, a refusal: taps stay in local storage with their original time and are sent the next time the app is open (or the moment the phone is back online), for up to 72 hours. Every tap has a fixed document id chosen when it was made, so a retry after an interrupted send cannot store it twice — the rules refuse a second write to the same id, and the app then checks which were already stored and drops them. Repeated failures back off, up to two minutes apart.

Spots go to their own `spots` collection, never mixed with ride logs: a Route 4 spotted at one stop and another Route 4 spotted at the next are two buses, not a timed hop. They do appear on the Track page and on trip cards ("seen from the stop"), and `scripts/export-reports.js` writes them to `exports/spots.csv` — each row an arrival at a stop, which is what punctuality modelling needs.

## Rider tracking

The **Track** page (swipe all the way right from the planner, or the first tab) lets someone who has just boarded report it in two taps: the stop — nearest first when the phone knows where it is — and then the route number, from only the routes that call there and run today.

Reports show up on the Track page for 90 minutes, newest first, with several riders reporting the same bus at the same stop within five minutes shown as one sighting "· 3 riders". A trip card also shows the latest report of its bus from the last 20 minutes, and whether that stop is before your stop, at it, or past it.

Everything is labelled as a rider report with its age. It is never called live and never replaces the timetable.

**No accounts.** Registration would kill it — nobody signs up to tell strangers a bus came. The phone signs in to Firebase *anonymously*: no screen, no name, no email, just a random id Firebase keeps on the phone so the rules can tell one phone from another.

- A report is a stop id, a route id and the server's time. Nothing about the reporter is stored with it.
- `firestore.rules` accepts a report only for a stop and route that really go together (generated from `data/shuttle-data.js`), with the server's own timestamp, and nothing can be edited or deleted afterwards.
- One report per phone per 45 seconds: each report is written in a batch together with a tiny `throttle/{uid}` document, and the rules only accept the report if that marker moves in the same batch, and only let it move once the cooldown has passed.
- The app keeps a live listener on the last 90 minutes of reports instead of polling, which is both quicker and cheaper, and drops it while the app is in the background.

Tuning lives in `config.tracking` in `data/shuttle-data.js`.

### Logging a ride

After reporting, the page switches to the ride. **While the app is open, stops log themselves from the phone's location**, and the ride ends by itself when you walk away from the route ("Looks like you got off at …", with a one-tap *Still on the bus?* in case GPS guessed wrong). A big button naming the next stop is there for tapping by hand when GPS is poor; "Bus didn't stop here" moves on without a report, and "I got off" ends it. The ride survives closing the app and ends by itself after 40 minutes with nothing logged.

**It cannot run in the background.** A web page gets no location with the screen locked or the app switched away — iOS and Android both pause it — so the screen is kept awake during a ride (Screen Wake Lock, where the browser allows it), and whatever the app misses while closed simply leaves a gap. Truly in-pocket tracking would need a native app.

Location never leaves the phone: it only decides *when* to send an ordinary report. How the following works (`lib/ridefollow.js`):

- It tracks how far along the route's actual road the bus has got, searching forwards only and taking the earliest stretch that fits, never the nearest. Campus roads double back: Route 4 passes the United College stop on its way to New Asia and comes back to it later, and matching by distance alone logged United College first.
- A stretch of road only fits if it runs the way the phone is moving. Route 4 goes out and back along the same road near C.W. Chu, where both directions are within reach of the same fix.
- A stop counts when the phone reaches the stop's point *on the road*, not its map pin. Some pins sit well off the carriageway (Campus Circuit East is 64 m away).
- A jump of more than 120 m along the road needs a second fix to agree, and fixes vaguer than 60 m are ignored, so a single wild fix cannot move the bus.
- "Got off" is three consecutive good fixes more than 80 m from the road just ahead or just behind.

`scripts/smoke-test.js` drives five noisy simulated rides along every route and fails if any stop is missed or anyone is told they got off mid-ride, then checks that walking away is noticed. Under much harsher noise (±9 m jitter, 6% wild fixes up to 220 m, 10% dropped fixes) about 1 ride in 20 misses a stop — which only leaves a gap — and about 1 in 250 is wrongly ended. Thresholds are the `gps…` entries in `config.tracking`.

**Where people get off** is logged too, in a separate `alightings` collection. When GPS sees you walk off the route, the ride doesn't just end: it asks *"Looks like you got off at University Administration Building. Right?"* with the nearby stops listed, and saves the guess by itself after 60 seconds if nobody answers (the phone is usually in a pocket by then). Tap another stop to correct it, *Still on the bus* to carry on, or *Don't log where*. "I got off" opens the same list, with no countdown, pre-selected at the stop GPS puts you nearest, or else the last stop logged. Each record says how it was decided — `gps`, `tap` or `picked` — so a guess is never mistaken for a rider's answer.

Each report is an ordinary report with the same ride id, so everyone else sees where that bus is now ("rider on board, logging stops") rather than a trail of every stop it passed. It records when the bus reached the stop by the phone's clock (`at`), so waiting for signal or for the gap between reports does not distort the timing, and whether GPS or a tap logged it (`auto`).

The private stats page (below) turns these logs into ride times: it pairs consecutive taps one stop apart within each ride, takes the median per hop (arrival to arrival, so the dwell at the previous stop is included), and once every hop of a route has three or more samples shows a `rideTimes` line to paste into `data/shuttle-data.js`. A skipped stop leaves a gap, so it never produces a false two-stop "hop".

### Setting up Firebase

The project config is in `data/firebase-config.js` (it is a public identifier, not a secret — the rules protect the data). To use a different project, replace it; to switch tracking off, set it to `null`.

One-time, in the [Firebase console](https://console.firebase.google.com/): **Authentication → Sign-in method → Anonymous** → enable.

Everything else is deployed from this folder with the official Firebase CLI — the database (in `asia-east2`, Hong Kong) and the security rules:

```bash
npx firebase-tools login
```

```bash
npx firebase-tools firestore:databases:create "(default)" --location=asia-east2 --project cuhk-buses
```

```bash
npx firebase-tools deploy --only firestore --project cuhk-buses
```

The first two are needed once. After that, only the deploy.

When routes or stops change, run `node scripts/build-firestore-rules.js` and deploy again, or reports from new stops will be refused.

### Keeping the data

Reports are **not** deleted: they are the raw material for modelling how long each hop takes, how punctual each route is, and where people get off. There is no TTL policy on purpose. Each document still carries an `expireAt` 120 days out (the rules require it), but it does nothing unless a TTL policy is created — so do not create one unless you want reports gone after 120 days, and update the note at the bottom of the Track page if you do.

Size is not a concern: a report is well under 1 KB, so Firestore's free 1 GB holds hundreds of thousands.

### The private stats page

`stats.html` shows what has been logged: totals, how early or late buses are against the timetable (overall and per route), sightings by hour, busiest stops, measured stop-to-stop times with ready-to-paste `rideTimes`, where people get off, the latest reports, and a CSV download of everything. It is not linked from the app and is marked `noindex`, but that is not what keeps it private.

**The rules are.** Anyone — the app included — may read only the last 3 hours of reports, which is all the Track page and trip cards need. The full history can only be read by the Firebase account ids in `FIREBASE_ADMIN_UIDS` (`data/firebase-config.js`); the page signs in with Google and asks. Ids, not emails, so no address sits in the public code.

Punctuality compares each sighting with the nearest timetabled bus at that stop (within 20 minutes). At the first stop that is the published time; at later stops it adds the estimated ride time, so part of any difference there is the estimate — the page says so, and the comparison gets sharper as measured `rideTimes` replace estimates.

Setting up access, once:

1. Firebase console → **Authentication → Sign-in method → Google** → enable.
2. **Authentication → Settings → Authorized domains** → add `cuhk-campus-bus.vercel.app` (localhost is there already).
3. Open `stats.html`, sign in. It shows *No access with this account* and your account id.
4. Put that id in `FIREBASE_ADMIN_UIDS`, run `node scripts/build-firestore-rules.js`, and publish `firestore.rules`.

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
