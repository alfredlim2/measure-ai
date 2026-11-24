// Steel structure takeoff profile: members (columns, beams, bracing, purlins / girts, rafters / trusses, secondary steel)
// and connections (plates and bolts), read from plans, elevations, sections and connection details.
// The model reports geometry (member centrelines, column positions), what is printed (profile designations, levels,
// plate sizes, bolt counts) and where it read it. The app computes every length, plate area / volume and bolt count,
// so each quantity is traceable. Unit weights (kg/m) are not asked for: they are applied later from the user's input.
const MEMBER_KINDS = ['column', 'beam', 'bracing', 'purlin', 'girt', 'rafter', 'truss', 'sag_rod', 'tie_rod', 'stair', 'handrail', 'other'];
const FAMILIES = ['wf', 'channel', 'lip_channel', 'z', 'angle', 'tee', 'chs', 'rhs', 'shs', 'rod', 'flat', 'plate', 'other'];
const VIEWS = ['plan', 'elevation', 'section', 'detail'];
const SHEET_KINDS = ['plan', 'roof_plan', 'elevation', 'section', 'connection_detail', 'schedule', 'other'];
const CONN_KINDS = ['base_plate', 'end_plate', 'fin_plate', 'splice', 'gusset', 'cap_plate', 'stiffener', 'cleat', 'other'];
const LABEL_SOURCES = ['on_element', 'nearby', 'schedule', 'typical_note', 'other_sheet', 'inferred'];
const takeoff = require('./takeoff');

const num = d => ({ type: ['number', 'null'], description: d });
const str = d => ({ type: 'string', description: d });
const obj = (props, req) => ({ type: 'object', additionalProperties: false, required: req || Object.keys(props), properties: props });
const pt = { type: 'array', items: { type: 'integer' }, description: '[x, y] as whole numbers in normalized image coordinates (0–1000) of THIS sheet\'s image.' };

const DIMS = obj({
  d_mm: num('Depth / height of the section (WF 300x150 → 300; C 150x50 → 150; RHS 200x100 → 200).'),
  b_mm: num('Flange width / breadth (WF 300x150 → 150).'),
  tw_mm: num('Web thickness.'), tf_mm: num('Flange thickness.'),
  t_mm: num('Wall / leg / plate thickness for CHS, RHS, SHS, angles, lip channels, flats, plates.'),
  dia_mm: num('Outside diameter for CHS / pipe, or bar diameter for rods.'),
});
const PLATE = obj({
  name: str('What the plate is, e.g. "base plate", "stiffener", "end plate".'),
  length_mm: num('Plate length.'), width_mm: num('Plate width.'), thickness_mm: num('Plate thickness.'),
  count: { type: 'integer', description: 'Number of these plates in ONE connection.' },
});
const BOLTS = obj({
  count: { type: ['integer', 'null'], description: 'Number of bolts in ONE connection. null if not shown.' },
  dia_mm: num('Bolt diameter, e.g. M20 → 20.'),
  grade: str('Grade / class as printed, e.g. "8.8", "A325", "F10T". Empty if none.'),
  type: { type: 'string', enum: ['structural', 'anchor', 'none'], description: 'anchor = anchor / holding-down bolts at bases; structural = connection bolts; none = welded only.' },
});

