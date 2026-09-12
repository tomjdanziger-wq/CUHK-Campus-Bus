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

    var words = f.split(' ');

    // Every query word matches the start of some word in the name, in order.
    //
    // This is what makes "residence 3" find "University Residence Nos. 3"
    // rather than "University Residence No. 13". Plain substring matching
    // fails on both, because "Nos." sits between the words, and then both
    // fall through to fuzzy matching and tie. Matching word by word, "3"
    // starts the word "3" but does not start "13", so the right one wins.
    var qWords = query.split(' ').filter(Boolean);
    if (qWords.length > 1) {
      var at = 0, matched = 0, exact = 0;
      for (var qi = 0; qi < qWords.length; qi++) {
        for (var wi = at; wi < words.length; wi++) {
          if (words[wi].indexOf(qWords[qi]) === 0) {
            if (words[wi] === qWords[qi]) exact++;
            matched++; at = wi + 1; break;
          }
        }
      }
      if (matched === qWords.length) {
        // Reward names where the words matched exactly rather than by prefix.
        return (isAlias ? 900 : 760) + exact * 12;
      }
    }

    // Word-start: "science" matching "university science centre".
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
      var nameBest = 0, aliasBest = 0;
      var matched = null;

      var s = scoreField(q, p.name, false);
      if (s > nameBest) { nameBest = s; matched = p.name; }

      s = scoreField(q, p.nameZh, false);
      if (s > nameBest) { nameBest = s; matched = p.nameZh; }

      if (p.aliases) {
        for (var a = 0; a < p.aliases.length; a++) {
          s = scoreField(q, p.aliases[a], true);
          if (s > aliasBest) { aliasBest = s; if (s > nameBest) matched = p.aliases[a]; }
        }
      }

      var best = Math.max(nameBest, aliasBest);
      if (!best) continue;

      // Matched on both its own name and a category word it was given.
      // Searching "canteen" should reach "Shaw College Student Canteen" before
      // it reaches a noodle bar that is merely tagged as one.
      if (nameBest > 0 && aliasBest > 0) best += 30;

      // Prefer concise names — "United College" over "United College Coffee Bar".
      best += Math.max(0, 40 - normalise(p.name).length) * 0.6;

      // Nudge actual shuttle stops up; they are usually what someone means.
      if (p.stopId) best += 8;

      // ...but not the direction-suffixed halves of a stop pair, unless the
      // query actually asked for a direction. Someone typing "UC" wants United
      // College, not "United College (Upward)" — the boarding side is a
      // decision the planner makes for them once they have picked a
      // destination.
      if (/\((?:up|down)ward\)/i.test(p.name) && !/\b(up|down|upward|downward)\b/.test(query)) {
        best -= 25;
      }

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
