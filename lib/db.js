// Measure.AI database: one SQLite file (data/measure.db) via Node's built-in node:sqlite.
// Users, sessions, password resets, the credit ledger, projects, drawings (uploaded PDFs) and runs.
const fs = require('fs');
const path = require('path');
// node:sqlite prints an "experimental" warning once; it is stable enough for this app, so that one warning is muted.
const emit = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w && w.message || w).includes('SQLite is an experimental') ? undefined : emit.call(process, w, ...a));
const { DatabaseSync } = require('node:sqlite');

const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'measure.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user',
  credits INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT, ua TEXT
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  kind TEXT NOT NULL,             -- topup | run | adjust | bonus | refund
  ref TEXT, note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS drawings (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  pages INTEGER NOT NULL DEFAULT 0,
  sheets TEXT NOT NULL DEFAULT '[]', -- JSON: [{page, name, number, title, scale, discipline, type, area}]
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  job_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',  -- running | done | error | cancelled
  settings TEXT NOT NULL DEFAULT '{}',     -- JSON: sheets [{drawing, page}], kinds, areas, options
  summary TEXT NOT NULL DEFAULT '{}',      -- JSON: counts shown in the history list
  checks TEXT NOT NULL DEFAULT '[]',       -- JSON: element ids the user marked as checked
  credits INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_ledger_user ON credit_ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_projects_user ON projects(user_id, updated_at);
CREATE INDEX IF NOT EXISTS ix_drawings_project ON drawings(project_id);
CREATE INDEX IF NOT EXISTS ix_runs_project ON runs(project_id, created_at);
`);

const now = () => Date.now();
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
function tx(fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } }

module.exports = { db, DATA, now, one, all, run, tx };
