// Conc & Fwk takeoff: one structural sheet (a 200 DPI image + optional PDF text layer) → concrete elements as JSON.
// Uses the OpenAI Responses API with streaming so the app can show the model's reasoning summary while it works.
// The model returns geometry in normalized image coordinates (0–1000) plus the marks and sizes it read;
// quantities (m³, m²) are computed in the app from that geometry, the printed dimensions and the scale.

// Thinking efforts each model accepts (from OpenAI's model pages). Models not listed get every effort; a refused one is reported on the task.
const pricing = require('./pricing');
const { parsePartial } = require('./partial-json');
const region = require('./region');

// Order of the answer = order the model writes it in (strict structured output follows the schema order):
// definitions first (so live elements already have their sizes), then each sheet (scale dimensions before elements),
// and complete / remaining last, so the model judges completeness after writing the elements.
function orderProps(schema, keys) {
  const p = schema.properties, o = {};
  keys.forEach(k => { if (p[k]) o[k] = p[k]; });
  Object.keys(p).forEach(k => { if (!o[k]) o[k] = p[k]; });
  schema.properties = o; schema.required = Object.keys(o);
  return schema;
}
const ANSWER_ORDER = ['types', 'cross_sheet_notes', 'sheets', 'warnings', 'summary', 'remaining', 'complete'];

// Review reasons are short codes (a few tokens each instead of a sentence on every item); the app turns them into text.
const REASON_CODES = ['no_size', 'no_detail', 'mark_unclear', 'geometry_unclear', 'hidden', 'conflict', 'count_unsure', 'scale_unsure', 'level_unsure', 'other'];
const REASON_DESC = `Why a QS should check it, as a code: ${REASON_CODES.join(' / ')}. Add ": up to 8 words" only when they say something the code does not ("other" always). Empty if nothing to check.`;

// Compact answers: the same schema sent non-strict with only the skeleton required, so the model can leave out empty
// fields (≈35% of a strict answer is null / "" / defaults). clean() fills every missing field back in.
const CORE = new Set(['sheets', 'sheet_no', 'complete', 'remaining', 'id', 'kind', 'shape', 'pts', 'first', 'last', 'count', 'at', 'p1', 'p2', 'where', 'applies_to_kind']);
const LOOSE = new WeakMap();
function looseSchema(s) {
  if (LOOSE.has(s)) return LOOSE.get(s);
  const c = JSON.parse(JSON.stringify(s));
  const walk = x => {
    if (!x || typeof x !== 'object') return;
    if (x.properties) { x.required = (x.required || []).filter(k => CORE.has(k)); Object.values(x.properties).forEach(walk); }
    if (x.items) walk(x.items);
  };
  walk(c); LOOSE.set(s, c); return c;
}

// PDF lines: members name line ids instead of points, so "pts" is not required there.
function lineSchemaOf(P) {
  const c = JSON.parse(JSON.stringify(looseSchema(P.lineSchema)));
  const el = c.properties.sheets.items.properties.elements.items; el.required = el.required.filter(k => k !== 'pts');
  return c;
}
// Rooms found by the app: a room is named by its number ("region"); its outline is not written.
function roomSchemaOf(P) {
  const c = JSON.parse(JSON.stringify(looseSchema(P.roomSchema)));
  const el = c.properties.sheets.items.properties.elements.items; el.required = ['region', ...el.required.filter(k => !['pts', 'shape', 'id'].includes(k))];
  return c;
}
// Added by the software after the instructions (also after an edited prompt): how to keep the answer short.
function answerRules(P, compact, lineMode, roomMode) {
  return [
    'ANSWER RULES (added by the software to every prompt)',
    roomMode && P.roomRules ? P.roomRules : '',
    lineMode && P.lineRules ? P.lineRules : '',
    P.rules || '',
    compact ? `COMPACT ANSWER\n- Leave out every field that is empty or a default: empty strings, null numbers, empty lists, false, qty 1, label_source "on_element", confidence 0.9 or more. The software fills them in. Never write null or "" just to complete an object.\n- Always write ${P.always}.${P.compactNote ? `\n- ${P.compactNote}` : ''}` : '',
    `REMARKS: FEW AND SHORT\n- review_reason is a code: ${REASON_CODES.join(', ')}. Add ": up to 8 words" only when they say something the code does not ("other: …" always). With a review_reason, needs_review is true.\n- A problem shared by many items (e.g. a schedule or detail sheet that is not in the set) goes ONCE in that sheet's "warnings", naming the marks; the items carry only the code.\n- warnings: at most 5 per sheet and 5 for the set. cross_sheet_notes: at most 8, only where a value came from another sheet or sheets disagree; in later rounds and parts only new ones. summary: one sentence. Every line at most 20 words.${P.remarksNote ? `\n- ${P.remarksNote}` : ''}`,
  ].filter(Boolean).join('\n\n');
}

