#!/usr/bin/env python3
"""
extract-timetable.py — turn the CUHK Transport Office route PDFs into route data.

WHY THIS EXISTS
    The Transport Office publishes each shuttle route as a web page. Saved to
    PDF, those pages contain the real service hours, departure minutes, service
    days and stop sequence — but as a *diagram*, not a table, in subsetted
    fonts whose digits are glyph indices rather than characters. Retyping all
    of that by hand each term is how mistakes get made.

USAGE
    Save each route page from https://www.cuhk.edu.hk/campus-shuttle/ as a PDF
    into this directory, then:

        python3 scripts/extract-timetable.py *.pdf > data/routes.generated.js

HOW THE DIAGRAM IS READ
    Each route is drawn as a tall loop:

        [ left column ]              [ right column ]
        top    ^  ...  ─── across the top ───  ...  │  top
               │                                    v
        bottom │                                    │  bottom
             [ bottom row: first stop … last stop ]

    The bus leaves the bottom row, climbs the LEFT column bottom-to-top,
    crosses the top, and descends the RIGHT column top-to-bottom.

    Three independent checks confirm that reading:
      1. The "First Stop" badge is drawn at the left end of the bottom row and
         the "Last Stop" badge at the right end — the ends adjacent to the
         upward and downward columns respectively.
      2. Route 1 decodes to the known Main Campus circuit.
      3. Stop elevations rise monotonically up the left column and fall
         monotonically down the right one, on every route. A campus loop that
         goes up one side and down the other cannot read any other way.

    Check 3 is re-run automatically by --validate, using the elevations in
    data/shuttle-data.js, so a future timetable change that breaks the
    assumption will be noticed rather than silently mis-parsed.

WHAT IT CANNOT GET
    Running times between stops. The published pages only give departure
    minutes from the first stop, so `segmentMinutes` is left absent and the
    app estimates the ride from distance and gradient. If the Transport Office
    ever publishes per-stop times, add them to data/shuttle-data.js.
"""

import re, sys, os, json, unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _pdfpos as P

# ---------------------------------------------------------------------------
# Text repair
#
# The PDFs mangle ligatures and smart quotes: the "ff" ligature comes back as
# whatever glyph slot it landed in (!, # or % depending on the file), and the
# curly quotes arrive as Ô/Õ.
# ---------------------------------------------------------------------------

def clean(s):
    s = s.replace('Ô', '‘').replace('Õ', '’').replace('Ð', '–')
    s = s.replace('＃', '#')
    s = re.sub(r'(?<=[A-Za-z])[!#%](?=[A-Za-z ])', 'ff', s)   # Sta!  -> Staff
    s = re.sub(r'\s+', ' ', s)
    return s.strip()

# PDF label -> stop id in data/shuttle-data.js
STOP_IDS = {
    'univ. station': 'univ-station',
    'station piazza': 'station-piazza',
    'chung chi teaching bldg.': 'chung-chi-teaching',
    'y.i.a.p.': 'yiap',
    'univ. sports centre': 'univ-sports-centre',
    's.h. ho college': 'sh-ho-college',
    'postgraduate hall 1': 'postgrad-hall-1',
    'campus circuit east (upward)': 'campus-circuit-east-up',
    'campus circuit east (downward)': 'campus-circuit-east-down',
    'campus circuit north (downward)': 'campus-circuit-north-down',
    'sir run run shaw hall': 'sir-run-run-shaw-hall',
    'science centre': 'science-centre',
    'fung king hey bldg.': 'fung-king-hey',
    'univ. admin. bldg.': 'univ-admin',
    'united college (upward)': 'united-college-up',
    'united college (downward)': 'united-college-down',
    'new asia college': 'new-asia-college',
    'new asia circle': 'new-asia-circle',
    'wu yee sun college (upward)': 'wu-yee-sun-up',
    'wu yee sun college (downward)': 'wu-yee-sun-down',
    'chan chun ha hostel': 'chan-chun-ha',
    'shaw college (upward)': 'shaw-college-up',
    'shaw college (downward)': 'shaw-college-down',
    'u.c. staff residence': 'uc-staff-residence',
    'residence no. 15': 'residence-15',
    'cw chu college (upward)': 'cw-chu-up',
    'cw chu college (downward)': 'cw-chu-down',
    'area 39 (upward)': 'area-39-up',
    'area 39 (downward)': 'area-39-down',
    # Campus Circuit North is printed without a direction suffix; only the
    # downward stop is ever served.
    'campus circuit north': 'campus-circuit-north-down',
}