const MEMBER = obj({
  id: str('Unique on this sheet: C1… columns, B1… beams, BR1… bracing, P1… purlins, G1… girts, R1… rafters, T1… truss members, S1… secondary.'),
  kind: { type: 'string', enum: MEMBER_KINDS },
  mark: str('Member mark as printed, e.g. "SC1", "SB2", "BR1". Empty if none.'),
  profile: str('Section designation exactly as printed or as given by its schedule, e.g. "WF 300x150x6.5x9", "H 200x200x8x12", "C 150x50x20x2.3", "CHS 114.3x4.5", "L 50x50x5", "Ø16". Empty if not found anywhere.'),
  family: { type: 'string', enum: FAMILIES, description: 'wf = WF / IWF / H-beam / I-beam; channel = UNP / C (no lip); lip_channel = CNP / lipped C purlin; z = Z purlin; chs = pipe; rod = round bar / sag rod.' },
  dims: DIMS,
  view: { type: 'string', enum: VIEWS, description: 'The view this member is measured in (plan / elevation / section / detail).' },
  shape: { type: 'string', enum: ['line', 'point'], description: 'line = centreline drawn in this view (pts = its points from one end to the other, through any bends). point = a member seen end-on, i.e. a column on a plan (pts = one point at the column centre).' },
  pts: { type: 'array', items: pt, description: 'line: centreline points from one end to the other (end = centre of the support / intersection). point: one point.' },
  qty: { type: 'integer', description: 'Number of identical physical members this entry stands for. 1 when every member is drawn and reported on its own. More than 1 ONLY when the drawing shows one member and states it repeats (e.g. "typical for grids 2–8", "purlins @ 1200, 9 nos"); explain in qty_note.' },
  qty_note: str('Why qty is more than 1, quoting the drawing. Empty when qty is 1.'),
  top_level_m: num('Columns and other vertical members: top level in metres as printed on a section / elevation / schedule (e.g. "+8.200" → 8.2). null otherwise.'),
  bottom_level_m: num('Columns: bottom level in metres (e.g. top of base plate / pedestal "+0.300" → 0.3; "±0.000" → 0). null otherwise.'),
  level_ref: str('Where top / bottom levels were read: sheet number, view name and the printed level marks, e.g. "Sheet 4, Section A-A: +8.200 / +0.300". Empty if no levels.'),
  slope_deg: num('Only for members drawn on a PLAN that actually slope (rafters, roof bracing on a roof plan): roof pitch in degrees as printed. null otherwise.'),
  length_mm: num('Member length from a printed dimension that spans it (support to support), if any. null otherwise.'),
  view_scale: str('Scale of the view this member is drawn in, if it differs from the sheet\'s main scale (e.g. a 1:50 section on a 1:100 sheet). Empty otherwise.'),
  grid_ref: str('Grid location, e.g. "B / 3–4", "C-5". Empty if no grids.'),
  label_text: str('The mark / profile text you used, as printed.'),
  label_source: { type: 'string', enum: LABEL_SOURCES },
  ref_sheet: { type: ['integer', 'null'], description: 'Sheet number the profile or levels came from, if not this sheet.' },
  confidence: { type: 'number', description: '0 to 1: geometry, profile and levels together.' },
  needs_review: { type: 'boolean' },
  review_reason: str(takeoff.REASON_DESC),
});
const CONNECTION = obj({
  id: str('Unique on this sheet: J1, J2…'),
  type_mark: str('Connection type / detail mark this joint uses, matching connection_types (e.g. "BP1", "Detail 3"). Empty if none.'),
  kind: { type: 'string', enum: CONN_KINDS },
  at: { ...pt, description: 'Position of the joint on this sheet (e.g. the column centre for a base plate, the beam end for an end plate).' },
  members: { type: 'array', items: { type: 'string' }, description: 'Ids of the members it joins (on this sheet).' },
  qty: { type: 'integer', description: 'Number of identical joints this entry stands for (1 if each is reported on its own).' },
  plates: { type: 'array', items: PLATE, description: 'Only when there is NO connection type for this joint: its plates as read here. Empty when type_mark gives them.' },
  bolts: BOLTS,
  confidence: { type: 'number' },
  needs_review: { type: 'boolean' },
  review_reason: str(takeoff.REASON_DESC),
});
// A run of identical, parallel, equally spaced members written once (purlins in a bay, girts, sag-rod lines, frames):
// the software draws every member between the first and the last, snaps each onto its drawn line and measures it.
const PATTERN = obj({
  id: str('Unique on this sheet: PAT1, PAT2…'),
  kind: { type: 'string', enum: MEMBER_KINDS },
  mark: str('Member mark as printed. Empty if none.'),
  profile: str('Section designation as printed or from its schedule, e.g. "C 125x50x20x2.3", "Ø10".'),
  family: { type: 'string', enum: FAMILIES },
  dims: DIMS,
  view: { type: 'string', enum: VIEWS },
  first: { type: 'array', items: pt, description: 'Centreline of the FIRST member of the run, from one end to the other.' },
  last: { type: 'array', items: pt, description: 'Centreline of the LAST member of the run, in the same direction as first.' },
  count: { type: 'integer', description: 'Number of members in the run, first and last included (3 or more).' },
  spacing_mm: num('Spacing between members as printed (e.g. "@1000" → 1000). null if not printed.'),
  slope_deg: num('Members drawn on a PLAN that actually slope (purlins / rafters on a roof plan): roof pitch in degrees. null otherwise.'),
  length_mm: num('Length of each member from a printed dimension, if any. null otherwise.'),
  view_scale: str('Scale of this view if it differs from the sheet\'s main scale. Empty otherwise.'),
  grid_ref: str('Grid location of the run, e.g. "X1–X2 / Y13–Y14". Empty if no grids.'),
  label_text: str('The mark / profile / spacing text you used, as printed.'),
  label_source: { type: 'string', enum: LABEL_SOURCES },
  ref_sheet: { type: ['integer', 'null'], description: 'Sheet number the profile came from, if not this sheet.' },
  confidence: { type: 'number', description: '0 to 1: run geometry, count and profile together.' },
  needs_review: { type: 'boolean' },
  review_reason: str(takeoff.REASON_DESC),
});
// A connection detail that applies at every location of one kind: the software finds the locations from the members.
const CONN_RULE = obj({
  type_mark: str('Connection type / detail mark, matching connection_types (e.g. "Tambat gording", "BP1"). Empty if none.'),
  kind: { type: 'string', enum: CONN_KINDS },
  applies_to_kind: { type: 'string', enum: MEMBER_KINDS, description: 'The member kind the rule is about.' },
  applies_to_mark: str('Only members with this mark. Empty = every member of that kind.'),
  where: { type: 'string', enum: ['each_end', 'each_crossing', 'each_base', 'each_member'], description: 'each_end = at both ends of every such member (shared ends count once); each_crossing = wherever such a member crosses a member of crossing_kind; each_base = at every column base (point columns); each_member = one per member.' },
  crossing_kind: { type: ['string', 'null'], enum: [...MEMBER_KINDS, null], description: 'For each_crossing: the member kind it crosses (e.g. rafter, beam). null otherwise.' },
  per_location: { type: 'integer', description: 'Number of these connections at each location (usually 1).' },
  plates: { type: 'array', items: PLATE, description: 'Only when there is NO connection type: plates per connection as read. Empty when type_mark gives them.' },
  bolts: BOLTS,
  text: str('Note or detail title you based the rule on, as printed.'),
  confidence: { type: 'number' },
  needs_review: { type: 'boolean' },
  review_reason: str(takeoff.REASON_DESC),
});

