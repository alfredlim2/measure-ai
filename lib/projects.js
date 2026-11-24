// Projects, drawings and runs, always scoped to the signed-in user.
// Uploaded PDFs are stored as data/files/<drawing id>.pdf; a finished run's result as data/runs/<run id>.json.
const fs = require('fs');
const path = require('path');
const { one, all, run, now, DATA } = require('./db');

const FILES = path.join(DATA, 'files'), RUNS = path.join(DATA, 'runs');
fs.mkdirSync(FILES, { recursive: true }); fs.mkdirSync(RUNS, { recursive: true });
const MAX_PDF = (+process.env.MAX_UPLOAD_MB || 150) * 1024 * 1024;
const err = (m, status = 400, code = 'bad_request') => Object.assign(new Error(m), { status, code });
const J = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// ---- projects ----
function list(userId) {
  return all(`SELECT p.id, p.name, p.created_at AS createdAt, p.updated_at AS updatedAt,
    (SELECT COUNT(*) FROM drawings d WHERE d.project_id = p.id) AS drawings,
    (SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id) AS runs
    FROM projects p WHERE p.user_id = ? ORDER BY p.updated_at DESC`, userId);
}
function own(userId, id) { const p = one('SELECT * FROM projects WHERE id = ? AND user_id = ?', +id, userId); if (!p) throw err('Project not found.', 404, 'not_found'); return p; }
function create(userId, name) {
  name = String(name || '').trim().slice(0, 120) || 'Untitled project';
  const r = run('INSERT INTO projects (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', userId, name, now(), now());
  return get(userId, Number(r.lastInsertRowid));
}
function rename(userId, id, name) { own(userId, id); run('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?', String(name || '').trim().slice(0, 120) || 'Untitled project', now(), +id); return get(userId, id); }
function remove(userId, id) {
  own(userId, id);
  all('SELECT id FROM drawings WHERE project_id = ?', +id).forEach(d => fs.rmSync(path.join(FILES, `${d.id}.pdf`), { force: true }));
  all('SELECT id FROM runs WHERE project_id = ?', +id).forEach(r => fs.rmSync(path.join(RUNS, `${r.id}.json`), { force: true }));
  run('DELETE FROM projects WHERE id = ?', +id);
}
const touch = id => run('UPDATE projects SET updated_at = ? WHERE id = ?', now(), +id);
function get(userId, id) {
  const p = own(userId, id);
  return {
    id: p.id, name: p.name, createdAt: p.created_at, updatedAt: p.updated_at,
    drawings: all('SELECT id, file_name AS fileName, size, pages, sheets, created_at AS createdAt FROM drawings WHERE project_id = ? ORDER BY id', p.id).map(d => ({ ...d, sheets: J(d.sheets, []) })),
    runs: runsOf(p.id),
  };
}

