// Measure.AI server — no dependencies, Node 22+ (built-in SQLite).
// Serves the app from ./web, keeps accounts, projects, drawings and runs in data/ (lib/db.js), and runs the AI
// requests server-side. Keys and service details never reach the browser (lib/brand.js scrubs every reply).
//   node server.js        then open http://localhost:5173
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadEnv, config, readSettings } = require('./lib/env');
loadEnv();
const { nameSheet, AiError } = require('./lib/sheet-namer');
const takeoff = require('./lib/takeoff');
const vision = require('./lib/vision');
const { FIN } = require('./lib/finishes');
const PROFILES = { conc: takeoff.CONC, fin: FIN, steel: require('./lib/steel').STL };   // measuring tools: Concrete & Formwork, Finishes, Steel
const brand = require('./lib/brand');
const usage = require('./lib/usage');
const auth = require('./lib/auth');
const credits = require('./lib/credits');
const projects = require('./lib/projects');
const { one, all, run } = require('./lib/db');

let CFG = config();
usage.init(() => CFG);
usage.setJobInfo(id => { const j = JOBS.get(id); return j && { tool: j.meta.tool, effort: j.meta.effort, sheets: (j.meta.sheets || []).map(x => x && x.name).join(' | ') }; });
const WEB = path.join(__dirname, 'web');
const LOG = path.join(__dirname, 'logs');
const MAX_BODY = 25 * 1024 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json' };

// Measuring engine, fixed: planning (round 1) and re-checks think at LOCK.effort, the parallel parts and continuation
// rounds at LOCK.later. The browser cannot choose or see the model.
const LOCK = { model: 'gpt-6.1-sol', effort: 'high', later: 'medium', detail: 'original' };

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...HEADERS });
  res.end(JSON.stringify(brand.scrub(obj)));
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(Object.assign(new Error('The request is too large.'), { status: 413, code: 'too_large' })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, max = MAX_BODY) {
  const b = await readBody(req, max);
  try { return b.length ? JSON.parse(b.toString('utf8')) : {}; } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400, code: 'bad_request' }); }
}
function logCall(entry) {
  try { fs.mkdirSync(LOG, { recursive: true }); fs.appendFileSync(path.join(LOG, 'ai-calls.jsonl'), JSON.stringify(entry) + '\n'); } catch {}
  usage.record(entry);
}
const aiReady = () => CFG.provider === 'openai' && CFG.hasKey;

// Test mode (TEST_MODE=1 in .env): no sign-in (everyone is one local test account), no credits checked or charged, no
// top-up. Measuring uses the server's AI key (ai-settings.json / .env) directly, with a per-run spending cap of
// TEST_COST_CAP dollars (default 10, 0 = none). Only requests from this computer are served unless TEST_ALLOW_REMOTE=1.
const TEST = /^(1|true|on|yes)$/i.test(String(process.env.TEST_MODE || ''));
const TEST_CAP = Math.max(0, process.env.TEST_COST_CAP == null || process.env.TEST_COST_CAP === '' ? 10 : +process.env.TEST_COST_CAP || 0);
const TEST_REMOTE = /^(1|true|on|yes)$/i.test(String(process.env.TEST_ALLOW_REMOTE || ''));
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
function testUser() {
  let u = one('SELECT * FROM users WHERE email = ?', 'tester@local');
  if (!u) { run("INSERT INTO users (email, name, role, created_at) VALUES (?, ?, 'admin', ?)", 'tester@local', 'Test user', Date.now()); u = one('SELECT * FROM users WHERE email = ?', 'tester@local'); }
  return u;
}
const userOf = req => (TEST ? testUser() : auth.userOf(req));