const SCHEMA = obj({
  complete: { type: 'boolean', description: 'true only when, together with earlier rounds, every member and connection of the requested kinds has been reported.' },
  remaining: { type: 'array', items: { type: 'string' }, description: 'What is still to do after this answer, e.g. "Sheet 2: purlins in bays 5–9". Empty when complete.' },
  sheets: { type: 'array', description: 'One entry per sheet you were given, in the same order.', items: obj({
    sheet_no: { type: 'integer' },
    sheet: obj({
      drawing_number: str('As printed. Empty if not visible.'), title: str('As printed.'), level: str('Floor / level, as printed.'), scale: str('Main view scale, e.g. "1:100".'),
      sheet_kind: { type: 'string', enum: SHEET_KINDS },
      steel_grade: str('Steel grade from notes, e.g. "BJ 37", "SS400", "A36". Empty if none.'),
      notes: str('Notes that affect the takeoff (typical connections, bolt grade, purlin spacing, "all members WF… unless noted").'),
    }),
    levels: { type: 'array', description: 'Level marks read on this sheet (sections / elevations), e.g. "TOP OF COLUMN +8.200".', items: obj({ name: str('As printed.'), level_m: { type: 'number' }, text: str('As printed.') }) },
    calibration: { type: 'array', description: 'Up to 4 long printed dimensions on this sheet\'s main view with the two points they measure between.', items: obj({ text: str('Dimension as printed.'), p1: pt, p2: pt, length_mm: { type: 'number' } }) },
    elements: { type: 'array', description: 'Single / irregular steel members measured on this sheet.', items: MEMBER },
    patterns: { type: 'array', description: 'Runs of 3 or more identical, parallel, equally spaced members on this sheet, each written once.', items: PATTERN },
    connections: { type: 'array', description: 'One-off joints on this sheet that no connection rule covers.', items: CONNECTION },
    warnings: { type: 'array', items: { type: 'string' } },
  }) },
  types: { type: 'array', description: 'Member marks and their profiles read anywhere in the set (steel schedule, legend, notes).', items: obj({
    mark: str('Member mark, e.g. "SC1", "SB2", "P1".'), kind: { type: 'string', enum: MEMBER_KINDS }, profile: str('Designation as printed.'), family: { type: 'string', enum: FAMILIES }, dims: DIMS,
    text: str('As printed.'), sheet_no: { type: 'integer' } }) },
  connection_types: { type: 'array', description: 'Connection details read anywhere in the set: one entry per detail / type.', items: obj({
    mark: str('Detail or type mark, e.g. "BP1", "Detail 3", "Typical beam-column connection".'), kind: { type: 'string', enum: CONN_KINDS },
    plates: { type: 'array', items: PLATE }, bolts: BOLTS, text: str('Title / notes of the detail, as printed.'), sheet_no: { type: 'integer' } }) },
  connection_rules: { type: 'array', description: 'Connections that apply at every location of one kind (e.g. a cleat at every purlin-rafter crossing, a base plate at every column base).', items: CONN_RULE },
  cross_sheet_notes: { type: 'array', items: { type: 'string' }, description: 'How the sheets were combined (e.g. "Column heights from Section A-A on sheet 4"), which view each kind was measured in, and conflicts.' },
  warnings: { type: 'array', items: { type: 'string' } },
  summary: str('Two or three sentences.'),
});

