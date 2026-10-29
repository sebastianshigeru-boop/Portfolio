// /api/wedding-program: receives a finished wedding program from /dj/wedding-program
// and emails it to DJ Zech via Resend, with the PDF attached.
//
// Env vars:
//   RESEND_API_KEY            required
//   PROGRAM_TO_EMAIL          default djzecheventos@gmail.com
//   CONTACT_FROM_EMAIL        default "DJ Zech Programs <onboarding@resend.dev>"

const LIMITS = { couple: 160, summary: 20000, link: 30000, filename: 200 };
const MAX_PDF_B64 = 3_000_000;

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const data = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    const value = String(body[key] ?? '').trim();
    if (value.length > max) return res.status(400).json({ error: `Field too long: ${key}` });
    data[key] = value;
  }
  if (!data.summary) return res.status(400).json({ error: 'Missing field: summary' });

  const pdf = String(body.pdf ?? '');
  // Base64 of a real PDF starts with "JVBER" (%PDF).
  if (!pdf.startsWith('JVBER') || pdf.length > MAX_PDF_B64 || !/^[A-Za-z0-9+/=]+$/.test(pdf)) {
    return res.status(400).json({ error: 'Invalid PDF' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('wedding-program: RESEND_API_KEY is not set');
    return res.status(500).json({ error: 'Sending is not configured' });
  }

  const couple = data.couple || 'Wedding';
  const filename = (data.filename || `Wedding Program - ${couple}.pdf`).replace(/[\\/:*?"<>|\r\n]+/g, '');
  const linkHtml = /^https?:\/\//.test(data.link)
    ? `<p><a href="${escapeHtml(data.link)}">Open their edited version</a></p>`
    : '';
  const html =
    `<h2>Wedding program: ${escapeHtml(couple)}</h2>` +
    `<p>The couple finished their program. The PDF is attached.</p>${linkHtml}` +
    `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap">${escapeHtml(data.summary)}</pre>`;
  const text = `${data.summary}${data.link ? `\n\nOpen their edited version:\n${data.link}` : ''}`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.CONTACT_FROM_EMAIL || 'DJ Zech Programs <onboarding@resend.dev>',
      to: [process.env.PROGRAM_TO_EMAIL || 'djzecheventos@gmail.com'],
      subject: `Wedding program: ${couple}`,
      html,
      text,
      attachments: [{ filename, content: pdf }],
    }),
  });

  if (!emailRes.ok) {
    console.error('wedding-program: Resend error', emailRes.status, await emailRes.text());
    return res.status(502).json({ error: 'Could not send the program' });
  }

  return res.status(200).json({ ok: true });
}
