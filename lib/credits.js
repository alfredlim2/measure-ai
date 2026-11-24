// Credits: each account has a balance; every change is a row in credit_ledger with the balance after it.
// How credits are bought (top-up packages, payments) is to be decided; until then an administrator adds them.
// A measuring run is charged after it ends from what it actually used: CREDITS_PER_USD credits per dollar of AI cost
// (default 100, i.e. 1 credit = 1 cent), rounded up, never more than the balance. The run's own spending cap is set from
// the balance, so a run stops when the credits run out and keeps what it found.
const { one, all, run, now, tx } = require('./db');

const perUsd = () => Math.max(1, +process.env.CREDITS_PER_USD || 100);
const balance = userId => (one('SELECT credits FROM users WHERE id = ?', userId) || { credits: 0 }).credits;

function add(userId, delta, kind, ref = '', note = '', inTx = false) {
  const go = () => {
    const b = balance(userId), d = Math.round(delta), after = b + d;
    if (after < 0) throw Object.assign(new Error('Not enough credits.'), { status: 402, code: 'no_credits' });
    run('UPDATE users SET credits = ? WHERE id = ?', after, userId);
    run('INSERT INTO credit_ledger (user_id, delta, balance_after, kind, ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', userId, d, after, kind, String(ref || ''), String(note || ''), now());
    return after;
  };
  return inTx ? go() : tx(go);
}
// charge a finished run: at most the current balance
function chargeRun(userId, usd, ref, note) {
  return tx(() => {
    const want = Math.ceil(Math.max(0, +usd || 0) * perUsd()), b = balance(userId), c = Math.min(want, b);
    if (c > 0) add(userId, -c, 'run', ref, note, true);
    return c;
  });
}
const usdLimit = userId => balance(userId) / perUsd();   // the most a run may spend
const ledger = (userId, n = 100) => all('SELECT id, delta, balance_after AS balanceAfter, kind, ref, note, created_at AS at FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, n);

module.exports = { add, chargeRun, balance, ledger, usdLimit, perUsd };