const MODEL_EFFORTS = [
  [/^gpt-6-astra/i, ['low', 'medium', 'high', 'xhigh', 'max']],
  [/^gpt-6\.1-sol/i, ['low', 'medium', 'high', 'xhigh', 'max']],
  [/^gpt-6-luna/i, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']],
];

const KINDS = ['column', 'beam', 'slab', 'wall', 'footing', 'pile_cap', 'stair', 'other'];
const SHEET_KINDS = ['beam_slab_plan', 'column_plan', 'foundation_plan', 'combined_plan', 'section', 'detail', 'schedule', 'other'];
const LABEL_SOURCES = ['on_element', 'nearby', 'schedule', 'typical_note', 'other_sheet', 'inferred'];
const TYPE_SOURCES = ['schedule', 'label', 'legend', 'note'];

const num = d => ({ type: ['number', 'null'], description: d });
const pt = { type: 'array', items: { type: 'integer' }, description: '[x, y] as whole numbers in normalized image coordinates (0–1000) of THIS sheet\'s image.' };   // whole numbers: shorter answers; the app snaps outlines to the PDF vectors

const ELEMENT = {
  type: 'object', additionalProperties: false,
  required: ['id', 'kind', 'mark', 'shape', 'pts', 'width_mm', 'depth_mm', 'thickness_mm', 'height_mm', 'length_mm', 'grid_ref', 'label_text', 'label_source', 'ref_sheet', 'confidence', 'needs_review', 'review_reason'],
  properties: {
    id: { type: 'string', description: 'Unique on this sheet: C1, C2… for columns, B1… beams, S1… slabs, W1… walls, F1… footings/pile caps, ST1… stairs, X1… other.' },
    kind: { type: 'string', enum: KINDS },
    mark: { type: 'string', description: 'Element mark exactly as printed, e.g. "G3A", "K1", "S2". Empty if none.' },
    shape: { type: 'string', enum: ['polygon', 'polyline'], description: 'polygon = outline (columns, slabs, footings, pile caps, stairs). polyline = centreline (beams, walls).' },
    pts: { type: 'array', items: pt, description: 'Points on this sheet\'s image. Polygon: corners in order, not repeating the first. Polyline: centreline from start to end.' },
    width_mm: num('Beam width; column side along the image x direction; wall thickness.'),
    depth_mm: num('Beam overall depth (incl. slab); column side along the image y direction; footing / pile cap depth.'),
    thickness_mm: num('Slab or stair thickness.'),
    height_mm: num('Column / wall height only if printed for this element (on any sheet of the set); else null.'),
    length_mm: num('Beam / wall length from a printed dimension (support centre to support centre). null if no dimension is printed for it.'),
    grid_ref: { type: 'string', description: 'Grid location, e.g. "5 / H–I" for a beam on grid 5 between H and I, "C-4" for a column. Empty if no grids.' },
    label_text: { type: 'string', description: 'The exact text you used to identify this element. Empty if none.' },
    label_source: { type: 'string', enum: LABEL_SOURCES },
    ref_sheet: { type: ['integer', 'null'], description: 'If the mark or size came from ANOTHER sheet of the set (schedule, detail, other plan), that sheet\'s number. Else null.' },
    confidence: { type: 'number', description: '0 to 1: how sure you are about the mark, the size and the outline together.' },
    needs_review: { type: 'boolean' },
    review_reason: { type: 'string', description: REASON_DESC },
  },
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sheets', 'types', 'cross_sheet_notes', 'warnings', 'summary', 'complete', 'remaining'],
  properties: {
    complete: { type: 'boolean', description: 'true only when, together with earlier rounds, every element of the requested kinds on every plan sheet has been reported.' },
    remaining: { type: 'array', items: { type: 'string' }, description: 'What is still to do after this answer, specific enough to continue from, e.g. "Sheet 1: beams and slabs in bays A–E / 1–4". Empty when complete.' },
    sheets: {
      type: 'array',
      description: 'One entry per sheet you were given, in the same order, even if a sheet has no elements.',
      items: {
        type: 'object', additionalProperties: false,
        required: ['sheet_no', 'sheet', 'calibration', 'elements', 'warnings'],
        properties: {
          sheet_no: { type: 'integer', description: 'The sheet number as given in the message (1, 2, 3…).' },
          sheet: {
            type: 'object',
            additionalProperties: false,
            required: ['drawing_number', 'title', 'level', 'scale', 'sheet_kind', 'concrete_grade', 'typical_slab_thickness_mm', 'floor_height_mm', 'notes'],
            properties: {
              drawing_number: { type: 'string', description: 'As printed in the title block, e.g. "S.03-01". Empty if not visible.' },
              title: { type: 'string', description: 'Drawing title as printed, original language.' },
              level: { type: 'string', description: 'Floor / level this sheet is for, as printed, e.g. "Lt.Dasar". Empty if none.' },
              scale: { type: 'string', description: 'Scale of the main plan as printed, e.g. "1:100". Empty if not visible.' },
              sheet_kind: { type: 'string', enum: SHEET_KINDS },
              concrete_grade: { type: 'string', description: 'Concrete grade that applies to the elements of this sheet (from this or another sheet\'s notes), e.g. "fc\' 25 MPa". Empty if unknown.' },
              typical_slab_thickness_mm: num('Slab thickness for most panels of this sheet, from any sheet of the set. null if unknown.'),
              floor_height_mm: num('Floor-to-floor height for columns/walls of this level, from level marks or sections anywhere in the set. null otherwise.'),
              notes: { type: 'string', description: 'Short summary of notes that affect concrete quantities for this sheet. Empty if none.' },
            },
          },
          calibration: {
            type: 'array',
            description: 'Up to 4 printed dimensions on this sheet\'s main plan (prefer long grid-to-grid dimensions in both directions) with the two points they measure between. Used by the app to check the scale.',
            items: {
              type: 'object', additionalProperties: false, required: ['text', 'p1', 'p2', 'length_mm'],
              properties: { text: { type: 'string', description: 'The dimension text as printed, e.g. "8000".' }, p1: pt, p2: pt, length_mm: { type: 'number' } },
            },
          },
          elements: { type: 'array', items: ELEMENT },
          warnings: { type: 'array', items: { type: 'string' }, description: 'Problems on this sheet: unreadable areas, skipped bays, conflicting sizes.' },
        },
      },
    },
    types: {
      type: 'array',
      description: 'Every element type defined anywhere in the set: schedules, legends, notes, or labels that carry a size (e.g. "G4 250X600").',
      items: {
        type: 'object', additionalProperties: false, required: ['mark', 'kind', 'width_mm', 'depth_mm', 'thickness_mm', 'source', 'text', 'sheet_no'],
        properties: {
          mark: { type: 'string' }, kind: { type: 'string', enum: KINDS },
          width_mm: num('Beam width / column side along x / wall thickness.'), depth_mm: num('Beam overall depth / column side along y / footing depth.'),
          thickness_mm: num('Slab or stair waist thickness.'),
          source: { type: 'string', enum: TYPE_SOURCES }, text: { type: 'string', description: 'The text as printed.' },
          sheet_no: { type: 'integer', description: 'Sheet number where this definition was read.' },
        },
      },
    },
    cross_sheet_notes: { type: 'array', items: { type: 'string' }, description: 'How the sheets were combined, e.g. "Column sizes on sheet 2 taken from the column plan, sheet 1", "Columns of Lt.Dasar measured on sheet 1 only, not repeated on sheet 2". Also conflicts between sheets.' },
    warnings: { type: 'array', items: { type: 'string' }, description: 'Problems that concern the whole set.' },
    summary: { type: 'string', description: 'Two or three sentences: what the set shows and what was measured.' },
  },
};

orderProps(SCHEMA, ANSWER_ORDER);

const DEFAULT_PROMPT = `You are a senior quantity surveyor doing a concrete and formwork takeoff from a SET of structural drawing sheets sent together.
Each sheet comes as "Sheet n" with its details from the drawing register, (if sent) its PDF text layer with positions, and an image of the whole sheet. The set may be a single sheet.
Find every cast-in-situ concrete element of the requested kinds on the main plans, outline it on its own sheet's image, and read its mark and size. Software computes the quantities from your answer, so geometry and sizes must be exact and honest.

WORK ACROSS THE SET
- First look at every sheet and work out what each one is (beam & slab plan, column plan, foundation plan, schedule, standard details, section) and which level it belongs to.
- Use the whole set to read sizes: beam, column and slab schedules, slab thickness tables, typical details, notes and sections on one sheet apply to the plans on the others. Record where they came from (types[].sheet_no, and element ref_sheet + label_source "other_sheet" when the size or mark came from another sheet).
- Use sections and level marks anywhere in the set for floor heights.
- Measure each physical element ONCE. If the set has both a column plan and a beam & slab plan for the same level, take the columns from the column plan only and the beams and slabs from the beam & slab plan only. Different levels are different elements, even when they look the same.
- When sheets disagree (a size in a schedule differs from a plan label), use the more specific source and set review_reason "conflict"; list the conflict in cross_sheet_notes.
- Return one entry in "sheets" for every sheet you were given, in order, with that sheet's own elements and coordinates.

COORDINATES
- Each element's points are on ITS OWN sheet's image, normalized: x = 0 at the left edge to 1000 at the right edge; y = 0 at the top edge to 1000 at the bottom edge. x and y are scaled separately (the sheet is not square). Use whole numbers.
- Trace the element linework itself, never text, leaders or dimension lines. The software snaps outlines onto the PDF's own drawn lines and shapes, so put each outline on the correct lines (for a column, its own drawn outline); do not flag an element just because your outline is approximate.

HOW TO RECORD EACH KIND
- column: shape "polygon", the outline of the column on plan (4 corners if rectangular, 8–12 points if round). width_mm = side along image x, depth_mm = side along image y (from the label or the column schedule). Usually hatched or filled.
- beam: shape "polyline", the CENTRELINE of ONE SPAN, from the centre of one support (column, wall or supporting beam) to the centre of the next. A continuous beam over 3 columns is 2 elements. Beams on plans are often drawn as dashed double lines under the slab. width_mm × depth_mm from the label (e.g. "G4 250X600" = 250 wide, 600 deep) or the beam schedule. length_mm only if a dimension is printed for that span.
- slab: shape "polygon", one panel per slab mark area, traced along the centrelines of the surrounding beams/grids. thickness_mm from the slab mark (circle/hexagon tag), its legend, a slab table or the notes. Leave out openings, shafts and voids (draw the panel around them only if they are small and say so in review_reason).
- wall: shape "polyline", the centreline; width_mm = thickness. Only concrete walls (core, retaining, shear walls), not masonry.
- footing / pile_cap: shape "polygon", the outline; depth_mm = depth from the schedule or section mark.
- stair: shape "polygon" around flights and landings; thickness_mm = waist if given.
- Report only the kinds requested in the message. Measure only the main plan(s) of each sheet; skip key plans, small location plans and enlarged details that repeat a main plan. Schedules, details and sections give information but have no elements of their own.

READING MARKS AND SIZES
- Copy marks exactly as printed (G3A, B2, K1, S2, …). Keep the original language of notes and titles.
- Put every type definition you can see on any sheet into "types". Then fill each element's size from its own label or its type (label_source "on_element", "schedule", "typical_note" or "other_sheet").
- A label on another span of the same continuous beam line may be used: label_source "nearby", lower confidence.
- If the mark cannot be read (blurred, rotated 45°, overlapping), infer it from the drawn width and the neighbours: label_source "inferred" and review_reason "mark_unclear: <what you assumed>".
- Never invent a size silently. If a size is unknown in the whole set, return null with review_reason "no_size".
- Sizes are in millimetres. If the drawing uses cm or m, convert.

SCALE CHECK
- For each plan sheet, give in "calibration" up to 4 long printed dimensions (grid to grid, both directions) with the exact two points they measure between and the length in mm. This lets the software verify the scale.
- Read the plan scale from under the plan title or from the title block.

QUALITY
- Keep the answer compact: coordinates as whole numbers, label_text only the mark text you read.
- The goal is full coverage: every column, every beam span and every slab panel of the requested kinds on every plan sheet. Work sheet by sheet and grid bay by grid bay.
- If the message asks you to work in rounds, keep to the size it gives for each answer and say exactly what is left in "remaining"; you will be asked to continue until "complete" is true. Never mark the set complete while bays are still unmeasured.
- NEVER return an empty element list for a plan because it is large, dense or irregular. A best-effort outline flagged with needs_review is far more useful than nothing; the QS checks flagged items.
- Do not report the same element twice. Do not report steel members, masonry, architectural items, or elements marked as existing / by others.
- confidence: 0.9+ only when the mark, size and outline are all clearly read; 0.6–0.8 when something was taken from a neighbour, a note or another sheet; below 0.6 when inferred.
Return JSON only, matching the schema.`;

// Message content: an intro, then for each sheet a text block followed by its image, then the closing line.
function sheetText(s, i, n, dpi) {
  const lines = (s.text || []).slice(0, 4000)
    .map(t => `${(+t.x).toFixed(1)},${(+t.y).toFixed(1)}${t.r ? ` r${t.r}` : ''}: ${String(t.s).slice(0, 60)}`).join('\n');
  const m = s.sheet || {};
  return [
    `=== Sheet ${i + 1} of ${n}: ${m.name || 'unknown'}${m.number ? ` · drawing no. ${m.number}` : ''}${m.title ? ` · title "${m.title}"` : ''} — page ${m.page || 1} of ${m.file || 'unknown.pdf'} ===`,
    s._area && m.area_mm
      ? `Paper size: ${m.paperW_mm ? Math.round(m.paperW_mm) : '?'} × ${m.paperH_mm ? Math.round(m.paperH_mm) : '?'} mm. Image (next): ONLY the selected AREA of this sheet (paper x ${m.area_mm[0]}–${m.area_mm[2]} mm, y ${m.area_mm[1]}–${m.area_mm[3]} mm from the top left) at ${m.dpi || dpi || 200} DPI, ${m.imgW || '?'} × ${m.imgH || '?'} px. Measure only what is inside this area. All coordinates for this sheet are 0–1000 of THIS image (the area), not of the whole sheet.`
      : `Paper size: ${m.paperW_mm ? Math.round(m.paperW_mm) : '?'} × ${m.paperH_mm ? Math.round(m.paperH_mm) : '?'} mm. Image (next): the whole sheet at ${m.dpi || dpi || 200} DPI, ${m.imgW || '?'} × ${m.imgH || '?'} px.`,
    `From the drawing register (check against the sheet): scale ${m.scale || 'unknown'}${m.level ? `, level ${m.level}` : ''}.`,
    lines
      ? `PDF text layer of sheet ${i + 1} (x,y in this sheet's 0–1000 coordinates, r = rotation in degrees if not 0). It can be incomplete; CAD exports often draw text as lines, so always check the image:\n${lines}`
      : `Read all text on sheet ${i + 1} from its image.`,
  ].join('\n');
}
function buildContent(input, detail, P) {
  const S = input.sheets || [], n = S.length;
  const content = [{ type: 'input_text', text: `${n} sheet${n > 1 ? 's' : ''} in this set, to be read together. ${P.measureLine(input.kinds)}` }];
  S.forEach((s, i) => {
    content.push({ type: 'input_text', text: sheetText(s, i, n, input.dpi) });
    content.push({ type: 'input_image', image_url: s.image, detail });
    const rt = region.roomsText(s, i); if (rt) content.push({ type: 'input_text', text: rt });
    else { const lt = region.linesText(s, i); if (lt) content.push({ type: 'input_text', text: lt }); }
  });
  content.push({ type: 'input_text', text: `Return the JSON object described by the schema, with one "sheets" entry for each of the ${n} sheet${n > 1 ? 's' : ''}.` });
  return content;
}
const contentText = c => c.map(x => (x.type === 'input_text' ? (/^(PDF LINES|ROOMS FOUND)/.test(x.text) ? x.text.split('\n')[0] + '\n[… the numbered list]' : x.text) : '[sheet image]')).join('\n\n');

class AiError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

// POST with Node's http(s) module and no timeouts. (Node's fetch gives up after 300 s without data,
// which a long-thinking model can exceed.) Resolves with the response stream; the signal aborts it.
function post(url, headers, body, signal) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? require('http') : require('https');
    const req = mod.request(u, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }, resolve);
    req.setTimeout(0);
    req.on('error', reject);
    if (signal) {
      const stop = () => req.destroy(new AiError('Cancelled', 'cancelled', 499));
      if (signal.aborted) return stop();
      signal.addEventListener('abort', stop, { once: true });
    }
    req.end(body);
  });
}
async function readText(res) { const c = []; for await (const ch of res) c.push(ch); return Buffer.concat(c).toString('utf8'); }

