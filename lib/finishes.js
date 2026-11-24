// Finishes takeoff profile: rooms with their outline, finishes, heights and openings, read from plans and schedules.
// The model reports geometry (room outlines, which edges are walls, where the doors and windows are) and what the
// schedules say (finish codes, heights). The app computes every length and area from that, so each quantity is traceable.
const SHEET_KINDS = ['floor_plan', 'finish_plan', 'reflected_ceiling_plan', 'room_finish_schedule', 'door_window_schedule', 'section', 'detail', 'other'];
const EDGE = ['wall', 'glazing', 'opening', 'none'];
const CEILING = ['suspended', 'direct', 'exposed', 'none', 'unknown'];
const OPENING = ['door', 'window', 'opening'];
const TYPE_KINDS = ['floor', 'wall', 'ceiling', 'skirting', 'waterproofing', 'door', 'window'];
const SOURCES = ['schedule', 'room_tag', 'finish_plan', 'legend', 'note', 'other_sheet', 'inferred'];
const takeoff = require('./takeoff');
const QTY = { floor: 'floor finish', wall: 'wall finish', skirting: 'skirting', suspended_ceiling: 'suspended ceiling', ceiling_paint: 'ceiling finish painted directly on the slab soffit', waterproofing: 'waterproofing' };

const num = d => ({ type: ['number', 'null'], description: d });
const str = d => ({ type: 'string', description: d });
const obj = (props, req) => ({ type: 'object', additionalProperties: false, required: req || Object.keys(props), properties: props });
const pt = { type: 'array', items: { type: 'integer' }, description: '[x, y] as whole numbers in normalized image coordinates (0–1000) of THIS sheet\'s image.' };   // whole numbers: shorter answers; the app snaps outlines to the PDF vectors