// ---- AI sheet naming (signed-in users; small, not charged) ----
let active = 0; const waiting = [];
const acquire = () => new Promise(r => { if (active < CFG.concurrency) { active++; r(); } else waiting.push(r); });
const release = () => { const n = waiting.shift(); if (n) n(); else active--; };
async function handleName(req, res, user) {
  if (!['openai', 'mock'].includes(CFG.provider)) return send(res, 500, { error: 'The AI is not configured on this server.', code: 'bad_config' });
  if (CFG.provider === 'openai' && !CFG.hasKey) return send(res, 503, { error: 'The AI is not available on this server yet.', code: 'no_key' });
  const input = await readJson(req);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), CFG.timeoutMs);
  res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
  const t0 = Date.now();
  await acquire();
  try {
    const out = await nameSheet(input, CFG, ctl.signal);
    logCall({ at: new Date().toISOString(), kind: 'naming', user: user.id, file: input.fileName, page: input.page, ok: true, ms: out.ms, model: out.model, usage: out.usage, number: out.drawing_number, title: out.title, discipline: out.discipline, type: out.sheet_type });
    const { usage: _u, ...shown } = out;
    send(res, 200, shown);
  } catch (e) {
    const timedOut = ctl.signal.aborted, code = timedOut ? 'timeout' : e.code || 'error';
    const status = timedOut ? 504 : e.status && e.status >= 400 ? (e.status === 401 ? 502 : e.status) : 502;
    logCall({ at: new Date().toISOString(), kind: 'naming', user: user.id, file: input.fileName, page: input.page, ok: false, ms: Date.now() - t0, code, error: String(e.message).slice(0, 300), usage: e.usage || null, model: e.model || CFG.openai.model, note: e.usage ? `failed (${code}), still billed` : '' });
    if (!res.writableEnded && !res.destroyed) send(res, status, { error: timedOut ? `No answer within ${CFG.timeoutMs / 1000} s` : e.message, code });
  } finally { clearTimeout(timer); release(); }
}

// ---- measuring runs ----
// One job per run: every selected sheet goes in ONE request so the model reads them together. The browser posts the
// sheet images, then listens on an SSE stream. Each job belongs to one user and one project run; when it ends, its
// result is saved with the run and its cost is charged in credits (lib/credits.js).
const JOBS = new Map();
const TAKEOFF_MAX_BODY = 200 * 1024 * 1024;
const TAKEOFF_LIMIT_MS = +process.env.TAKEOFF_TIMEOUT_MS || 0;
const MAX_RUNNING = Math.max(1, +process.env.MAX_RUNS_PER_USER || 2);
let tActive = 0; const tWaiting = [];
const tAcquire = () => new Promise(r => { if (tActive < CFG.concurrency) { tActive++; r(); } else tWaiting.push(r); });
const tRelease = () => { const n = tWaiting.shift(); if (n) n(); else tActive--; };

