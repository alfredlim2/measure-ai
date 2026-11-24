// Usage meter (server side only, never shown in the app): token usage and cost of every AI call, kept for the operator.
//  - Session: exact token usage of every OpenAI call this server made since it started, plus a live estimate of the runs in progress.
//  - Platform (needs an OpenAI *Admin* key, sk-admin-…): this month's spend from the Costs API and today's org tokens from the Usage API.
//  - Credit left: OpenAI has no API for the prepaid balance, so the user enters the balance shown on the billing page
//    once (with its date); the meter subtracts the spend since then. The Costs API is daily and can lag by hours.
// To remove: delete this file and the lines marked "usage" in server.js.
const { readSettings, writeSettings } = require('./env');
const pricing = require('./pricing');
const fs = require('fs'), path = require('path');
const LEDGER = path.join(__dirname, '..', 'logs', 'usage-ledger.csv');
const LEDGER_COLS = ['time', 'kind', 'task', 'round', 'tool', 'model', 'effort', 'sheets', 'input', 'cached', 'uncached', 'cache_write', 'output', 'reasoning', 'usd_input', 'usd_cached', 'usd_output', 'usd_total', 'price_model', 'tier', 'response_id', 'lane', 'note'];   // note: failed / stopped requests that were still billed   // lane: parallel lane of a takeoff (empty = round 1 / serial)
// One CSV row per OpenAI request (each takeoff round, each sheet-naming call): the detailed record behind every total.
function ledger(row) {
  try {
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    const q = v => { v = v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    if (!fs.existsSync(LEDGER)) fs.writeFileSync(LEDGER, LEDGER_COLS.join(',') + '\n');
    else if (!ledger.checked) {   // older ledger without the newer columns: extend its header line once
      const txt = fs.readFileSync(LEDGER, 'utf8'), nl = txt.indexOf('\n');
      if (nl > 0 && txt.slice(0, nl) !== LEDGER_COLS.join(',')) fs.writeFileSync(LEDGER, LEDGER_COLS.join(',') + txt.slice(nl));
    }
    ledger.checked = true;
    fs.appendFileSync(LEDGER, LEDGER_COLS.map(k => q(row[k])).join(',') + '\n');
  } catch {}
}
function costRow(c) {
  return c ? { input: c.input, cached: c.cached, uncached: c.uncached, cache_write: c.cacheWrite, output: c.output, reasoning: c.reasoning, usd_input: c.inUsd, usd_cached: c.cachedUsd, usd_output: c.outUsd, usd_total: c.total, price_model: c.priceModel || (c.priced ? '' : 'no price'), tier: c.tier } : {};
}

const S = { since: Date.now(), calls: 0, in: 0, out: 0, reasoning: 0, cached: 0, usd: 0, unpriced: 0, byModel: {}, live: new Map(), clients: new Set(), plat: null, platErr: '', platAt: 0, platBusy: false };
let timer = null, cfgOf = () => null;
// Admin key and credit: from ai-settings.json (AI Settings window or the meter panel), else from .env.
function meterSettings() {
  const s = readSettings(), e = process.env;
  const bal = s.creditBalance ?? (e.OPENAI_CREDIT_BALANCE ? +e.OPENAI_CREDIT_BALANCE : null);
  return { adminKey: s.adminKey || (e.OPENAI_ADMIN_KEY || '').trim(), creditBalance: isFinite(bal) ? bal : null, creditAsOf: s.creditAsOf || e.OPENAI_CREDIT_AS_OF || '', fromEnv: !s.adminKey && !!e.OPENAI_ADMIN_KEY };
}

function norm(u) {
  if (!u) return null;
  const od = u.output_tokens_details || u.completion_tokens_details || {}, id = u.input_tokens_details || u.prompt_tokens_details || {};
  return { in: u.input_tokens ?? u.prompt_tokens ?? 0, out: u.output_tokens ?? u.completion_tokens ?? 0, reasoning: od.reasoning_tokens || 0, cached: id.cached_tokens || 0 };
}
function record(entry) {
  const u = norm(entry && entry.usage);
  if (!u) return;
  const c = entry.cost || pricing.cost(entry.usage, entry.model);
  S.calls++; S.in += u.in; S.out += u.out; S.reasoning += u.reasoning; S.cached += u.cached;
  if (c && c.priced) S.usd += c.total; else S.unpriced++;
  const m = S.byModel[entry.model || '?'] = S.byModel[entry.model || '?'] || { calls: 0, in: 0, out: 0, reasoning: 0, cached: 0, usd: 0, priced: true, kind: {} };
  m.calls++; m.in += u.in; m.out += u.out; m.reasoning += u.reasoning; m.cached += u.cached; m.kind[entry.kind || 'naming'] = (m.kind[entry.kind || 'naming'] || 0) + 1;
  if (c && c.priced) m.usd += c.total; else m.priced = false;
  if (entry.kind === 'naming' || entry.ledger) ledger({ time: new Date().toISOString(), kind: entry.kind || 'naming', task: entry.task, round: entry.round, tool: entry.tool, model: entry.model, effort: entry.effort, sheets: entry.sheets || (entry.file ? `${entry.file} p${entry.page}` : ''), response_id: entry.responseId, lane: entry.lane, note: entry.note, ...costRow(c) });
  push();
  clearTimeout(record.t); record.t = setTimeout(() => refresh(), 90 * 1000);   // platform numbers catch up a little later
}
// Live estimate while a takeoff streams: ~4 characters per token of visible output and thinking summary
// (hidden reasoning tokens are only known when the run ends).
const lk = (id, ev) => `${id}#${ev.lane || 0}`;   // one live estimate per parallel lane
let jobInfo = () => null;   // set by the server: job id -> { tool, effort, sheets }
function jobEvent(id, ev) {
  if (ev.type === 'usage') { record({ usage: ev.usage, model: ev.model, cost: ev.cost, kind: 'takeoff', ledger: true, task: id, round: ev.round, lane: ev.lane, note: ev.note, responseId: ev.responseId, ...(jobInfo(id) || {}) }); const l = S.live.get(lk(id, ev)); if (l) { l.out = 0; l.think = 0; } return; }   // one round finished
  if (ev.type === 'output' || ev.type === 'thinking' || ev.type === 'status') {
    const l = S.live.get(lk(id, ev)) || { id, out: 0, think: 0 };
    if (ev.type === 'output') l.out = ev.chars || 0;
    if (ev.type === 'thinking') l.think += (ev.delta || '').length;
    S.live.set(lk(id, ev), l); push();
  }
  if (ev.type === 'end') { for (const k of [...S.live.keys()]) if (k.startsWith(id + '#')) S.live.delete(k); push(); }
}

function snapshot() {
  const s = meterSettings(), live = [...S.live.values()];
  return {
    session: { since: S.since, calls: S.calls, in: S.in, out: S.out, reasoning: S.reasoning, cached: S.cached, usd: S.usd, unpriced: S.unpriced, byModel: S.byModel },
    live: { runs: new Set(live.map(l => l.id)).size, estOut: Math.round(live.reduce((a, l) => a + l.out + l.think, 0) / 4) },
    platform: S.plat, platformError: S.platErr, platformAt: S.platAt, platformBusy: S.platBusy,
    spend: !!s.adminKey, creditBalance: s.creditBalance, creditAsOf: s.creditAsOf,
  };
}
// what the browser gets: no model names, service names or links (lib/brand.js)
const shown = () => require('./brand').scrub(snapshot());
let pushT = null;
function push() {
  if (pushT) return;
  pushT = setTimeout(() => { pushT = null; const d = `data: ${JSON.stringify(shown())}\n\n`; for (const c of S.clients) c.write(d); }, 700);
}

// ---- platform (Admin API) ----
async function adminGet(cfg, key, p, q) {
  const url = new URL(`${cfg.openai.baseUrl}/organization/${p}`);
  Object.entries(q).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error((j && j.error && j.error.message) || `${res.status} ${res.statusText}`);
  return j;
}
async function buckets(cfg, key, p, start, extra) {
  const out = []; let page = null;
  for (let n = 0; n < 20; n++) {
    // OpenAI's maximum buckets per page: 31 for 1d, 168 for 1h, 1440 for 1m (more come back as further pages)
    const width = (extra && extra.bucket_width) || '1d', max = { '1d': 31, '1h': 168, '1m': 1440 }[width] || 31;
    const j = await adminGet(cfg, key, p, { start_time: start, bucket_width: width, limit: max, page, ...(extra || {}), ...(extra && extra.limit ? { limit: Math.min(extra.limit, max) } : {}) });
    out.push(...(j.data || []));
    if (!j.has_more || !j.next_page) break; page = j.next_page;
  }
  return out;
}
async function refresh() {
  const s = meterSettings(), cfg = cfgOf();
  if (!s.adminKey || !cfg) { S.plat = null; S.platErr = ''; push(); return; }
  if (S.platBusy) return;
  S.platBusy = true; push();
  try {
    const now = new Date(), month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000, today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
    const asOf = s.creditAsOf ? Date.parse(s.creditAsOf + 'T00:00:00Z') / 1000 : null;
    const from = Math.min(month, asOf || month);
    const cost = await buckets(cfg, s.adminKey, 'costs', from);
    const sum = t0 => cost.filter(b => b.start_time >= t0).reduce((a, b) => a + (b.results || []).reduce((x, r) => x + (+(r.amount && r.amount.value) || 0), 0), 0);
    const use = await buckets(cfg, s.adminKey, 'usage/completions', today);
    const tok = use.reduce((a, b) => { (b.results || []).forEach(r => { a.in += r.input_tokens || 0; a.out += r.output_tokens || 0; a.req += r.num_model_requests || 0; }); return a; }, { in: 0, out: 0, req: 0 });
    const cur = ((cost.find(b => (b.results || []).length) || {}).results || [{}])[0].amount;
    // near real time: last 60 minutes in 1-minute buckets, by model
    const hour = await buckets(cfg, s.adminKey, 'usage/completions', Math.floor(Date.now() / 1000) - 3600, { bucket_width: '1m', limit: 60, group_by: 'model' });
    const lastHour = {};
    hour.forEach(b => (b.results || []).forEach(r => { const m = lastHour[r.model || '?'] = lastHour[r.model || '?'] || { in: 0, cached: 0, out: 0, req: 0 }; m.in += r.input_tokens || 0; m.cached += r.input_cached_tokens || 0; m.out += r.output_tokens || 0; m.req += r.num_model_requests || 0; }));
    S.plat = { monthSpend: sum(month), todaySpend: sum(today), currency: (cur && cur.currency) || 'usd', todayTokens: tok, lastHour, spendSinceCredit: asOf ? sum(asOf) : null };
    S.platErr = ''; S.platAt = Date.now();
  } catch (e) { S.platErr = e.message; }
  finally { S.platBusy = false; push(); }
}

function init(cfg) {
  cfgOf = cfg;
  if (!timer) { timer = setInterval(refresh, 5 * 60 * 1000); timer.unref(); refresh(); }
}
async function handle(req, res, url, h) {
  init(h.cfg);
  if (url.pathname === '/api/usage/stream' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(shown())}\n\n`);
    S.clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    res.on('close', () => { clearInterval(ping); S.clients.delete(res); });
    return;
  }
  if (url.pathname === '/api/usage/refresh' && req.method === 'POST') { refresh(); return h.send(res, 200, { ok: true }); }
  if (url.pathname === '/api/usage/settings' && req.method === 'POST') {
    if (!h.isLocal(req)) return h.send(res, 403, { error: 'Only on the computer running the server.' });
    let b; try { b = await h.readJson(req); } catch (e) { return h.send(res, 400, { error: e.message }); }
    const s = readSettings();   // only the prepaid balance can be set from the browser; the spend key is set in .env
    if ('creditBalance' in b) { if (b.creditBalance === '' || b.creditBalance == null) delete s.creditBalance; else s.creditBalance = +b.creditBalance; }
    if ('creditAsOf' in b) { if (b.creditAsOf) s.creditAsOf = String(b.creditAsOf).slice(0, 10); else delete s.creditAsOf; }
    writeSettings(s);
    await refresh();
    return h.send(res, 200, { ok: true, error: S.platErr });
  }
  h.send(res, 404, { error: 'Unknown endpoint' });
}

module.exports = { init, refresh, record, jobEvent, handle, ledger, setJobInfo: f => { jobInfo = f; } };