// Read an SSE stream and call onEvent for every JSON event.
async function readSSE(res, onEvent) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res) {
    buf += dec.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') continue;
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      onEvent(ev);
    }
  }
}

const outputText = r => (r && r.output || []).flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('');
const reasoningText = r => (r && r.output || []).filter(o => o.type === 'reasoning').flatMap(o => o.summary || []).map(s => s.text).join('\n\n');

// One model answer (one "round"). Mutates body when the model / key refuses an option, and tells the user.
async function callOnce(ctx, body, emit) {
  const { o, headers, signal, model, effort, system } = ctx;
  for (let attempt = 0; attempt < 8; attempt++) {
    emit({ type: 'status', status: 'sending' });
    const res = await post(`${o.baseUrl}/responses`, headers, JSON.stringify(body), signal);
    res.status = res.statusCode; res.ok = res.statusCode >= 200 && res.statusCode < 300;
    if (!res.ok) {
      const txt = await readText(res);
      let j; try { j = JSON.parse(txt); } catch { j = null; }
      const msg = (j && j.error && j.error.message) || txt.slice(0, 400) || res.statusMessage;
      if (res.status === 400) {
        const r = body.reasoning;
        if (body.previous_response_id && /previous_response|store|not found|retention/i.test(msg)) { ctx.noStore = msg; throw Object.assign(new AiError(msg, 'no_store', 400), { retryReplay: true }); }
        if (r && r.context && /context|all_turns/i.test(msg)) { delete r.context; ctx.drop.context = 1; emit({ type: 'note', text: `Keeping the model's reasoning across rounds is not available here, so each round reasons afresh. (${msg})` }); continue; }
        if (body.service_tier && /service_tier|ultrafast|fast mode|tier/i.test(msg)) { delete body.service_tier; ctx.drop.tier = 1; emit({ type: 'note', text: `The ${msg.match(/ultrafast|fast/i)?.[0] || 'selected'} processing tier is not available for this model or key; using standard processing. (${msg})` }); continue; }
        if (Array.isArray(body.input) && body.input.some(x => x.type === 'configuration_update') && /configuration_update/i.test(msg)) { body.input = body.input.filter(x => x.type !== 'configuration_update'); ctx.drop.cfgUpdate = 1; emit({ type: 'note', text: `Changing effort between rounds is not available here; every round uses ${effort}. (${msg})` }); continue; }
        if (r && r.summary && /summar|verif/i.test(msg)) { delete r.summary; ctx.drop.summary = 1; emit({ type: 'note', text: `Thinking summary is not available for this key or model, so only the status is shown. (${msg})` }); continue; }
        if (body.stream && /stream/i.test(msg)) { body.stream = false; ctx.drop.stream = 1; emit({ type: 'note', text: `Streaming was refused, so thinking appears only at the end of each round. (${msg})` }); continue; }
        if (r && /reasoning|effort/i.test(msg)) {
          if (/unsupported value|not supported with this model|supported values/i.test(msg) && r.effort) throw new AiError(`${model} does not accept effort "${effort}". Choose another effort. (${msg})`, 'bad_effort', 400);
          delete body.reasoning; ctx.drop.reasoning = 1; emit({ type: 'note', text: `${model} is not a reasoning model: effort and thinking are ignored.` }); continue;
        }
        if (ctx.detail === 'original' && /detail|original|image|patch|too large|dimension/i.test(msg)) {
          ctx.detail = 'high'; setDetail(body.input, 'high');
          emit({ type: 'note', text: `The model refused the full-resolution images, so they were sent with detail "high" (resized; small text may be harder to read). (${msg})` }); continue;
        }
        if (body.text.format.type === 'json_schema' && /json_schema|text\.format|schema|strict/i.test(msg)) {
          body.text.format = { type: 'json_object' }; ctx.drop.schema = 1;
          body.instructions = system + '\n\nReturn a single JSON object with exactly this JSON Schema:\n' + JSON.stringify(ctx.P.schema);
          emit({ type: 'note', text: `Strict JSON schema was refused; using plain JSON mode. (${msg})` }); continue;
        }
        if (body.store && /store/i.test(msg)) { body.store = false; ctx.noStore = msg; continue; }
        if (body.prompt_cache_key && /prompt_cache_key/i.test(msg)) { delete body.prompt_cache_key; ctx.drop.cacheKey = 1; continue; }
        if (body.metadata && /metadata/i.test(msg)) { delete body.metadata; ctx.drop.metadata = 1; continue; }
      }
      const code = res.status === 401 ? 'bad_key' : res.status === 429 ? 'rate_limited' : res.status === 404 ? 'model_not_found' : 'upstream_error';
      throw new AiError(msg, code, res.status);
    }

    let final = null, text = '', thinking = '', failed = null, failedUsage = null;
    if (body.stream) {
      let lastOut = 0;
      await readSSE(res, ev => {
        switch (ev.type) {
          case 'response.created': case 'response.in_progress': ctx._started = true; emit({ type: 'status', status: 'thinking' }); break;
          case 'response.reasoning_summary_part.added': if (thinking) { thinking += '\n\n'; emit({ type: 'thinking_break' }); } break;
          case 'response.reasoning_summary_text.delta': case 'response.reasoning_text.delta':
            thinking += ev.delta || ''; ctx._chars = text.length + thinking.length; emit({ type: 'thinking', delta: ev.delta || '' }); break;
          case 'response.output_text.delta':
            if (!text) emit({ type: 'status', status: 'writing' });
            text += ev.delta || ''; ctx._chars = text.length + thinking.length;
            if (text.length - lastOut > 400) { lastOut = text.length; emit({ type: 'output', chars: text.length }); }
            if (ctx.onPartial && Date.now() - (ctx.lastPartial || 0) > 1000) { ctx.lastPartial = Date.now(); try { ctx.onPartial(text); } catch {} }
            break;
          case 'response.completed': final = ev.response; break;
          case 'response.incomplete': final = ev.response; break;
          case 'response.failed': failedUsage = ev.response && ev.response.usage; failed = (ev.response && ev.response.error && ev.response.error.message) || 'The model run failed'; break;
          case 'error': failed = ev.message || (ev.error && ev.error.message) || 'Stream error'; break;
        }
      });
    } else {
      emit({ type: 'status', status: 'thinking' });
      final = JSON.parse(await readText(res));
      thinking = reasoningText(final);
      if (thinking) emit({ type: 'thinking', delta: thinking });
    }
    // from here on OpenAI has answered, so a failure is still billed: errors carry the usage (recorded by runTakeoff)
    const billed = e => Object.assign(e, { usage: (final && final.usage) || failedUsage || null, model: (final && final.model) || model });
    if (failed) throw billed(new AiError(failed, 'model_failed', 502));
    if (final) { text = outputText(final) || text; if (!thinking) { thinking = reasoningText(final); if (thinking) emit({ type: 'thinking', delta: thinking }); } }
    emit({ type: 'output', chars: text.length });
    const incomplete = final && final.status === 'incomplete' ? (final.incomplete_details && final.incomplete_details.reason) || 'incomplete' : '';
    if (!text) throw billed(new AiError(incomplete ? `The model stopped before answering (${incomplete}).` : 'The model returned no answer.', 'empty', 502));
    let parsed;
    try { parsed = JSON.parse(text.replace(/^\s*```(json)?/i, '').replace(/```\s*$/, '').trim()); }
    catch { const e = billed(new AiError(incomplete ? `The answer was cut off (${incomplete}); the JSON is incomplete.` : 'The model did not return valid JSON.', 'bad_json', 502)); e.raw = text; throw e; }
    return { parsed, raw: text, thinking, usage: final && final.usage || null, id: final && final.id, model: final && final.model || model, tier: (final && final.service_tier) || body.service_tier || 'default' };
  }
  throw new AiError('The model kept refusing the request settings.', 'upstream_error', 502);
}
function setDetail(input, d) { input.forEach(m => (Array.isArray(m.content) ? m.content : []).forEach(c => { if (c.type === 'input_image') c.detail = d; })); }