const ROOM = obj({
  id: str('Unique on this sheet: R1, R2, …'),
  kind: { type: 'string', enum: ['room'] },
  number: str('Room number / code as printed, e.g. "B-012". Empty if none.'),
  name: str('Room name as printed, original language, e.g. "TOILET PRIA". Empty if none.'),
  shape: { type: 'string', enum: ['polygon'] },
  pts: { type: 'array', items: pt, description: 'Room outline on the FINISHED FACE of its walls (inside face), corners in order, not repeating the first.' },
  edges: { type: 'array', items: { type: 'string', enum: EDGE }, description: 'One entry per outline edge, same count as pts: edge i runs from pts[i] to pts[i+1] (the last back to pts[0]). wall = a wall that gets wall finish and skirting; glazing = curtain wall / full-height glass; opening = open side to another space; none = anything else.' },
  printed_area_m2: num('Room area printed on the plan or schedule, if any.'),
  floor_finish: obj({ code: str('Finish code, e.g. "F2". Empty if none.'), name: str('Description, e.g. "Homogeneous tile 600x600". Empty if none.') }),
  wall_finishes: { type: 'array', description: 'Wall finish layers from bottom to top, e.g. ceramic tile 0–1500 then paint 1500–ceiling. Empty if the room has no wall finish.', items: obj({ code: str('Finish code or empty.'), name: str('Description.'), bottom_mm: num('Height above floor where this layer starts; null = from the floor.'), top_mm: num('Height above floor where it ends; null = up to the ceiling (or slab soffit if there is no ceiling).') }) },
  skirting: obj({ code: str('Skirting code or empty.'), name: str('Description, empty if no skirting.'), height_mm: num('Skirting height.') }),
  ceiling: obj({ type: { type: 'string', enum: CEILING, description: 'suspended = a hung ceiling (gypsum, calcium silicate, acoustic tile…); direct = finish applied straight to the slab soffit (paint/skim on concrete); exposed = bare soffit; none = open to sky; unknown = not stated.' }, code: str('Ceiling code or empty.'), name: str('Description.'), height_mm: num('Finished ceiling height above floor (e.g. "+2.80", "CH 2800").') }),
  slab_soffit_mm: num('Height from finished floor to the slab soffit above, if it can be read (sections, level marks, floor-to-floor minus slab). null otherwise.'),
  waterproofing: obj({ floor: { type: 'boolean', description: 'true if the floor gets waterproofing.' }, upturn_mm: num('Height the waterproofing turns up the walls; null if none.'), code: str('Code or empty.'), name: str('Description or empty.') }),
  obstructions: { type: 'array', description: 'Elements standing on the slab INSIDE this room outline whose footprint gets no floor finish: structural columns, wall stubs / internal walls that do not bound the room, shafts, ducts, fixed plinths. Empty if none.', items: obj({
    kind: { type: 'string', enum: ['column', 'wall', 'shaft', 'duct', 'other'] }, mark: str('Mark as printed, e.g. "K1". Empty if none.'),
    pts: { type: 'array', items: pt, description: 'Footprint outline on plan (its drawn outline), corners in order.' } }) },
  openings: { type: 'array', description: 'Every door, window and open doorway in this room\'s walls.', items: obj({
    type: { type: 'string', enum: OPENING }, mark: str('Mark as printed, e.g. "P1", "J3". Empty if none.'),
    width_mm: num('Width (leaf / clear opening), from the plan or the door/window schedule.'), height_mm: num('Height, from the schedule.'),
    frame_width_mm: num('Overall width INCLUDING the frame (kusen / frame outer size or structural opening), if the schedule or a detail gives it. null otherwise.'),
    frame_height_mm: num('Overall height INCLUDING the frame head, if given. null otherwise.'),
    sill_mm: num('Sill height above floor (windows); 0 for doors.'),
    edge: { type: ['integer', 'null'], description: 'Index (0-based) of the room edge the opening is in.' },
    at: { ...pt, description: 'Position of this door / window TAG (its mark text, e.g. "P1") on the plan; if it has no tag, the centre of the opening.' } }) },
  info_source: { type: 'string', enum: SOURCES, description: 'Where the finishes for this room were read.' },
  schedule_text: str('The schedule row or room tag text you used, as printed.'),
  ref_sheet: { type: ['integer', 'null'], description: 'Sheet number the finish information came from, if not this sheet.' },
  grid_ref: str('Grid location, e.g. "C–D / 3–4". Empty if no grids.'),
  confidence: { type: 'number', description: '0 to 1: outline, finishes and heights together.' },
  needs_review: { type: 'boolean' },
  review_reason: str(takeoff.REASON_DESC),
});

const SCHEMA = obj({
  complete: { type: 'boolean', description: 'true only when, together with earlier rounds, every room on every plan sheet has been reported.' },
  remaining: { type: 'array', items: { type: 'string' }, description: 'What is still to do after this answer, e.g. "Sheet 1: rooms in the east wing (grids 8–12)". Empty when complete.' },
  sheets: { type: 'array', description: 'One entry per sheet you were given, in the same order.', items: obj({
    sheet_no: { type: 'integer' },
    sheet: obj({
      drawing_number: str('As printed. Empty if not visible.'), title: str('As printed.'), level: str('Floor / level, as printed.'), scale: str('Main plan scale, e.g. "1:100".'),
      sheet_kind: { type: 'string', enum: SHEET_KINDS },
      floor_to_floor_mm: num('Floor-to-floor height of this level if readable anywhere in the set.'),
      typical_ceiling_height_mm: num('Ceiling height that applies to most rooms on this sheet, from notes, schedule or RCP.'),
      notes: str('Notes that affect finishes (typical heights, finish to all rooms unless noted, etc.).'),
    }),
    calibration: { type: 'array', description: 'Up to 4 long printed dimensions on this sheet\'s main plan with the two points they measure between.', items: obj({ text: str('Dimension as printed.'), p1: pt, p2: pt, length_mm: { type: 'number' } }) },
    elements: { type: 'array', description: 'Rooms on this sheet\'s main plan. Schedules, sections and details have none.', items: ROOM },
    warnings: { type: 'array', items: { type: 'string' } },
  }) },
  types: { type: 'array', description: 'Every definition read anywhere in the set: finish codes from the finish schedule / legend, and door and window types from the door/window schedule.', items: obj({
    mark: str('Code or mark, e.g. "F2", "W1", "C3", "P1", "J2".'), kind: { type: 'string', enum: TYPE_KINDS }, name: str('Description.'),
    width_mm: num('Doors / windows: width.'), height_mm: num('Doors / windows: height. Skirting: height. Waterproofing: upturn.'),
    frame_width_mm: num('Doors / windows: overall width including frame, if given.'), frame_height_mm: num('Doors / windows: overall height including frame, if given.'),
    text: str('As printed.'), sheet_no: { type: 'integer' } }) },
  cross_sheet_notes: { type: 'array', items: { type: 'string' }, description: 'How the sheets were combined (e.g. "Room finishes from the schedule on sheet 3"), and conflicts.' },
  warnings: { type: 'array', items: { type: 'string' } },
  summary: str('Two or three sentences.'),
});