// what a user's browser sees of a job event: no prices, token counts or instructions (admins see the same)
function shownEvent(ev) {
  if (ev.type === 'usage' || ev.type === 'request') return null;
  const { cost, costTotal, usage: u, roundUsage, model, ...rest } = ev;
  return brand.scrub(rest);
}
function jobEmit(job, ev) {
  if (ev.type === 'usage' && ev.costTotal) job.usd = ev.costTotal.total || job.usd;
  if (ev.type === 'live') {   // transient, and at most one every 2 s per run (the latest is always sent)
    const sendLive = e => { job.liveAt = Date.now(); const s = shownEvent(e); if (s) { const d = `data: ${JSON.stringify(s)}\n\n`; for (const c of job.clients) c.write(d); } };
    const wait = 2000 - (Date.now() - (job.liveAt || 0));
    if (wait <= 0) return sendLive(ev);
    job.livePending = ev;
    if (!job.liveT) job.liveT = setTimeout(() => { job.liveT = null; const e = job.livePending; job.livePending = null; if (e && !job.done) sendLive(e); }, wait);
    return;
  }
  if (ev.type === 'result' || ev.type === 'error') { clearTimeout(job.liveT); job.liveT = null; job.livePending = null; }
  ev.seq = job.events.length; ev.at = Date.now();
  job.events.push(ev);   // kept in full on the server (logs, usage)
  const s = shownEvent(ev);
  if (s) { const line = `id: ${ev.seq}\ndata: ${JSON.stringify(s)}\n\n`; for (const c of job.clients) c.write(line); }
  usage.jobEvent(job.id, ev);
  if (ev.type === 'end') for (const c of job.clients) c.end();
}
function saveJob(job, extra) {
  try {
    const dir = path.join(LOG, 'takeoff'); fs.mkdirSync(dir, { recursive: true });
    const thinking = job.events.filter(e => e.type === 'thinking' || e.type === 'thinking_break').map(e => (e.type === 'thinking' ? e.delta : '\n\n')).join('');
    const sent = job.events.find(e => e.type === 'request');
    fs.writeFileSync(path.join(dir, `${job.id}.json`), JSON.stringify({ id: job.id, user: job.userId, run: job.runId, created: new Date(job.created).toISOString(), request: job.meta, prompt: sent && { instructions: sent.instructions, text: sent.text }, thinking, notes: job.events.filter(e => e.type === 'note').map(e => e.text), ...extra }, null, 2));
  } catch {}
}
async function startJob(req, res, user) {
  if (!aiReady()) return send(res, 503, { error: 'Measuring is not available on this server yet.', code: 'no_key' });
  if ([...JOBS.values()].filter(j => j.userId === user.id && !j.done).length >= MAX_RUNNING) return send(res, 429, { error: `You already have ${MAX_RUNNING} measurements running. Wait for one to finish.`, code: 'busy' });
  if (!TEST && credits.balance(user.id) <= 0) return send(res, 402, { error: 'You have no credits left. Top up to measure.', code: 'no_credits' });
  const input = await readJson(req, TAKEOFF_MAX_BODY);
  projects.get(user.id, input.projectId);   // the project must be the user's
  Object.assign(input, { model: LOCK.model, effort: LOCK.effort, laterEffort: LOCK.later, detail: LOCK.detail, prompt: '' });
  // the spending cap is what the credits pay for (and the user's own cap, if lower)
  if (TEST) input.costCap = +input.costCap > 0 ? (TEST_CAP ? Math.min(+input.costCap, TEST_CAP) : +input.costCap) : TEST_CAP;   // test mode: no credits, own cap
  else { const capUsd = credits.usdLimit(user.id); input.costCap = +input.costCap > 0 ? Math.min(+input.costCap, capUsd) : capUsd; }
  const S = Array.isArray(input.sheets) ? input.sheets : [];
  if (!S.length || S.some(x => !/^data:image\/(jpeg|png|webp);base64,/.test(x.image || ''))) return send(res, 400, { error: 'No sheet images in the request', code: 'bad_request' });
  const tool = PROFILES[input.tool] ? input.tool : 'conc';
  const id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}`;
  const meta = { tool, user: user.id, project: +input.projectId, model: input.model, effort: input.effort, dpi: input.dpi, lanes: input.lanes, costCap: input.costCap, kinds: input.kinds, areas: S.map(x => x.region || null), pdfLines: S.map(x => (Array.isArray(x.lines) ? x.lines.length : 0)), rooms: S.map(x => (Array.isArray(x.rooms) ? x.rooms.length : 0)), sheets: S.map(x => x.sheet), imageBytes: S.reduce((a, x) => a + Math.round(x.image.length * 0.75), 0) };
  const runSettings = { sheets: S.map(x => ({ drawing: x.drawing, page: x.sheet && x.sheet.page, name: x.sheet && x.sheet.name })), kinds: input.kinds, items: input.items || [], areas: S.map(x => x.area || null), options: input.options || {} };
  const runId = projects.startRun(user.id, input.projectId, tool, runSettings, id);
  const job = { id, userId: user.id, runId, created: Date.now(), meta, events: [], clients: new Set(), ctl: new AbortController(), why: '', done: false, usd: 0 };
  JOBS.set(id, job);
  setTimeout(() => JOBS.delete(id), 2 * 60 * 60 * 1000).unref();
  try { const dir = path.join(LOG, 'takeoff'); fs.mkdirSync(dir, { recursive: true }); S.forEach((x, i) => fs.writeFileSync(path.join(dir, `${id}-sheet${i + 1}.jpg`), Buffer.from(x.image.split(',')[1], 'base64'))); } catch {}
  send(res, 200, { id, runId });

  const timer = TAKEOFF_LIMIT_MS ? setTimeout(() => { job.why = 'timeout'; job.ctl.abort(); }, TAKEOFF_LIMIT_MS) : null;
  const t0 = Date.now();
  jobEmit(job, { type: 'status', status: 'queued' });
  await tAcquire();
  meta.queueMs = Date.now() - t0;
  let out = null, failure = null;
  try {
    if (job.ctl.signal.aborted) throw new AiError('Cancelled', 'cancelled', 499);
    input.jobId = id;
    out = await takeoff.runTakeoff(input, CFG, job.ctl.signal, ev => jobEmit(job, ev), PROFILES[tool]);
  } catch (e) { failure = e; }
  // charge what the run used (also when it failed or was stopped after the AI started on it)
  const usd = out && out.cost ? out.cost.total : job.usd;
  const charged = TEST ? 0 : credits.chargeRun(user.id, usd, `run:${runId}`, `${({ conc: 'Concrete & Formwork', fin: 'Finishes', steel: 'Steel' })[tool]} · ${S.length} sheet${S.length > 1 ? 's' : ''}`);
  try {
    if (out) {
      const n = out.result ? out.result.sheets.reduce((a, x) => a + x.elements.length + (x.connections || []).length + (x.patterns || []).length, 0) : 0;
      projects.finishRun(runId, { status: out.stopped && !out.complete ? 'done' : 'done', result: out.result, summary: { items: n, complete: out.complete, stopped: out.stopped || '' }, credits: charged });
      jobEmit(job, { type: 'result', result: out.result, raw: out.raw, ms: out.ms, rounds: out.rounds, stopped: out.stopped, complete: out.complete, lanes: out.lanes, credits: charged, balance: credits.balance(user.id) });
      jobEmit(job, { type: 'status', status: 'done' });
      logCall({ at: new Date().toISOString(), kind: 'takeoff-' + tool, user: user.id, job: id, ok: true, ms: out.ms, model: out.model, usageTotal: out.usage, rounds: out.rounds, complete: out.complete, credits: charged });
      saveJob(job, { ok: true, ms: out.ms, model: out.model, usage: out.usage, cost: out.cost, roundUsage: out.roundUsage, rounds: out.rounds, complete: out.complete, stopped: out.stopped, credits: charged, result: out.result, raw: out.raw });
    } else {
      const e = failure, code = job.why === 'cancel' ? 'cancelled' : job.why === 'timeout' ? 'timeout' : e.code || 'error';
      const msg = code === 'cancelled' ? 'Cancelled' : code === 'timeout' ? `No answer within ${Math.round(TAKEOFF_LIMIT_MS / 60000)} min` : e.cause && e.cause.code ? 'The AI could not be reached.' : e.message;
      projects.finishRun(runId, { status: code === 'cancelled' ? 'cancelled' : 'error', summary: {}, credits: charged, error: brand.scrubText(msg) });
      jobEmit(job, { type: 'error', error: msg, code, credits: charged, balance: credits.balance(user.id) });
      jobEmit(job, { type: 'status', status: code === 'cancelled' ? 'cancelled' : 'error' });
      logCall({ at: new Date().toISOString(), kind: 'takeoff-' + tool, user: user.id, job: id, ok: false, ms: Date.now() - t0, code, error: String(msg).slice(0, 300), credits: charged });
      saveJob(job, { ok: false, code, error: msg, raw: e.raw, credits: charged });
    }
  } finally {
    clearTimeout(timer); tRelease(); job.done = true;
    jobEmit(job, { type: 'end' });
  }
}
function ownJob(user, id) { const job = JOBS.get(id); if (!job || job.userId !== user.id) throw Object.assign(new Error('This measurement is no longer on the server.'), { status: 404, code: 'gone' }); return job; }
function jobStream(req, res, user, id) {
  const job = ownJob(user, id);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const from = req.headers['last-event-id'] != null ? +req.headers['last-event-id'] + 1 : 0;
  for (const ev of job.events.slice(from)) { const s = shownEvent(ev); if (s) res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(s)}\n\n`); }
  if (job.done) return res.end();
  job.clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  res.on('close', () => { clearInterval(ping); job.clients.delete(res); });
}
function cancelJob(res, user, id) { const job = ownJob(user, id); if (!job.done) { job.why = 'cancel'; job.ctl.abort(); } send(res, 200, { ok: true }); }
// Image limits of the locked engine (lib/vision.js), without its name: the browser sizes each sheet image with them.
function visionLimits() { const v = vision.VISION.find(r => r.re.test(LOCK.model)) || vision.FALLBACK, o = v.original || v.high; return { maxSide: o.maxDim, maxBlocks: o.budget || o.reject, block: 32, perBlock: v.mult || 1.2 }; }