ROUTE_NAMES_ZH = {
    '1': '本部線', '2': '新亞聯合線', '2S': '新亞聯合線 (S)', '3': '逸夫線',
    '4': '環校線', '8': '西部校園線', 'N': '夜間線', 'H': '假日線',
}

NOTE_RE = re.compile(r'buses departing|days only|teaching days', re.I)
SKIP_RE = re.compile(
    r'^(route|normal service|service delay|service suspension|non-service hours|'
    r'first stop|last stop|special arrangement|temporarily closed|ns|s|n|h|a|\||'
    r'english|繁|简|\d+|\d+s|minute|only)$', re.I)

# ---------------------------------------------------------------------------

def merged_runs(path):
    """Text runs, deduplicated by position and repaired."""
    out = {}
    for r in P.extract_runs(path):
        k = (round(r['x'] / 3), round(r['y'] / 3))
        out.setdefault(k, {'x': r['x'], 'y': r['y'], 'text': ''})
        out[k]['text'] += r['text']
    return [v for v in out.values() if v['text'].strip()]

def find(runs, pattern, flags=re.I):
    for r in runs:
        m = re.search(pattern, clean(r['text']), flags)
        if m: return m
    return None

def meta(runs):
    """Service hours, departure minutes, service days, footnotes."""
    hours = find(runs, r'(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})')
    days_txt = ' '.join(clean(r['text']) for r in runs
                        if re.search(r'For Mon|Sun & Public|Public Holidays', clean(r['text'])))

    # The minute list sits to the right of the "Departure Time (mins)" label on
    # the same line, but is split across several runs — footnote markers get
    # their own run, so "15, # 45" arrives as three pieces. Collect the whole
    # line and pull the numbers out of it.
    mins = []
    label = next((r for r in runs if 'Departure Time' in clean(r['text'])), None)
    if label:
        same_line = [r for r in runs
                     if abs(r['y'] - label['y']) < 12 and r['x'] >= label['x']]
        text = ' '.join(clean(r['text']) for r in sorted(same_line, key=lambda r: r['x']))
        text = text.split('Departure Time (mins)')[-1]
        # Stop at any footnote sentence that follows the list.
        text = re.split(r'[A-Za-z]{4,}', text.replace('Every', ''))[0]
        mins = [int(x) for x in re.findall(r'\b\d{1,2}\b', text) if 0 <= int(x) <= 59]

    # Footnotes appear twice: in full under the header, and as short fragments
    # printed beside the stop they qualify. Keep the full versions only.
    def with_continuation(run):
        """Footnotes wrap; pick up the line directly beneath the first one."""
        text = clean(run['text'])
        for other in runs:
            if other is run: continue
            if 0 < run['y'] - other['y'] < 22 and abs(other['x'] - run['x']) < 40:
                tail = clean(other['text'])
                if tail and not NOTE_RE.search(tail) and len(tail) < 70:
                    text += ' ' + tail
        return re.sub(r'^#\s*', '', text).strip()

    cands = [with_continuation(r) for r in runs if NOTE_RE.search(clean(r['text']))]
    notes = []
    for c in sorted(set(cands), key=len, reverse=True):
        if not any(c in kept for kept in notes) and len(c) > 25:
            notes.append(c)

    low = days_txt.lower()
    if 'sun & public' in low or re.search(r'sun\s*&', low):
        days = 'sun-ph'
    elif 'mon to fri' in low:
        days = 'mon-fri'
    else:
        days = 'mon-sat'
    return {
        'firstDeparture': hours.group(1) if hours else None,
        'lastDeparture': hours.group(2) if hours else None,
        'departureMinutes': sorted(set(mins)),
        'runsOn': days,
        'daysText': days_txt,
        'footnotes': notes,
    }

