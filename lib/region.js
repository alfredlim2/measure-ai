// Analysis area + PDF lines (the browser side is web/engine/lines.js).
// A sheet may come with
//   region  [x0, y0, x1, y1] in the sheet's 0–1000 coordinates: the image sent is that area only, and the model works in
//           the AREA's own 0–1000 coordinates. Every point in its answer is mapped back onto the sheet here.
//   lines   [[x1, y1, x2, y2, weight_mm, dashed], …] in the sheet's 0–1000 coordinates: every straight line drawn inside
//           the area, exactly as drawn (nothing merged). They are numbered and listed for the model, which names the
//           lines of each member ("lines": "12-15,18") instead of writing coordinates. resolve() builds the member
//           geometry from those lines, so lengths come straight from the PDF.

const PT_LIST = new Set(['pts', 'first', 'last']);    // keys holding a list of points
const PT_ONE = new Set(['p1', 'p2', 'at', 'from', 'to']);   // keys holding one point

// Called once per run: area transform, numbered line table (ids 1…N), text layer moved into the area.
function prep(S) {
  (S || []).forEach(s => {
    const r = Array.isArray(s.region) && s.region.length === 4 && s.region.every(v => isFinite(+v)) ? s.region.map(Number) : null;
    s._area = r && r[2] - r[0] > 1 && r[3] - r[1] > 1 ? { x0: r[0], y0: r[1], sx: (r[2] - r[0]) / 1000, sy: (r[3] - r[1]) / 1000 } : null;
    const A = s._area;
    // rooms found by the app (web/engine/rooms.js): id → outline and door swings, in sheet coordinates
    s._rooms = Array.isArray(s.rooms) && s.rooms.length ? new Map(s.rooms.filter(r => r && r.id && Array.isArray(r.pts) && r.pts.length >= 3).map(r => [String(r.id).toUpperCase(), r])) : null;
    if (A && Array.isArray(s.text)) s.text = s.text.map(t => { const [x, y] = toCrop(A, [+t.x, +t.y]); return { ...t, x: +x.toFixed(1), y: +y.toFixed(1) }; }).filter(t => t.x >= 0 && t.x <= 1000 && t.y >= 0 && t.y <= 1000);
    if (!Array.isArray(s.lines)) { s._lines = null; return; }
    // order: horizontal lines top to bottom, vertical left to right, then the others by angle, so runs of parallel
    // members get consecutive ids and the model can name them as ranges ("40-63")
    const L = s.lines.filter(l => Array.isArray(l) && l.length >= 4 && l.slice(0, 4).every(v => isFinite(+v))).map(l => {
      const [a, b] = [toCrop(A, [+l[0], +l[1]]), toCrop(A, [+l[2], +l[3]])];
      const c = [a, b].map(p => p.map(v => Math.round(v)));
      const kind = c[0][1] === c[1][1] ? 'h' : c[0][0] === c[1][0] ? 'v' : 'o';
      const [p, q] = kind === 'h' ? (c[0][0] <= c[1][0] ? c : [c[1], c[0]]) : kind === 'v' ? (c[0][1] <= c[1][1] ? c : [c[1], c[0]]) : (c[0][0] <= c[1][0] ? c : [c[1], c[0]]);
      let ang = Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI; if (ang < 0) ang += 180;
      return { page: l.slice(0, 4).map(Number), p, q, kind, ang, w: +l[4] || 0, d: +l[5] ? 1 : 0 };
    });
    const ord = { h: 0, v: 1, o: 2 };
    L.sort((a, b) => ord[a.kind] - ord[b.kind] || (a.kind === 'h' ? a.p[1] - b.p[1] || a.p[0] - b.p[0] : a.kind === 'v' ? a.p[0] - b.p[0] || a.p[1] - b.p[1] : Math.round(a.ang) - Math.round(b.ang) || a.p[1] - b.p[1] || a.p[0] - b.p[0]));
    s._lines = L;
  });
}
const toCrop = (A, [x, y]) => (A ? [(x - A.x0) / A.sx, (y - A.y0) / A.sy] : [x, y]);
const toPage = (A, [x, y]) => (A ? [A.x0 + x * A.sx, A.y0 + y * A.sy] : [x, y]);

