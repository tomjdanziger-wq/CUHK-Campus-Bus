/* ===========================================================================
 *
 *   ⚠  PLACEHOLDER TIMETABLE  ⚠
 *
 *   The STOPS geometry below is real (coordinates and elevations came out of
 *   OpenStreetMap + SRTM). The ROUTES — their stop sequences, departure times,
 *   segment durations and service days — are INVENTED PLACEHOLDERS. They are
 *   plausible-looking so the app can be demonstrated, which makes them
 *   dangerous if shipped as-is.
 *
 *   Before deploying for real:
 *     1. Replace `routes` with the published CUHK shuttle timetable.
 *     2. Check every stop in `stops` actually exists and is where we say.
 *     3. Set  meta.isPlaceholder = false   and update  meta.validFrom / validUntil.
 *
 *   While `meta.isPlaceholder` is true the app shows a permanent red warning
 *   banner. That is intentional. Do not remove the banner instead of the flag.
 *
 *   This is the ONLY file you need to edit each term.
 *
 * =========================================================================== */

(function (root) {
  'use strict';

  // -------------------------------------------------------------------------
  // META — shown in the UI so users can tell whether the data is stale.
  // -------------------------------------------------------------------------
  var meta = {
    isPlaceholder: true,                 // ← set to false once real data is in
    timetableLabel: 'Placeholder timetable (not the real CUHK schedule)',
    validFrom: '2026-09-01',
    validUntil: '2026-12-31',
    sourceUrl: 'https://www.cuhk.edu.hk/campus-shuttle/',
    lastUpdated: '2026-09-09'
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
  // STOPS
  //
  // Coordinates and elevations are real (OSM + SRTM 30m). Elevation is in
  // metres above sea level and is REQUIRED — it drives the walking estimate.
  // Whether the shuttle genuinely stops at each of these is placeholder.
  // -------------------------------------------------------------------------
  var stops = [
    { id: 'univ-station',    name: 'University MTR Station',        nameZh: '大學站',       lat: 22.414143, lng: 114.210574, elevation: 6 },
    { id: 'chung-chi',       name: 'Chung Chi College',             nameZh: '崇基學院',     lat: 22.415153, lng: 114.208991, elevation: 6 },
    { id: 'pommerenke',      name: 'Pommerenke Student Centre',     nameZh: '龐萬倫學生中心', lat: 22.417074, lng: 114.208995, elevation: 20 },
    { id: 'sh-ho',           name: 'S.H. Ho / Morningside College', nameZh: '善衡 / 晨興書院', lat: 22.418297, lng: 114.210103, elevation: 53 },
    { id: 'science-centre',  name: 'University Science Centre',     nameZh: '科學館',       lat: 22.419516, lng: 114.207990, elevation: 107 },
    { id: 'run-run-shaw',    name: 'Sir Run Run Shaw Hall',         nameZh: '邵逸夫堂',     lat: 22.420148, lng: 114.207159, elevation: 103 },
    { id: 'univ-admin',      name: 'University Administration Bldg', nameZh: '大學行政樓',   lat: 22.418964, lng: 114.205291, elevation: 101 },
    { id: 'univ-library',    name: 'University Library',            nameZh: '大學圖書館',   lat: 22.419570, lng: 114.204778, elevation: 109 },
    { id: 'united-college',  name: 'United College',                nameZh: '聯合書院',     lat: 22.421972, lng: 114.205157, elevation: 128 },
    { id: 'new-asia',        name: 'New Asia College',              nameZh: '新亞書院',     lat: 22.421227, lng: 114.209053, elevation: 146 },
    { id: 'chan-chun-ha',    name: 'Chan Chun Ha Hostel',           nameZh: '陳震夏宿舍',   lat: 22.422032, lng: 114.204955, elevation: 120 },
    { id: 'lee-woo-sing',    name: 'Lee Woo Sing College',          nameZh: '和聲書院',     lat: 22.422427, lng: 114.204285, elevation: 79 },
    { id: 'wu-yee-sun',      name: 'Wu Yee Sun College',            nameZh: '伍宜孫書院',   lat: 22.422231, lng: 114.202623, elevation: 94 },
    { id: 'shaw-college',    name: 'Shaw College',                  nameZh: '逸夫書院',     lat: 22.423044, lng: 114.201430, elevation: 68 },
    { id: 'cw-chu',          name: 'C. W. Chu College',             nameZh: '敬文書院',     lat: 22.425248, lng: 114.206510, elevation: 24 },
    { id: 'postgrad-halls',  name: 'Postgraduate Halls (Area 39)',  nameZh: '研究生宿舍(三十九區)', lat: 22.426018, lng: 114.206271, elevation: 12 }
  ];

  // -------------------------------------------------------------------------
  // ROUTES  —  ⚠ ENTIRELY PLACEHOLDER ⚠
  //
  //   stops             ordered stop ids; the bus travels first → last
  //   departureMinutes  minutes past the hour, departing the FIRST stop
  //   firstDeparture    earliest departure from the first stop  (HH:MM)
  //   lastDeparture     latest departure from the first stop    (HH:MM)
  //   runsOn            'mon-fri' | 'mon-sat' | 'sat' | 'sun-ph' | 'daily'
  //   segmentMinutes    OPTIONAL. Ride time for each hop; length must be
  //                     stops.length - 1. Omit it and the app falls back to a
  //                     distance-and-gradient estimate, which is worse. Fill
  //                     this in if you have real running times.
  //   notes             free text, shown on the option card
  // -------------------------------------------------------------------------
  var routes = [
    {
      id: '1A',
      name: 'Route 1A',
      nameZh: '一號線甲',
      stops: ['univ-station', 'chung-chi', 'pommerenke', 'run-run-shaw', 'univ-admin', 'univ-library', 'united-college', 'chan-chun-ha'],
      segmentMinutes: [2, 2, 4, 2, 1, 3, 2],
      departureMinutes: [0, 20, 40],
      firstDeparture: '07:40',
      lastDeparture: '18:40',
      runsOn: 'mon-sat',
      notes: 'The main uphill spine. Placeholder times.'
    },
    {
      id: '2',
      name: 'Route 2',
      nameZh: '二號線',
      stops: ['univ-station', 'chung-chi', 'sh-ho', 'science-centre', 'new-asia'],
      segmentMinutes: [2, 3, 5, 3],
      departureMinutes: [10, 25, 40, 55],
      firstDeparture: '07:45',
      lastDeparture: '19:10',
      runsOn: 'mon-sat',
      notes: 'Most frequent route to New Asia. Placeholder times.'
    },
    {
      id: '3',
      name: 'Route 3',
      nameZh: '三號線',
      stops: ['univ-station', 'postgrad-halls', 'cw-chu', 'shaw-college', 'wu-yee-sun', 'lee-woo-sing'],
      segmentMinutes: [5, 2, 4, 2, 2],
      departureMinutes: [5, 35],
      firstDeparture: '08:05',
      lastDeparture: '18:35',
      runsOn: 'mon-fri',
      notes: 'North campus. Half-hourly — check the gap before walking down. Placeholder times.'
    },
    {
      id: '4',
      name: 'Route 4',
      nameZh: '四號線',
      stops: ['new-asia', 'science-centre', 'run-run-shaw', 'chung-chi', 'univ-station'],
      segmentMinutes: [3, 2, 4, 2],
      departureMinutes: [15, 45],
      firstDeparture: '08:15',
      lastDeparture: '19:45',
      runsOn: 'mon-sat',
      notes: 'Downhill return to the MTR. Placeholder times.'
    },
    {
      id: '5',
      name: 'Route 5',
      nameZh: '五號線',
      stops: ['shaw-college', 'wu-yee-sun', 'lee-woo-sing', 'chan-chun-ha', 'united-college', 'univ-library', 'science-centre', 'chung-chi', 'univ-station'],
      segmentMinutes: [2, 2, 3, 2, 3, 2, 5, 2],
      departureMinutes: [0, 30],
      firstDeparture: '08:00',
      lastDeparture: '18:30',
      runsOn: 'mon-fri',
      notes: 'Cross-campus, west to the station. Long ride — often faster to change. Placeholder times.'
    },
    {
      id: '8',
      name: 'Route 8',
      nameZh: '八號線',
      stops: ['univ-station', 'science-centre', 'univ-library', 'lee-woo-sing', 'shaw-college'],
      segmentMinutes: [7, 2, 4, 2],
      departureMinutes: [50],
      firstDeparture: '08:50',
      lastDeparture: '17:50',
      runsOn: 'mon-fri',
      notes: 'Express to the west campus, hourly only. Placeholder times.'
    }
  ];

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
    attribution: 'Place data © OpenStreetMap contributors (ODbL). Elevations from SRTM via OpenTopoData.'
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