const PROMPT = `You are a senior quantity surveyor doing a STRUCTURAL STEEL takeoff from a SET of drawing sheets sent together: framing plans, roof plans, elevations, sections, connection details and steel schedules.
Each sheet comes as "Sheet n" with its register details, (if sent) its PDF text layer with positions, and an image of the whole sheet.
Report every steel member and every connection. Software computes every length, plate area, plate volume and bolt count from what you report, so geometry must be exact and every value traceable to something printed. Do not compute weights.

WORK ACROSS THE SET
- First identify every sheet (plan, roof plan, elevation, section, connection detail, schedule) and its level / gridline.
- Measure each PHYSICAL member ONCE, in the view where its length is true:
  - columns: on the plan, as a point at the column centre, with top and bottom levels read from sections, elevations or a column schedule (top_level_m / bottom_level_m / level_ref). If no plan shows them, as a line on an elevation or section.
  - beams, plan bracing, purlins: on plans / roof plans as centrelines. Purlins or rafters on a sloping roof drawn on plan: give slope_deg (roof pitch).
  - vertical bracing, girts, trusses, portal rafters: on elevations or sections as centrelines (true length there).
  - secondary steel (sag rods, tie rods, stairs, handrails): where they are drawn.
  Say in cross_sheet_notes which view each kind was measured in. Never report the same member from two views.
- Profiles: from the label on the member, else the steel schedule / legend by mark, else a typical note. Put every mark → profile you read into "types". Give the designation as printed in "profile" and split its numbers into dims.
- Connections: read every connection detail into "connection_types" (plates with length × width × thickness and count per joint; bolts with count per joint, diameter, grade, anchor or structural). Then on the plans / elevations report each joint where a typed connection occurs, with type_mark and its position. Base plates go at every column base. If a joint has no detail, give its plates / bolts directly when printed, else leave them empty (review_reason "no_detail").
- When sources disagree, use the more specific one (review_reason "conflict"); list the conflict in cross_sheet_notes.
- Return one "sheets" entry per sheet, in order. Members and joints belong to the sheet they are drawn on; points are on that sheet's image.

COORDINATES
- Normalized image coordinates of the member's own sheet: x = 0 left to 1000 right, y = 0 top to 1000 bottom, scaled separately. Whole numbers.
- A line member runs from the centre of one support / intersection to the other along its centreline (gridline), through any bends. The software measures the length at the sheet scale; put the ends exactly on the support centres.
- Columns on plan: one point at the column centre (the grid intersection or the drawn section centre).
- If a view has its own scale (e.g. a 1:50 section on a 1:100 sheet), give it in view_scale.
- Repeated members drawn on the sheet: see REPEATS in the answer rules. Use qty > 1 only when the drawing shows one member and states it repeats; quote that in qty_note.

LEVELS AND SIZES
- Levels in metres as printed (+8.200 → 8.2). Sizes in millimetres; convert cm or m.
- Never invent a profile, level, plate size or bolt count. If unknown in the whole set, leave it empty (review_reason "no_size" or "level_unsure").

SCALE CHECK
- For each plan, elevation and section sheet give in "calibration" up to 4 long printed dimensions (grid to grid) with the exact two points they span and the length in mm.

QUALITY
- Keep the answer compact: coordinates as whole numbers, label_text only the text you read.
- The goal is full coverage: every member and every joint of the requested kinds. Work sheet by sheet and grid bay by grid bay.
- If the message asks you to work in rounds, keep to the size it gives for each answer and say exactly what is left in "remaining"; you will be asked to continue until "complete" is true.
- Never return an empty member list for a framing plan because it is large or dense. A best-effort member flagged with needs_review is far more useful than nothing.
- confidence: 0.9+ only when geometry, profile and levels are all clearly read; lower when taken from a typical note or inferred.
Return JSON only, matching the schema.`;

