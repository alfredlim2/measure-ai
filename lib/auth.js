// Measure.AI accounts: email + password and Google sign-in, cookie sessions, password reset.
// Passwords: scrypt with a random salt per user. Sessions: a random token in an HttpOnly cookie; only its SHA-256 is
// stored, so a copy of the database cannot be used to sign in. Google: OAuth 2.0 authorization-code flow (openid email
// profile), the account is matched by Google's user id, else by the same verified email.
const crypto = require('crypto');
const { one, run, now, tx } = require('./db');
const credits = require('./credits');
const mail = require('./mail');

const COOKIE = 'ma_session', SESSION_DAYS = 30;
const PUBLIC_URL = () => String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const secure = () => PUBLIC_URL().startsWith('https://');
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
class AuthError extends Error { constructor(message, status = 400, code = 'bad_request') { super(message); this.status = status; this.code = code; } }

// ---- passwords ----
const SCRYPT = { N: 16384, r: 8, p: 1, len: 64 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p });
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
function checkPassword(pw) { if (typeof pw !== 'string' || pw.length < 8) throw new AuthError('Use at least 8 characters for the password.'); if (pw.length > 200) throw new AuthError('That password is too long.'); }

// ---- attempt limiter (sign-in, sign-up, reset): per IP and per email, in memory ----
const tries = new Map();
function limit(key, max = 10, windowMs = 15 * 60 * 1000) {
  const t = now(), r = tries.get(key) || { n: 0, at: t };
  if (t - r.at > windowMs) { r.n = 0; r.at = t; }
  r.n++; tries.set(key, r);
  if (r.n > max) throw new AuthError('Too many attempts. Please wait a few minutes and try again.', 429, 'rate_limited');
}
setInterval(() => { const t = now(); for (const [k, r] of tries) if (t - r.at > 3600000) tries.delete(k); }, 600000).unref();

// ---- sessions ----
function cookieOf(req, name) {
  const c = req.headers.cookie || '';
  for (const part of c.split(/;\s*/)) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1)); }
  return '';
}
const setCookie = (res, name, val, maxAgeS) => {
  const prev = res.getHeader('Set-Cookie'), list = prev ? [].concat(prev) : [];
  list.push(`${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure() ? '; Secure' : ''}`);
  res.setHeader('Set-Cookie', list);
};
function startSession(res, user, req) {
  const t = token();
  run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?)',
    sha(t), user.id, now(), now() + SESSION_DAYS * 864e5, ipOf(req), String(req.headers['user-agent'] || '').slice(0, 200));
  run('UPDATE users SET last_login = ? WHERE id = ?', now(), user.id);
  setCookie(res, COOKIE, t, SESSION_DAYS * 86400);
}
function userOf(req) {
  const t = cookieOf(req, COOKIE); if (!t) return null;
  const s = one('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?', sha(t), now());
  return s || null;
}
function endSession(req, res) { const t = cookieOf(req, COOKIE); if (t) run('DELETE FROM sessions WHERE token_hash = ?', sha(t)); setCookie(res, COOKIE, '', 0); }
const ipOf = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
// what the browser may see of a user
const publicUser = u => u && { id: u.id, email: u.email, name: u.name, role: u.role, credits: u.credits, hasPassword: !!u.password_hash, google: !!u.google_sub, createdAt: u.created_at };

// ---- email + password ----
function createUser({ email, name, passwordHash, googleSub }) {
  return tx(() => {
    const r = run('INSERT INTO users (email, name, password_hash, google_sub, created_at) VALUES (?, ?, ?, ?, ?)', email, String(name || '').trim().slice(0, 80), passwordHash || null, googleSub || null, now());
    const id = Number(r.lastInsertRowid);
    // the first account on a new server is the administrator (it can add credits to accounts)
    if (one('SELECT COUNT(*) n FROM users').n === 1 || adminEmails().includes(email)) run("UPDATE users SET role = 'admin' WHERE id = ?", id);
    const bonus = Math.max(0, Math.round(+process.env.SIGNUP_CREDITS || 0));
    if (bonus) credits.add(id, bonus, 'bonus', '', 'Welcome credits', true);
    return one('SELECT * FROM users WHERE id = ?', id);
  });
}
const adminEmails = () => String(process.env.ADMIN_EMAILS || '').split(',').map(normEmail).filter(Boolean);
function signup(req, res, { email, password, name }) {
  email = normEmail(email); limit('su:' + ipOf(req), 20);
  if (!validEmail(email)) throw new AuthError('Enter a valid email address.');
  checkPassword(password);
  if (one('SELECT id FROM users WHERE email = ?', email)) throw new AuthError('An account with this email already exists. Sign in instead.', 409, 'exists');
  const u = createUser({ email, name, passwordHash: hashPassword(password) });
  startSession(res, u, req); return publicUser(u);
}
function login(req, res, { email, password }) {
  email = normEmail(email); limit('li:' + ipOf(req), 30); limit('le:' + email, 10);
  const u = one('SELECT * FROM users WHERE email = ?', email);
  if (!u || !u.password_hash || !verifyPassword(password, u.password_hash)) {
    if (u && !u.password_hash && u.google_sub) throw new AuthError('This account signs in with Google.', 401, 'use_google');
    throw new AuthError('Email or password is not correct.', 401, 'bad_login');
  }
  startSession(res, u, req); return publicUser(u);
}
function changePassword(u, { current, password }) {
  checkPassword(password);
  if (u.password_hash && !verifyPassword(current, u.password_hash)) throw new AuthError('The current password is not correct.', 401, 'bad_login');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), u.id);
}
function updateProfile(u, { name }) { run('UPDATE users SET name = ? WHERE id = ?', String(name || '').trim().slice(0, 80), u.id); }