// The sheet's line list as the model reads it: "id: y430 x168-311" (horizontal), "id: x239 y261-430" (vertical),
// "id: 168,261 311,430" (other); " w35" = line weight 0.35 mm (given from 0.25 mm), " d" = dashed.
function linesText(s, i) {
  if (!s._lines) return '';
  const rows = s._lines.map((l, k) => {
    const g = l.kind === 'h' ? `y${l.p[1]} x${l.p[0]}-${l.q[0]}` : l.kind === 'v' ? `x${l.p[0]} y${l.p[1]}-${l.q[1]}` : `${l.p[0]},${l.p[1]} ${l.q[0]},${l.q[1]}`;
    return `${k + 1}: ${g}${l.w >= 0.25 ? ` w${Math.round(l.w * 100)}` : ''}${l.d ? ' d' : ''}`;
  });
  return `PDF LINES of sheet ${i + 1}: all ${rows.length} straight lines drawn ${s._area ? 'inside the area' : 'on the sheet'}, each exactly as drawn (nothing joined; lines crossing the area edge are cut there). Coordinates are this image's 0–1000. Name lines by these ids.\n${rows.join('\n')}`;
}

// [12,13,14,15,18] → "12-15,18"
function rangeText(L) { L = [...L].sort((a, b) => a - b); const r = []; for (let i = 0; i < L.length; i++) { let j = i; while (j + 1 < L.length && L[j + 1] === L[j] + 1) j++; r.push(j > i ? `${L[i]}-${L[j]}` : `${L[i]}`); i = j; } return r.join(','); }
// The rooms the app found on a sheet, as the model reads them (label positions in this image's coordinates).
function roomsText(s, i) {
  if (!s._rooms) return '';
  const rows = [...s._rooms.values()].map(r => { const [x, y] = toCrop(s._area, r.label || r.pts[0]).map(Math.round); return `${r.id}: label at ${x},${y} · ≈${r.area_m2} m²${r.doors && r.doors.length ? ` · ${r.doors.length} door swing${r.doors.length > 1 ? 's' : ''}` : ''}`; });
  return `ROOMS FOUND on sheet ${i + 1}: the software found ${rows.length} enclosed spaces and wrote their numbers on the image (red boxes). Areas assume the register scale.\n${rows.join('\n')}`;
}
// "12-15, 18 20–22" → [12,13,14,15,18,20,21,22], only ids that exist (1…n)
function parseIds(v, n) {
  const out = [];
  String(v == null ? '' : Array.isArray(v) ? v.join(',') : v).split(/[\s,;]+/).filter(Boolean).forEach(part => {
    const m = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (m) { const a = Math.min(+m[1], +m[2]), b = Math.max(+m[1], +m[2]); for (let i = a; i <= Math.min(b, a + 5000); i++) if (i >= 1 && i <= n) out.push(i); }
    else if (/^\d+$/.test(part) && +part >= 1 && +part <= n) out.push(+part);
  });
  return [...new Set(out)];
}

// Map every point of the answer from area to sheet coordinates (all tools), then build line-named members (steel).
function resolve(p, S) {
  if (!p || !Array.isArray(p.sheets) || !(S || []).some(s => s._area || s._lines || s._rooms)) return p;
  const out = { ...p, sheets: p.sheets.map((e, k) => {
    if (!e || typeof e !== 'object') return e;
    const i = Number.isInteger(+e.sheet_no) && +e.sheet_no >= 1 && +e.sheet_no <= S.length ? +e.sheet_no - 1 : k, s = S[i];
    if (!s) return e;
    const A = s._area;
    const walk = v => {
      if (Array.isArray(v)) return v.map(walk);
      if (!v || typeof v !== 'object') return v;
      const o = {};
      for (const [key, val] of Object.entries(v)) {
        if (A && PT_LIST.has(key) && Array.isArray(val)) o[key] = val.map(pt => (Array.isArray(pt) && pt.length >= 2 ? toPage(A, [+pt[0], +pt[1]]) : pt));
        else if (A && PT_ONE.has(key) && Array.isArray(val) && val.length >= 2 && !Array.isArray(val[0])) o[key] = toPage(A, [+val[0], +val[1]]);
        else o[key] = walk(val);
      }
      return o;
    };
    const e2 = walk(e);
    // a room named by its number: the outline and door swings come from the room the app found
    if (s._rooms && Array.isArray(e2.elements)) {
      const lost = [];
      e2.elements = e2.elements.map(x => {
        if (!x || x.region == null || x.region === '') return x;
        const R = s._rooms.get(String(x.region).trim().toUpperCase());
        if (!R) { if (!Array.isArray(x.pts) || x.pts.length < 3) lost.push(`${x.name || x.id || '?'} (room number ${x.region})`); return x; }
        return { ...x, region: R.id, shape: 'polygon', pts: R.pts, edges: Array.isArray(x.edges) && x.edges.length === R.pts.length ? x.edges : R.pts.map(() => 'wall'), doors_found: R.doors || [] };
      });
      if (lost.length) e2.warnings = (Array.isArray(e2.warnings) ? e2.warnings : []).concat(`Not drawn: ${lost.join(', ')} named a room number that the software did not find.`);
    }
    if (s._lines && Array.isArray(e2.elements)) {
      const lost = [];
      e2.elements = e2.elements.flatMap(x => { const r = fromLines(x, s); if (r.lost) lost.push(r.lost); return r; });
      if (lost.length) e2.warnings = (Array.isArray(e2.warnings) ? e2.warnings : []).concat(`Not drawn: ${lost.join(', ')} named PDF lines that are not in the list.`);
    }
    return e2;
  }) };
  return out;
}

