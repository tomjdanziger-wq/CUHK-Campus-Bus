/* ---------------------------------------------------------------------------
 * geo.js — distance and the walking-time model.
 *
 * There is no routing API here, on purpose: no keys, no backend, no network.
 * Everything is computed from coordinates and elevations in the data file.
 *
 * THE MODEL, STATED PLAINLY
 * -------------------------
 *   1. Straight-line (haversine) distance between two points.
 *   2. Multiplied by a detour factor to approximate the real path network.
 *   3. Converted to time with Tobler's hiking function, using the average
 *      gradient between the two points.
 *   4. Widened into a range, because a point estimate would be a lie.
 *
 * WHERE THE MODEL IS WRONG
 * ------------------------
 *   • It uses the *average* gradient. A route that goes down 40 m and then
 *     back up 40 m looks flat to this model and is not. On CUHK's terraced
 *     campus this makes some estimates optimistic.
 *   • It knows nothing about stairs, lifts, covered walkways or the fact that
 *     some direct-looking lines are blocked by a building or a cliff.
 *   • The detour factor is one constant for the whole campus.
 *
 * These are acceptable because the output is presented as a wide range and
 * the user makes the decision. They would not be acceptable if the app
 * claimed precision. It must not.
 * ------------------------------------------------------------------------- */

(function (root) {
  'use strict';

  var EARTH_RADIUS_M = 6371000;

  function toRad(deg) { return deg * Math.PI / 180; }

  /** Great-circle distance in metres. */
  function haversineMetres(a, b) {
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var lat1 = toRad(a.lat);
    var lat2 = toRad(b.lat);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * Tobler's hiking function.
   *   v = 6 · exp(−3.5 · |slope + 0.05|)  km/h
   * where slope is rise/run (dimensionless, +ve uphill).
   *
   * Peaks at slope = −0.05 (a gentle downhill) and falls away sharply uphill,
   * which is the right shape for this campus. `calibration` scales the whole
   * curve down to a realistic student pace.
   */
  function toblerSpeedKmh(slope, calibration) {
    return 6 * Math.exp(-3.5 * Math.abs(slope + 0.05)) * calibration;
  }

  /**
   * Estimate a walk between two points that each carry {lat, lng, elevation}.
   *
   * Returns:
   *   { minutes, low, high, metres, climb, descent, deltaElevation, gradient }
   * where `minutes` is the point estimate used for ranking and low/high are
   * what we actually show a human.
   */
  function walk(from, to, cfg) {
    var w = cfg.walking;
    var straight = haversineMetres(from, to);
    var horizontal = straight * w.detourFactor;

    var fromEl = typeof from.elevation === 'number' ? from.elevation : 0;
    var toEl = typeof to.elevation === 'number' ? to.elevation : 0;
    var delta = toEl - fromEl;

    // Guard the degenerate case: two points at the same coordinate but with
    // different elevations would otherwise produce an infinite gradient.
    var gradient = horizontal > 5 ? delta / horizontal : 0;

    var speedKmh = toblerSpeedKmh(gradient, w.toblerCalibration);
    var speedMPerMin = (speedKmh * 1000) / 60;

    // Slope-adjusted path length: walking up a 20% grade covers slightly more
    // ground than the horizontal projection suggests.
    var pathLength = Math.sqrt(horizontal * horizontal + delta * delta);

    var minutes = speedMPerMin > 0 ? pathLength / speedMPerMin : 0;
    minutes = Math.max(w.minimumMinutes, minutes);

    return {
      minutes: minutes,
      low: minutes * w.rangeLow,
      high: minutes * w.rangeHigh,
      metres: Math.round(horizontal),
      deltaElevation: Math.round(delta),
      climb: delta > 0 ? Math.round(delta) : 0,
      descent: delta < 0 ? Math.round(-delta) : 0,
      gradient: gradient
    };
  }

  /**
   * Ride time along a route, from stop index `i` to stop index `j`.
   *
   * Prefers the route's own `segmentMinutes` (real published running times).
   * Falls back to a distance estimate only when that field is missing — this
   * fallback is a rough guess and the caller flags it in the UI.
   */
  function ride(route, i, j, stopsById, cfg) {
    var b = cfg.bus;

    if (Array.isArray(route.segmentMinutes) &&
        route.segmentMinutes.length === route.stops.length - 1) {
      var total = 0;
      for (var k = i; k < j; k++) total += route.segmentMinutes[k];
      return { minutes: total, estimated: false };
    }

    var metres = 0;
    for (var s = i; s < j; s++) {
      metres += haversineMetres(stopsById[route.stops[s]], stopsById[route.stops[s + 1]]);
    }
    metres *= b.roadDetourFactor;

    var driving = (metres / 1000) / b.fallbackSpeedKmh * 60;
    var dwell = Math.max(0, j - i - 1) * (b.dwellSecondsPerStop / 60);
    return { minutes: driving + dwell, estimated: true };
  }

  /**
   * Estimate the elevation of an arbitrary coordinate (a GPS fix, a dropped
   * pin) by inverse-distance weighting the k nearest known points.
   *
   * This matters more than it sounds. Elevation drives the whole walking
   * model, and a GPS fix arrives without one. Defaulting to 0 m would put the
   * user at sea level while standing outside New Asia at 146 m, and every
   * estimate on the screen would be wrong in the same direction.
   *
   * IDW is crude on terraced ground, but the reference points are dense — a
   * few hundred buildings across a small campus — so it is good to within a
   * few metres almost everywhere, which is well inside our error bars.
   */
  function estimateElevation(point, referencePoints, k) {
    if (!referencePoints || !referencePoints.length) return 0;
    k = k || 5;

    var scored = referencePoints
      .map(function (p) {
        return { elevation: p.elevation, d: haversineMetres(point, p) };
      })
      .sort(function (a, b) { return a.d - b.d; })
      .slice(0, k);

    // Standing essentially on top of a known point: just use it.
    if (scored[0].d < 12) return scored[0].elevation;

    var num = 0, den = 0;
    scored.forEach(function (s) {
      var w = 1 / (s.d * s.d);
      num += w * s.elevation;
      den += w;
    });
    return den > 0 ? Math.round(num / den) : 0;
  }

  root.CUHK = root.CUHK || {};
  root.CUHK.geo = {
    haversineMetres: haversineMetres,
    toblerSpeedKmh: toblerSpeedKmh,
    walk: walk,
    ride: ride,
    estimateElevation: estimateElevation
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
