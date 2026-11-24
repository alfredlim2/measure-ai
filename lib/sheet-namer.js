// Reads one drawing sheet (images + PDF text layer) and returns its title-block data and tags.
// Tags: discipline (structural | architectural | other) and sheet_type (plan | section | elevation | detail | schedule | other).
// Providers: "openai" (ChatGPT via Chat Completions) and "mock" (text-layer heuristics, no API calls).

const SHEET_TYPES = ['plan', 'section', 'elevation', 'detail', 'schedule', 'other'];
const DISCIPLINES = ['structural', 'architectural', 'other'];
// Older answers / other wording mapped onto the tag lists.
const TYPE_ALIAS = { cover: 'other', notes: 'other', details: 'detail', standard_detail: 'detail', standard_details: 'detail', schedules: 'schedule', sections: 'section', elevations: 'elevation', plans: 'plan', others: 'other' };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['drawing_number', 'title', 'scale', 'level', 'sheet_type', 'discipline', 'confidence', 'tag_confidence'],
  properties: {
    drawing_number: { type: 'string', description: 'Sheet / drawing number exactly as printed, e.g. "S.03-01", "A-101". Empty if not visible.' },
    title: { type: 'string', description: 'Drawing title as printed, original language, one line, e.g. "Denah Balok dan Plat Lt.Dasar". Empty if not visible.' },
    scale: { type: 'string', description: 'Scale as printed, e.g. "1:300", "NTS". Empty if not visible.' },
    level: { type: 'string', description: 'Floor / level the sheet is for if the title names one, e.g. "Lt.Dasar", "Basement", "Level 2". Empty otherwise.' },
    sheet_type: { type: 'string', enum: SHEET_TYPES, description: 'What the sheet mainly shows: plan | section | elevation | detail (standard / typical details) | schedule (tables, lists) | other (cover, index, general notes, 3D views, anything else).' },
    discipline: { type: 'string', enum: DISCIPLINES, description: 'structural | architectural | other (MEP, civil, landscape, interior, or unclear).' },
    confidence: { type: 'number', description: '0 to 1: how sure you are that drawing_number and title are read correctly.' },
    tag_confidence: { type: 'number', description: '0 to 1: how sure you are about sheet_type and discipline.' },
  },
};

const SYSTEM = `You read construction drawing sheets for a quantity surveying tool.
Find the title block (usually a strip along the right edge or the bottom) and read the sheet's own identity.
Rules:
- Copy text exactly as printed. Keep the original language (often Indonesian, Malay, English or Chinese). Do not translate.
- If the drawing number is split across fields such as KODE / CODE and HALAMAN / SHEET / PAGE (e.g. KODE "S.03" and HALAMAN "01"), join them as "S.03-01".
- The title is the sheet's drawing title from the title block (fields like GAMBAR, DRAWING TITLE, JUDUL). Join wrapped lines into one line. If the title block has none, use the main heading printed under the drawing.
- Ignore project name, client, consultant, logos, revision tables and general notes.
- If something is not visible, return an empty string. Never guess a number.
Then tag the sheet:
- discipline: "structural" for structural drawings (STRUKTUR, STRUCTURAL; numbers starting S; foundations, piles, columns, beams, slabs, rebar, steel framing).
  "architectural" for architectural drawings (ARSITEKTUR, ARCHITECTURAL; numbers starting A; rooms, doors, windows, finishes, furniture, ceilings).
  "other" for MEP, civil, landscape, interior or when unclear.
- sheet_type, from what the sheet mainly shows (title words help: DENAH/PLAN/LAYOUT = plan, POTONGAN/SECTION = section, TAMPAK/ELEVATION = elevation, DETAIL/STANDAR/TYPICAL = detail, DAFTAR/TABEL/SCHEDULE = schedule):
  "plan" = a view from above of a floor, roof, foundation or site;
  "section" = a vertical cut through the building or part of it;
  "elevation" = an outside or inside face of the building seen straight on;
  "detail" = standard / typical details, enlarged connections, reinforcement details;
  "schedule" = tables or lists, e.g. beam, column, door, window or finish schedules;
  "other" = cover, drawing index, general notes, legends, 3D views, anything else.
  If a sheet mixes several, pick the one that takes most of the sheet.
Return JSON only.`;

