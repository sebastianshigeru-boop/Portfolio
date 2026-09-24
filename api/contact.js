// /api/contact: contact form for the portfolio.
// Emails each request via Resend and, optionally, forwards it to a webhook
// (Make, Zapier, etc.) for WhatsApp/SMS/Slack alerts.
//
// Env vars:
//   RESEND_API_KEY        required
//   CONTACT_TO_EMAIL      default zaizai.admin@gmail.com
//   CONTACT_FROM_EMAIL    default "ZaiZai Contact <onboarding@resend.dev>"
//   CONTACT_WEBHOOK_URL   optional

const FIELDS = { name: 120, company: 160, email: 200, phone: 40, message: 4000 };

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
  for (const [key, max] of Object.entries(FIELDS)) {
    const value = String(body[key] ?? '').trim();
    if (!value) return res.status(400).json({ error: `Missing field: ${key}` });
    if (value.length > max) return res.status(400).json({ error: `Field too long: ${key}` });
    data[key] = value;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('contact: RESEND_API_KEY is not set');
    return res.status(500).json({ error: 'Contact form is not configured' });
  }

  const source = body.source ? String(body.source).slice(0, 80) : 'website';
  const rows = [
    ['Name', data.name], ['Company', data.company], ['Email', data.email],
    ['Phone', data.phone], ['Source', source],
  ];
  const html =
    `<h2>New consultation request</h2><table cellpadding="6">` +
    rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${escapeHtml(v)}</td></tr>`).join('') +
    `</table><h3>Message</h3><p style="white-space:pre-wrap">${escapeHtml(data.message)}</p>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\nMessage:\n${data.message}`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.CONTACT_FROM_EMAIL || 'ZaiZai Contact <onboarding@resend.dev>',
      to: [process.env.CONTACT_TO_EMAIL || 'zaizai.admin@gmail.com'],
      reply_to: data.email,
      subject: `New consultation request: ${data.name} (${data.company})`,
      html,
      text,
    }),
  });

  if (!emailRes.ok) {
    console.error('contact: Resend error', emailRes.status, await emailRes.text());
    return res.status(502).json({ error: 'Could not send the message' });
  }

  if (process.env.CONTACT_WEBHOOK_URL) {
    try {
      await fetch(process.env.CONTACT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, source, received_at: new Date().toISOString() }),
      });
    } catch (err) {
      // The email already went out; a failed alert shouldn't fail the request.
      console.error('contact: webhook error', err);
    }
  }

  return res.status(200).json({ ok: true });
}