const PROMPT = `You are a senior quantity surveyor doing an architectural FINISHES takeoff from a SET of drawing sheets sent together: plans, finish plans, reflected ceiling plans, room finish schedules, door and window schedules and sections.
Each sheet comes as "Sheet n" with its register details, (if sent) its PDF text layer with positions, and an image of the whole sheet.
For every room, outline it and record what finishes it gets and the heights that apply. Software computes every length and area from your outline and heights, so geometry and heights must be exact, and every value must be traceable to something printed.

WORK ACROSS THE SET
- First identify every sheet (floor plan, finish plan, reflected ceiling plan, room finish schedule, door/window schedule, section) and its level.
- Rooms come from the plans. Their finishes come from the room finish schedule (match by room number, else by name), a finish plan / legend, or room tags. Ceiling type and height come from the schedule or the reflected ceiling plan. Door and window sizes come from the door/window schedule by mark.
- Put every finish code and every door/window type you read into "types". For each room, record schedule_text (the row or tag you used), info_source and ref_sheet.
- When sources disagree, use the more specific one (room schedule over typical note), review_reason "conflict"; list the conflict in cross_sheet_notes.
- Return one "sheets" entry per sheet, in order. Rooms belong to the plan sheet they are drawn on; points are on that sheet's image.

COORDINATES
- Normalized image coordinates of the room's own sheet: x = 0 left to 1000 right, y = 0 top to 1000 bottom, scaled separately. Whole numbers.
- Trace the room on the FINISHED (inside) face of the walls that BOUND it, corner by corner, including recesses and splayed corners. Do NOT go around columns, wall stubs or other elements standing inside the room: list them in "obstructions" with their own footprint outline (the software deducts the part inside the room). Do not trace door swings, furniture, hatching or text.
- The software snaps every outline edge onto the PDF's own drawn line, so exact coordinates come from the drawing: put each edge on the correct line (the inside face, not the outer face or a hatch line) and each corner at the right corner. Do not flag a room as needing review just because your outline is approximate.
- "edges" has one entry per outline edge (edge i = pts[i] → pts[i+1], last edge back to pts[0]). Mark an edge "wall" only if it is a wall that receives wall finish and skirting; "glazing" for curtain wall / full-height glass; "opening" for an open side to another space.

ROOMS AND FINISHES
- One entry per enclosed room or space, including corridors, lobbies, toilets, shafts that receive finishes, stairs landings shown as rooms. Skip voids, lift shafts and areas outside the building unless finishes are scheduled for them.
- floor_finish, wall_finishes (as layers with bottom/top heights: e.g. ceramic tile 0–1500, paint 1500–ceiling; null top = up to the ceiling), skirting (with height), ceiling (type suspended / direct / exposed / none, with finished ceiling height), waterproofing (floor and upturn height, for toilets, kitchens, wet areas, roofs and balconies as scheduled).
- Ceiling type: "suspended" for any hung ceiling (gypsum board, calcium silicate, acoustic tile, grid ceiling); "direct" when paint or skim coat is applied straight to the concrete soffit.
- Heights: ceiling height from the schedule or RCP ("CH +2.800" = 2800 mm); slab_soffit_mm from sections or floor-to-floor minus slab where you can read it.
- Openings: every door, window and open doorway in the room's walls, with its mark, the edge index it sits in, "at" = the position of its tag (mark text) on the plan, and width / height / sill from the plan or the door/window schedule. Give the FRAME size too (frame_width_mm / frame_height_mm: overall size including the frame / kusen) when the schedule or a door detail gives it; the software deducts doors from wall finish by their frame size. A door between two rooms is listed in both rooms.
- Never invent a code, size or height. If unknown in the whole set, leave it empty (review_reason "no_size" or "no_detail").
- Sizes and heights in millimetres; convert cm or m.

SCALE CHECK
- For each plan sheet give in "calibration" up to 4 long printed dimensions (grid to grid, both directions) with the exact two points they span and the length in mm.

QUALITY
- Keep the answer compact: coordinates as whole numbers.
- The goal is full coverage: every room on every plan sheet. Work sheet by sheet and area by area.
- If the message asks you to work in rounds, keep to the size it gives for each answer and say exactly what is left in "remaining"; you will be asked to continue until "complete" is true.
- Never return an empty room list for a floor plan because it is large or dense. A best-effort outline flagged with needs_review is far more useful than nothing.
- confidence: 0.9+ only when outline, finishes and heights are all clearly read; lower when taken from a typical note or inferred.
Return JSON only, matching the schema.`;