function userText(input) {
  const lines = (input.text || [])
    .slice(0, 600)
    .map(t => `${(t.x * 100).toFixed(0)},${(t.y * 100).toFixed(0)} h${(t.h || 0).toFixed(1)}: ${String(t.s).slice(0, 80)}`)
    .join('\n');
  return [
    `File: ${input.fileName || 'unknown.pdf'} — page ${input.page} of ${input.pageCount}.`,
    input.region
      ? `Image: only the title-block area of the sheet, cropped at high resolution (a box the user marked; the same position on every sheet of this project, so on some sheets it may be off or partly empty). The rest of the sheet is not shown: tag sheet_type and discipline from the title, drawing number and any other text in this area. If there is no drawing number or title in the image, return empty strings.`
      : `Images: (1) whole sheet, (2) right-edge strip, (3) bottom strip, at higher resolution for the title block.`,
    lines
      ? `PDF text layer (x%,y% from top-left, h = text height in pt). It can be incomplete; drawings exported from CAD often draw text as lines:\n${lines.slice(0, 12000)}`
      : 'Read everything from the image' + (input.region ? '.' : 's.'),
    `Return: drawing_number, title, scale, level, sheet_type (${SHEET_TYPES.join(' | ')}), discipline (${DISCIPLINES.join(' | ')}), confidence, tag_confidence.`,
  ].join('\n\n');
}

const NO_EFFORT = new Set();   // models that rejected reasoning_effort

class AiError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