// One answer element with "lines" → element(s) with exact points on the sheet:
//   outline (rooms, columns, footings… shape "polygon")  → corners where consecutive listed sides meet
//   column seen end-on (steel, on a plan)                  → the centre of its symbol
//   anything else (beams, walls, steel members)            → a centreline along its lines
function fromLines(x, s) {
  if (!x || typeof x !== 'object' || x.lines == null || x.lines === '') return [x];
  const L = s._lines, ids = parseIds(x.lines, L.length);
  if (!ids.length) return Array.isArray(x.pts) && x.pts.length ? [{ ...x, review_reason: x.review_reason || 'geometry_unclear: line ids not found' }] : Object.assign([], { lost: `${x.id || '?'} (${x.kind || 'member'}, lines ${x.lines})` });
  const PW = +(s.sheet && s.sheet.paperW_mm) || 1000, PH = +(s.sheet && s.sheet.paperH_mm) || 1000;   // geometry in paper mm (x and y scale differently in 0–1000)
  const mm = ([a, b]) => [a / 1000 * PW, b / 1000 * PH], back = ([a, b]) => [a / PW * 1000, b / PH * 1000];
  const segs = ids.map(id => { const g = L[id - 1].page; return [mm([g[0], g[1]]), mm([g[2], g[3]])]; });
  const tag = rangeText(ids);
  // "each": every listed line is one member of this kind and mark
  if (x.each) return ids.map((id, k) => ({ ...x, id: `${x.id || 'L'}.${k + 1}`, shape: 'line', pts: [back(segs[k][0]), back(segs[k][1])], lines: String(id), each: undefined }));
  // an outline: the model lists its sides in order around it
  if (x.shape === 'polygon' || x.kind === 'room') {
    const poly = outline(segs);
    return [{ ...x, shape: 'polygon', pts: poly.map(back), lines: tag, ...(poly.hull ? { review_reason: x.review_reason || 'geometry_unclear: outline from the extent of its lines' } : {}) }];
  }
  // a column seen end-on (on a plan): the centre of the lines of its symbol
  if (x.kind === 'column' && (x.shape === 'point' || x.view === 'plan')) {
    const P = segs.flat(); return [{ ...x, shape: 'point', pts: [back([P.reduce((a, q) => a + q[0], 0) / P.length, P.reduce((a, q) => a + q[1], 0) / P.length])], lines: tag }];
  }
  // a line member: along the direction of its longest line; across it, the length-weighted middle of its lines (two
  // flange lines → the centreline); along it, from the first to the last end of its lines, or between "from" and "to"
  // when the model says which part of a longer drawn line this member is (e.g. one bay of a line drawn over three)
  const len = g => Math.hypot(g[1][0] - g[0][0], g[1][1] - g[0][1]);
  const lg = segs.reduce((a, g) => (len(g) > len(a) ? g : a), segs[0]), dl = len(lg) || 1;
  const u = [(lg[1][0] - lg[0][0]) / dl, (lg[1][1] - lg[0][1]) / dl], nv = [-u[1], u[0]];
  const T = q => q[0] * u[0] + q[1] * u[1], O = q => q[0] * nv[0] + q[1] * nv[1];
  let wsum = 0, osum = 0; segs.forEach(g => { const w = len(g) || 1e-6; wsum += w; osum += w * (O(g[0]) + O(g[1])) / 2; });
  const off = osum / wsum, ts = segs.flat().map(T);
  let t0 = Math.min(...ts), t1 = Math.max(...ts);
  const pt = v => (Array.isArray(v) && v.length >= 2 && isFinite(+v[0]) && isFinite(+v[1]) ? mm([+v[0], +v[1]]) : null);
  const f = pt(x.from), t = pt(x.to);
  if (f && t) {
    // the model's support points are whole numbers in the area (≈ 0.1–0.3 mm on paper): snap each to the nearest end of
    // the member's own lines, or to where another drawn line crosses it (a grid line, a supporting member), within 0.35 mm
    const cand = ts.slice(), o0 = [nv[0] * off, nv[1] * off];
    for (const l of L) {
      const a = mm([l.page[0], l.page[1]]), b = mm([l.page[2], l.page[3]]), d = [b[0] - a[0], b[1] - a[1]], den = u[0] * d[1] - u[1] * d[0];
      if (Math.abs(den) < 1e-9) continue;
      const w = [a[0] - o0[0], a[1] - o0[1]], tt = (w[0] * d[1] - w[1] * d[0]) / den, ss = (w[0] * u[1] - w[1] * u[0]) / den;
      if (ss >= -0.001 && ss <= 1.001) cand.push(tt);
    }
    const snap = v => { let b = v, dd = 0.35; cand.forEach(q => { if (Math.abs(q - v) < dd) { dd = Math.abs(q - v); b = q; } }); return b; };
    t0 = snap(Math.min(T(f), T(t))); t1 = snap(Math.max(T(f), T(t)));
  }
  const P = tt => back([u[0] * tt + nv[0] * off, u[1] * tt + nv[1] * off]);
  return [{ ...x, shape: 'line', pts: [P(t0), P(t1)], lines: tag, from: undefined, to: undefined }];
}