function clean(p, n) {
  const s = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const num = v => (v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v);
  const pos = v => { const x = num(v); return x != null && x > 0 ? x : null; };
  const int = v => (Number.isInteger(+v) && +v >= 1 && +v <= n ? +v : null);
  const cnt = v => (Number.isInteger(+v) && +v >= 1 ? Math.min(+v, 10000) : 1);
  const P = a => (Array.isArray(a) && a.length >= 2 && isFinite(+a[0]) && isFinite(+a[1]) ? [Math.max(0, Math.min(1000, +a[0])), Math.max(0, Math.min(1000, +a[1]))] : null);
  const strs = a => (Array.isArray(a) ? a : []).map(s).filter(Boolean);
  const o = v => (v && typeof v === 'object' ? v : {});
  const dims = d => { d = o(d); return { d_mm: pos(d.d_mm), b_mm: pos(d.b_mm), tw_mm: pos(d.tw_mm), tf_mm: pos(d.tf_mm), t_mm: pos(d.t_mm), dia_mm: pos(d.dia_mm) }; };
  const plates = a => (Array.isArray(a) ? a : []).map(x => ({ name: s(o(x).name), length_mm: pos(o(x).length_mm), width_mm: pos(o(x).width_mm), thickness_mm: pos(o(x).thickness_mm), count: cnt(o(x).count) }));
  const bolts = b => { b = o(b); const c = num(b.count); return { count: c != null && c >= 0 ? Math.round(c) : null, dia_mm: pos(b.dia_mm), grade: s(b.grade), type: ['structural', 'anchor', 'none'].includes(b.type) ? b.type : 'structural' }; };
  const member = (x, k, seen) => {
    let id = s(x.id) || `M${k + 1}`; while (seen.has(id)) id += "'"; seen.add(id);
    const pts = (Array.isArray(x.pts) ? x.pts : []).map(P).filter(Boolean);
    const shape = x.shape === 'point' || pts.length === 1 ? 'point' : 'line';
    return {
      id, kind: MEMBER_KINDS.includes(x.kind) ? x.kind : 'other', mark: s(x.mark), profile: s(x.profile), family: FAMILIES.includes(x.family) ? x.family : 'other', dims: dims(x.dims),
      view: VIEWS.includes(x.view) ? x.view : 'plan', shape, pts: shape === 'point' ? pts.slice(0, 1) : pts,
      qty: cnt(x.qty), qty_note: s(x.qty_note),
      top_level_m: num(x.top_level_m), bottom_level_m: num(x.bottom_level_m), level_ref: s(x.level_ref),
      slope_deg: (() => { const v = num(x.slope_deg); return v != null && v > 0 && v < 80 ? v : null; })(),
      length_mm: pos(x.length_mm), view_scale: s(x.view_scale), grid_ref: s(x.grid_ref),
      label_text: s(x.label_text), label_source: takeoff.labelSrc(x.label_source, LABEL_SOURCES), ref_sheet: int(x.ref_sheet),
      ...takeoff.review(x), lines: s(x.lines),   // PDF line ids it was measured from (PDF lines mode), else empty
    };
  };
  const joint = (x, k, seen) => {
    let id = s(x.id) || `J${k + 1}`; while (seen.has(id)) id += "'"; seen.add(id);
    return { id, type_mark: s(x.type_mark), kind: CONN_KINDS.includes(x.kind) ? x.kind : 'other', at: P(x.at), members: strs(x.members), qty: cnt(x.qty),
      plates: plates(x.plates), bolts: bolts(x.bolts), ...takeoff.review(x) };
  };
  const pattern = (x, k, seen) => {
    let id = s(x.id) || `PAT${k + 1}`; while (seen.has(id)) id += "'"; seen.add(id);
    const line = a => (Array.isArray(a) ? a : []).map(P).filter(Boolean);
    return {
      id, kind: MEMBER_KINDS.includes(x.kind) ? x.kind : 'other', mark: s(x.mark), profile: s(x.profile), family: FAMILIES.includes(x.family) ? x.family : 'other', dims: dims(x.dims),
      view: VIEWS.includes(x.view) ? x.view : 'plan', first: line(x.first), last: line(x.last),
      count: Number.isInteger(+x.count) && +x.count >= 2 ? Math.min(+x.count, 2000) : 0, spacing_mm: pos(x.spacing_mm),
      slope_deg: (() => { const v = num(x.slope_deg); return v != null && v > 0 && v < 80 ? v : null; })(),
      length_mm: pos(x.length_mm), view_scale: s(x.view_scale), grid_ref: s(x.grid_ref),
      label_text: s(x.label_text), label_source: takeoff.labelSrc(x.label_source, LABEL_SOURCES), ref_sheet: int(x.ref_sheet),
      ...takeoff.review(x),
    };
  };
  const sheetOf = (e, i) => {
    const sh = o(e && e.sheet), seen = new Set(), seenJ = new Set(), seenP = new Set();
    return {
      sheet_no: i + 1,
      sheet: { drawing_number: s(sh.drawing_number), title: s(sh.title), level: s(sh.level), scale: s(sh.scale), sheet_kind: SHEET_KINDS.includes(sh.sheet_kind) ? sh.sheet_kind : 'other', steel_grade: s(sh.steel_grade), notes: s(sh.notes) },
      levels: (Array.isArray(e && e.levels) ? e.levels : []).map(l => ({ name: s(o(l).name), level_m: num(o(l).level_m), text: s(o(l).text) })).filter(l => l.level_m != null),
      calibration: (Array.isArray(e && e.calibration) ? e.calibration : []).map(c => ({ text: s(c.text), p1: P(c.p1), p2: P(c.p2), length_mm: num(c.length_mm) })).filter(c => c.p1 && c.p2 && c.length_mm > 0),
      elements: (Array.isArray(e && e.elements) ? e.elements : []).map((x, k) => member(o(x), k, seen)).filter(x => x.pts.length >= 1),
      patterns: (Array.isArray(e && e.patterns) ? e.patterns : []).map((x, k) => pattern(o(x), k, seenP)).filter(x => x.first.length >= 2 && x.last.length >= 2 && x.count >= 2),
      connections: (Array.isArray(e && e.connections) ? e.connections : []).map((x, k) => joint(o(x), k, seenJ)).filter(x => x.at),
      warnings: strs(e && e.warnings),
    };
  };
  const given = Array.isArray(p && p.sheets) ? p.sheets : [];
  const sheets = Array.from({ length: n }, (_, i) => sheetOf(given.find(x => int(x && x.sheet_no) === i + 1) || given[i], i));
  return {
    sheets,
    types: (Array.isArray(p && p.types) ? p.types : []).map(t => ({ mark: s(t.mark), kind: MEMBER_KINDS.includes(t.kind) ? t.kind : 'other', profile: s(t.profile), family: FAMILIES.includes(t.family) ? t.family : 'other', dims: dims(t.dims), text: s(t.text), sheet_no: int(t.sheet_no) })).filter(t => t.mark || t.profile),
    connection_types: (Array.isArray(p && p.connection_types) ? p.connection_types : []).map(t => ({ mark: s(t.mark), kind: CONN_KINDS.includes(t.kind) ? t.kind : 'other', plates: plates(t.plates), bolts: bolts(t.bolts), text: s(t.text), sheet_no: int(t.sheet_no) })).filter(t => t.mark),
    connection_rules: (Array.isArray(p && p.connection_rules) ? p.connection_rules : []).map(x => { x = o(x); return {
      type_mark: s(x.type_mark), kind: CONN_KINDS.includes(x.kind) ? x.kind : 'other', applies_to_kind: MEMBER_KINDS.includes(x.applies_to_kind) ? x.applies_to_kind : null, applies_to_mark: s(x.applies_to_mark),
      where: ['each_end', 'each_crossing', 'each_base', 'each_member'].includes(x.where) ? x.where : null, crossing_kind: MEMBER_KINDS.includes(x.crossing_kind) ? x.crossing_kind : null,
      per_location: cnt(x.per_location), plates: plates(x.plates), bolts: bolts(x.bolts), text: s(x.text),
      ...takeoff.review(x) }; })
      .filter(r => r.applies_to_kind && r.where && (r.where !== 'each_crossing' || r.crossing_kind)),
    cross_sheet_notes: strs(p && p.cross_sheet_notes), warnings: strs(p && p.warnings), summary: s(p && p.summary),
  };
}

