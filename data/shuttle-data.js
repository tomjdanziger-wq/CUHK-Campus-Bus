/* ===========================================================================
 * shuttle-data.js — all CUHK campus data for the Shuttle Helper.
 *
 * This is the ONLY file you need to edit each term.
 *
 * WHAT IS REAL HERE
 *   Stops        Real. Positions and bilingual names come from OpenStreetMap's
 *                mapped CUHK shuttle stops; elevations from SRTM 30 m.
 *   Routes       Real. Stop sequences, service hours, departure minutes and
 *                service days are extracted from the Transport Office's own
 *                published route pages by scripts/extract-timetable.py.
 *
 * WHAT IS ESTIMATED
 *   Ride times   The Transport Office publishes departure minutes from the
 *                first stop, but NOT running times between stops. So no route
 *                carries `segmentMinutes`, and the app estimates each ride
 *                from distance and gradient, labelling it "estimated" on the
 *                card. `meta.rideTimesEstimated` drives a standing notice.
 *
 *                This is the single biggest source of error in the app. If you
 *                can time the routes with a stopwatch, adding `segmentMinutes`
 *                to a route (one entry per hop) replaces the estimate and the
 *                notice disappears for that route.
 *
 *   Peak periods Guesses about when buses fill up, not measured data.
 *
 * UPDATING EACH TERM
 *   1. Save each route page from https://www.cuhk.edu.hk/campus-shuttle/
 *      as a PDF into the project root.
 *   2. python3 scripts/extract-timetable.py *.pdf > data/routes.generated.js
 *   3. node scripts/validate-data.js          ← checks the result is sane
 *   4. Update meta.lastUpdated / meta.validUntil below.
 *
 *   If a new stop appears, add it to `stops` here and map its printed label in
 *   STOP_IDS inside scripts/extract-timetable.py. The validator will tell you
 *   if you miss one.
 * =========================================================================== */