async function callOpenAI(input, cfg, signal) {
  const o = cfg.openai;
  if (!o.key) throw new AiError('OPENAI_API_KEY is not set in .env', 'no_key', 500);
  const images = (input.images || []).slice(0, 4).map(url => ({ type: 'image_url', image_url: { url, detail: cfg.imageDetail } }));
  const baseBody = {
    model: o.model,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: [{ type: 'text', text: userText(input) }, ...images] },
    ],
    max_completion_tokens: 2000,
  };
  // Effort: only reasoning models (o-series, gpt-5 family) accept it. If the model rejects it, retry without and remember.
  if (o.effort && o.effort !== 'auto' && !NO_EFFORT.has(o.model)) baseBody.reasoning_effort = o.effort;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${o.key}` };
  if (o.org) headers['OpenAI-Organization'] = o.org;
  if (o.project) headers['OpenAI-Project'] = o.project;

  const attempt = async (responseFormat) => {
    const res = await fetch(`${o.baseUrl}/chat/completions`, {
      method: 'POST', headers, signal,
      body: JSON.stringify({ ...baseBody, response_format: responseFormat }),
    });
    const txt = await res.text();
    let j; try { j = JSON.parse(txt); } catch { j = null; }
    if (!res.ok) {
      const msg = (j && j.error && j.error.message) || txt.slice(0, 300) || res.statusText;
      const code = res.status === 401 ? 'bad_key' : res.status === 429 ? 'rate_limited' : res.status === 404 ? 'model_not_found' : 'upstream_error';
      throw new AiError(msg, code, res.status);
    }
    const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    // failures after OpenAI answered are still billed: the error carries the usage so it is recorded
    const billed = e => Object.assign(e, { usage: j.usage || null, model: j.model || o.model });
    if (!content) throw billed(new AiError('The model returned no content', 'empty', 502));
    let parsed;
    try { parsed = JSON.parse(content.replace(/^```(json)?|```$/g, '').trim()); } catch { throw billed(new AiError('The model did not return valid JSON', 'bad_json', 502)); }
    return { parsed, usage: j.usage || null, model: j.model || o.model };
  };

  try {
    try {
      return await attempt({ type: 'json_schema', json_schema: { name: 'sheet_info', strict: true, schema: SCHEMA } });
    } catch (e) {
      if (baseBody.reasoning_effort && e.status === 400 && /reasoning/i.test(e.message)) {
        NO_EFFORT.add(o.model); delete baseBody.reasoning_effort;
        return await attempt({ type: 'json_schema', json_schema: { name: 'sheet_info', strict: true, schema: SCHEMA } });
      }
      throw e;
    }
  } catch (e) {
    // Some models / gateways do not support json_schema; fall back to plain JSON mode once.
    if (e.code === 'upstream_error' && e.status === 400 && /response_format|json_schema|schema/i.test(e.message)) {
      baseBody.messages[0].content = SYSTEM + `\nJSON keys: drawing_number, title, scale, level, sheet_type (one of ${SHEET_TYPES.join(', ')}), discipline (one of ${DISCIPLINES.join(', ')}), confidence (0-1), tag_confidence (0-1).`;
      return await attempt({ type: 'json_object' });
    }
    throw e;
  }
}

// ---- mock: no API call, reads the text layer only (for demos without a key) ----
const KEYWORDS = /\b(DENAH|DETAIL|POTONGAN|TAMPAK|DAFTAR|STANDAR|TABEL|PLAN|SECTION|ELEVATION|SCHEDULE|LAYOUT)\b|平面|剖面|详图|立面/i;
const typeFromTitle = t => /DENAH|PLAN|LAYOUT|平面/i.test(t) ? 'plan' : /POTONGAN|SECTION|剖面/i.test(t) ? 'section' : /TAMPAK|ELEVATION|立面/i.test(t) ? 'elevation' : /DETAIL|STANDAR|TYPICAL|详图/i.test(t) ? 'detail' : /DAFTAR|TABEL|SCHEDULE|表/i.test(t) ? 'schedule' : 'other';
function disciplineFrom(num, title, zoneText) {
  if (/^S(T)?[.\-]?\d/i.test(num)) return 'structural';
  if (/^A(R)?[.\-]?\d/i.test(num)) return 'architectural';
  const t = title + ' ' + zoneText;
  if (/STRUKTUR|STRUCTUR|BALOK|KOLOM|PONDASI|PILE|TULANGAN|REBAR|结构/i.test(t)) return 'structural';
  if (/ARSITEKTUR|ARCHITECT|PINTU|JENDELA|DOOR|WINDOW|FINISH|PLAFON|CEILING|建筑/i.test(t)) return 'architectural';
  return 'other';
}
const NOISE = /KONSULTAN|PERENCANA|PEKERJAAN|MENYETUJUI|KETERANGAN|DIREKTUR|PT\.|JL\.|PROJECT|CLIENT|CONSULTANT/i;
async function callMock(input, cfg, signal) {
  const delay = 1200 + Math.random() * 3800;
  await new Promise((r, j) => { const t = setTimeout(r, delay); signal.addEventListener('abort', () => { clearTimeout(t); j(new AiError('aborted', 'aborted', 499)); }); });
  const T = (input.text || []).filter(t => t.s && t.s.trim()).map(t => ({ ...t, s: t.s.trim() }));
  const zone = input.region ? T : T.filter(t => t.x > 0.84 && t.y > 0.84);  // the user's title-block box (text already cut to it), else the usual corner
  // title: keyword line in the title-block corner (+ the next line below it), else the largest keyword line on the sheet
  let title = '';
  const zt = zone.filter(t => KEYWORDS.test(t.s) && !NOISE.test(t.s)).sort((a, b) => a.y - b.y)[0];
  if (zt) {
    const next = zone.filter(t => t.y > zt.y && t.y - zt.y < 0.02 && Math.abs(t.x - zt.x) < 0.08 && !/^\d|^1\s?:/.test(t.s) && !NOISE.test(t.s)).sort((a, b) => a.y - b.y)[0];
    title = zt.s + (next && !/GAMBAR|SKALA|KODE|HALAMAN/i.test(next.s) ? ' ' + next.s : '');
  } else {
    const c = T.filter(t => KEYWORDS.test(t.s) && !NOISE.test(t.s) && t.s.length < 90).sort((a, b) => (b.h || 0) - (a.h || 0))[0];
    title = c ? c.s : '';
  }
  // number: a code in the corner (e.g. "S.03"), joined with a 1–2 digit sheet number on the same row ("01" → "S.03-01")
  let num = '';
  const code = zone.find(t => /^[A-Z]{1,3}[.\-]?\d{1,3}[A-Z]?$/.test(t.s) && /\d/.test(t.s));
  if (code) {
    const pg = zone.find(t => /^\d{1,3}$/.test(t.s) && Math.abs(t.y - code.y) < 0.012 && t.x > code.x);
    num = code.s + (pg ? '-' + pg.s.padStart(2, '0') : '');
  }
  const scale = ((zone.concat(T)).map(t => t.s).find(s => /\b1\s?:\s?\d{2,4}\b|\bN\.?T\.?S\b/i.test(s)) || '').match(/1\s?:\s?\d{2,4}|N\.?T\.?S/i)?.[0]?.replace(/\s/g, '') || '';
  const lvl = (title.match(/\b(LT\.?\s?\w+|LANTAI\s\w+|BASEMENT|LEVEL\s\w+)/i) || [''])[0];
  const type = typeFromTitle(title);
  const discipline = disciplineFrom(num, title, zone.map(t => t.s).join(' '));
  return { parsed: { drawing_number: num, title: title.replace(/\s+/g, ' '), scale, level: lvl, sheet_type: type, discipline, confidence: title ? (num ? 0.6 : 0.45) : 0.1, tag_confidence: title ? 0.5 : 0.1 }, usage: null, model: 'mock (text layer only)' };
}

async function nameSheet(input, cfg, signal) {
  const t0 = Date.now();
  const r = cfg.provider === 'openai' ? await callOpenAI(input, cfg, signal) : await callMock(input, cfg, signal);
  const p = r.parsed || {};
  const clean = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const low = v => clean(v).toLowerCase().replace(/[\s-]+/g, '_');
  const type = TYPE_ALIAS[low(p.sheet_type)] || low(p.sheet_type);
  const disc = low(p.discipline);
  return {
    drawing_number: clean(p.drawing_number),
    title: clean(p.title),
    scale: clean(p.scale),
    level: clean(p.level),
    sheet_type: SHEET_TYPES.includes(type) ? type : 'other',
    discipline: DISCIPLINES.includes(disc) ? disc : /^struct/.test(disc) ? 'structural' : /^archi/.test(disc) ? 'architectural' : 'other',
    confidence: Math.max(0, Math.min(1, +p.confidence || 0)),
    tag_confidence: Math.max(0, Math.min(1, +p.tag_confidence || 0)),
    model: r.model,
    usage: r.usage,
    ms: Date.now() - t0,
  };
}

// Quick check used by the AI Settings window: one tiny text request with the current key, model and effort.
async function testConnection(cfg) {
  const o = cfg.openai, t0 = Date.now();
  if (!o.key) return { ok: false, error: 'Enter an API key first.' };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${o.key}` };
  if (o.org) headers['OpenAI-Organization'] = o.org;
  if (o.project) headers['OpenAI-Project'] = o.project;
  const body = { model: o.model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_completion_tokens: 200 };
  if (o.effort && o.effort !== 'auto') body.reasoning_effort = o.effort;
  const go = async b => {
    const res = await fetch(`${o.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(b), signal: AbortSignal.timeout(20000) });
    const j = await res.json().catch(() => null);
    return { res, j };
  };
  try {
    let { res, j } = await go(body);
    let note = '';
    if (!res.ok && body.reasoning_effort && res.status === 400 && /reasoning/i.test(j?.error?.message || '')) {
      delete body.reasoning_effort; ({ res, j } = await go(body));
      note = `${o.model} does not use the effort setting; it will be ignored.`;
    }
    if (!res.ok) {
      const msg = j?.error?.message || res.statusText;
      const hint = res.status === 401 ? 'The API key was rejected.' : res.status === 404 ? `Model “${o.model}” is not available for this key.` : res.status === 429 ? 'Rate limited or out of credit.' : '';
      return { ok: false, status: res.status, error: [hint, msg].filter(Boolean).join(' ') };
    }
    return { ok: true, model: j.model || o.model, ms: Date.now() - t0, note, usage: j.usage || null };
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'No answer within 20 s.' : `Could not reach ${o.baseUrl} (${e.cause?.code || e.message}).` };
  }
}

module.exports = { nameSheet, testConnection, AiError, SCHEMA, SYSTEM, SHEET_TYPES, DISCIPLINES };