// Answer order: definitions (types, connection details) first so live elements already have their profiles;
// per sheet: scale and levels before members, connections after them.
takeoff.orderProps(SCHEMA, ['types', 'connection_types', 'connection_rules', ...takeoff.ANSWER_ORDER]);
takeoff.orderProps(SCHEMA.properties.sheets.items, ['sheet_no', 'sheet', 'levels', 'calibration', 'patterns', 'elements', 'connections', 'warnings']);

const RULES = 'REPEATS: WRITE A RUN ONCE\n- When 3 or more members of the same kind, mark and profile are parallel and equally spaced (purlins in a bay, girts on a wall, sag-rod lines, rafters / frames on a regular grid), report ONE entry in "patterns": the first and the last member\'s centrelines (same direction), count (first and last included) and the printed spacing. The software draws every member of the run, snaps each onto its drawn line and measures it. Do not also list those members in "elements".\n- Break a run where the spacing, profile, length or direction changes, or where members stop at a grid line. Members that are single or irregular stay in "elements".\n- Connections: when a detail applies at every location of one kind (a purlin cleat at every purlin-rafter crossing, a base plate at every column base, an end plate at each sag-rod end), report it ONCE in "connection_rules" (applies_to_kind, applies_to_mark if only some members, where = each_end / each_crossing with crossing_kind / each_base / each_member, per_location). The software finds the locations from the members and patterns. Report single joints in "connections" only where no rule covers them; never both for the same joints.\n- A member, pattern or joint whose mark is in "types" / "connection_types" takes its profile, family, dims, plates and bolts from there: write them on the item only when it differs from its type or has no mark.';

