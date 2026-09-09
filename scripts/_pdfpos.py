"""Positional text extraction for the CUHK Transport Office PDFs.

The timetables are tables, and the content stream order does not follow the
visual layout, so we track the full graphics state (CTM stack + text matrix)
and recover each text run's device coordinates. Fonts are subsetted, so
strings are decoded through each font's ToUnicode CMap.
"""
import re, zlib, sys, pathlib, json

# ---------------------------------------------------------------- objects

def objects(raw):
    return {int(m.group(1)): m.group(2)
            for m in re.finditer(rb'(\d+)\s+0\s+obj\b(.*?)\bendobj', raw, re.S)}

def stream_of(body):
    m = re.search(rb'stream\r?\n(.*?)endstream', body, re.S)
    if not m: return None
    try: return zlib.decompress(m.group(1))
    except Exception: return m.group(1)

def parse_cmap(data):
    cmap = {}
    for blk in re.findall(rb'beginbfchar(.*?)endbfchar', data, re.S):
        for src, dst in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            cmap[int(src,16)] = bytes.fromhex(dst.decode()).decode('utf-16-be','replace')
    for blk in re.findall(rb'beginbfrange(.*?)endbfrange', data, re.S):
        for lo, hi, dst in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            lo, hi, base = int(lo,16), int(hi,16), int(dst,16)
            for i in range(lo, hi+1): cmap[i] = chr(base + (i-lo))
    return cmap

def font_cmaps(objs):
    by_obj = {}
    for num, body in objs.items():
        m = re.search(rb'/ToUnicode\s+(\d+)\s+0\s+R', body)
        if not m: continue
        tu = objs.get(int(m.group(1)))
        if tu is None: continue
        d = stream_of(tu)
        if d: by_obj[num] = parse_cmap(d)
    names = {}
    for body in objs.values():
        for fm in re.finditer(rb'/Font\s*<<(.*?)>>', body, re.S):
            for name, num in re.findall(rb'/([A-Za-z0-9+._-]+)\s+(\d+)\s+0\s+R', fm.group(1)):
                if int(num) in by_obj: names[name.decode()] = by_obj[int(num)]
    return names

# ---------------------------------------------------------------- matrices

def mul(m1, m2):
    a1,b1,c1,d1,e1,f1 = m1; a2,b2,c2,d2,e2,f2 = m2
    return (a1*a2+b1*c2, a1*b2+b1*d2,
            c1*a2+d1*c2, c1*b2+d1*d2,
            e1*a2+f1*c2+e2, e1*b2+f1*d2+f2)

IDENT = (1,0,0,1,0,0)

def unescape(s):
    out = bytearray(); i = 0
    while i < len(s):
        c = s[i]
        if c == 0x5C and i+1 < len(s):
            n = s[i+1]
            mp = {0x6E:10,0x72:13,0x74:9,0x62:8,0x66:12}
            if n in mp: out.append(mp[n]); i += 2; continue
            if 0x30 <= n <= 0x37:
                j = i+1; o = b''
                while j < len(s) and len(o) < 3 and 0x30 <= s[j] <= 0x37:
                    o += bytes([s[j]]); j += 1
                out.append(int(o,8) & 0xFF); i = j; continue
            out.append(n); i += 2; continue
        out.append(c); i += 1
    return bytes(out)

TOKEN = re.compile(rb"""
    (?P<q>\bq\b) | (?P<Q>\bQ\b)
  | (?P<cm>(?:[-\d.]+\s+){6}cm\b)
  | (?P<BT>\bBT\b) | (?P<ET>\bET\b)
  | (?P<Tm>(?:[-\d.]+\s+){6}Tm\b)
  | (?P<Td>[-\d.]+\s+[-\d.]+\s+(?:Td|TD)\b)
  | (?P<Tstar>\bT\*)
  | (?P<Tf>/(?P<fname>[A-Za-z0-9+._-]+)\s+(?P<fsize>[\d.]+)\s+Tf\b)
  | (?P<TJ>\[(?:[^\[\]\\]|\\.)*\]\s*TJ\b)
  | (?P<Tj>\((?:[^()\\]|\\.)*\)\s*Tj\b)
""", re.S | re.X)

def run_content(data, fonts):
    """Yield {x, y, size, text} for every text run."""
    ctm = IDENT; stack = []
    tm = IDENT; tlm = IDENT
    font = None; size = 1
    runs = []

    for m in TOKEN.finditer(data):
        k = m.lastgroup
        if m.group('q'): stack.append(ctm)
        elif m.group('Q'): ctm = stack.pop() if stack else IDENT
        elif m.group('cm'):
            v = [float(x) for x in m.group('cm').split()[:6]]
            ctm = mul(tuple(v), ctm)
        elif m.group('BT'): tm = tlm = IDENT
        elif m.group('Tm'):
            v = [float(x) for x in m.group('Tm').split()[:6]]
            tm = tlm = tuple(v)
        elif m.group('Td'):
            v = [float(x) for x in m.group('Td').split()[:2]]
            tlm = mul((1,0,0,1,v[0],v[1]), tlm); tm = tlm
        elif m.group('Tstar'):
            tlm = mul((1,0,0,1,0,-size), tlm); tm = tlm
        elif m.group('Tf'):
            font = fonts.get(m.group('fname').decode()); size = float(m.group('fsize'))
        elif m.group('TJ') or m.group('Tj'):
            body = m.group(0)
            parts = []
            for p in re.finditer(rb'\(((?:[^()\\]|\\.)*)\)', body):
                b = unescape(p.group(1))
                parts.append(''.join(font.get(c, chr(c) if 32 <= c < 127 else '')
                                     for c in b) if font else b.decode('latin-1'))
            txt = ''.join(parts)
            if txt.strip():
                dev = mul(tm, ctm)
                runs.append({'x': round(dev[4], 1), 'y': round(dev[5], 1), 'text': txt})
    return runs

def extract_runs(path):
    raw = pathlib.Path(path).read_bytes()
    objs = objects(raw)
    fonts = font_cmaps(objs)
    runs = []
    for body in objs.values():
        d = stream_of(body)
        if not d or (b'Tj' not in d and b'TJ' not in d): continue
        runs.extend(run_content(d, fonts))
    return runs

def lines(runs, tol=6):
    """Group runs into visual lines, top to bottom, left to right."""
    runs = sorted(runs, key=lambda r: (-r['y'], r['x']))
    out = []; cur = []; cy = None
    for r in runs:
        if cy is None or abs(r['y'] - cy) <= tol:
            cur.append(r); cy = r['y'] if cy is None else cy
        else:
            out.append(cur); cur = [r]; cy = r['y']
    if cur: out.append(cur)
    return out

if __name__ == '__main__':
    for p in sys.argv[1:]:
        print('=' * 78); print(p); print('=' * 78)
        for ln in lines(extract_runs(p)):
            y = ln[0]['y']
            cells = ' | '.join(f"{r['text'].strip()}" for r in ln if r['text'].strip())
            if cells: print(f"y={y:8.1f}  {cells}")