def diagram(runs):
    """Split the route diagram into left column, right column and bottom row."""
    anchor = None
    for r in runs:
        if clean(r['text']).lower() == 'first stop':
            anchor = r['y']; break
    if anchor is None:
        raise SystemExit('could not locate the diagram legend')

    # The diagram sits between the legend (below it) and the service-hours
    # header (above it). Without the upper bound the page header and the site
    # navigation get swept in as if they were stops.
    header = [r['y'] for r in runs if 'Departure Time' in clean(r['text'])]
    ceiling = min(header) - 40 if header else float('inf')

    body = [r for r in runs
            if anchor + 50 < r['y'] < ceiling and r['x'] > 470
            and not SKIP_RE.match(clean(r['text']))
            and not NOTE_RE.search(clean(r['text']))]

    # The bottom row can hold multi-line labels ("Chung Chi" / "Teaching
    # Bldg."), so cluster it by x before reading left to right.
    bottom_y = min(r['y'] for r in body) if body else 0
    bottom_runs = [r for r in body if r['y'] < bottom_y + 80]
    rest = [r for r in body if r['y'] >= bottom_y + 80]

    clusters = []
    for r in sorted(bottom_runs, key=lambda r: (r['x'], -r['y'])):
        if clusters and abs(clusters[-1][0]['x'] - r['x']) < 55:
            clusters[-1].append(r)
        else:
            clusters.append([r])
    bottom = [sorted(c, key=lambda r: -r['y']) for c in clusters]

    left = [r for r in rest if r['x'] < 800]
    right = [r for r in rest if r['x'] >= 800]

    def stack(col):
        """Merge the wrapped second line, e.g. 'United College' + '(Upward)'."""
        col = sorted(col, key=lambda r: -r['y'])
        groups = []
        for r in col:
            if groups and abs(groups[-1][-1]['y'] - r['y']) <= 26:
                groups[-1].append(r)
            else:
                groups.append([r])
        return [clean(' '.join(g['text'] for g in grp)) for grp in groups]

    return {
        'bottom': [clean(' '.join(r['text'] for r in c)) for c in bottom],
        'left': list(reversed(stack(left))),    # bottom -> top
        'right': stack(right),                  # top -> bottom
    }

def to_ids(labels, path):
    ids = []
    for lab in labels:
        # Conditional stops carry a trailing footnote marker, e.g.
        # "Univ. Station #" or "Sir Run Run Shaw Hall # 31 to 00 minutes".
        lab = re.split(r'\s*#', lab)[0].strip()
        if not lab: continue
        key = lab.lower().rstrip('.').strip()
        key = key if key in STOP_IDS else lab.lower().strip()
        if key not in STOP_IDS:
            print(f'  !! unmapped stop label {lab!r} in {os.path.basename(path)}',
                  file=sys.stderr)
            continue
        ids.append(STOP_IDS[key])
    return ids

def route(path):
    runs = merged_runs(path)
    m = meta(runs)
    d = diagram(runs)

    base = os.path.basename(path)
    rid = re.match(r'([0-9A-Z]+)', base).group(1)

    bottom = to_ids(d['bottom'], path)
    seq = []
    if bottom: seq.append(bottom[0])                 # first stop (left end)
    seq += to_ids(d['left'], path)                   # up the left column
    seq += to_ids(d['right'], path)                  # down the right column
    if len(bottom) > 1: seq.append(bottom[-1])       # last stop (right end)
    elif bottom: seq.append(bottom[0])               # a loop: terminus at both ends

    name = re.sub(r'\s*\|.*$', '', os.path.splitext(base)[0]).strip()
    name = re.sub(r'^[0-9A-Z]+\s*', '', name)

    return {
        'id': rid,
        'name': f'Route {rid}',
        'nameZh': ROUTE_NAMES_ZH.get(rid),
        'label': name,
        'stops': seq,
        'departureMinutes': m['departureMinutes'],
        'firstDeparture': m['firstDeparture'],
        'lastDeparture': m['lastDeparture'],
        'runsOn': m['runsOn'],
        'notes': ' '.join(m['footnotes']) or None,
    }

def main(paths):
    routes = [route(p) for p in paths]
    routes.sort(key=lambda r: (len(r['id']), r['id']))
    body = ',\n'.join(
        '    ' + json.dumps(r, ensure_ascii=False) for r in routes)
    print(f"""/**
 * routes.generated.js — AUTO-GENERATED from the Transport Office route PDFs.
 * Do not edit by hand; edit the PDFs' source and re-run:
 *
 *     python3 scripts/extract-timetable.py *.pdf > data/routes.generated.js
 *
 * Service hours, departure minutes and stop sequences are as published.
 * `segmentMinutes` is deliberately absent — the Transport Office does not
 * publish running times between stops, so the app estimates the ride leg and
 * labels it as estimated. See scripts/extract-timetable.py for details.
 */
(function (root) {{
  'use strict';
  root.CUHK_ROUTES_GENERATED = [
{body}
  ];
}})(typeof globalThis !== 'undefined' ? globalThis : this);""")

if __name__ == '__main__':
    main(sys.argv[1:])