(function (root) {
  'use strict';

  // -------------------------------------------------------------------------
  // META — surfaced in the UI so users can judge whether the data is stale.
  // -------------------------------------------------------------------------
  var meta = {
    // The timetable is now the real published one, not invented.
    isPlaceholder: false,

    // Ride times between stops are still estimated — see the note above.
    rideTimesEstimated: true,

    timetableLabel: 'CUHK Transport Office published timetable',
    source: 'https://www.cuhk.edu.hk/campus-shuttle/',
    extractedOn: '2026-09-09',
    lastUpdated: '2026-09-09',

    // The Transport Office does not print a validity window on the route
    // pages, so we show the extraction date instead of inventing one. Set
    // validUntil when you know the term's end date.
    validFrom: null,
    validUntil: null
  };

  // -------------------------------------------------------------------------
  // CONFIG — every tunable assumption lives here.
  //
  // These numbers are guesses until someone walks the campus with a stopwatch.
  // They are deliberately in one block so they can be calibrated in one place.
  // -------------------------------------------------------------------------
  var config = {

    walking: {
      // Straight-line distance is multiplied by this to approximate the real
      // path network (stairs, switchbacks, walking round buildings).
      //
      // MEASURED, not guessed. Routing 2,739 building-to-stop legs over the
      // campus footpath network in data/shapes.generated.js gives a ratio of
      // routed distance to straight-line distance of:
      //
      //     p10 1.28   p25 1.43   median 1.69   p75 2.12   p90 2.63
      //
      // This started at a guessed 1.3, which underestimated every walk on
      // campus by about 30%. 1.65 sits just under the measured median, on the
      // grounds that OpenStreetMap does not map every covered walkway, podium
      // shortcut and lift, so the router detours where a person would not.
      //
      // Re-measure after changing the footpath data:
      //   node scripts/calibrate-walk.js
      detourFactor: 1.65,

      // Tobler's hiking function:  v = 6 · exp(−3.5 · |slope + 0.05|)  km/h
      // It peaks at a gentle −5% downhill and falls off steeply uphill, which
      // matches how this campus actually feels. On the flat it predicts
      // ~5.0 km/h, which is brisk for a student with a backpack — so we scale
      // it down. 0.85 gives ~4.3 km/h on the flat.
      toblerCalibration: 0.85,

      // Anything below this reads as "basically no walk at all".
      minimumMinutes: 1,

      // Displayed range around the point estimate. Asymmetric because these
      // estimates fail long far more often than they fail short (crowds,
      // waiting at crossings, getting lost, stopping to breathe on the hill).
      rangeLow: 0.8,
      rangeHigh: 1.35
    },

    bus: {
      // Only used when a route has no explicit `segmentMinutes`. Campus roads
      // are narrow, steep and speed-limited.
      fallbackSpeedKmh: 18,
      // Added per intermediate stop for doors-open time.
      dwellSecondsPerStop: 25,
      // Same detour factor idea, applied to the road network.
      roadDetourFactor: 1.35
    },

    search: {
      // How far we are willing to make someone walk to reach a boarding stop.
      maxWalkToStopMinutes: 12,
      // How far we are willing to make someone walk after alighting.
      maxWalkFromStopMinutes: 15,

      // A shuttle option must save at least this much WALKING versus going on
      // foot the whole way, or it is not shown. Stops the app suggesting you
      // walk 5 minutes to a stop and 14 minutes from the next one in order to
      // avoid a 17-minute walk.
      //
      // Deliberately about walking, not total time: a bus that is no faster
      // than walking is still worth offering on this campus, because it saves
      // you the climb.
      minWalkSavedMinutes: 3,

      // Flag an option as the long way round when it spends this much longer
      // RIDING than a bus you could catch from within
      // `longWayRoundWalkMinutes`. On a campus of one-way loops the uphill and
      // downhill stops sit metres apart and send you in opposite directions,
      // so this is easy to get wrong and expensive when you do.
      //
      // Measured on riding time, not total, so that having just missed the
      // right bus is never mistaken for standing at the wrong stop. Real
      // wrong-side journeys run about eight minutes longer in the vehicle;
      // a missed bus rides the same distance and loses its time waiting.
      longWayRoundThresholdMinutes: 6,
      longWayRoundWalkMinutes: 4,

      // Two routes running the same stretch are shown as one option when
      // their ride times are within this of each other — you board whichever
      // comes first, so presenting them separately fakes a decision and hides
      // their combined frequency. A route sharing both endpoints but looping
      // the long way round exceeds this and stays on its own card.
      groupRideToleranceMinutes: 4,

      // Drop shuttle options that lose to the direct walk by more than this.
      // Generous on purpose — a bus that ties with walking still saves you the
      // climb and stays on the list. This only removes the absurd cases, like
      // a 58-minute wait offered next to an 8-minute stroll.
      maxWorseThanWalkMinutes: 15,

      // "Walk further for a better bus" — only surface a further-away boarding
      // stop when it beats the nearest sensible one by at least this much.
      //
      // Every number in this app carries roughly ±30% error. Recommending a
      // 6-minute uphill walk to save a predicted 3 minutes will often be
      // wrong, and being wrong about that is worse than staying quiet.
      furtherStopThresholdMinutes: 8,

      // A boarding stop counts as "the nearest one" if it is within this much
      // extra walking of the genuinely closest stop.
      nearStopToleranceMinutes: 2,

      // How many options to show, direct walk included.
      maxOptions: 4,

      // How far ahead to look for departures.
      lookAheadMinutes: 90,
      // How many upcoming departures to list per option.
      departuresToShow: 3
    },

    display: {
      // Coarse rounding. Two options sitting side by side make small
      // differences read as a recommendation, so we round hard enough that
      // spurious differences disappear.
      totalRoundingMinutes: 5,
      // A climb or descent worth warning about, in metres.
      notableElevationMetres: 15
    },

    // One-tap shortcuts under the From and To boxes, for the trips you make
    // every day. `place` is an id from the merged places list — either a
    // generated OSM id, or 'stop:<stop id>' for a shuttle stop.
    quickPicks: {
      from: [
        { place: 'university-residence-nos-3', label: 'I House 6' }
      ],
      to: [
        { place: 'stop:univ-station', label: 'MTR' }
      ]
    },

    // Route colours, used to draw each line on the map. Chosen to stay apart
    // from each other and to read against OpenStreetMap tiles in both themes.
    // 2S is a deliberate sibling shade of 2 — it is a variant of that route.
    routeColours: {
      '1':  '#d1495b',   // Main Campus      — crimson
      '2':  '#0b6e99',   // NA / UC          — deep blue
      '2S': '#4ea3d1',   // NA / UC (S)      — light blue
      '3':  '#e07a1f',   // Shaw             — orange
      '4':  '#7b52ab',   // Campus Circuit   — purple
      '8':  '#00857a',   // Western Campus   — teal
      '5':  '#b5651d',   // Upward           — burnt orange
      '6A': '#7d5ba6',   // Downward (CWC)   — violet
      '6B': '#a8869e',   // Downward (NA/UC) — muted mauve
      '7':  '#6b7a1f',   // Downward (Shaw)  — olive
      'N':  '#3f4e7a',   // Night Service    — indigo
      'H':  '#b5179e'    // Holidays Service — magenta
    },
    fallbackRouteColour: '#555f6b',
    walkColour: '#1b7f4d',

    // Capacity warnings. Static, not real-time — we have no occupancy data.
    peakPeriods: [
      { start: '08:30', end: '09:30', days: 'mon-fri',
        message: 'Morning peak — buses are often full. You may not get on the first one.' },
      { start: '12:20', end: '13:10', days: 'mon-fri',
        message: 'Lunchtime class change — expect a queue.' },
      { start: '17:15', end: '18:15', days: 'mon-fri',
        message: 'Evening peak toward the MTR — expect a queue.' }
    ]
  };

  // -------------------------------------------------------------------------
  // STOPS — real. Positions and bilingual names from OpenStreetMap's mapped
  // CUHK shuttle stops; elevations from SRTM 30 m via OpenTopoData.
  //
  // `elevation` is metres above sea level and is REQUIRED: it drives the
  // walking estimate, and a wrong value produces confidently wrong advice.
  //
  // `abbr` is the short code shown on the network map, where full names would
  // overlap into an unreadable mess. The ↑ / ↓ suffix is the uphill/downhill
  // side of the road, matching the Transport Office's own naming.
  //
  // `pair` and `side` mark the two halves of a stop that exists on both sides
  // of the road. They are the same place to walk to and a completely different
  // journey to board: from the downhill side of Wu Yee Sun you reach the
  // station in 9 minutes, from the uphill side the bus goes the long way round
  // the campus and takes 21.
  //
  // Several stops exist as an (Upward)/(Downward) pair on opposite sides of
  // the road. Where OpenStreetMap maps only one of the pair, both share that
  // position — they are metres apart, well inside the walking model's error.
  // -------------------------------------------------------------------------
  var stops = [
    { id: 'univ-station'              , name: "University Station"                   , nameZh: "大學站", lat: 22.414537, lng: 114.210221, elevation:   7 , abbr: 'MTR' },
    { id: 'station-piazza'            , name: "University Station Piazza"            , nameZh: "港鐵大學站廣場", lat: 22.413808, lng: 114.209437, elevation:  10 , abbr: 'PZA' },
    { id: 'chung-chi-teaching'        , name: "Chung Chi Teaching Blocks"            , nameZh: "崇基教學樓", lat: 22.416036, lng: 114.208359, elevation:  12 , abbr: 'CCT' },
    { id: 'yiap'                      , name: "Yasumoto International Academic Park" , nameZh: "康本國際學術園", lat: 22.415973, lng: 114.210832, elevation:  19 , abbr: 'YIA' },
    { id: 'univ-sports-centre'        , name: "University Sports Centre"             , nameZh: "大學體育中心", lat: 22.417812, lng: 114.210482, elevation:  45 , abbr: 'SPT' },
    { id: 'sh-ho-college'             , name: "S.H. Ho College"                      , nameZh: "善衡書院", lat: 22.418042, lng: 114.209850, elevation:  49 , abbr: 'SHH' },
    { id: 'postgrad-hall-1'           , name: "Postgraduate Hall 1"                  , nameZh: "賽馬會研究生宿舍一座", lat: 22.420248, lng: 114.212171, elevation:  32 , abbr: 'PG1' },
    { id: 'campus-circuit-east-up'    , name: "Campus Circuit East (Upward)"         , nameZh: "環迴東路（上行）", lat: 22.421533, lng: 114.211835, elevation:  55 , abbr: 'CCE↑' , pair: 'campus-circuit-east', side: 'up' },  // APPROXIMATE — road-side stop, position not in OSM
    { id: 'campus-circuit-east-down'  , name: "Campus Circuit East (Downward)"       , nameZh: "環迴東路（下行）", lat: 22.421533, lng: 114.211835, elevation:  55 , abbr: 'CCE↓' , pair: 'campus-circuit-east', side: 'down' },  // APPROXIMATE — road-side stop, position not in OSM
    { id: 'campus-circuit-north-down' , name: "Campus Circuit North (Downward)"      , nameZh: "環迴北路（下行）", lat: 22.424445, lng: 114.209261, elevation:  11 , abbr: 'CCN↓' , pair: 'campus-circuit-north', side: 'down' },  // APPROXIMATE — road-side stop, position not in OSM
    { id: 'sir-run-run-shaw-hall'     , name: "Sir Run Run Shaw Hall"                , nameZh: "邵逸夫堂", lat: 22.419841, lng: 114.206942, elevation: 102 , abbr: 'SRS' },
    { id: 'science-centre'            , name: "Science Centre"                       , nameZh: "科學館", lat: 22.419830, lng: 114.207342, elevation: 102 , abbr: 'SCI' },
    { id: 'fung-king-hey'             , name: "Fung King Hey Building"               , nameZh: "馮景禧樓", lat: 22.419864, lng: 114.203032, elevation: 113 , abbr: 'FKH' },
    { id: 'univ-admin'                , name: "University Administration Building"   , nameZh: "大學行政樓", lat: 22.418806, lng: 114.205358, elevation: 100 , abbr: 'ADM' },
    { id: 'united-college-up'         , name: "United College (Upward)"              , nameZh: "聯合書院（上行）", lat: 22.420390, lng: 114.205394, elevation: 136 , abbr: 'UC↑' , pair: 'united-college', side: 'up' },
    { id: 'united-college-down'       , name: "United College (Downward)"            , nameZh: "聯合書院（下行）", lat: 22.420302, lng: 114.205340, elevation: 133 , abbr: 'UC↓' , pair: 'united-college', side: 'down' },
    { id: 'new-asia-college'          , name: "New Asia College"                     , nameZh: "新亞書院", lat: 22.421271, lng: 114.207559, elevation: 142 , abbr: 'NA' },
    { id: 'new-asia-circle'           , name: "New Asia Circle"                      , nameZh: "新亞坊", lat: 22.421072, lng: 114.207647, elevation: 141 , abbr: 'NAC' },
    { id: 'wu-yee-sun-up'             , name: "Wu Yee Sun College (Upward)"          , nameZh: "伍宜孫書院（上行）", lat: 22.421331, lng: 114.203471, elevation: 114 , abbr: 'WYS↑' , pair: 'wu-yee-sun', side: 'up' },
    { id: 'wu-yee-sun-down'           , name: "Wu Yee Sun College (Downward)"        , nameZh: "伍宜孫書院（下行）", lat: 22.421199, lng: 114.203521, elevation: 116 , abbr: 'WYS↓' , pair: 'wu-yee-sun', side: 'down' },
    { id: 'chan-chun-ha'              , name: "Chan Chun Ha Hostel"                  , nameZh: "陳震夏宿舍", lat: 22.421812, lng: 114.204612, elevation: 119 , abbr: 'CCH' },
    { id: 'shaw-college-up'           , name: "Shaw College (Upward)"                , nameZh: "逸夫書院（上行）", lat: 22.422486, lng: 114.201315, elevation:  82 , abbr: 'SHW↑' , pair: 'shaw-college', side: 'up' },  // up/down stops share one mapped position
    { id: 'shaw-college-down'         , name: "Shaw College (Downward)"              , nameZh: "逸夫書院（下行）", lat: 22.422486, lng: 114.201315, elevation:  82 , abbr: 'SHW↓' , pair: 'shaw-college', side: 'down' },  // up/down stops share one mapped position
    { id: 'uc-staff-residence'        , name: "United College Staff Residence"       , nameZh: "聯合苑", lat: 22.423259, lng: 114.205130, elevation:  83 , abbr: 'UCS' },
    { id: 'residence-15'              , name: "Residence No. 15"                     , nameZh: "十五苑", lat: 22.423716, lng: 114.206598, elevation:  62 , abbr: 'R15' },
    { id: 'cw-chu-up'                 , name: "C.W. Chu College (Upward)"            , nameZh: "敬文書院（上行）", lat: 22.425557, lng: 114.206218, elevation:  23 , abbr: 'CWC↑' , pair: 'cw-chu', side: 'up' },  // up/down stops share one mapped position
    { id: 'cw-chu-down'               , name: "C.W. Chu College (Downward)"          , nameZh: "敬文書院（下行）", lat: 22.425557, lng: 114.206218, elevation:  23 , abbr: 'CWC↓' , pair: 'cw-chu', side: 'down' },  // up/down stops share one mapped position
    { id: 'area-39-up'                , name: "Area 39 (Upward)"                     , nameZh: "三十九區（上行）", lat: 22.427631, lng: 114.204351, elevation:   9 , abbr: 'A39↑' , pair: 'area-39', side: 'up' },  // up/down stops share one mapped position
    { id: 'area-39-down'              , name: "Area 39 (Downward)"                   , nameZh: "三十九區（下行）", lat: 22.427631, lng: 114.204351, elevation:   9 , abbr: 'A39↓' , pair: 'area-39', side: 'down' },  // up/down stops share one mapped position
  ];

  // -------------------------------------------------------------------------
  // ROUTES — real, generated from the Transport Office PDFs.
  //
  // Regenerate with:
  //   python3 scripts/extract-timetable.py *.pdf > data/routes.generated.js
  //
  // To add measured running times to a route, give it a `segmentMinutes`
  // array here (one entry per hop, length = stops.length - 1) and it will
  // override the distance-based estimate:
  //
  //   var rideTimes = { '1': [2, 4, 2, 3, 2] };
  //
  // -------------------------------------------------------------------------
  var rideTimes = {
    // '1': [2, 4, 2, 3, 2],
  };

  // -------------------------------------------------------------------------
  // EXTRA ROUTES — routes that have no PDF.
  //
  // scripts/extract-timetable.py rebuilds data/routes.generated.js from
  // whatever route PDFs are in the project root, so anything added there is
  // lost on the next run. Routes added by hand go here instead.
  //
  // Empty, and best kept that way: the extractor reads the published diagram
  // and is more reliable than transcription. Route 7 lived here briefly, taken
  // off the Transport Office website, and the PDF turned out to have two stops
  // the web page had not shown us.
  // -------------------------------------------------------------------------
  var extraRoutes = [
  ];

  var routes = (root.CUHK_ROUTES_GENERATED || []).concat(extraRoutes).map(function (r, i) {
    var seg = rideTimes[r.id];
    return {
      id: r.id,
      order: i,
      colour: config.routeColours[r.id] || config.fallbackRouteColour,
      name: r.name,
      nameZh: r.nameZh,
      label: r.label,
      stops: r.stops,
      segmentMinutes: (seg && seg.length === r.stops.length - 1) ? seg : null,
      departureMinutes: r.departureMinutes,
      firstDeparture: r.firstDeparture,
      lastDeparture: r.lastDeparture,
      runsOn: r.runsOn,
      serviceOverrides: r.serviceOverrides || null,
      notes: r.notes
    };
  });

  // -------------------------------------------------------------------------
  // STOP ALIASES — what people actually call the shuttle stops.
  //
  // The official names come from the Transport Office and OpenStreetMap, and
  // nobody says "University Station Piazza". Everyone says "MTR".
  // -------------------------------------------------------------------------
  var stopAliases = {
    'univ-station':              ['MTR', 'MTR Station', 'University MTR Station', 'Uni Station', 'KCR', 'train station', '港鐵'],
    'station-piazza':            ['Piazza', 'MTR Piazza', 'Station Plaza', 'bus terminus'],
    'chung-chi-teaching':        ['Chung Chi Teaching', 'CC Teaching', 'Teaching Blocks'],
    'yiap':                      ['YIA', 'YIAP', 'Yasumoto'],
    'univ-sports-centre':        ['Sports Centre', 'Gym', 'USC', 'sports hall'],
    'sh-ho-college':             ['SH Ho', 'Ho College', 'SHHO'],
    'postgrad-hall-1':           ['PGH', 'PG Hall', 'Postgraduate Hall', 'Jockey Club Hall'],
    'campus-circuit-east-up':    ['CCE', 'Campus Circuit East'],
    'campus-circuit-east-down':  ['CCE', 'Campus Circuit East'],
    'campus-circuit-north-down': ['CCN', 'Campus Circuit North'],
    'sir-run-run-shaw-hall':     ['Shaw Hall', 'SRRS', 'SRRSH', 'Run Run Shaw'],
    'science-centre':            ['Sci Centre', 'SC', 'Science'],
    'fung-king-hey':             ['FKH', 'Fung King Hey', 'Business School'],
    'univ-admin':                ['UAB', 'Admin', 'Admin Building', 'Administration'],
    'united-college-up':         ['UC', 'United', 'United College'],
    'united-college-down':       ['UC', 'United', 'United College'],
    'new-asia-college':          ['NA', 'New Asia'],
    'new-asia-circle':           ['NA Circle', 'New Asia Circle'],
    'wu-yee-sun-up':             ['WYS', 'Wu Yee Sun'],
    'wu-yee-sun-down':           ['WYS', 'Wu Yee Sun'],
    'chan-chun-ha':              ['CCH', 'Chan Chun Ha'],
    'shaw-college-up':           ['Shaw', 'Shaw College'],
    'shaw-college-down':         ['Shaw', 'Shaw College'],
    'uc-staff-residence':        ['UC Staff', 'United College Staff'],
    'residence-15':              ['Res 15', 'Residence 15'],
    'cw-chu-up':                 ['CWC', 'Chu College', 'CW Chu'],
    'cw-chu-down':               ['CWC', 'Chu College', 'CW Chu'],
    'area-39-up':                ['Area 39', 'A39', '39'],
    'area-39-down':              ['Area 39', 'A39', '39']
  };

  // -------------------------------------------------------------------------
  // PLACE ALIASES — hand-maintained, merged over the auto-extracted list.
  //
  // OpenStreetMap carries the official names; students use shorthand. Add
  // whatever you actually hear people say. Re-running
  // scripts/extract-places.js never touches this block.
  //
  // Keys are ids from data/places.generated.js.
  // -------------------------------------------------------------------------
  var placeAliases = {
    // --- colleges -------------------------------------------------------
    'united-college':                      ['UC', 'United'],
    'new-asia-college':                    ['NA', 'New Asia'],
    'chung-chi-college':                   ['CC', 'Chung Chi'],
    'shaw-college':                        ['Shaw'],
    'wu-yee-sun-college':                  ['WYS'],
    'lee-woo-sing-college':                ['LWS'],
    'sh-ho-college':                       ['SHHO', 'S.H. Ho'],
    'morningside-college':                 ['MC'],
    'c-w-chu-college':                     ['CWC', 'Chu College'],

    // --- halls of residence ---------------------------------------------
    // University Residence Nos. 3 is across the road from Wu Yee Sun College
    // and is known to its residents as I House Block 6.
    'university-residence-nos-3':          ['I House Block 6', 'IHouse Block 6', 'I-House Block 6',
                                            'IH Block 6', 'Block 6', 'University Residence No. 3',
                                            'University Residence Number 3', 'Res 3', 'Residence 3'],
    'international-house-1':               ['IH1', 'I House 1', 'I-House 1'],
    'international-house-2':               ['IH2', 'I House 2', 'I-House 2'],
    'international-house-3':               ['IH3', 'I House 3', 'I-House 3'],
    'chan-chun-ha-hostel':                 ['CCH'],
    'adam-schall-residence':               ['Adam Schall'],

    // --- teaching and admin ---------------------------------------------
    'university-library':                  ['UL', 'Main Library', 'Uni Library'],
    'university-science-centre':           ['Science Centre', 'SC'],
    'yasumoto-international-academic-park': ['YIA', 'YIAP', 'Yasumoto'],
    'benjamin-franklin-centre':            ['BFC', 'Benjamin Franklin'],
    'sir-run-run-shaw-hall':               ['Shaw Hall', 'SRRSH'],
    'university-administration-building':  ['UAB', 'Admin Building'],
    'pommerenke-student-centre':           ['Pomm', 'PSC'],
    'esther-lee-building':                 ['ELB'],
    'mong-man-wai-building':               ['MMW'],
    'lady-shaw-building':                  ['LSB'],
    'sino-building':                       ['Sino'],
    'cheng-ming-building':                 ['CMB'],
    'chien-mu-library':                    ["Ch'ien Mu", 'New Asia Library'],
    'fong-shu-chuen-building':             ['FSC'],
    'wu-ho-man-yuen-building':             ['WMY', 'Wu Ho Man Yuen'],
    'academic-building-no1':               ['AB1', 'Academic Building 1'],
    'academic-building-no2':               ['AB2', 'Academic Building 2'],
    'cheng-yu-tung-building':              ['CYT', 'Business School'],
    'leung-kau-kui-building':              ['LKK'],
    'lee-shau-kee-building':               ['LSK'],
    'li-dak-sum-building':                 ['LDS'],
    'tin-ka-ping-building':                ['TKP'],
    'william-mw-mong-engineering-building': ['Engineering', 'Mong Engineering'],
    'ho-sin-hang-engineering-building':     ['HSH', 'Engineering'],

    // --- services -------------------------------------------------------
    'university-health-centre':            ['clinic', 'health centre', 'doctor', 'medical'],
    'cuhk-medical-centre':                 ['hospital', 'CUHK Hospital'],
    'sir-philip-haddon-cave-sports-field':  ['running track', 'athletics track', 'football pitch', 'sports field'],
    'si-yuan-amphitheatre':                ['Si Yuan']
  };

  // -------------------------------------------------------------------------
  // EXTRA PLACES — searchable destinations OpenStreetMap does not have.
  //
  // The extracted list is good but not complete: campus gates, the post
  // office and the swimming pool are all missing, for instance. Add them
  // here rather than editing data/places.generated.js, which is overwritten
  // every time the extractor runs.
  //
  // `elevation` is metres above sea level and is required — it drives the
  // walking estimate. Read it off a nearby building in places.generated.js
  // if you do not have a better source.
  //
  //   { id: 'main-gate', name: 'Main Gate', nameZh: '正門',
  //     aliases: ['gate'], lat: 22.0000, lng: 114.0000, elevation: 0 }
  // -------------------------------------------------------------------------
  var extraPlaces = [
  ];

  // -------------------------------------------------------------------------
  // Assembly. Shuttle stops are also valid destinations, so they get folded
  // into the searchable places list.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // FOOD SEARCH TERMS
  //
  // So that somebody looking for lunch can type "canteen" or "食堂" and find
  // one, instead of having to already know that the place they want is called
  // "Café 12" or "The Harmony".
  //
  // These are added as aliases, which means they work through the same fuzzy
  // search as everything else — no separate mode, no category picker to learn.
  // -------------------------------------------------------------------------
  var foodSearchTerms = {
    restaurant:  ['restaurant', 'canteen', 'food', 'eat', 'lunch', 'dinner', '餐廳', '食堂', '膳堂'],
    canteen:     ['canteen', 'restaurant', 'food', 'eat', 'lunch', 'dinner', '餐廳', '食堂', '膳堂'],
    food_court:  ['food court', 'canteen', 'food', 'eat', 'lunch', '美食廣場', '食堂'],
    fast_food:   ['fast food', 'canteen', 'food', 'eat', 'lunch', '快餐', '食堂'],
    cafe:        ['cafe', 'café', 'coffee', 'food', 'eat', '咖啡', '咖啡室'],
    bakery:      ['bakery', 'bread', 'food', 'eat', '麵包'],
    ice_cream:   ['ice cream', 'dessert', 'food', '雪糕'],
    bar:         ['bar', 'drinks', 'pub'],
    pub:         ['pub', 'bar', 'drinks'],
    convenience: ['convenience store', 'shop', 'snacks', '便利店'],
    supermarket: ['supermarket', 'groceries', 'shop', '超級市場', '超市'],
    deli:        ['deli', 'food', 'shop'],
    coffee:      ['coffee', 'cafe', '咖啡']
  };

  var generated = (root.CUHK_PLACES_GENERATED || []).map(function (p) {
    return {
      id: p.id,
      name: p.name,
      nameZh: p.nameZh,
      aliases: (placeAliases[p.id] || []).slice()
        .concat(p.food ? (foodSearchTerms[p.food.category] || []) : []),
      lat: p.lat,
      lng: p.lng,
      elevation: p.elevation,
      source: 'osm',
      stopId: null,
      // Present only on places that sell food: { category, cuisine, hours }.
      food: p.food || null
    };
  });

  // Shuttle stops are valid destinations too. Most of them already exist in
  // the OSM list under the same name, so tag those rather than adding a second
  // entry — otherwise "Science Centre" returns the same building twice and the
  // user has to guess which one to tap.
  function nameKey(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
  }

  /**
   * Drop stop aliases that already appear in the stop's own name.
   *
   * "Wu Yee Sun" as an alias of the stop "Wu Yee Sun College (Upward)" adds
   * nothing — the name already matches — but it does add an *exact alias*
   * match, which outranks the prefix match on the actual college building. The
   * result is that searching "wu yee sun" offers you a boarding stop instead
   * of the college. Genuine shorthand like "WYS" survives; restatements of the
   * name do not.
   */
  function usefulAliases(stop) {
    var name = nameKey(stop.name);
    return (stopAliases[stop.id] || []).filter(function (a) {
      return name.indexOf(nameKey(a)) === -1;
    });
  }

  var byName = {};
  generated.forEach(function (p) {
    var k = nameKey(p.name);
    if (k && !byName[k]) byName[k] = p;
  });

  var extraStopPlaces = [];
  stops.forEach(function (s) {
    var match = byName[nameKey(s.name)];
    if (match) {
      // Same place, already searchable — record that a shuttle stops here and
      // fold in the stop's own nicknames.
      match.stopId = s.id;
      match.source = 'osm+stop';
      usefulAliases(s).forEach(function (a) {
        if (match.aliases.indexOf(a) === -1) match.aliases.push(a);
      });
      return;
    }
    extraStopPlaces.push({
      id: 'stop:' + s.id,
      name: s.name,
      nameZh: s.nameZh,
      aliases: usefulAliases(s).concat(['bus stop', 'shuttle stop']),
      lat: s.lat,
      lng: s.lng,
      elevation: s.elevation,
      source: 'stop',
      stopId: s.id
    });
  });

  // Road geometry and the walking network, from scripts/extract-geometry.js.
  // Optional: without it the map falls back to straight lines between stops
  // and everything else still works.
  var shapes = root.CUHK_SHAPES_GENERATED || { routeShapes: {}, walkGraph: null };

  root.SHUTTLE_DATA = {
    meta: meta,
    routeShapes: shapes.routeShapes,
    walkGraph: shapes.walkGraph,
    config: config,
    stops: stops,
    routes: routes,
    places: generated.concat(extraStopPlaces).concat(extraPlaces.map(function (p) {
      return {
        id: p.id, name: p.name, nameZh: p.nameZh || null,
        aliases: p.aliases || [], lat: p.lat, lng: p.lng,
        elevation: p.elevation, source: 'manual', stopId: p.stopId || null
      };
    })),
    attribution: 'Stop and place data © OpenStreetMap contributors (ODbL). Elevations from SRTM via OpenTopoData. Timetable © The Chinese University of Hong Kong, Transport Office.'
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
