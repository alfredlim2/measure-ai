// Parse JSON that is still being written (a streamed model answer), keeping only what is certain so far.
//  - Strings, numbers and literals cut off at the end are dropped.
//  - In arrays, only finished items are kept, except arrays named in `keepPartial` (e.g. "sheets"), whose last,
//    still-open object is kept too, so the finished elements inside it can be used.
//  - Objects keep their finished keys and any partly written child object / array.
// So an element appears only once its closing "}" has arrived: nothing half-written is ever drawn.
function parsePartial(src, keepPartial = ['sheets']) {
  const keep = new Set(keepPartial);
  let i = 0;
  src = String(src || '').replace(/^\s*```(json)?/i, '');
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const eof = () => i >= src.length;
  function str() {
    i++; let out = '';
    while (i < src.length) {
      const c = src[i];
      if (c === '"') { i++; return { v: out, done: true }; }
      if (c === '\\') {
        if (i + 1 >= src.length) return { done: false };
        const e = src[i + 1];
        if (e === 'u') { if (i + 6 > src.length) return { done: false }; out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)); i += 6; continue; }
        out += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[e] ?? e; i += 2; continue;
      }
      out += c; i++;
    }
    return { done: false };
  }
  function scalar() {
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(src.slice(i));
    if (!m) return { done: false, bad: true };
    i += m[0].length;
    if (eof()) return { done: false };              // a number may still be growing
    return { v: JSON.parse(m[0]), done: true };
  }
  function value(key) {
    ws(); if (eof()) return { done: false };
    const c = src[i];
    if (c === '{') return obj();
    if (c === '[') return arr(key);
    if (c === '"') return str();
    return scalar();
  }
  function obj() {
    i++; const o = {};
    for (;;) {
      ws(); if (eof()) return { v: o, done: false };
      if (src[i] === '}') { i++; return { v: o, done: true }; }
      if (src[i] === ',') { i++; continue; }
      if (src[i] !== '"') return { v: o, done: false, bad: true };
      const k = str(); if (!k.done) return { v: o, done: false };
      ws(); if (eof() || src[i] !== ':') return { v: o, done: false };
      i++;
      const r = value(k.v);
      if (r.done) o[k.v] = r.v;
      else { if (r.v && typeof r.v === 'object') o[k.v] = r.v; return { v: o, done: false }; }
    }
  }
  function arr(key) {
    i++; const a = [];
    for (;;) {
      ws(); if (eof()) return { v: a, done: false };
      if (src[i] === ']') { i++; return { v: a, done: true }; }
      if (src[i] === ',') { i++; continue; }
      const r = value();
      if (r.done) a.push(r.v);
      else { if (keep.has(key) && r.v && typeof r.v === 'object' && !Array.isArray(r.v)) a.push(r.v); return { v: a, done: false }; }
    }
  }
  ws();
  if (src[i] !== '{') return null;
  const r = obj();
  return r.v || null;
}

module.exports = { parsePartial };