// ---- drawings (PDF files) ----
function addDrawing(userId, projectId, fileName, buf, pages, sheets) {
  own(userId, projectId);
  if (!buf || buf.length < 5 || buf.subarray(0, 5).toString() !== '%PDF-') throw err('That file is not a PDF.');
  if (buf.length > MAX_PDF) throw err(`The file is larger than ${MAX_PDF / 1048576} MB.`, 413, 'too_large');
  const r = run('INSERT INTO drawings (project_id, user_id, file_name, size, pages, sheets, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    +projectId, userId, String(fileName || 'drawing.pdf').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 200), buf.length, Math.max(0, +pages || 0), JSON.stringify(cleanSheets(sheets)), now());
  const id = Number(r.lastInsertRowid);
  fs.writeFileSync(path.join(FILES, `${id}.pdf`), buf);
  touch(projectId);
  return one('SELECT id, file_name AS fileName, size, pages, sheets, created_at AS createdAt FROM drawings WHERE id = ?', id);
}
function ownDrawing(userId, id) { const d = one('SELECT * FROM drawings WHERE id = ? AND user_id = ?', +id, userId); if (!d) throw err('Drawing not found.', 404, 'not_found'); return d; }
const drawingPath = (userId, id) => { ownDrawing(userId, id); return path.join(FILES, `${+id}.pdf`); };
function cleanSheets(a) {
  const s = v => String(v == null ? '' : v).slice(0, 200);
  return (Array.isArray(a) ? a : []).slice(0, 2000).map(x => ({
    page: Math.max(1, Math.round(+x.page || 1)), name: s(x.name), number: s(x.number), title: s(x.title), scale: s(x.scale), level: s(x.level),
    discipline: s(x.discipline), type: s(x.type), named: !!x.named,
    area: x.area && ['x', 'y', 'w', 'h'].every(k => isFinite(+x.area[k])) ? { x: +x.area.x, y: +x.area.y, w: +x.area.w, h: +x.area.h } : null,
  }));
}
function updateSheets(userId, id, sheets) { const d = ownDrawing(userId, id); run('UPDATE drawings SET sheets = ? WHERE id = ?', JSON.stringify(cleanSheets(sheets)), d.id); touch(d.project_id); }
function removeDrawing(userId, id) { const d = ownDrawing(userId, id); run('DELETE FROM drawings WHERE id = ?', d.id); fs.rmSync(path.join(FILES, `${d.id}.pdf`), { force: true }); touch(d.project_id); }

// ---- runs ----
const runRow = r => r && ({ id: r.id, projectId: r.project_id, tool: r.tool, status: r.status, settings: J(r.settings, {}), summary: J(r.summary, {}), checks: J(r.checks, []), credits: r.credits, error: r.error, createdAt: r.created_at, finishedAt: r.finished_at, jobId: r.job_id });
const runsOf = projectId => all('SELECT * FROM runs WHERE project_id = ? ORDER BY id DESC LIMIT 200', +projectId).map(runRow);
function startRun(userId, projectId, tool, settings, jobId) {
  own(userId, projectId);
  const r = run('INSERT INTO runs (project_id, user_id, tool, job_id, status, settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', +projectId, userId, tool, jobId, 'running', JSON.stringify(settings || {}), now());
  touch(projectId); return Number(r.lastInsertRowid);
}
function finishRun(id, { status, result, summary, credits, error }) {
  if (result) fs.writeFileSync(path.join(RUNS, `${+id}.json`), JSON.stringify(result));
  run('UPDATE runs SET status = ?, summary = ?, credits = ?, error = ?, finished_at = ? WHERE id = ?', status, JSON.stringify(summary || {}), Math.round(credits || 0), error || null, now(), +id);
}
function ownRun(userId, id) { const r = one('SELECT * FROM runs WHERE id = ? AND user_id = ?', +id, userId); if (!r) throw err('Run not found.', 404, 'not_found'); return r; }
function getRun(userId, id) {
  const r = ownRun(userId, id), f = path.join(RUNS, `${r.id}.json`);
  return { ...runRow(r), result: fs.existsSync(f) ? J(fs.readFileSync(f, 'utf8'), null) : null };
}
function setChecks(userId, id, checks) { const r = ownRun(userId, id); run('UPDATE runs SET checks = ? WHERE id = ?', JSON.stringify((Array.isArray(checks) ? checks : []).map(String).slice(0, 20000)), r.id); }
function removeRun(userId, id) { const r = ownRun(userId, id); if (r.status === 'running') throw err('Stop the run first.'); run('DELETE FROM runs WHERE id = ?', r.id); fs.rmSync(path.join(RUNS, `${r.id}.json`), { force: true }); }
// a run interrupted by a server restart can never finish
run("UPDATE runs SET status = 'error', error = 'The server restarted during this run.', finished_at = ? WHERE status = 'running'", now());

module.exports = { list, create, rename, remove, get, addDrawing, drawingPath, updateSheets, removeDrawing, startRun, finishRun, getRun, setChecks, removeRun, ownDrawing, MAX_PDF };
