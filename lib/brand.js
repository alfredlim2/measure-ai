// Everything the browser receives goes through scrub(): the AI is presented as "Measure.AI" only.
// Model ids, request / response ids, keys, service names and links are removed from JSON replies, job streams and
// error messages. Logs, the ledger and settings on this computer keep the full details.
const NAME = 'Measure.AI';
const RULES = [
  [/https?:\/\/[^\s"')]*openai[^\s"')]*/gi, ''],
  [/\bplatform\.openai\.com\S*/gi, ''],
  [/\b(?:chat\s?gpt|open\s?ai)(?:['’]s)?\b/gi, NAME],
  [/\bgpt-[\w.-]+/gi, NAME],
  [/\b(?:responses api|chat completions(?: api)?|admin api|costs api|usage api)\b/gi, 'AI service'],
  [/\b(?:resp|req|file|run|msg)_[A-Za-z0-9]{8,}\b/g, ''],
  [/\bsk-[A-Za-z0-9_-]{6,}/g, ''],
  // the service's own account / billing wording
  [/you exceeded your current quota[^.]*\.?/gi, 'The AI has reached its usage limit for now.'],
  [/you have no credits remaining[^.]*\.?/gi, 'The AI has reached its usage limit for now.'],
  [/please check your plan and billing details\.?/gi, ''],
  [/for more information on this error[^:]*:\s*/gi, ''],
  [/incorrect api key provided[^.]*\./gi, 'The AI is not available on this server.'],
  [/you can find your api key at\s*\.?/gi, ''],
  [/\(\s*request\s*\)/gi, ''],
  [/\s*in (?:organization|project)\s+(?:org|proj)[-_][A-Za-z0-9]+/gi, ''],
  [/\b(?:org|proj)[-_][A-Za-z0-9]{3,}\b/g, ''],
  [/\s+\.(?=\s|$)/g, '.'],
  [new RegExp(`(?:${NAME}\\s*){2,}`, 'g'), NAME + ' '],
];
const scrubText = s => RULES.reduce((t, [re, to]) => t.replace(re, to), String(s));
const MODEL_KEYS = new Set(['model', 'modelUsed', 'priceModel', 'price_model', 'current']);
const DROP_KEYS = new Set(['responseId', 'response_id', 'baseUrl', 'keyHint', 'byModel', 'lastHour', 'effortsByModel']);
function scrub(v) {
  if (typeof v === 'string') return scrubText(v);
  if (Array.isArray(v)) return v.map(scrub);
  if (!v || typeof v !== 'object') return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    if (DROP_KEYS.has(k)) continue;
    o[k] = MODEL_KEYS.has(k) && x != null && x !== '' ? NAME : scrub(x);
  }
  return o;
}
module.exports = { NAME, scrub, scrubText };
