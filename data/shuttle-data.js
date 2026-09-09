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
      // path network (stairs, switchbacks, walking round buildings). CUHK is
      // hilly with an indirect path network, so this is higher than the ~1.2
      // you would use for a grid-plan city.
      detourFactor: 1.3,

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
  // Several stops exist as an (Upward)/(Downward) pair on opposite sides of
  // the road. Where OpenStreetMap maps only one of the pair, both share that
  // position — they are metres apart, well inside the walking model's error.
  // -------------------------------------------------------------------------
  var stops = [
    { id: 'univ-station'              , name: "University Station"                   , nameZh: "大學站", lat: 22.414537, lng: 114.210221, elevation:   7 },
    { id: 'station-piazza'            , name: "University Station Piazza"            , nameZh: "港鐵大學站廣場", lat: 22.413808, lng: 114.209437, elevation:  10 },
    { id: 'chung-chi-teaching'        , name: "Chung Chi Teaching Blocks"            , nameZh: "崇基教學樓", lat: 22.416036, lng: 114.208359, elevation:  12 },
    { id: 'yiap'                      , name: "Yasumoto International Academic Park" , nameZh: "康本國際學術園", lat: 22.415973, lng: 114.210832, elevation:  19 },
    { id: 'univ-sports-centre'        , name: "University Sports Centre"             , nameZh: "大學體育中心", lat: 22.417812, lng: 114.210482, elevation:  45 },
    { id: 'sh-ho-college'             , name: "S.H. Ho College"                      , nameZh: "善衡書院", lat: 22.418042, lng: 114.209850, elevation:  49 },
    { id: 'postgrad-hall-1'           , name: "Postgraduate Hall 1"                  , nameZh: "賽馬會研究生宿舍一座", lat: 22.420248, lng: 114.212171, elevation:  32 },
    { id: 'campus-circuit-east-up'    , name: "Campus Circuit East (Upward)"         , nameZh: "環迴東路（上行）", lat: 22.421533, lng: 114.211835, elevation:  55 },  // APPROXIMATE — road-side stop, position not in OSM
    { id: 'campus-circuit-east-down'  , name: "Campus Circuit East (Downward)"       , nameZh: "環迴東路（下行）", lat: 22.421533, lng: 114.211835, elevation:  55 },  // APPROXIMATE — road-side stop, position not in OSM
    { id: 'campus-circuit-north-down' , name: "Campus Circuit North (Downward)"      , nameZh: "環迴北路（下行）", lat: 22.424445, lng: 114.209261, elevation:  11 },  // APPROXIMATE — road-side stop, position not in OSM
    { id: 'sir-run-run-shaw-hall'     , name: "Sir Run Run Shaw Hall"                , nameZh: "邵逸夫堂", lat: 22.419841, lng: 114.206942, elevation: 102 },
    { id: 'science-centre'            , name: "Science Centre"                       , nameZh: "科學館", lat: 22.419830, lng: 114.207342, elevation: 102 },
    { id: 'fung-king-hey'             , name: "Fung King Hey Building"               , nameZh: "馮景禧樓", lat: 22.419864, lng: 114.203032, elevation: 113 },
    { id: 'univ-admin'                , name: "University Administration Building"   , nameZh: "大學行政樓", lat: 22.418806, lng: 114.205358, elevation: 100 },
    { id: 'united-college-up'         , name: "United College (Upward)"              , nameZh: "聯合書院（上行）", lat: 22.420390, lng: 114.205394, elevation: 136 },
    { id: 'united-college-down'       , name: "United College (Downward)"            , nameZh: "聯合書院（下行）", lat: 22.420302, lng: 114.205340, elevation: 133 },
    { id: 'new-asia-college'          , name: "New Asia College"                     , nameZh: "新亞書院", lat: 22.421271, lng: 114.207559, elevation: 142 },
    { id: 'new-asia-circle'           , name: "New Asia Circle"                      , nameZh: "新亞坊", lat: 22.421072, lng: 114.207647, elevation: 141 },
    { id: 'wu-yee-sun-up'             , name: "Wu Yee Sun College (Upward)"          , nameZh: "伍宜孫書院（上行）", lat: 22.421331, lng: 114.203471, elevation: 114 },
    { id: 'wu-yee-sun-down'           , name: "Wu Yee Sun College (Downward)"        , nameZh: "伍宜孫書院（下行）", lat: 22.421199, lng: 114.203521, elevation: 116 },
    { id: 'chan-chun-ha'              , name: "Chan Chun Ha Hostel"                  , nameZh: "陳震夏宿舍", lat: 22.421812, lng: 114.204612, elevation: 119 },
    { id: 'shaw-college-up'           , name: "Shaw College (Upward)"                , nameZh: "逸夫書院（上行）", lat: 22.422486, lng: 114.201315, elevation:  82 },  // up/down stops share one mapped position
    { id: 'shaw-college-down'         , name: "Shaw College (Downward)"              , nameZh: "逸夫書院（下行）", lat: 22.422486, lng: 114.201315, elevation:  82 },  // up/down stops share one mapped position
    { id: 'uc-staff-residence'        , name: "United College Staff Residence"       , nameZh: "聯合苑", lat: 22.423259, lng: 114.205130, elevation:  83 },
    { id: 'residence-15'              , name: "Residence No. 15"                     , nameZh: "十五苑", lat: 22.423716, lng: 114.206598, elevation:  62 },
    { id: 'cw-chu-up'                 , name: "C.W. Chu College (Upward)"            , nameZh: "敬文書院（上行）", lat: 22.425557, lng: 114.206218, elevation:  23 },  // up/down stops share one mapped position
    { id: 'cw-chu-down'               , name: "C.W. Chu College (Downward)"          , nameZh: "敬文書院（下行）", lat: 22.425557, lng: 114.206218, elevation:  23 },  // up/down stops share one mapped position
    { id: 'area-39-up'                , name: "Area 39 (Upward)"                     , nameZh: "三十九區（上行）", lat: 22.427631, lng: 114.204351, elevation:   9 },  // up/down stops share one mapped position
    { id: 'area-39-down'              , name: "Area 39 (Downward)"                   , nameZh: "三十九區（下行）", lat: 22.427631, lng: 114.204351, elevation:   9 },  // up/down stops share one mapped position
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

  var routes = (root.CUHK_ROUTES_GENERATED || []).map(function (r) {
    var seg = rideTimes[r.id];
    return {
      id: r.id,
      name: r.name,
      nameZh: r.nameZh,
      label: r.label,
      stops: r.stops,
      segmentMinutes: (seg && seg.length === r.stops.length - 1) ? seg : null,
      departureMinutes: r.departureMinutes,
      firstDeparture: r.firstDeparture,
      lastDeparture: r.lastDeparture,
      runsOn: r.runsOn,
      notes: r.notes
    };
  });

  // -------------------------------------------------------------------------
  // PLACE ALIASES — hand-maintained, merged over the auto-extracted list.
  //
  // OSM names are the official ones; students use shorthand. Add whatever you
  // hear people actually say. Re-running scripts/extract-places.js never
  // touches this block.
  //
  // Keys are ids from data/places.generated.js.
  // -------------------------------------------------------------------------
  var placeAliases = {
    'united-college':                      ['UC', 'United'],
    'new-asia-college':                    ['NA', 'New Asia'],
    'chung-chi-college':                   ['CC', 'Chung Chi'],
    'shaw-college':                        ['Shaw'],
    'wu-yee-sun-college':                  ['WYS'],
    'lee-woo-sing-college':                ['LWS'],
    'sh-ho-college':                       ['SHHO', 'S.H. Ho'],
    'morningside-college':                 ['MC'],
    'c-w-chu-college':                     ['CWC', 'Chu College'],
    'university-library':                  ['UL', 'Main Library', 'Uni Library'],
    'university-science-centre':           ['Science Centre', 'SC'],
    'yasumoto-international-academic-park': ['YIA', 'Yasumoto'],
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
    'chan-chun-ha-hostel':                 ['CCH']
  };

  // -------------------------------------------------------------------------
  // Assembly. Shuttle stops are also valid destinations, so they get folded
  // into the searchable places list.
  // -------------------------------------------------------------------------
  var generated = (root.CUHK_PLACES_GENERATED || []).map(function (p) {
    return {
      id: p.id,
      name: p.name,
      nameZh: p.nameZh,
      aliases: (placeAliases[p.id] || []).slice(),
      lat: p.lat,
      lng: p.lng,
      elevation: p.elevation,
      source: 'osm',
      stopId: null
    };
  });

  // Shuttle stops are valid destinations too. Most of them already exist in
  // the OSM list under the same name, so tag those rather than adding a second
  // entry — otherwise "Science Centre" returns the same building twice and the
  // user has to guess which one to tap.
  function nameKey(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
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
      // Same place, already searchable — just record that a shuttle stops here.
      match.stopId = s.id;
      match.source = 'osm+stop';
      return;
    }
    extraStopPlaces.push({
      id: 'stop:' + s.id,
      name: s.name,
      nameZh: s.nameZh,
      aliases: ['bus stop', 'shuttle stop'],
      lat: s.lat,
      lng: s.lng,
      elevation: s.elevation,
      source: 'stop',
      stopId: s.id
    });
  });

  root.SHUTTLE_DATA = {
    meta: meta,
    config: config,
    stops: stops,
    routes: routes,
    places: generated.concat(extraStopPlaces),
    attribution: 'Stop and place data © OpenStreetMap contributors (ODbL). Elevations from SRTM via OpenTopoData. Timetable © The Chinese University of Hong Kong, Transport Office.'
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