// Outline from sides listed in order (paper mm). Pieces of the same side (either side of a door, a dashed line) are
// grouped; each corner is where one side meets the next, so gaps at doors and lines running past corners do not matter.
// If that does not give a sensible polygon (sides not in order, too few), the convex hull of the lines is used and flagged.
function outline(segs) {
  const len = g => Math.hypot(g[1][0] - g[0][0], g[1][1] - g[0][1]);
  const dir = g => { const l = len(g) || 1; return [(g[1][0] - g[0][0]) / l, (g[1][1] - g[0][1]) / l]; };
  const sides = [];
  for (const g of segs) {
    const d = dir(g), last = sides[sides.length - 1];
    if (last) {
      const cr = Math.abs(last.d[0] * d[1] - last.d[1] * d[0]), m = [(g[0][0] + g[1][0]) / 2, (g[0][1] + g[1][1]) / 2];
      const off = Math.abs((m[0] - last.p[0]) * last.d[1] - (m[1] - last.p[1]) * last.d[0]);
      if (cr < 0.026 && off < 0.4) { last.segs.push(g); continue; }   // same side: within 1.5° and 0.4 mm
    }
    sides.push({ d, p: [(g[0][0] + g[1][0]) / 2, (g[0][1] + g[1][1]) / 2], segs: [g] });
  }
  if (sides.length > 2) { const a = sides[0], z = sides[sides.length - 1];   // the last piece may continue the first side
    if (Math.abs(a.d[0] * z.d[1] - a.d[1] * z.d[0]) < 0.026 && Math.abs((z.p[0] - a.p[0]) * a.d[1] - (z.p[1] - a.p[1]) * a.d[0]) < 0.4) { a.segs.push(...z.segs); sides.pop(); } }
  const P = segs.flat(), xs = P.map(q => q[0]), ys = P.map(q => q[1]), box = [Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3];
  if (sides.length >= 3) {
    const v = [];
    for (let i = 0; i < sides.length; i++) {
      const a = sides[i], b = sides[(i + 1) % sides.length], den = a.d[0] * b.d[1] - a.d[1] * b.d[0];
      if (Math.abs(den) < 0.05) { v.length = 0; break; }   // neighbours parallel: sides are not in order
      const t = ((b.p[0] - a.p[0]) * b.d[1] - (b.p[1] - a.p[1]) * b.d[0]) / den, q = [a.p[0] + a.d[0] * t, a.p[1] + a.d[1] * t];
      if (q[0] < box[0] || q[0] > box[2] || q[1] < box[1] || q[1] > box[3]) { v.length = 0; break; }
      v.push(q);
    }
    if (v.length >= 3 && simple(v)) { const ord = []; for (let i = 0; i < v.length; i++) ord.push(v[(i + v.length - 1) % v.length]); return ord; }   // corner i-1|i first, so edge k runs along side k
  }
  const h = hull(P); h.hull = true; return h;
}
function simple(v) {
  let area = 0; v.forEach((p, i) => { const q = v[(i + 1) % v.length]; area += p[0] * q[1] - q[0] * p[1]; });
  if (Math.abs(area) < 1) return false;   // < 0.5 mm² on paper
  const X = (a, b, c, d) => { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
  for (let i = 0; i < v.length; i++) for (let j = i + 2; j < v.length; j++) { if (i === 0 && j === v.length - 1) continue; if (X(v[i], v[(i + 1) % v.length], v[j], v[(j + 1) % v.length])) return false; }
  return true;
}
function hull(P) {
  const pts = [...P].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

module.exports = { prep, linesText, roomsText, resolve, parseIds, toCrop, toPage };