// ---- password reset (link by email, valid 1 hour, single use) ----
async function requestReset(req, { email }) {
  email = normEmail(email); limit('rr:' + ipOf(req), 10); limit('re:' + email, 3, 3600000);
  const u = one('SELECT * FROM users WHERE email = ?', email);
  if (!u) return;   // same answer either way: does not reveal which emails have accounts
  const t = token();
  run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha(t), u.id, now() + 3600000);
  const link = `${PUBLIC_URL() || 'http://localhost:' + (process.env.PORT || 5173)}/#/reset?token=${t}`;
  await mail.send({ to: u.email, subject: 'Reset your Measure.AI password', text: `Hello${u.name ? ' ' + u.name : ''},\n\nUse this link within one hour to choose a new password:\n${link}\n\nIf you did not ask for this, you can ignore this email.\n\nMeasure.AI` });
}
function resetPassword(req, res, { token: t, password }) {
  checkPassword(password);
  const r = one('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > ?', sha(t), now());
  if (!r) throw new AuthError('This reset link is not valid any more. Ask for a new one.', 400, 'bad_token');
  tx(() => { run('UPDATE password_resets SET used = 1 WHERE token_hash = ?', sha(t)); run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), r.user_id); run('DELETE FROM sessions WHERE user_id = ?', r.user_id); });
  const u = one('SELECT * FROM users WHERE id = ?', r.user_id); startSession(res, u, req); return publicUser(u);
}

// ---- Google sign-in ----
const google = () => ({ id: process.env.GOOGLE_CLIENT_ID || '', secret: process.env.GOOGLE_CLIENT_SECRET || '' });
const googleOn = () => !!(google().id && google().secret && PUBLIC_URL());
const redirectUri = () => `${PUBLIC_URL()}/auth/google/callback`;
function googleStart(req, res) {
  if (!googleOn()) { res.writeHead(302, { Location: '/#/login?error=google_off' }); return res.end(); }
  const state = token();
  setCookie(res, 'ma_gstate', state, 600);
  const q = new URLSearchParams({ client_id: google().id, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${q}` }); res.end();
}
async function googleCallback(req, res, url) {
  const back = err => { res.writeHead(302, { Location: err ? `/#/login?error=${encodeURIComponent(err)}` : '/#/projects' }); res.end(); };
  try {
    const st = url.searchParams.get('state'), code = url.searchParams.get('code');
    if (!googleOn() || !code || !st || st !== cookieOf(req, 'ma_gstate')) return back('google_state');
    setCookie(res, 'ma_gstate', '', 0);
    const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: google().id, client_secret: google().secret, redirect_uri: redirectUri(), grant_type: 'authorization_code' }), signal: AbortSignal.timeout(15000) });
    const tj = await tr.json().catch(() => ({}));
    if (!tr.ok || !tj.access_token) return back('google_token');
    const ur = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tj.access_token}` }, signal: AbortSignal.timeout(15000) });
    const g = await ur.json().catch(() => ({}));
    if (!ur.ok || !g.sub || !g.email) return back('google_profile');
    if (g.email_verified !== true && g.email_verified !== 'true') return back('google_unverified');   // linking by email needs a verified address
    const email = normEmail(g.email);
    let u = one('SELECT * FROM users WHERE google_sub = ?', g.sub);
    if (!u) { u = one('SELECT * FROM users WHERE email = ?', email); if (u) run('UPDATE users SET google_sub = ? WHERE id = ?', g.sub, u.id); }
    if (!u) u = createUser({ email, name: g.name || '', googleSub: g.sub });
    startSession(res, one('SELECT * FROM users WHERE id = ?', u.id), req); back('');
  } catch (e) { console.error('google sign-in', e.message); back('google_error'); }
}

module.exports = { AuthError, userOf, publicUser, signup, login, endSession, changePassword, updateProfile, requestReset, resetPassword, googleStart, googleCallback, googleOn, hashPassword, verifyPassword, normEmail };