function clean(p, n) {
  const s = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const num = v => (v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v);
  const int = v => (Number.isInteger(+v) && +v >= 1 && +v <= n ? +v : null);
  const P = a => (Array.isArray(a) && a.length >= 2 && isFinite(+a[0]) && isFinite(+a[1]) ? [Math.max(0, Math.min(1000, +a[0])), Math.max(0, Math.min(1000, +a[1]))] : null);
  const strs = a => (Array.isArray(a) ? a : []).map(s).filter(Boolean);
  const o = v => (v && typeof v === 'object' ? v : {});
  const room = (x, k, seen) => {
    let id = s(x.id) || s(x.region) || `R${k + 1}`; while (seen.has(id)) id += "'"; seen.add(id);
    const pts = (Array.isArray(x.pts) ? x.pts : []).map(P).filter(Boolean);
    let edges = (Array.isArray(x.edges) ? x.edges : []).map(e => (EDGE.includes(e) ? e : 'wall'));
    const edgesOk = edges.length === pts.length;
    if (!edgesOk) edges = pts.map((_, i) => edges[i] || 'wall');
    const c = o(x.ceiling), w = o(x.waterproofing), sk = o(x.skirting), f = o(x.floor_finish);
    return {
      id, kind: 'room', number: s(x.number), name: s(x.name), shape: 'polygon', pts, edges, edgesGuessed: !edgesOk,
      printed_area_m2: num(x.printed_area_m2),
      floor_finish: { code: s(f.code), name: s(f.name) },
      wall_finishes: (Array.isArray(x.wall_finishes) ? x.wall_finishes : []).map(l => ({ code: s(l.code), name: s(l.name), bottom_mm: num(l.bottom_mm), top_mm: num(l.top_mm) })).filter(l => l.code || l.name),
      skirting: { code: s(sk.code), name: s(sk.name), height_mm: num(sk.height_mm) },
      ceiling: { type: CEILING.includes(c.type) ? c.type : 'unknown', code: s(c.code), name: s(c.name), height_mm: num(c.height_mm) },
      slab_soffit_mm: num(x.slab_soffit_mm),
      waterproofing: { floor: !!w.floor, upturn_mm: num(w.upturn_mm), code: s(w.code), name: s(w.name) },
      obstructions: (Array.isArray(x.obstructions) ? x.obstructions : []).map(q => ({ kind: ['column', 'wall', 'shaft', 'duct', 'other'].includes(q.kind) ? q.kind : 'other', mark: s(q.mark), pts: (Array.isArray(q.pts) ? q.pts : []).map(P).filter(Boolean) })).filter(q => q.pts.length >= 3),
      openings: (Array.isArray(x.openings) ? x.openings : []).map(q => ({ type: OPENING.includes(q.type) ? q.type : 'opening', mark: s(q.mark), width_mm: num(q.width_mm), height_mm: num(q.height_mm), frame_width_mm: num(q.frame_width_mm), frame_height_mm: num(q.frame_height_mm), sill_mm: num(q.sill_mm), edge: Number.isInteger(+q.edge) && +q.edge >= 0 && +q.edge < pts.length ? +q.edge : null, at: P(q.at) })),
      info_source: SOURCES.includes(x.info_source) ? x.info_source : 'inferred', schedule_text: s(x.schedule_text), ref_sheet: int(x.ref_sheet),
      grid_ref: s(x.grid_ref), ...takeoff.review(x), lines: s(x.lines), region: s(x.region),
      // door swings the app found on this room's walls (rooms mode): where the door is and its swing radius on paper
      doors_found: (Array.isArray(x.doors_found) ? x.doors_found : []).map(d => ({ at: P(o(d).at), w_paper_mm: num(o(d).w_paper_mm) })).filter(d => d.at && d.w_paper_mm > 0),   // PDF line ids of its sides (PDF lines mode)
    };
  };
  const sheetOf = (e, i) => {
    const sh = o(e && e.sheet), seen = new Set();
    return {
      sheet_no: i + 1,
      sheet: { drawing_number: s(sh.drawing_number), title: s(sh.title), level: s(sh.level), scale: s(sh.scale), sheet_kind: SHEET_KINDS.includes(sh.sheet_kind) ? sh.sheet_kind : 'other', floor_to_floor_mm: num(sh.floor_to_floor_mm), typical_ceiling_height_mm: num(sh.typical_ceiling_height_mm), notes: s(sh.notes) },
      calibration: (Array.isArray(e && e.calibration) ? e.calibration : []).map(c => ({ text: s(c.text), p1: P(c.p1), p2: P(c.p2), length_mm: num(c.length_mm) })).filter(c => c.p1 && c.p2 && c.length_mm > 0),
      elements: (Array.isArray(e && e.elements) ? e.elements : []).map((x, k) => room(o(x), k, seen)).filter(x => x.pts.length >= 3),
      warnings: strs(e && e.warnings),
    };
  };
  const given = Array.isArray(p && p.sheets) ? p.sheets : [];
  const sheets = Array.from({ length: n }, (_, i) => sheetOf(given.find(x => int(x && x.sheet_no) === i + 1) || given[i], i));
  return {
    sheets,
    types: (Array.isArray(p && p.types) ? p.types : []).map(t => ({ mark: s(t.mark), kind: TYPE_KINDS.includes(t.kind) ? t.kind : 'wall', name: s(t.name), width_mm: num(t.width_mm), height_mm: num(t.height_mm), frame_width_mm: num(t.frame_width_mm), frame_height_mm: num(t.frame_height_mm), text: s(t.text), sheet_no: int(t.sheet_no) })).filter(t => t.mark || t.name),
    cross_sheet_notes: strs(p && p.cross_sheet_notes), warnings: strs(p && p.warnings), summary: s(p && p.summary),
  };
}

