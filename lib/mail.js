// Outgoing email (password resets). With RESEND_API_KEY set, mail goes through Resend's HTTP API from MAIL_FROM.
// Without it (local development), the message is printed in the server console instead.
async function send({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM || 'Measure.AI <onboarding@resend.dev>';
  if (!key) { console.log(`\n[mail not configured] To: ${to}\nSubject: ${subject}\n${text}\n`); return { ok: true, logged: true }; }
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, text }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) console.error('mail send failed', r.status, await r.text().catch(() => ''));
  return { ok: r.ok };
}
module.exports = { send };