// PDF lines mode (lib/region.js): the same schema, members may name the drawn lines instead of giving points.
const LINE_SCHEMA = JSON.parse(JSON.stringify(SCHEMA));
Object.assign(LINE_SCHEMA.properties.sheets.items.properties.elements.items.properties, {
  lines: str('Ids of the PDF lines that draw this member, from the sheet\'s line list: ids and ranges, e.g. "12-15,18". Use instead of pts.'),
  each: { type: 'boolean', description: 'true = every listed line is a separate member of this kind and mark (one line per member).' },
  from: { ...pt, description: 'Only when one drawn line runs over several members: this member\'s start support point on the image.' },
  to: { ...pt, description: 'With from: this member\'s end support point on the image.' },
});
takeoff.orderProps(LINE_SCHEMA.properties.sheets.items.properties.elements.items, ['id', 'kind', 'mark', 'view', 'lines', 'each', 'from', 'to']);
const LINE_RULES = `PDF LINES (each sheet's drawn lines come as a numbered list after its image)
- Do not write coordinates for members: name the lines that draw each member in "lines" (ids and ranges, e.g. "12-15,18") and leave out "pts". The software measures every member from its lines, so lengths are exact.
- Use the image to see what each line is (marks and profile labels next to it, line weight, dashed or not), then take its ids from the list. Ids are ordered: horizontal lines top to bottom, vertical lines left to right, then the others by angle, so a run of parallel members usually has consecutive ids.
- One member = one physical piece (one span or bay between supports). A member drawn as two parallel lines (flanges, a section outline): list both. A member drawn in pieces (dashed, broken by other lines): list all pieces.
- One drawn line running over several members (e.g. three bays drawn as one line): report each member with that line id plus "from" and "to" (its two support points on the image). Never report several bays as one member.
- "each": true = every listed line is a separate member of this kind and mark (e.g. 24 purlins drawn as single lines: "lines": "40-63", "each": true); list exactly one line per member then. In this mode use "each" instead of "patterns".
- Columns seen end-on on a plan: list the lines of the column symbol; the software takes its centre.
- Lines that are not steel members (grids, dimensions, text, hatching, concrete, symbols) are simply not named.
- Joints keep their "at" point; "connection_rules" work as usual from the members.`;

