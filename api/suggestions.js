// /api/suggestions: song/event suggestions from /dj/sugerencias.
// Emails each suggestion to DJ Zech via Resend.
// Requires a name, a suggestion, and at least one of phone or email.
//
// Env vars (same as /api/wedding-program):
//   RESEND_API_KEY            required
//   PROGRAM_TO_EMAIL          default djzecheventos@gmail.com
//   CONTACT_FROM_EMAIL        default "DJ Zech <onboarding@resend.dev>"

const LIMITS = { name: 120, phone: 40, email: 200, suggestion: 2000, event: 120 };

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  // Honeypot: real visitors never fill this hidden field.
  if (body.website) return res.status(200).json({ ok: true });

  const data = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    const value = String(body[key] ?? '').trim();
    if (value.length > max) return res.status(400).json({ error: `Field too long: ${key}` });
    data[key] = value;
  }

  if (!data.name) return res.status(400).json({ error: 'Missing field: name' });
  if (!data.suggestion) return res.status(400).json({ error: 'Missing field: suggestion' });
  if (!data.phone && !data.email) return res.status(400).json({ error: 'Phone or email required' });
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  if (data.phone && (data.phone.replace(/\D/g, '').length < 7 || !/^[0-9+()\s.-]+$/.test(data.phone))) {
    return res.status(400).json({ error: 'Invalid phone' });
  }

  const eventLine = data.event ? ` (${data.event})` : '';
  const rows = [
    ['Name', data.name],
    ['Phone', data.phone || '—'],
    ['Email', data.email || '—'],
    ['Event', data.event || '—'],
  ];
  const html =
    `<h2>New suggestion${escapeHtml(eventLine)}</h2>` +
    `<table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">` +
    rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><strong>${escapeHtml(v)}</strong></td></tr>`).join('') +
    `</table>` +
    `<p style="font-family:Arial,sans-serif;font-size:15px;white-space:pre-wrap;background:#f4f4f4;padding:12px;border-radius:8px">${escapeHtml(data.suggestion)}</p>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\nSuggestion:\n${data.suggestion}`;

  const email = {
    from: process.env.CONTACT_FROM_EMAIL || 'DJ Zech <onboarding@resend.dev>',
    to: [process.env.PROGRAM_TO_EMAIL || 'djzecheventos@gmail.com'],
    subject: `Suggestion from ${data.name}${eventLine}`,
    html,
    text,
  };
  if (data.email) email.reply_to = data.email;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(email),
  });

  if (!emailRes.ok) {
    console.error('suggestions: Resend error', emailRes.status, await emailRes.text());
    return res.status(502).json({ error: 'Could not send the suggestion' });
  }

  return res.status(200).json({ ok: true });
};
