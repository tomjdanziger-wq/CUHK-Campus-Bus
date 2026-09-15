/* ---------------------------------------------------------------------------
 * arrivals.js — turn reports into bus arrivals.
 *
 * Reports are kept exactly as sent; this decides, when they are read, how
 * many buses they describe. Five people reporting the same Night bus at the
 * same stop is one arrival, not five — counted five times it would make one
 * late bus look like five, and skew every punctuality figure. But two Night
 * buses bunched a minute apart are two, and must not be merged.
 *
 * Reports of the same route at the same stop (and the same position on the
 * route, for loops that pass a stop twice) are one arrival when they are
 * within `windowMs` of the one before, and within twice that of the first.
 * Two exceptions split them:
 *
 *   - The same reporter twice. A spotter standing at the stop who taps the
 *     same bus again is telling us a second one came; a ride cannot reach
 *     the same stop twice in one arrival either.
 *   - Too long a chain: the cap on total span stops a stream of reports from
 *     merging a whole evening into one bus.
 *
 * What it cannot do: tell apart two buses under `windowMs` apart when each is
 * reported only by different people. They count as one. Pure — no DOM — so
 * the app, the stats page and the smoke test share it.
 * ------------------------------------------------------------------------- */

(function (root) {
  'use strict';

  /**
   * reports: [{ route, stop, i?, at (ms), reporter? , ...anything }]
   * Returns arrivals, newest first:
   *   [{ route, stop, i, at (median time), first, last, reports: [...], reporters }]
   */
  function group(reports, windowMs) {
    var byKey = {};
    reports.forEach(function (r) {
      if (!r || !r.route || !r.stop || !r.at) return;
      var key = r.route + '|' + r.stop + '|' + (typeof r.i === 'number' ? r.i : '');
      (byKey[key] = byKey[key] || []).push(r);
    });

    var out = [];
    Object.keys(byKey).forEach(function (key) {
      var list = byKey[key].sort(function (a, b) { return a.at - b.at; });
      var cur = null;
      list.forEach(function (r) {
        var fits = cur &&
          r.at - cur.last <= windowMs &&
          r.at - cur.first <= windowMs * 2 &&
          !(r.reporter && cur.seen[r.reporter]);
        if (!fits) {
          cur = { route: r.route, stop: r.stop, i: r.i, first: r.at, last: r.at,
                  reports: [], seen: {}, reporters: 0 };
          out.push(cur);
        }
        cur.reports.push(r);
        cur.last = r.at;
        if (r.reporter) {
          if (!cur.seen[r.reporter]) cur.reporters++;
          cur.seen[r.reporter] = true;
        } else {
          cur.reporters++;
        }
      });
    });

    out.forEach(function (a) {
      var ts = a.reports.map(function (r) { return r.at; }).sort(function (x, y) { return x - y; });
      var m = ts.length >> 1;
      a.at = ts.length % 2 ? ts[m] : (ts[m - 1] + ts[m]) / 2;
      delete a.seen;
    });
    return out.sort(function (a, b) { return b.at - a.at; });
  }

  root.CUHK = root.CUHK || {};
  root.CUHK.arrivals = { group: group };

})(typeof globalThis !== 'undefined' ? globalThis : this);