const KIND_WORDS = { column: 'columns', beam: 'beams', bracing: 'bracing', purlin: 'purlins', girt: 'girts', rafter: 'rafters', truss: 'truss members', sag_rod: 'sag rods', tie_rod: 'tie rods', stair: 'steel stairs', handrail: 'handrails', other: 'other steel', connection: 'connections (plates and bolts)' };
const STL = {
  id: 'steel', name: 'steel_takeoff', schema: SCHEMA, prompt: PROMPT, clean,
  // fixed rules added after the prompt (also an edited one), see takeoff.answerRules
  rules: RULES, lineSchema: LINE_SCHEMA, lineRules: LINE_RULES,
  always: 'id, kind, mark (when printed), view, and shape + pts (patterns: first, last, count; joints: at), and every printed value you read',
  remarksNote: 'qty_note only when qty is more than 1; level_ref only when the levels are not in the sheet "levels"; rule text only the detail title.',
  noun: 'members', order: 'Work sheet by sheet and grid bay by grid bay, finishing whole bays; connection details first.',
  all: 'every member and connection of the requested kinds on every sheet',
  measureLine: k => {
    const L = k && k.length ? k : Object.keys(KIND_WORDS);
    const words = [...new Set(L.map(x => KIND_WORDS[x] || x))];
    return `Measure these only: ${words.join(', ')}.${L.includes('connection') ? '' : ' Skip connections (leave "connections" and "connection_types" empty).'}`;
  },
};

module.exports = { STL, SCHEMA, PROMPT, MEMBER_KINDS, FAMILIES, CONN_KINDS };