/* ---- merging rounds ---- */
const centroid = pts => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
const near2 = (a, b, t) => Math.hypot(a[0] - b[0], a[1] - b[1]) < t;
// Same physical element reported again? Same kind and practically the same place (in 0–1000 image units).
function sameElement(a, b) {
  if (a.kind !== b.kind) return false;
  const lineish = s => s === 'polyline' || s === 'line';   // concrete beams / walls, steel members
  if (lineish(a.shape) && lineish(b.shape)) {
    const A0 = a.pts[0], A1 = a.pts[a.pts.length - 1], B0 = b.pts[0], B1 = b.pts[b.pts.length - 1];
    return (near2(A0, B0, 3) && near2(A1, B1, 3)) || (near2(A0, B1, 3) && near2(A1, B0, 3));
  }
  const ca = centroid(a.pts), cb = centroid(b.pts);
  const span = p => Math.max(Math.max(...p.map(q => q[0])) - Math.min(...p.map(q => q[0])), Math.max(...p.map(q => q[1])) - Math.min(...p.map(q => q[1])), 1);
  const sa = span(a.pts), sb = span(b.pts);
  return near2(ca, cb, Math.max(2.5, Math.min(sa, sb) * 0.25)) && Math.min(sa, sb) / Math.max(sa, sb) > 0.6;
}
function merge(M, D, round) {
  let added = 0, dupes = 0;
  // a steel pattern stands for `count` members: it counts as that many for progress (re-checks, "added fewer than N")
  if (!M) { D.sheets.forEach(s => { s.elements.forEach(e => { e.round = round; added++; }); (s.connections || []).forEach(c => { c.round = round; added++; }); (s.patterns || []).forEach(q => { q.round = round; added += q.count || 1; }); }); return { M: D, added, dupes }; }
  D.sheets.forEach((ds, i) => {
    const ms = M.sheets[i]; if (!ms) return;
    const ids = new Set(ms.elements.map(e => e.id));
    for (const e of ds.elements) {
      if (ms.elements.some(x => sameElement(x, e))) { dupes++; continue; }
      let id = e.id; if (ids.has(id)) { let k = 2; while (ids.has(`${e.id}~${k}`)) k++; id = `${e.id}~${k}`; }
      ids.add(id); ms.elements.push({ ...e, id, round }); added++;
    }
    for (const k of Object.keys(ms.sheet)) if ((ms.sheet[k] === '' || ms.sheet[k] == null) && ds.sheet[k] !== '' && ds.sheet[k] != null) ms.sheet[k] = ds.sheet[k];
    ms.calibration = ms.calibration.concat(ds.calibration).slice(0, 8);
    // steel: joints (same kind and type at the same place = repeat) and level marks
    if (Array.isArray(ds.connections)) {
      ms.connections = ms.connections || [];
      const jid = new Set(ms.connections.map(x => x.id));
      for (const c of ds.connections) {
        if (ms.connections.some(x => x.kind === c.kind && x.type_mark === c.type_mark && near2(x.at, c.at, 3))) { dupes++; continue; }
        let id = c.id; if (jid.has(id)) { let k = 2; while (jid.has(`${c.id}~${k}`)) k++; id = `${c.id}~${k}`; }
        jid.add(id); ms.connections.push({ ...c, id, round }); added++;
      }
    }
    // steel: runs of repeated members (same kind with practically the same first and last lines = repeat)
    if (Array.isArray(ds.patterns)) {
      ms.patterns = ms.patterns || [];
      const pid = new Set(ms.patterns.map(x => x.id)), ends = q => [q.first[0], q.first[q.first.length - 1], q.last[0], q.last[q.last.length - 1]];
      for (const q of ds.patterns) {
        if (ms.patterns.some(x => x.kind === q.kind && ends(x).every((a, i) => near2(a, ends(q)[i], 3)))) { dupes++; continue; }
        let id = q.id; if (pid.has(id)) { let k = 2; while (pid.has(`${q.id}~${k}`)) k++; id = `${q.id}~${k}`; }
        pid.add(id); ms.patterns.push({ ...q, id, round }); added += q.count || 1;
      }
    }
    if (Array.isArray(ds.levels)) { ms.levels = ms.levels || []; ds.levels.forEach(l => { if (!ms.levels.some(x => x.name === l.name && x.level_m === l.level_m)) ms.levels.push(l); }); }
    ms.warnings = ds.warnings;                        // the latest round knows what still applies
  });
  const tk = new Set(M.types.map(t => `${t.mark}|${t.kind}`));
  D.types.forEach(t => { if (!tk.has(`${t.mark}|${t.kind}`)) { tk.add(`${t.mark}|${t.kind}`); M.types.push(t); } });
  if (Array.isArray(D.connection_rules)) { M.connection_rules = M.connection_rules || []; const key = r => [r.type_mark, r.kind, r.applies_to_kind, r.applies_to_mark, r.where, r.crossing_kind].join('|'); D.connection_rules.forEach(r => { if (!M.connection_rules.some(x => key(x) === key(r))) M.connection_rules.push(r); }); }
  if (Array.isArray(D.connection_types)) { M.connection_types = M.connection_types || []; D.connection_types.forEach(c => { if (!M.connection_types.some(x => x.mark === c.mark)) M.connection_types.push(c); }); }
  D.cross_sheet_notes.forEach(x => { if (M.cross_sheet_notes.length < 12 && !M.cross_sheet_notes.some(y => y === x || similarItem(y, x))) M.cross_sheet_notes.push(x); });
  M.warnings = D.warnings; M.summary = D.summary || M.summary; M.complete = D.complete; M.remaining = D.remaining;
  return { M, added, dupes };
}
const addUsage = (a, u) => {
  if (!u) return a; a = a || { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
  a.input_tokens += u.input_tokens || 0; a.output_tokens += u.output_tokens || 0;
  a.input_tokens_details.cached_tokens += (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0;
  a.output_tokens_details.reasoning_tokens += (u.output_tokens_details && u.output_tokens_details.reasoning_tokens) || 0;
  return a;
};
// parallel: the parts listed in "remaining" will run at the same time (lanes), so they should be about one answer each.
const roundAsk = (n, per, P, parallel) => `Work in rounds: in THIS answer (round ${n}) report at most about ${per} ${P.noun}, then stop. ${P.order} Set "complete" true only if, together with earlier rounds, ${P.all} have now been reported; otherwise set it false and list in "remaining" exactly what is still to do, by sheet and grid zone (e.g. "Sheet 1: beams and slabs in bays A–D / 1–5")${parallel ? `, split into separate parts of about ${per} ${P.noun} each; the parts are measured at the same time, so do not lump a whole plan into one part, and leave out sheets that have nothing to measure` : ''}. Never ask for other drawings or views in "remaining"; put such limits in warnings. You will be asked to continue until the takeoff is complete.`;
// Parallel mode: round 1 only plans. It reads the set (scale, schedules, details) and splits the work into parts, which start
// right after it, each continuing from this answer. Measuring here as well kept every part waiting (11 min on a roof plan).
// The run lasts as long as its biggest part, so the split asks for at least one part per lane, all of similar size.
const planAsk = (per, P, lanes) => `Round 1 is a PLANNING step: do not report any ${P.noun} yet. Leave every "elements" list empty${P.id === 'steel' ? ', and leave "patterns" and "connections" empty' : ''}. Read the whole set and return: each sheet's details, scale and calibration; every definition you can read (${P.id === 'steel' ? '"types", "connection_types" and "connection_rules"' : P.id === 'fin' ? '"types": finish codes and door / window types' : '"types": marks with their sizes'}). Then set "complete" false and list in "remaining" the whole takeoff split into AT LEAST ${lanes} parts of about the same size (never more than about ${per} ${P.noun} in one part${P.id === 'steel' ? '; a run of repeated members counts as one entry' : ''}), by sheet and grid zone (e.g. "Sheet 1: purlins and sag rods in bays X1–X4"). ${lanes} parts run at the same time and the run takes as long as the biggest one, so split big zones (by grid range or by kind) until the parts are even. Each part continues from this answer, so make them separate (no overlaps, no gaps between them). Every part is a zone to measure: never a part that only verifies, checks or confirms something (put such doubts in warnings). Leave out sheets with nothing to measure, and never ask for other drawings or views in "remaining".`;
function continueText(n, M, per, P) {
  const counts = M.sheets.map((s, i) => `sheet ${i + 1}: ${s.elements.length}`).join(', ');
  return [
    `Round ${n}. Continue the takeoff where you stopped. Recorded so far: ${counts}.`,
    M.remaining && M.remaining.length ? `Still to do, from your last answer:\n- ${M.remaining.join('\n- ')}` : 'Check every plan sheet for anything not yet reported.',
    `Report ONLY ${P.noun} you have not reported in earlier rounds; never repeat one. Use new ids that do not reuse earlier ones (continue the numbering). At most about ${per} ${P.noun} in this answer.`,
    'Return the same JSON schema: one "sheets" entry per sheet in the same order (elements may be empty), "types" only for new definitions, warnings that still apply, and "complete" / "remaining" for the whole set after this round. Never ask for other drawings or views in "remaining"; put such limits in warnings.',
  ].join('\n\n');
}
// Single session: when a round adds little or nothing but the takeoff is not complete, the next asks are re-checks
// that get stricter, so every round either reports new elements or ends with "complete": true.
function sweepText(n, M, per, P, sweep) {
  const counts = M.sheets.map((s, i) => `sheet ${i + 1}: ${s.elements.length}`).join(', ');
  const step = [
    `Round ${n}, re-check ${sweep}. Your last answer added little or nothing, but the takeoff is not marked complete. Go through each plan sheet grid bay by grid bay, including the perimeter, voids, cores and any irregular or angled zones, and report every one of the requested kinds that you have not reported yet. Recorded so far: ${counts}.`,
    `Round ${n}, re-check ${sweep}. For each plan sheet, list for yourself its grid bays and zones and check them one by one against what you have reported (recorded so far: ${counts}). Report everything that is missing.`,
    `Round ${n}, re-check ${sweep}: final check. If nothing of the requested kinds is missing on any plan sheet, set "complete" true now. If something is missing, report it in this answer. Do not set "complete" false without reporting new ${P.noun}: anything you cannot resolve (unreadable areas, details on drawings you were not given) goes in warnings, not in "remaining".`,
  ][Math.min(sweep, 3) - 1];
  return [
    step,
    `Never repeat ${P.noun} already reported; use new ids that do not reuse earlier ones. At most about ${per} ${P.noun} in this answer.`,
    'Return the same JSON schema: one "sheets" entry per sheet in the same order (elements may be empty), "types" only for new definitions, warnings that still apply, and "complete" / "remaining" for the whole set after this round.',
  ].join('\n\n');
}

// Parallel lanes: after round 1, each part still to do runs as its own request, all continuing from round 1's stored answer.
function laneText(n, M, per, P, item, rem, lane) {
  const counts = M.sheets.map((s, i) => `sheet ${i + 1}: ${s.elements.length}`).join(', ');
  return [
    n === 1
      ? `Part ${lane}. After your round-1 answer, the rest of the takeoff is split into parts that are done at the same time, each continuing from round 1. Do ONLY this part:\n- ${item}`
      : `Part ${lane}, continued. Still to do in this part, from your last answer:\n- ${rem.join('\n- ')}`,
    `Report only ${P.noun} of this part that are not in your round-1 answer${n > 1 ? ' or in your earlier answers for this part' : ''}. The other parts are done separately: skip anything outside this part. Recorded so far over all parts: ${counts}.`,
    `Ids: start every id with "P${lane}-" (e.g. "P${lane}-C1", "P${lane}-B1") so they never clash with other parts. At most about ${per} ${P.noun} in this answer.`,
    'Return the same JSON schema: one "sheets" entry per sheet in the same order (elements may be empty), "types" only for new definitions, warnings that still apply. "complete" = true when THIS part is fully reported; otherwise "remaining" lists what is still to do in this part only. Never ask for other drawings or views in "remaining"; put such limits in warnings.',
  ].join('\n\n');
}
// "remaining" items that ask for something nobody can give (another view, an enlargement) are not worth a request.
const JUNK = /\b(supply|provide|uncropped|enlargement|clearer (image|view|copy)|higher[- ]resolution|zoomed|registration points)\b/i;
// Items that only verify / confirm something add nothing as a part (2 requests, +0 on a steel elevation): kept as warnings.
const CHECK = /^(?:[^:—–]{0,40}[:—–]\s*)?(?:re-?)?(?:verify|confirm|check|double[- ]check|validate|clarify)\b/i;
// Same item reworded? Every token counts (grid letters and bay numbers too: "axis Q bays 1–7" ≠ "axis Q bays 7–13"); shared / all tokens.
const words = s => new Set(String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean));
const sameText = (a, b) => String(a).toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim() === String(b).toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
// Grid names, bay ranges and marks, kept whole: "1.4–1.7" → 1.4, 1.7; "axis Q" → q; "SC1" → sc1. Parts that differ here are
// different zones however alike the rest of the wording (planned parts are often identical except for the grids).
const idsOf = s => [...new Set((String(s).match(/[A-Za-z]*\d+(?:[.\/]\d+)*[A-Za-z]*|\b[A-Z]{1,3}\b/g) || []).map(x => x.toLowerCase()))].sort().join(' ');
function similarItem(a, b) {
  if (sameText(a, b)) return true;
  if (idsOf(a) !== idsOf(b)) return false;
  const A = words(a), B = words(b); let k = 0; A.forEach(w => { if (B.has(w)) k++; }); return k / Math.max(1, A.size + B.size - k) > 0.85;
}
const wait = (ms, signal) => new Promise(r => { const t = setTimeout(r, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

// Run one set of sheets in one session, in rounds until the model reports the takeoff complete.
// emit(event): status | thinking | thinking_break | output | note | request | round | partial | usage.
// Returns { result (merged), raw (last round), usage (total), model, detail, ms, rounds, stopped }.
async function runTakeoff(input, cfg, signal, emit, P = CONC) {
  const o = cfg.openai, t0 = Date.now();
  if (!o.key) throw new AiError('No API key yet. Open AI Settings to add one.', 'no_key', 503);
  const model = input.model || o.model, effort = input.effort || 'auto';
  const system = (input.prompt && input.prompt.trim()) || P.prompt;
  const n = (input.sheets || []).length;
  // Rounds go on until the model reports the takeoff complete; 1000 is only a technical ceiling. The safety stop is the spending cap.
  const multi = input.rounds !== false, per = Math.max(20, Math.min(1000, +input.perRound || 150)), maxRounds = multi ? 1000 : 1;
  const lanesN = Math.max(1, Math.min(8, Math.round(+input.lanes) || 1)), live = input.live !== false;   // lanes > 1 = parallel parts after round 1; live = stream finished elements while the model writes
  const costCap = Math.max(0, +input.costCap || 0);   // USD; 0 = no cap
  const capHit = () => costCap > 0 && costTotal && costTotal.total >= costCap;
  const capNote = () => `Stopped at the spending cap ($${costCap}); the results so far are kept`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${o.key}` };
  if (o.org) headers['OpenAI-Organization'] = o.org;
  if (o.project) headers['OpenAI-Project'] = o.project;
  // Processing tier: standard, or fast / ultrafast = quicker at 2× / 6× the price. (Flex is deliberately not used.)
  const tier = ['fast', 'ultrafast'].includes(input.serviceTier) ? input.serviceTier : 'default';
  // GPT-6 family: keep the model's reasoning across rounds (reasoning.context all_turns) and change effort between rounds with a
  // configuration_update item, which keeps the cached prefix. Round 1 and re-checks use the chosen effort; continuation rounds and
  // parallel parts may use a lower one (input.laterEffort: 'same' | 'lower' | an effort name).
  const gpt6 = /^gpt-6/i.test(model), EFF_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
  const later = !gpt6 || effort === 'auto' || !input.laterEffort || input.laterEffort === 'same' ? effort
    : input.laterEffort === 'lower' ? EFF_ORDER[Math.max(0, EFF_ORDER.indexOf(effort) - 1)] || effort : EFF_ORDER.includes(input.laterEffort) ? input.laterEffort : effort;
  // Compact answers (default): non-strict schema, empty fields left out. The answer rules go after the (possibly edited) prompt.
  // Analysis area / PDF lines (lib/region.js): points come back in area coordinates and members may name line ids;
  // both are turned into sheet geometry before the usual clean-up, so merging, live drawing and the app work unchanged.
  region.prep(input.sheets);
  // rooms found by the app (Finishes): the model names numbered rooms instead of drawing them
  const roomMode = !!P.roomSchema && (input.sheets || []).some(s => s._rooms);
  const lineMode = !roomMode && !!P.lineSchema && (input.sheets || []).some(s => s._lines);
  if ((input.sheets || []).some(s => s._area || s._lines || s._rooms)) { const P0 = P; P = { ...P0, clean: (p, nn) => P0.clean(region.resolve(p, input.sheets), nn) }; }
  const compact = input.compact !== false || lineMode || roomMode;   // line ids / room numbers need the non-strict schema
  const fullSys = `${system}\n\n${answerRules(P, compact, lineMode, roomMode)}`;
  const ctx = { o, headers, signal, model, effort, system: fullSys, detail: input.detail || 'original', drop: {}, noStore: '', P, tier };

  const first = buildContent(input, ctx.detail, P);
  const planFirst = multi && lanesN > 1;   // parallel parts: round 1 plans only
  if (multi) first.push({ type: 'input_text', text: planFirst ? planAsk(per, P, lanesN) : roundAsk(1, per, P, false) });
  const history = [{ role: 'user', content: first }];   // used only when the key cannot store responses
  const base = (rd = round) => {
    const b = {
      model, instructions: fullSys,
      reasoning: { summary: 'auto', ...(effort !== 'auto' ? { effort } : {}), ...(gpt6 && multi && !ctx.drop.context ? { context: 'all_turns' } : {}) },
      ...(ctx.tier !== 'default' && !ctx.drop.tier ? { service_tier: ctx.tier } : {}),
      text: { format: { type: 'json_schema', name: P.name, strict: !compact, schema: roomMode ? roomSchemaOf(P) : lineMode ? lineSchemaOf(P) : compact ? looseSchema(P.schema) : P.schema } },
      stream: true,
      store: multi && !ctx.noStore,   // stored so the next round continues the same session (previous_response_id)
      // Tags so a request can be traced back to its task (visible in the stored response / logs), and one cache key per task
      // so every round of it reuses the cached drawings.
      metadata: { app: 'measure-ai', tool: P.id, task: String(input.jobId || ''), round: String(rd) },
      prompt_cache_key: `qa-${P.id}-${input.jobId || ''}`,
      // No max_output_tokens: the model may use its full output allowance.
    };
    if (ctx.drop.summary) delete b.reasoning.summary;
    if (ctx.drop.reasoning) delete b.reasoning;
    if (ctx.drop.stream) b.stream = false;
    if (ctx.drop.metadata) delete b.metadata;
    if (ctx.drop.cacheKey) delete b.prompt_cache_key;
    if (ctx.drop.schema) { b.text.format = { type: 'json_object' }; b.instructions = fullSys + '\n\nReturn a single JSON object with exactly this JSON Schema:\n' + JSON.stringify(P.schema); }
    return b;
  };
  emit({ type: 'request', instructions: fullSys, text: contentText(first), model, effort, detail: ctx.detail });

  let M = null, usage = null, prevId = null, raw = '', lastModel = model, sweep = 0, stopped = '', round = 0, costTotal = null;
  const junk = new Set();   // "remaining" items asking for drawings / views nobody can give: kept as warnings, not asked for again
  const checks = new Set();   // parallel parts: "verify / confirm …" items are not run as parts; kept as warnings for the QS
  const laneMode = multi && lanesN > 1;
  // Finished elements of the answer being written, merged with everything so far (transient 'live' events).
  const livePartial = (rd, lane) => { let liveN = 0; return text => {
    const p = parsePartial(text); if (!p) return;
    const D = P.clean(p, n), cnt = D.sheets.reduce((a, s) => a + s.elements.length, 0);
    if (cnt <= liveN) return; liveN = cnt;
    const L = merge(M ? JSON.parse(JSON.stringify(M)) : null, D, rd).M;
    emit({ type: 'live', round: rd, lane, result: L, newInRound: cnt, total: L.sheets.reduce((a, s) => a + s.elements.length, 0) });
  }; };
  const rounds = [];   // per round: tokens, cost, response id, time
  // Every request goes through call(): when one fails or is stopped after OpenAI started on it, it is still billed.
  // With OpenAI's usage (failed / cut-off / unreadable answers) the exact tokens are recorded; a request stopped
  // mid-answer has no usage, so an estimate is recorded (input ≈ the largest input so far, output ≈ streamed text ÷ 4;
  // hidden reasoning is not streamed, so it is a lower bound), marked in the ledger's note column.
  let maxIn = 0;
  // configuration_update when the wanted effort differs from the session's current one (it persists along the chain)
  let chainEff = effort;
  const effItem = (want, lane) => { const cur = lane ? lane.eff : chainEff; if (!gpt6 || ctx.drop.cfgUpdate || effort === 'auto' || want === cur) return [];
    if (lane) lane.eff = want; else chainEff = want; return [{ type: 'configuration_update', reasoning: { effort: want } }]; };
  const billFail = (e, c, rd, lane) => {
    let u = e.usage, note;
    if (u) note = `failed (${e.code || 'error'}), still billed`;
    else if (c._started) { note = `stopped mid-answer (${e.code || 'error'}): estimate, at least`; u = { input_tokens: maxIn, output_tokens: Math.ceil((c._chars || 0) / 4), input_tokens_details: { cached_tokens: Math.round(maxIn * 0.8) }, output_tokens_details: { reasoning_tokens: 0 } }; }
    else return;
    const m = e.model || model, cc = pricing.cost(u, m, ctx.drop.tier ? 'default' : ctx.tier);
    usage = addUsage(usage, u); costTotal = pricing.addCost(costTotal, cc);
    rounds.push({ round: rd, lane, ms: 0, responseId: null, model: m, cost: cc, note });
    emit({ type: 'usage', usage: u, model: m, round: rd, lane, cost: cc, costTotal, responseId: null, note });
  };
  const call = async (c, body, em, rd, lane) => {
    c._started = false; c._chars = 0;
    try { const out = await callOnce(c, body, em); maxIn = Math.max(maxIn, (out.usage && out.usage.input_tokens) || 0); return out; }
    catch (e) { billFail(e, c, rd, lane); throw e; }
  };
  while (round < maxRounds) {
    round++;
    const rt = Date.now();
    emit({ type: 'round', round, max: maxRounds, sweep, effort: round === 1 || sweep || !prevId || ctx.drop.cfgUpdate ? effort : later });
    if (round > 1) emit({ type: 'thinking', delta: `${M ? '\n\n' : ''}**— Round ${round}${sweep ? ` · re-check ${sweep}` : ''} —**\n\n` });
    const ask = round === 1 ? null : sweep ? sweepText(round, M, per, P, sweep) : continueText(round, M, per, P);
    // Live: as the answer streams, the finished elements so far (merged with earlier rounds) go to the app.
    // Sent as transient events: the round result that follows replaces them.
    ctx.onPartial = live ? livePartial(round) : null;
    let out;
    try {
      const body = base();
      if (round === 1 || !prevId) { body.input = round === 1 ? history : history.concat([{ role: 'user', content: [{ type: 'input_text', text: ask }] }]); }
      else { body.previous_response_id = prevId; body.input = [...effItem(sweep ? effort : later), { role: 'user', content: [{ type: 'input_text', text: ask }] }]; }
      // A failed round (rate limit, server error, broken JSON; round 1 too) is tried again up to 3 times before giving up,
      // so a hiccup does not end a long run.
      for (let tries = 0; ; tries++) {
        try { out = await call(ctx, body, emit, round); break; }
        catch (e) {
          if (e.retryReplay) {
            // The key cannot continue a stored response: replay the whole conversation instead (same content, no storage).
            emit({ type: 'note', text: 'This key cannot continue a stored response, so each round re-sends the conversation instead (same result, more input tokens).' });
            prevId = null; const b2 = base(); b2.store = false; b2.input = history.concat([{ role: 'user', content: [{ type: 'input_text', text: ask }] }]);
            out = await call(ctx, b2, emit, round); break;
          }
          if (signal.aborted || tries >= 3 || !['bad_json', 'empty', 'model_failed', 'rate_limited', 'upstream_error'].includes(e.code)) throw e;
          const ms = e.code === 'rate_limited' ? 30000 * (tries + 1) : 10000;
          emit({ type: 'note', text: `Round ${round} failed (${e.message}); trying again in ${ms / 1000} s.` });
          await wait(ms, signal);
          if (signal.aborted) throw e;
        }
      }
    } catch (e) {
      if (M && (signal.aborted || e.code === 'bad_json' || e.code === 'empty' || e.code === 'model_failed' || e.code === 'rate_limited' || e.code === 'upstream_error')) {
        stopped = signal.aborted ? 'Stopped by the user' : `Round ${round} failed (${e.message}); the results of the earlier rounds are kept`;
        emit({ type: 'note', text: stopped + '.' });
        break;
      }
      throw e;
    }
    usage = addUsage(usage, out.usage);
    const c = pricing.cost(out.usage, out.model, out.tier); costTotal = pricing.addCost(costTotal, c);
    rounds.push({ round, ms: Date.now() - rt, responseId: out.id || null, model: out.model, cost: c });
    emit({ type: 'usage', usage: out.usage, model: out.model, round, cost: c, costTotal, responseId: out.id || null });
    raw = out.raw; lastModel = out.model;
    const D = P.clean(out.parsed, n);
    D.complete = !!(out.parsed && out.parsed.complete);
    D.remaining = (Array.isArray(out.parsed && out.parsed.remaining) ? out.parsed.remaining.map(x => String(x).trim()).filter(Boolean) : [])
      .filter(x => { if (!JUNK.test(x)) return true; junk.add(x); return false; })
      .filter(x => { if (!laneMode || !CHECK.test(x)) return true; checks.add(x); return false; });
    const mg = merge(M, D, round); M = mg.M;
    if (round === 1 && planFirst) M.complete = false;   // a planning answer never finishes the takeoff
    // keep the conversation too, in case a later round has to replay it
    if (round > 1) history.push({ role: 'user', content: [{ type: 'input_text', text: ask }] });
    history.push({ role: 'assistant', content: [{ type: 'output_text', text: out.raw }] });
    prevId = multi && !ctx.noStore && out.id ? out.id : null;
    const total = M.sheets.reduce((a, s) => a + s.elements.length, 0);
    emit({ type: 'partial', round, result: M, added: mg.added, dupes: mg.dupes, total, complete: M.complete, remaining: M.remaining, ms: Date.now() - rt });
    if (!multi || M.complete) break;
    if (capHit()) { stopped = capNote(); emit({ type: 'note', text: stopped + '.' }); break; }
    if (laneMode && prevId && !ctx.noStore) break;   // rounds 2+ run as parallel lanes (below)
    // Not complete: keep going. A round that adds little (or leaves nothing listed as still to do) makes the next one a re-check.
    // "Little" = under 5% of a round (8 at 150 per round): a model trickling a few elements per round gets re-checked too.
    sweep = mg.added < Math.max(3, Math.round(per * 0.05)) || !M.remaining.length ? sweep + 1 : 0;
  }
  // ---- Parallel lanes: every part still to do after round 1 is its own request, all branching from round 1's stored answer,
  // so each sees every sheet. Up to lanesN run at once; each lane continues its own part until done or nothing new comes.
  let laneSummary = null;
  if (laneMode && M && !M.complete && prevId && !ctx.noStore && !stopped && round < maxRounds) {
    const rootId = prevId, rootEff = chainEff, queue = [], known = [], left = [], failed = [], skipped = [], twins = [], started = new Set();
    let limit = lanesN, running = 0, laneNo = 0, lanesDone = 0, kick = () => {};
    const add = (it, from = rootId) => {
      if (JUNK.test(it)) { skipped.push(it); emit({ type: 'note', text: `Not sent (asks for a drawing or view the AI was not given): ${it}` }); return; }
      if (known.some(k => sameText(k, it))) return;   // exactly a part already queued or done
      // reads like another part (same grids and marks, almost the same words): not run twice, but never dropped silently:
      // it is noted and stays in "still to do", so the run cannot report itself complete
      const twin = known.find(k => similarItem(k, it));
      if (twin) { twins.push(it); emit({ type: 'note', text: `Not run as a separate part, because "${it}" reads like "${twin}". Kept in "still to do".` }); return; }
      known.push(it); queue.push({ item: it, from });
    };
    const planned = M.remaining.length ? M.remaining.slice() : [`Check every plan sheet for any ${P.noun} of the requested kinds not reported yet.`];
    planned.forEach(x => add(x));
    const pending = () => [...queue.map(q => q.item), ...left, ...failed, ...twins];
    const waiting = () => emit({ type: 'lanes', items: queue.map(q => q.item), limit });   // parts waiting for a free slot
    waiting();
    const runLane = async ({ item, from }) => {
      started.add(item);
      const lane = ++laneNo, laneEff = { eff: from === rootId ? rootEff : later }; let last = from, k = 0, rem = [item], retried = false;
      const le = ev => emit({ ...ev, lane });
      while (!signal.aborted) {
        if (round >= maxRounds || capHit()) { left.push(...rem); emit({ type: 'lane', lane, state: 'stopped', why: capHit() ? `spending cap ($${costCap}) reached` : `request limit (${maxRounds}) reached` }); return; }
        k++; round++; const rd = round, rt = Date.now();
        emit({ type: 'round', round: rd, max: maxRounds, lane, item, laneRound: k, effort: ctx.drop.cfgUpdate ? effort : later });
        const body = base(rd);
        body.previous_response_id = last;
        body.input = [...effItem(later, laneEff), { role: 'user', content: [{ type: 'input_text', text: laneText(k, M, per, P, item, rem, lane) }] }];
        const lctx = Object.assign(Object.create(ctx), { lastPartial: 0, onPartial: live ? livePartial(rd, lane) : null });
        let out;
        try { out = await call(lctx, body, le, rd, lane); }
        catch (e) {
          if (signal.aborted) return;
          if (e.code === 'rate_limited' && !retried) {
            retried = true; k--; limit = Math.max(1, limit - 1);
            emit({ type: 'note', text: `The AI is busy: part ${lane} waits 20 s and tries again; at most ${limit} part${limit > 1 ? 's' : ''} at a time from now on.` });
            await wait(20000, signal); continue;
          }
          failed.push(...rem);
          emit({ type: 'note', text: `Part ${lane} failed (${e.message}); the other parts continue and its work is listed as still to do.` });
          emit({ type: 'lane', lane, state: 'failed', why: e.message }); return;
        }
        usage = addUsage(usage, out.usage);
        const c = pricing.cost(out.usage, out.model, out.tier); costTotal = pricing.addCost(costTotal, c);
        rounds.push({ round: rd, lane, ms: Date.now() - rt, responseId: out.id || null, model: out.model, cost: c });
        emit({ type: 'usage', usage: out.usage, model: out.model, round: rd, lane, cost: c, costTotal, responseId: out.id || null });
        raw = out.raw; lastModel = out.model; last = out.id || last;
        const D = P.clean(out.parsed, n);
        const done = !!(out.parsed && out.parsed.complete);
        rem = (Array.isArray(out.parsed && out.parsed.remaining) ? out.parsed.remaining : []).map(x => String(x).trim()).filter(Boolean)
          .filter(x => { if (!JUNK.test(x)) return true; skipped.push(x); return false; })
          .filter(x => { if (!CHECK.test(x)) return true; checks.add(x); return false; });
        const mg = merge(M, D, rd); M = mg.M;
        M.complete = false; M.remaining = pending().concat(rem);
        emit({ type: 'partial', round: rd, lane, item, added: mg.added, dupes: mg.dupes, total: M.sheets.reduce((a, s) => a + s.elements.length, 0), complete: false, remaining: M.remaining, ms: Date.now() - rt });
        if (done || !rem.length) { lanesDone++; emit({ type: 'lane', lane, state: 'done' }); return; }
        if (mg.added < 3) { left.push(...rem); emit({ type: 'lane', lane, state: 'stopped', why: 'its last answer added fewer than 3 new ' + P.noun }); return; }
        // Several zones still to do in this part: keep the first, the others become new parts running alongside,
        // each continuing from this part's latest answer (so they know what it already reported).
        if (rem.length > 1) { const before = queue.length; rem.slice(1).forEach(x => add(x, last)); rem = rem.slice(0, 1); if (queue.length > before) { waiting(); kick(); } }
      }
    };
    await new Promise(resolve => {
      const pump = () => {
        while (running < limit && queue.length && round < maxRounds && !capHit() && !signal.aborted) {
          const it = queue.shift(); running++; waiting();
          runLane(it).catch(e => { failed.push(it.item); emit({ type: 'note', text: `Part failed: ${e.message}` }); }).finally(() => { running--; pump(); });
        }
        if (!running) resolve();
      };
      kick = pump; pump();
    });
    if (signal.aborted) stopped = 'Stopped by the user';
    else if (capHit()) stopped = capNote();
    left.push(...queue.splice(0).map(q => q.item));
    // every planned part must have run, or be listed as still to do (or as a warning: asks for a drawing nobody has)
    const lost = planned.filter(x => !started.has(x) && !JUNK.test(x) && ![...left, ...failed, ...twins].some(y => sameText(y, x)) && !planned.some(y => y !== x && sameText(y, x) && started.has(y)));
    if (lost.length) { left.push(...lost); emit({ type: 'note', text: `${lost.length} planned part${lost.length > 1 ? 's were' : ' was'} not run: listed as still to do.` }); }
    M.remaining = [...left, ...failed, ...twins];
    M.complete = !M.remaining.length && !signal.aborted;
    if (skipped.length) M.warnings = (M.warnings || []).concat(skipped.map(x => `Not measured, needs another drawing or view: ${x}`));
    laneSummary = { lanes: laneNo, done: lanesDone, failed: failed.length, left: left.length };
    if (!stopped && !M.complete) stopped = `${M.remaining.length} part${M.remaining.length > 1 ? 's' : ''} not finished (see "still to do")`;
    if (stopped) emit({ type: 'note', text: stopped + '.' });
  }
  if (multi && M && !M.complete && !stopped) { stopped = `Stopped after the maximum of ${maxRounds} rounds`; emit({ type: 'note', text: stopped + '.' }); }
  if (M && junk.size) M.warnings = (M.warnings || []).concat([...junk].map(x => `Not measured, needs another drawing or view: ${x}`));
  if (M && checks.size) M.warnings = (M.warnings || []).concat([...checks].map(x => `Left for the QS to check: ${x}`));
  return { result: M, raw, thinking: '', usage, model: lastModel, detail: ctx.detail, ms: Date.now() - t0, rounds: round, roundUsage: rounds, cost: costTotal, stopped, complete: !!(M && M.complete), lanes: laneSummary };
}

// Compact answers leave defaults out: no label_source = read on the element, no confidence = 0.9, a review_reason = needs review.
const labelSrc = (v, L = LABEL_SOURCES) => (v == null ? 'on_element' : L.includes(v) ? v : 'inferred');
function review(x) {
  const r = typeof x.review_reason === 'string' ? x.review_reason.replace(/\s+/g, ' ').trim() : '';
  const c = x.confidence == null || x.confidence === '' ? 0.9 : +x.confidence;
  return { confidence: Math.max(0, Math.min(1, isFinite(c) ? c : 0)), needs_review: !!x.needs_review || !!r, review_reason: r };
}
// Light normalisation so the app can trust the shape (the app does the quantity maths).
// Sheets are matched to the request by sheet_no (falling back to order); missing ones get an empty entry.
function clean(p, n) {
  const s = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const num = v => (v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v);
  const int = v => (Number.isInteger(+v) && +v >= 1 && +v <= n ? +v : null);
  const P = a => (Array.isArray(a) && a.length >= 2 && isFinite(+a[0]) && isFinite(+a[1]) ? [Math.max(0, Math.min(1000, +a[0])), Math.max(0, Math.min(1000, +a[1]))] : null);
  const strs = a => (Array.isArray(a) ? a : []).map(s).filter(Boolean);
  const sheetOf = (e, i) => {
    const sh = e && e.sheet || {}, seen = new Set();
    return {
      sheet_no: i + 1,
      sheet: {
        drawing_number: s(sh.drawing_number), title: s(sh.title), level: s(sh.level), scale: s(sh.scale),
        sheet_kind: SHEET_KINDS.includes(sh.sheet_kind) ? sh.sheet_kind : 'other', concrete_grade: s(sh.concrete_grade),
        typical_slab_thickness_mm: num(sh.typical_slab_thickness_mm), floor_height_mm: num(sh.floor_height_mm), notes: s(sh.notes),
      },
      calibration: (Array.isArray(e && e.calibration) ? e.calibration : []).map(c => ({ text: s(c.text), p1: P(c.p1), p2: P(c.p2), length_mm: num(c.length_mm) })).filter(c => c.p1 && c.p2 && c.length_mm > 0),
      elements: (Array.isArray(e && e.elements) ? e.elements : []).map((x, k) => {
        let id = s(x.id) || `E${k + 1}`; while (seen.has(id)) id += "'"; seen.add(id);
        return {
          id, kind: KINDS.includes(x.kind) ? x.kind : 'other', mark: s(x.mark), shape: x.shape === 'polyline' ? 'polyline' : 'polygon',
          pts: (Array.isArray(x.pts) ? x.pts : []).map(P).filter(Boolean),
          width_mm: num(x.width_mm), depth_mm: num(x.depth_mm), thickness_mm: num(x.thickness_mm), height_mm: num(x.height_mm), length_mm: num(x.length_mm),
          grid_ref: s(x.grid_ref), label_text: s(x.label_text), label_source: labelSrc(x.label_source), ref_sheet: int(x.ref_sheet),
          ...review(x), lines: s(x.lines),   // PDF line ids it was built from (PDF lines mode), else empty
        };
      }).filter(x => x.pts.length >= 2),
      warnings: strs(e && e.warnings),
    };
  };
  const given = Array.isArray(p && p.sheets) ? p.sheets : [];
  const sheets = Array.from({ length: n }, (_, i) => sheetOf(given.find(x => int(x && x.sheet_no) === i + 1) || given[i], i));
  if (given.length < n) sheets.forEach((x, i) => { if (!given.find(g => int(g && g.sheet_no) === i + 1) && !given[i]) x.warnings.unshift('The model returned nothing for this sheet.'); });
  return {
    sheets,
    types: (Array.isArray(p && p.types) ? p.types : []).map(t => ({ mark: s(t.mark), kind: KINDS.includes(t.kind) ? t.kind : 'other', width_mm: num(t.width_mm), depth_mm: num(t.depth_mm), thickness_mm: num(t.thickness_mm), source: TYPE_SOURCES.includes(t.source) ? t.source : 'label', text: s(t.text), sheet_no: int(t.sheet_no) })),
    cross_sheet_notes: strs(p && p.cross_sheet_notes),
    warnings: strs(p && p.warnings),
    summary: s(p && p.summary),
  };
}

// Models this key can use, for the model picker. Leaves out audio, image-generation, embedding and moderation models.
async function listModels(cfg) {
  const o = cfg.openai;
  if (!o.key) return [];
  const headers = { Authorization: `Bearer ${o.key}` };
  if (o.org) headers['OpenAI-Organization'] = o.org;
  if (o.project) headers['OpenAI-Project'] = o.project;
  const res = await fetch(`${o.baseUrl}/models`, { headers, signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new AiError((j && j.error && j.error.message) || res.statusText, res.status === 401 ? 'bad_key' : 'upstream_error', res.status);
  const skip = /audio|realtime|tts|transcribe|whisper|dall-e|image|embedding|moderation|babbage|davinci|search|instruct|codex|sora|computer-use/i;
  return (j.data || []).map(m => ({ id: m.id, created: m.created || 0 }))
    .filter(m => /^(gpt-|o\d|chatgpt-)/i.test(m.id) && !skip.test(m.id))
    .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
}

// PDF lines mode (lib/region.js): elements may name the drawn lines instead of giving points.
const LINE_SCHEMA = JSON.parse(JSON.stringify(SCHEMA));
Object.assign(LINE_SCHEMA.properties.sheets.items.properties.elements.items.properties, {
  lines: { type: 'string', description: 'Ids of the PDF lines that draw this element, from the sheet\'s line list: ids and ranges, e.g. "12-15,18". Use instead of pts.' },
  from: { ...pt, description: 'Only when one drawn line runs over several spans: this span\'s start support centre on the image.' },
  to: { ...pt, description: 'With from: this span\'s end support centre on the image.' },
});
orderProps(LINE_SCHEMA.properties.sheets.items.properties.elements.items, ['id', 'kind', 'mark', 'shape', 'lines', 'from', 'to']);
const LINE_RULES = `PDF LINES (each sheet's drawn lines come as a numbered list after its image)
- Name the lines that draw each element in "lines" (ids and ranges, e.g. "12-15,18") and leave out "pts". The software builds the geometry from those lines, so sizes are exact.
- Use the image to see what each line is (labels, hatching, line weight, dashed or not), then take its ids from the list. Ids are ordered: horizontal lines top to bottom, vertical lines left to right, then the others by angle.
- Lines that are not part of what you measure (grids, dimensions, text, hatching, symbols, other trades) are simply not named.
- Beams and walls ("polyline"): list the two face lines of ONE span (or its centreline if that is drawn). The software takes the line midway between them, from support to support. One drawn line running over several spans: report each span with that id plus "from" and "to" (its support centres on the image).
- Columns, footings, pile caps and stairs ("polygon"): list the lines of the outline IN ORDER around it, one side after the other (pieces of the same side next to each other).
- Slabs: give "pts" as usual (panels follow beam centrelines, which are not drawn as lines).`;

// What makes a measurement tool: its schema, default prompt, answer clean-up and the words used when asking for rounds.
const CONC = {
  id: 'conc', name: 'conc_fwk_takeoff', schema: SCHEMA, prompt: DEFAULT_PROMPT, clean,
  always: 'id, kind, mark (when printed), shape, pts (or lines), and every size you read',
  lineSchema: LINE_SCHEMA, lineRules: LINE_RULES,
  noun: 'elements', order: 'Work sheet by sheet and grid bay by grid bay, finishing whole bays.',
  all: 'every element of the requested kinds on every plan sheet',
  measureLine: k => `Measure these kinds only: ${(k && k.length ? k : ['column', 'beam', 'slab']).join(', ')}.`,
};

module.exports = { orderProps, ANSWER_ORDER, REASON_CODES, REASON_DESC, labelSrc, review, runTakeoff, listModels, SCHEMA, DEFAULT_PROMPT, KINDS, MODEL_EFFORTS, AiError, CONC, SHEET_KINDS, LABEL_SOURCES };
