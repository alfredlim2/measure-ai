// Model prices and token → cost. USD per 1M tokens, standard tier, from OpenAI's pricing page (checked 2026-10-11).
// "long" applies when one request has more than 272K input tokens. Edit the table from the usage meter (Prices…);
// edits are saved in ai-settings.json ("prices") and win over these defaults. A dated model id (gpt-5.5-2026-04-23)
// uses its base model's price.
const { readSettings, writeSettings } = require('./env');

const LONG_FROM = 272000;
// Uncached input that OpenAI writes into the prompt cache is billed as "cache writes" at 1.25 × the input price
// (checked against the Costs API, 2026-10-12: gpt-6-astra $12.50 / 1M, gpt-6.1-sol long $5.00 / 1M). A model row may
// give its own "write" price; otherwise input × CACHE_WRITE_MULT.
const CACHE_WRITE_MULT = 1.25;
// Processing tiers (service_tier) scale every rate: Fast 2×, Ultrafast 6× (gpt-6.1-sol model page, 2026-10-12).
// flex / batch (half price) are listed only so a response billed that way is still priced right; the app never asks for them.
const TIER_MULT = { fast: 2, ultrafast: 6, flex: 0.5, batch: 0.5 };
const DEFAULT_PRICES = {
  'gpt-6-astra':   { in: 10.00, cached: 1.00,  out: 50.00, long: { in: 20.00, cached: 2.00, out: 75.00 } },
  'gpt-6.1-sol':   { in: 2.00,  cached: 0.10,  out: 10.00, long: { in: 4.00,  cached: 0.20, out: 15.00 } },
  'gpt-6-sol':     { in: 2.00,  cached: 0.20,  out: 10.00, long: { in: 4.00,  cached: 0.40, out: 15.00 } },
  'gpt-6-luna':    { in: 0.10,  cached: 0.01,  out: 0.50,  long: { in: 0.20,  cached: 0.02, out: 0.75 } },
  'gpt-5.6-sol':   { in: 4.00,  cached: 0.40,  out: 20.00, long: { in: 8.00,  cached: 0.80, out: 30.00 } },
  'gpt-5.6-terra': { in: 2.00,  cached: 0.20,  out: 12.00, long: { in: 4.00,  cached: 0.40, out: 18.00 } },
  'gpt-5.6-luna':  { in: 0.20,  cached: 0.02,  out: 1.20,  long: { in: 0.40,  cached: 0.04, out: 1.80 } },
  'gpt-5.5':       { in: 5.00,  cached: 0.50,  out: 30.00, long: { in: 10.00, cached: 1.00, out: 45.00 } },
  'gpt-5.4':       { in: 2.50,  cached: 0.25,  out: 15.00, long: { in: 5.00,  cached: 0.50, out: 22.50 } },
  'gpt-5.4-mini':  { in: 0.75,  cached: 0.075, out: 4.50 },
  'gpt-5.4-nano':  { in: 0.20,  cached: 0.02,  out: 1.25 },
  'gpt-4.1':       { in: 2.00,  cached: 0.50,  out: 8.00 },
  'gpt-4.1-mini':  { in: 0.40,  cached: 0.10,  out: 1.60 },
};

function table() { return { ...DEFAULT_PRICES, ...(readSettings().prices || {}) }; }
function saveTable(edited) {
  const s = readSettings(), custom = {};
  for (const [m, p] of Object.entries(edited || {})) {
    if (!p || !isFinite(+p.in) || !isFinite(+p.out)) continue;
    const row = { in: +p.in, cached: isFinite(+p.cached) ? +p.cached : +p.in, out: +p.out };
    if (p.long && isFinite(+p.long.in)) row.long = { in: +p.long.in, cached: +p.long.cached || +p.long.in, out: +p.long.out || +p.out };
    const d = DEFAULT_PRICES[m];
    if (!d || JSON.stringify(row) !== JSON.stringify({ in: d.in, cached: d.cached, out: d.out, ...(d.long ? { long: d.long } : {}) })) custom[m] = row;
  }
  if (Object.keys(custom).length) s.prices = custom; else delete s.prices;
  writeSettings(s);
}
// Longest table key the model id starts with: "gpt-5.4-mini-2026-03-17" → gpt-5.4-mini, "gpt-5.5-pro" → none (not gpt-5.5).
function priceFor(model) {
  const T = table(), m = String(model || '').toLowerCase();
  if (T[m]) return { model: m, ...T[m] };
  const base = m.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  if (T[base]) return { model: base, ...T[base] };
  return null;
}

// Token counts from either API shape (Responses: input_tokens…, Chat Completions: prompt_tokens…).
function tokens(u) {
  if (!u) return null;
  const id = u.input_tokens_details || u.prompt_tokens_details || {}, od = u.output_tokens_details || u.completion_tokens_details || {};
  const input = u.input_tokens ?? u.prompt_tokens ?? 0, cached = id.cached_tokens || 0;
  return { input, cached, uncached: Math.max(0, input - cached), cacheWrite: id.cache_write_tokens || 0, output: u.output_tokens ?? u.completion_tokens ?? 0, reasoning: od.reasoning_tokens || 0 };
}
// Cost of one request. Reasoning tokens are billed as output (they are included in output_tokens).
function cost(usage, model, serviceTier) {
  const t = tokens(usage), p = priceFor(model), k = TIER_MULT[serviceTier] || 1;
  if (!t) return null;
  if (!p) return { ...t, model, priced: false, total: null };
  const long = t.input > LONG_FROM && p.long, r0 = long ? p.long : p, r = { in: r0.in * k, cached: r0.cached * k, out: r0.out * k }, write = (r0.write ?? r0.in * CACHE_WRITE_MULT) * k;
  const wt = Math.min(t.cacheWrite, t.uncached), writeUsd = wt * write / 1e6;
  const inUsd = (t.uncached - wt) * r.in / 1e6 + writeUsd, cachedUsd = t.cached * r.cached / 1e6, outUsd = t.output * r.out / 1e6;   // inUsd includes cache writes
  return { ...t, model, priceModel: p.model, priced: true, tier: (TIER_MULT[serviceTier] ? serviceTier + ' · ' : '') + (long ? 'long' : 'standard'), serviceTier: serviceTier || 'default', rate: { in: r.in, write, cached: r.cached, out: r.out }, inUsd, writeUsd, cachedUsd, outUsd, total: inUsd + cachedUsd + outUsd };
}
// Sum of several cost() results.
function addCost(a, c) {
  if (!c) return a;
  a = a || { input: 0, cached: 0, uncached: 0, cacheWrite: 0, output: 0, reasoning: 0, inUsd: 0, cachedUsd: 0, outUsd: 0, total: 0, unpriced: 0 };
  for (const k of ['input', 'cached', 'uncached', 'cacheWrite', 'output', 'reasoning']) a[k] += c[k] || 0;
  if (c.priced) { a.writeUsd = (a.writeUsd || 0) + (c.writeUsd || 0); a.inUsd += c.inUsd; a.cachedUsd += c.cachedUsd; a.outUsd += c.outUsd; a.total += c.total; } else a.unpriced++;
  return a;
}

module.exports = { DEFAULT_PRICES, LONG_FROM, CACHE_WRITE_MULT, TIER_MULT, table, saveTable, priceFor, tokens, cost, addCost };
