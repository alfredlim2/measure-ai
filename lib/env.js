// Settings: .env (optional) + ai-settings.json (written by the AI Settings window in the app).
// Values saved from the app win over .env. Both files stay on this computer; the browser never receives the key.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SETTINGS_FILE = process.env.AI_SETTINGS_FILE ? path.resolve(process.env.AI_SETTINGS_FILE) : path.join(ROOT, 'ai-settings.json');

function loadEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return false;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return true;
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}
function writeSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

const EFFORTS = ['auto', 'minimal', 'low', 'medium', 'high'];

function config(s = readSettings()) {
  const e = process.env;
  const pick = (k, envK, d) => (s[k] !== undefined && s[k] !== '' ? s[k] : e[envK] !== undefined && e[envK] !== '' ? e[envK] : d);
  const key = String(pick('apiKey', 'OPENAI_API_KEY', '')).trim();
  const hasKey = !!key && !key.includes('...');
  const provider = String(pick('provider', 'AI_PROVIDER', '') || (hasKey ? 'openai' : 'mock')).toLowerCase();
  const effort = String(pick('effort', 'OPENAI_REASONING_EFFORT', 'auto') || 'auto').toLowerCase();
  return {
    port: +(e.PORT || 5173),
    host: e.HOST || '127.0.0.1',
    provider: provider === 'openai' && !hasKey ? 'openai' : provider,
    hasKey,
    openai: {
      key,
      model: pick('model', 'OPENAI_MODEL', 'gpt-4.1-mini'),
      baseUrl: String(pick('baseUrl', 'OPENAI_BASE_URL', 'https://api.openai.com/v1')).replace(/\/+$/, ''),
      org: pick('org', 'OPENAI_ORG_ID', ''),
      project: pick('project', 'OPENAI_PROJECT_ID', ''),
      effort: EFFORTS.includes(effort) ? effort : 'auto',
    },
    timeoutMs: Math.min(120000, Math.max(5000, +pick('timeoutMs', 'AI_SHEET_TIMEOUT_MS', 30000))),
    concurrency: Math.min(8, Math.max(1, +pick('concurrency', 'AI_CONCURRENCY', 3))),
    imageDetail: String(pick('imageDetail', 'AI_IMAGE_DETAIL', 'high')).toLowerCase() === 'low' ? 'low' : 'high',
  };
}

module.exports = { loadEnv, config, readSettings, writeSettings, EFFORTS, SETTINGS_FILE };
