/* ---------------------------------------------------------------------------
 * ridefollow.js — follow a bus ride from GPS fixes.
 *
 * Given the ride so far and one location fix, decide which stops the bus has
 * reached and whether the rider has got off. Pure: no DOM, no storage, no
 * network, so scripts/smoke-test.js can drive simulated rides on every route.
 *
 * The hard part is that campus roads double back on themselves. Route 4
 * passes the United College stop on its way to New Asia and returns to it
 * later; matched on distance alone, GPS logged United College first and
 * skipped New Asia. So the follower tracks how far along the route's road
 * the bus has got — searched forwards only, taking the earliest matching
 * stretch rather than the nearest — and a stop only counts once the bus has
 * reached that stop's point on the road.
 * ------------------------------------------------------------------------- */

(function (root) {
  'use strict';

  var EARTH_R = 6371000;
  function rad(d) { return d * Math.PI / 180; }

  function metres(a, b) {
    var dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Metres from p to the segment a–b, on a local flat projection. */
  function distToSegment(p, a, b) {
    var kx = 111320 * Math.cos(rad(p.lat)), ky = 110540;
    var ax = (a[1] - p.lng) * kx, ay = (a[0] - p.lat) * ky;
    var bx = (b[1] - p.lng) * kx, by = (b[0] - p.lat) * ky;
    var dx = bx - ax, dy = by - ay;
    var len = dx * dx + dy * dy;
    var u = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    var x = ax + u * dx, y = ay + u * dy;
    return Math.sqrt(x * x + y * y);
  }

  /** Compass bearing a → b in degrees. */
  function bearing(aLat, aLng, bLat, bLng) {
    var y = Math.sin(rad(bLng - aLng)) * Math.cos(rad(bLat));
    var x = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) -
            Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLng - aLng));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function angleBetween(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  /** Distance along the road to each vertex, computed once per shape. */
  function along(shape) {
    if (shape._along) return shape._along;
    var cum = [0];
    for (var k = 1; k < shape.line.length; k++) {
      cum.push(cum[k - 1] + metres({ lat: shape.line[k - 1][0], lng: shape.line[k - 1][1] },
                                   { lat: shape.line[k][0], lng: shape.line[k][1] }));
    }
    Object.defineProperty(shape, '_along', { value: cum, enumerable: false });
    return cum;
  }

  /**
   * { k: earliest road segment ahead within `tolerance` (-1 if none),
   *   d: metres to the nearest stretch, a little behind included }.
   */
  function progress(shape, p, from, tolerance, maxJump, heading, nearJump) {
    var line = shape.line, cum = along(shape);
    var last = line.length - 2;
    var start = Math.max(0, Math.min(from, last));
    // Only as far ahead as a bus could plausibly have got since the last
    // good fix. Without this, one wild fix near a later stretch of a looping
    // road threw the position far ahead, and every real fix after it looked
    // like the rider walking off.
    var end = start;
    while (end < last && cum[end + 1] - cum[start] <= maxJump) end++;
    var first = -1, nearest = Infinity;
    for (var k = start; k <= end; k++) {
      var d = distToSegment(p, line[k], line[k + 1]);
      // "How far off the road" only looks at the road just ahead. The match
      // search widens while the bus is unaccounted for, and on a looping
      // route the wide search soon reaches some other stretch near anyone
      // walking away.
      if (d < nearest && cum[k] - cum[start] <= nearJump) nearest = d;
      if (first >= 0 || d > tolerance) continue;
      // Going the right way along it? Roads that go out and back (Route 4
      // near C.W. Chu) put both directions within reach of the same fix;
      // only the one matching the direction of travel is where the bus is.
      if (heading !== null) {
        var segHeading = bearing(line[k][0], line[k][1], line[k + 1][0], line[k + 1][1]);
        var segLen = metres({ lat: line[k][0], lng: line[k][1] }, { lat: line[k + 1][0], lng: line[k + 1][1] });
        if (segLen > 3 && angleBetween(segHeading, heading) > 75) continue;
      }
      first = k;
    }
    // A fix lagging behind the bus is not the rider walking away.
    for (var kb = Math.max(0, start - 30); kb < start; kb++) {
      nearest = Math.min(nearest, distToSegment(p, line[kb], line[kb + 1]));
    }
    return { k: first, d: nearest, metresAhead: first >= 0 ? cum[first] - cum[start] : 0 };
  }

  /**
   * One GPS fix.
   *
   *   follower  { progress, offRoute } — carried between calls, mutated
   *   ride      { i } — index on the route of the last stop reached
   *   fix       { lat, lng, accuracy }
   *   route     { stops: [stopId...] }
   *   shape     { line: [[lat,lng]...], stopIndices: [...] } or null
   *   stopsById { id: { lat, lng } }
   *   cfg       config.tracking
   *
   * Returns { arrived: stop index or -1, gotOff: bool, usable: bool,
   *           resumedAfter: stop index or -1 }.
   *
   * `resumedAfter` is set when tracking picks the ride up again after a gap
   * (the app was closed, the screen locked, GPS lost): the index of the last
   * stop the bus has already passed. Those in between were not seen, so
   * they are skipped — never given invented times.
   */
  function step(follower, ride, fix, route, shape, stopsById, cfg) {
    var out = { arrived: -1, gotOff: false, usable: false, resumedAfter: -1 };
    var acc = fix.accuracy || 999;
    // Too vague to tell neighbouring stops apart.
    if (acc > cfg.gpsMaxAccuracyMetres) return out;
    out.usable = true;

    var p = { lat: fix.lat, lng: fix.lng };
    var idx = shape && shape.stopIndices;
    var hasShape = shape && shape.line && shape.line.length > 1;

    var now = fix.time || Date.now();
    if (typeof follower.progress !== 'number') {
      follower.progress = idx && typeof idx[ride.i] === 'number' ? Math.max(0, idx[ride.i] - 2) : 0;
    }

    // A gap: no fix has matched the road for a while. While the app was
    // closed the bus kept driving, so the position we have is stale — find
    // where it is now before judging anything (see resume below).
    if (typeof follower.lastMatchAt === 'number' && now - follower.lastMatchAt > cfg.gpsResumeGapSeconds * 1000) {
      follower.resuming = true;
    }
    if (follower.resuming && hasShape && resume(follower, ride, p, acc, shape, cfg, out)) {
      follower.lastMatchAt = now;
      follower.last = p;
    }
    // Direction of travel, measured from the last fix that matched the road
    // — so one wild fix cannot turn the bus round.
    var heading = null;
    if (follower.last && metres(follower.last, p) >= Math.max(12, acc * 0.6)) {
      heading = bearing(follower.last.lat, follower.last.lng, p.lat, p.lng);
    }

    // If recent fixes have not matched the road, the bus has still been
    // moving: let the search reach further ahead each time.
    var jump = cfg.gpsMaxJumpMetres * (1 + Math.min(4, follower.stuck || 0));
    var prog = hasShape
      ? progress(shape, p, follower.progress, Math.max(30, acc), jump, heading, cfg.gpsMaxJumpMetres)
      : null;

    if (prog && prog.k >= 0) {
      // A big leap along the road needs a second fix agreeing with it. A
      // single stray fix beside a later stretch of a looping road otherwise
      // moved the bus hundreds of metres ahead of where it really was.
      if (prog.metresAhead > cfg.gpsConfirmJumpMetres &&
          !(typeof follower.pending === 'number' && Math.abs(prog.k - follower.pending) <= 25)) {
        follower.pending = prog.k;
        follower.stuck = (follower.stuck || 0) + 1;
      } else {
        follower.progress = prog.k;
        follower.pending = null;
        follower.stuck = 0;
        follower.lastMatchAt = now;
        if (!follower.last || metres(follower.last, p) >= Math.max(12, acc * 0.6)) follower.last = p;
      }
    } else if (prog) {
      follower.stuck = (follower.stuck || 0) + 1;
    }

    // Arrived? Close to a stop, and the bus has reached that stop's point on
    // the road. Looks a few stops ahead, in case one was driven past.
    var reach = Math.max(25, Math.min(cfg.gpsStopRadiusMetres, acc * 0.8 + 15));
    var lastIdx = route.stops.length - 1;
    var fromI = out.resumedAfter >= 0 ? out.resumedAfter : ride.i;
    for (var j = fromI + 1; j <= Math.min(fromI + 3, lastIdx); j++) {
      var st = stopsById[route.stops[j]];
      if (!st) continue;
      // Measured to where the stop sits ON THE ROAD, not to its map pin.
      // Some pins are well off the carriageway — Campus Circuit East is 64 m
      // from the road the buses drive — and a phone on the bus never gets
      // within reach of those.
      var k = idx && idx[j];
      var target = typeof k === 'number' && hasShape ? { lat: shape.line[k][0], lng: shape.line[k][1] } : st;
      if (metres(p, target) > reach) continue;
      // Slack for the road position trailing the fix by a few vertices — not
      // enough to let Route 4's early pass of United College (23 vertices
      // before its stop) through.
      if (idx && typeof idx[j] === 'number' && follower.progress < idx[j] - 12) continue;
      out.arrived = j;
      follower.offRoute = 0;
      break;
    }

    // Got off? Several good fixes in a row well away from the road ahead.
    // One stray fix is GPS; three in a row is someone walking off.
    if (follower.resuming) {
      follower.offRoute = 0;          // not until we know where the bus is
    } else if (prog && acc <= 40 && prog.d > cfg.gpsOffRouteMetres) {
      follower.offRoute = (follower.offRoute || 0) + 1;
    } else if (!prog || prog.d <= cfg.gpsOffRouteMetres) {
      follower.offRoute = 0;          // consecutive, or it is not walking off
    }
    out.gotOff = follower.offRoute >= 3;
    return out;
  }

  /**
   * Pick the ride up again after a gap. Looks along the whole rest of the
   * route for the earliest stretch of road this fix is on, and needs a second
   * fix to agree before moving there. If three fixes find no road at all, the
   * rider has most likely got off while tracking was away: stop resuming and
   * let the usual "got off" check decide. Returns true once resumed.
   */
  function resume(follower, ride, p, acc, shape, cfg, out) {
    var line = shape.line, idx = shape.stopIndices || [];
    var tol = Math.max(35, acc);
    var found = -1;
    for (var k = Math.max(0, follower.progress); k < line.length - 1; k++) {
      if (distToSegment(p, line[k], line[k + 1]) <= tol) { found = k; break; }
    }
    if (found < 0) {
      follower.resumeMisses = (follower.resumeMisses || 0) + 1;
      follower.resumePending = null;
      if (follower.resumeMisses >= 3) { follower.resuming = false; follower.resumeMisses = 0; }
      return false;
    }
    if (!(typeof follower.resumePending === 'number' && Math.abs(found - follower.resumePending) <= 30)) {
      follower.resumePending = found;
      return false;
    }

    follower.progress = found;
    follower.resuming = false;
    follower.resumePending = null;
    follower.resumeMisses = 0;
    follower.pending = null;
    follower.stuck = 0;
    follower.offRoute = 0;

    // Every stop clearly behind this point was passed while we were away. The
    // one the bus is at or approaching stays loggable.
    var passed = ride.i;
    for (var j = ride.i + 1; j < idx.length; j++) {
      if (typeof idx[j] === 'number' && idx[j] < found - 3) passed = j; else break;
    }
    if (passed > ride.i) out.resumedAfter = passed;
    return true;
  }

  /** After a manual tap or skip: carry on from that stop's point on the road. */
  function syncToStop(follower, shape, i) {
    var k = shape && shape.stopIndices && shape.stopIndices[i];
    if (typeof k === 'number' && (typeof follower.progress !== 'number' || k - 2 > follower.progress)) {
      follower.progress = k - 2;
      follower.stuck = 0;
      follower.pending = null;
      follower.resuming = false;
      follower.last = { lat: shape.line[k][0], lng: shape.line[k][1] };
    }
  }

  root.CUHK = root.CUHK || {};
  root.CUHK.rideFollow = { step: step, syncToStop: syncToStop, distToSegment: distToSegment };

})(typeof globalThis !== 'undefined' ? globalThis : this);