// ---- static files: the app (web/) ----
function serveStatic(req, res, url) {
  let p; try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (p === '/' || !path.extname(p)) p = '/index.html';
  const file = path.normalize(path.join(WEB, p));
  if (!file.startsWith(WEB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}

// ---- routes ----
// A state-changing request must carry the app's own header: another site cannot send it without a CORS pre-flight,
// which this server never grants (with SameSite=Lax cookies, this blocks cross-site request forgery).
const APP_HEADER = 'x-measure-ai';
const route = (m, re) => (req, url) => req.method === m && url.pathname.match(re);
async function api(req, res, url) {
  const p = url.pathname, M = req.method;
  if (M !== 'GET' && M !== 'HEAD' && req.headers[APP_HEADER] !== '1') return send(res, 403, { error: 'Missing app header.', code: 'forbidden' });
  // public
  if (TEST && !TEST_REMOTE && !isLocal(req)) return send(res, 403, { error: 'This server is in test mode and only serves this computer.', code: 'forbidden' });
  if (p === '/api/config' && M === 'GET') return send(res, 200, { testMode: TEST, measure: aiReady(), naming: aiReady() || CFG.provider === 'mock', demo: CFG.provider === 'mock', google: auth.googleOn(), vision: visionLimits(), timeoutMs: CFG.timeoutMs, concurrency: CFG.concurrency, maxUploadMb: projects.MAX_PDF / 1048576 });
  if (p === '/api/auth/me' && M === 'GET') return send(res, 200, { user: auth.publicUser(userOf(req)) });
  if (TEST && p.startsWith('/api/auth/')) return send(res, 200, { ok: true, user: auth.publicUser(testUser()) });   // sign-in is off in test mode
  if (p === '/api/auth/signup' && M === 'POST') return send(res, 200, { user: auth.signup(req, res, await readJson(req)) });
  if (p === '/api/auth/login' && M === 'POST') return send(res, 200, { user: auth.login(req, res, await readJson(req)) });
  if (p === '/api/auth/logout' && M === 'POST') { auth.endSession(req, res); return send(res, 200, { ok: true }); }
  if (p === '/api/auth/forgot' && M === 'POST') { await auth.requestReset(req, await readJson(req)); return send(res, 200, { ok: true }); }
  if (p === '/api/auth/reset' && M === 'POST') return send(res, 200, { user: auth.resetPassword(req, res, await readJson(req)) });
  // signed in
  const user = userOf(req);
  if (!user) return send(res, 401, { error: 'Please sign in.', code: 'signed_out' });
  let m;
  if (p === '/api/account' && M === 'GET') return send(res, 200, { user: auth.publicUser(user), ledger: credits.ledger(user.id), creditsPerUsd: undefined });
  if (p === '/api/account/profile' && M === 'POST') { auth.updateProfile(user, await readJson(req)); return send(res, 200, { user: auth.publicUser(one('SELECT * FROM users WHERE id = ?', user.id)) }); }
  if (p === '/api/account/password' && M === 'POST') { auth.changePassword(user, await readJson(req)); return send(res, 200, { ok: true }); }
  if (p === '/api/projects' && M === 'GET') return send(res, 200, { projects: projects.list(user.id) });
  if (p === '/api/projects' && M === 'POST') return send(res, 200, { project: projects.create(user.id, (await readJson(req)).name) });
  if ((m = route('GET', /^\/api\/projects\/(\d+)$/)(req, url))) return send(res, 200, { project: projects.get(user.id, m[1]) });
  if ((m = route('PATCH', /^\/api\/projects\/(\d+)$/)(req, url))) return send(res, 200, { project: projects.rename(user.id, m[1], (await readJson(req)).name) });
  if ((m = route('DELETE', /^\/api\/projects\/(\d+)$/)(req, url))) { projects.remove(user.id, m[1]); return send(res, 200, { ok: true }); }
  if ((m = route('POST', /^\/api\/projects\/(\d+)\/drawings$/)(req, url))) {
    const buf = await readBody(req, projects.MAX_PDF + 1024);
    let sheets = []; try { sheets = JSON.parse(decodeURIComponent(req.headers['x-sheets'] || '%5B%5D')); } catch {}
    return send(res, 200, { drawing: projects.addDrawing(user.id, m[1], decodeURIComponent(req.headers['x-file-name'] || 'drawing.pdf'), buf, +req.headers['x-pages'] || 0, sheets) });
  }
  if ((m = route('GET', /^\/api\/drawings\/(\d+)\/file$/)(req, url))) {
    // no-cache: the browser may keep the file but asks every time, so the account check runs on each load (shared computers)
    const f = projects.drawingPath(user.id, m[1]), st = fs.statSync(f), tag = `"d${+m[1]}-${st.size}-${Math.round(st.mtimeMs)}"`;
    if (req.headers['if-none-match'] === tag) { res.writeHead(304, { ETag: tag, 'Cache-Control': 'private, no-cache' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': st.size, 'Cache-Control': 'private, no-cache', ETag: tag, 'X-Content-Type-Options': 'nosniff' });
    return fs.createReadStream(f).pipe(res);
  }
  if ((m = route('PATCH', /^\/api\/drawings\/(\d+)$/)(req, url))) { projects.updateSheets(user.id, m[1], (await readJson(req)).sheets); return send(res, 200, { ok: true }); }
  if ((m = route('DELETE', /^\/api\/drawings\/(\d+)$/)(req, url))) { projects.removeDrawing(user.id, m[1]); return send(res, 200, { ok: true }); }
  if ((m = route('GET', /^\/api\/runs\/(\d+)$/)(req, url))) return send(res, 200, { run: projects.getRun(user.id, m[1]) });
  if ((m = route('PATCH', /^\/api\/runs\/(\d+)$/)(req, url))) { const b = await readJson(req); if (b.checks) projects.setChecks(user.id, m[1], b.checks); return send(res, 200, { ok: true }); }
  if ((m = route('DELETE', /^\/api\/runs\/(\d+)$/)(req, url))) { projects.removeRun(user.id, m[1]); return send(res, 200, { ok: true }); }
  if (TEST && p === '/api/test/info' && M === 'GET') {   // test mode only: which key is used (masked) and the run cap
    const k = CFG.openai.key || '', src = readSettings().apiKey ? 'ai-settings.json' : process.env.OPENAI_API_KEY ? '.env' : '';
    return send(res, 200, { key: { set: CFG.hasKey, hint: k ? `${k.slice(0, 3)}…${k.slice(-4)}` : '', length: k.length, source: src }, ready: aiReady(), cap: TEST_CAP, remote: TEST_REMOTE });
  }
  if (p === '/api/sheet-name' && M === 'POST') return handleName(req, res, user);
  if (p === '/api/takeoff/jobs' && M === 'POST') return startJob(req, res, user);
  if ((m = route('GET', /^\/api\/takeoff\/jobs\/([\w-]+)\/events$/)(req, url))) return jobStream(req, res, user, m[1]);
  if ((m = route('POST', /^\/api\/takeoff\/jobs\/([\w-]+)\/cancel$/)(req, url))) return cancelJob(res, user, m[1]);
  // administrators: accounts and credits
  if (p.startsWith('/api/admin/')) {
    if (user.role !== 'admin') return send(res, 403, { error: 'Administrators only.', code: 'forbidden' });
    if (p === '/api/admin/users' && M === 'GET') return send(res, 200, { users: all('SELECT id, email, name, role, credits, created_at AS createdAt, last_login AS lastLogin, (SELECT COUNT(*) FROM runs r WHERE r.user_id = users.id) AS runs FROM users ORDER BY id DESC LIMIT 1000') });
    if ((m = route('POST', /^\/api\/admin\/users\/(\d+)\/credits$/)(req, url))) {
      const b = await readJson(req), u = one('SELECT id FROM users WHERE id = ?', +m[1]);
      if (!u) return send(res, 404, { error: 'No such account.', code: 'not_found' });
      const d = Math.round(+b.delta || 0); if (!d) return send(res, 400, { error: 'Enter a number of credits.', code: 'bad_request' });
      return send(res, 200, { balance: credits.add(u.id, d, d > 0 ? 'topup' : 'adjust', `admin:${user.id}`, String(b.note || '').slice(0, 200) || (d > 0 ? 'Credits added' : 'Credits removed')) });
    }
    if ((m = route('POST', /^\/api\/admin\/users\/(\d+)\/role$/)(req, url))) { const r = (await readJson(req)).role === 'admin' ? 'admin' : 'user'; if (+m[1] === user.id) return send(res, 400, { error: 'You cannot change your own role.' }); run('UPDATE users SET role = ? WHERE id = ?', r, +m[1]); return send(res, 200, { ok: true }); }
  }
  return send(res, 404, { error: 'Unknown endpoint', code: 'not_found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (TEST && url.pathname.startsWith('/auth/google')) { res.writeHead(302, { Location: '/#/projects' }); return res.end(); }
    if (url.pathname === '/auth/google' && req.method === 'GET') return auth.googleStart(req, res);
    if (url.pathname === '/auth/google/callback' && req.method === 'GET') return await auth.googleCallback(req, res, url);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url);
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch {} return; }
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    if (status === 500) console.error(e);
    send(res, status, { error: status === 500 ? 'Something went wrong on the server.' : e.message, code: e.code || 'error' });
  }
});

function openBrowser(url) {
  if (!process.argv.includes('--open')) return;
  const { exec } = require('child_process');
  exec(process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`, () => {});
}
const where = `http://${CFG.host === '0.0.0.0' || CFG.host === '127.0.0.1' ? 'localhost' : CFG.host}:${CFG.port}`;
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log(`\nThe app is already running at ${where} (or port ${CFG.port} is used by another program).`); openBrowser(where); setTimeout(() => process.exit(0), 1500); }
  else { console.error(e); process.exit(1); }
});
server.listen(CFG.port, CFG.host, () => {
  console.log(`\nMeasure.AI  →  ${where}`);
  console.log(aiReady() ? 'AI: ready' : CFG.provider === 'mock' ? 'AI: demo mode (no AI calls). Set the key in .env to enable it.' : 'AI: no key yet. Set it in .env, then restart.');
  if (TEST) console.log(`TEST MODE: no sign-in, no credits${TEST_CAP ? `, $${TEST_CAP} cap per run` : ', no spending cap'}${TEST_REMOTE ? ', open to other computers' : ', this computer only'}. Remove TEST_MODE from .env for normal use.`);
  console.log(auth.googleOn() ? 'Google sign-in: on' : 'Google sign-in: off (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and PUBLIC_URL in .env)');
  openBrowser(where);
});