takeoff.orderProps(SCHEMA, takeoff.ANSWER_ORDER);

// PDF lines mode (lib/region.js): a room may name the lines of its wall faces instead of giving corner points.
const LINE_SCHEMA = JSON.parse(JSON.stringify(SCHEMA));
LINE_SCHEMA.properties.sheets.items.properties.elements.items.properties.lines = { type: 'string', description: 'Ids of the PDF lines of the room\'s finished wall faces, IN ORDER around the room (one side after the other), e.g. "41,57,62-63,88". Use instead of pts.' };
takeoff.orderProps(LINE_SCHEMA.properties.sheets.items.properties.elements.items, ['id', 'kind', 'number', 'name', 'shape', 'lines']);

// Rooms found by the app (web/engine/rooms.js): the model gives each numbered room its name and finishes, no outline.
const ROOM_SCHEMA = JSON.parse(JSON.stringify(SCHEMA));
ROOM_SCHEMA.properties.sheets.items.properties.elements.items.properties.region = { type: 'string', description: 'The room number the software wrote on the image, e.g. "R12".' };
ROOM_SCHEMA.properties.sheets.items.properties.elements.items.properties.openings.items.properties.at.description = 'Windows: the window\'s position on the image. Doors: leave out (the software finds door swings).';
takeoff.orderProps(ROOM_SCHEMA.properties.sheets.items.properties.elements.items, ['region', 'number', 'name']);
const ROOM_RULES = `ROOMS FOUND BY THE SOFTWARE (this run)
- The software has found the enclosed spaces on each sheet and written their numbers on the image (R1, R2… in red boxes); the list follows the image. Their outlines are exact: never write outline points or edges for them.
- For every numbered space that is a room or space receiving finishes, return one entry with "region" (its number) and the room's number, name, finishes, heights, waterproofing and openings as usual. Leave out "pts", "edges", "shape" and "id".
- Numbered spaces that are not rooms (the gap inside a wall, a shaft, a pool, landscape, a stair void, furniture, a title-block box, an outside area) are simply left out.
- A room split into several numbers (by a counter or a furniture line): give each number the same room number and name.
- One number covering two rooms (no line between them): return it once with both names and review_reason "geometry_unclear: two rooms in one space".
- A room with no number on it: report it as usual with "pts" (and "edges").
- Doors: the software finds the door swings. List each door with its mark and its sizes from the schedule; no "at" needed. Windows: mark, sizes, sill and "at" (its position on the image).
- Obstructions (columns inside a room): as usual, with "pts".`;
const LINE_RULES = `PDF LINES (each sheet's drawn lines come as a numbered list after its image)
- Rooms: name the lines of the room's FINISHED wall faces in "lines", IN ORDER around the room, one side after the other (pieces of the same side, e.g. either side of a door, next to each other), and leave out "pts". The software puts each corner where one side meets the next, so the outline is exact even across door gaps. "edges" then has one entry per side, in the same order.
- Use the image to see what each line is (labels, hatching, line weight, dashed or not), then take its ids from the list. Ids are ordered: horizontal lines top to bottom, vertical lines left to right, then the others by angle.
- Lines that are not part of what you measure (grids, dimensions, text, hatching, symbols, other trades) are simply not named.
- A room with a side that has no drawn line (an open side): give "pts" for that room instead.
- Openings keep "at"; obstructions keep "pts".`;

const FIN = {
  id: 'fin', name: 'finishes_takeoff', schema: SCHEMA, prompt: PROMPT, clean,
  always: 'id, number and name (when printed), pts (or lines), edges, info_source, schedule_text, and every finish, height and opening you read',
  lineSchema: LINE_SCHEMA, lineRules: LINE_RULES, roomSchema: ROOM_SCHEMA, roomRules: ROOM_RULES,
  noun: 'rooms', order: 'Work sheet by sheet and area by area (a wing or grid zone at a time), finishing whole areas.',
  all: 'every room on every plan sheet',
  measureLine: k => `Quantities wanted: ${(k && k.length ? k : Object.keys(QTY)).map(x => QTY[x] || x).join(', ')}. Outline every room and read only the information these need (skip the others).`,
};

module.exports = { FIN, SCHEMA, PROMPT, QTY };
