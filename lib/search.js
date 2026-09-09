/* ---------------------------------------------------------------------------
 * search.js — fuzzy matching over place names, Chinese names and aliases.
 *
 * Small enough (~560 places) to score everything on every keystroke. No index,
 * no library. If the place list ever grows past a few thousand, revisit.
 *
 * Scoring, highest first:
 *   exact match          1000
 *   alias exact           950   ("UC" must beat "University Cafeteria")
 *   prefix match          800
 *   word-start match      700   ("science" hits "University Science Centre")
 *   substring             500
 *   subsequence (typos)   250
 * with small bonuses for shorter names and for being an actual shuttle stop.
 * ------------------------------------------------------------------------- */

(function (root) {
  'use strict';

  function normalise(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[.'’]/g, '')
      .replace(/[^\w一-鿿]+/g, ' ')
      .trim();
  }

  /** Are all of `needle`'s characters present in `hay`, in order? */
  function isSubsequence(needle, hay) {
    var i = 0;
    for (var j = 0; j < hay.length && i < needle.length; j++) {
      if (hay[j] === needle[i]) i++;
    }
    return i === needle.length;
  }

  function scoreField(query, field, isAlias) {
    if (!field) return 0;
    var f = normalise(field);
    if (!f) return 0;

    if (f === query) return isAlias ? 950 : 1000;
    if (f.indexOf(query) === 0) return 800;

    // Word-start: "science" matching "university science centre".
    var words = f.split(' ');
    for (var i = 1; i < words.length; i++) {
      if (words[i].indexOf(query) === 0) return 700;
    }

    // Initialism: "ycc" matching "yasumoto china centre".
    if (query.length >= 2 && words.length >= query.length) {
      var initials = words.map(function (w) { return w[0]; }).join('');
      if (initials.indexOf(query) === 0) return 720;
    }

    if (f.indexOf(query) !== -1) return 500;
    if (query.length >= 3 && isSubsequence(query, f)) return 250;
    return 0;
  }

  /**
   * Rank places against a query string.
   * `places` is the merged list from the data file.
   */
  function search(query, places, limit) {
    var q = normalise(query);
    if (!q) return [];

    var results = [];

    for (var i = 0; i < places.length; i++) {
      var p = places[i];
      var best = 0;
      var matched = null;

      var s = scoreField(q, p.name, false);
      if (s > best) { best = s; matched = p.name; }

      s = scoreField(q, p.nameZh, false);
      if (s > best) { best = s; matched = p.nameZh; }

      if (p.aliases) {
        for (var a = 0; a < p.aliases.length; a++) {
          s = scoreField(q, p.aliases[a], true);
          if (s > best) { best = s; matched = p.aliases[a]; }
        }
      }

      if (!best) continue;

      // Prefer concise names — "United College" over "United College Coffee Bar".
      best += Math.max(0, 40 - normalise(p.name).length) * 0.6;
      // Nudge actual shuttle stops up; they are usually what someone means.
      if (p.stopId) best += 30;

      results.push({ place: p, score: best, matched: matched });
    }

    results.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.place.name.localeCompare(b.place.name);
    });

    return results.slice(0, limit || 8);
  }

  root.CUHK = root.CUHK || {};
  root.CUHK.search = { search: search, normalise: normalise };

})(typeof globalThis !== 'undefined' ? globalThis : this);
