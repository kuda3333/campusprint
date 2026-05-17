// Vercel Serverless Function — /api/send-email.js
// CommonJS format for Vercel compatibility (Node 24 runtime).
//
// 2026-05-16 hardening pass (IMMEDIATE STOP fixes from Council of 5 — Seat 3 Security):
//   - Removed legacy `salon_booking` handler (one endpoint must serve one product; CWE-732).
//   - HTML-escape every user-controlled field before interpolation into email body (CWE-79).
//   - Lock CORS to ALLOWED_ORIGIN(S) env var; fail closed (no `*` echo). (CWE-942)
//   - Strict request-body schema validation with length caps. (CWE-20)
//   - Reject `from: onboarding@resend.dev`; require a verified sender via env. (CWE-441)
//   - Generic error responses to client; full error in server logs only. (CWE-209)
//
// Outstanding (tracked in SECURITY.md): Firebase ID-token verification, per-IP rate limit
// (Upstash), payment-webhook verification before any "PAID" claim, virus scan on file upload
// once Blob is wired.

const MAX_FIELD_LEN = 200;

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isAllowedOrigin(origin, allowList) {
  if (!origin || allowList.length === 0) return false;
  return allowList.includes(origin);
}

function looksLikeEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= MAX_FIELD_LEN;
}

function clean(v) {
  if (typeof v !== 'string') return '';
  return v.slice(0, MAX_FIELD_LEN);
}

function validatePrintJob(data) {
  if (!data || typeof data !== 'object') return 'data must be an object';
  const required = ['jobNum', 'location', 'studentId', 'email', 'phone',
                    'copies', 'paper', 'sides', 'payment', 'amount',
                    'fileName', 'collectBy'];
  for (const k of required) {
    if (!(k in data)) return `missing field: ${k}`;
    if (typeof data[k] !== 'string' && typeof data[k] !== 'number') {
      return `invalid type for: ${k}`;
    }
    if (String(data[k]).length > MAX_FIELD_LEN) return `field too long: ${k}`;
  }
  if (data.email && !looksLikeEmail(data.email)) return 'invalid email';
  return null;
}

module.exports = async function handler(req, res) {
  // ── CORS: env-driven allowlist, fail closed ────────────────────────────
  const rawAllow = process.env.ALLOWED_ORIGINS || '';
  const allowList = rawAllow.split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin, allowList)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Secrets present? ────────────────────────────────────────────────────
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM    = process.env.RESEND_FROM;
  const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL;
  if (!RESEND_API_KEY || !RESEND_FROM || !OPERATOR_EMAIL) {
    console.error('config missing: RESEND_API_KEY / RESEND_FROM / OPERATOR_EMAIL');
    return res.status(500).json({ error: 'service_unavailable' });
  }
  if (RESEND_FROM.includes('onboarding@resend.dev')) {
    console.error('RESEND_FROM is the shared Resend sandbox sender — refusing to send.');
    return res.status(500).json({ error: 'service_misconfigured' });
  }

  // ── Body validation ─────────────────────────────────────────────────────
  const { type, data } = req.body || {};
  if (type !== 'print_job') {
    return res.status(400).json({ error: 'unsupported_type' });
  }
  const validationError = validatePrintJob(data);
  if (validationError) {
    console.warn('validation rejected:', validationError);
    return res.status(400).json({ error: 'invalid_payload' });
  }

  // ── Build escaped view of the data for HTML interpolation ───────────────
  const e = {
    jobNum:    escapeHtml(clean(data.jobNum)),
    location:  escapeHtml(clean(data.location)),
    studentId: escapeHtml(clean(data.studentId)),
    fileName:  escapeHtml(clean(data.fileName)),
    copies:    escapeHtml(clean(data.copies)),
    paper:     escapeHtml(clean(data.paper)),
    sides:     escapeHtml(clean(data.sides)),
    payment:   escapeHtml(clean(data.payment)),
    amount:    escapeHtml(clean(data.amount)),
    email:     escapeHtml(clean(data.email)),
    phone:     escapeHtml(clean(data.phone)),
    collectBy: escapeHtml(clean(data.collectBy)),
  };

  const operatorSubject = `New Print Job ${e.jobNum} — ${e.location}`;
  const customerSubject = `Your CampusPrint Job is Confirmed — ${e.jobNum}`;

  const operatorBody = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px;background:#f5f2eb">
      <div style="background:#0e0e0e;border-radius:12px;padding:20px;margin-bottom:16px">
        <h2 style="color:#2d9e5f;margin:0 0 4px;font-size:20px">Campus<span style="color:#fff">Print</span></h2>
        <p style="color:#999;font-size:11px;margin:0;font-family:monospace">New print job received</p>
      </div>
      <div style="background:#e8f5ee;border:1px dashed #1a6b3c;border-radius:8px;padding:16px;text-align:center;margin-bottom:16px">
        <p style="font-size:11px;color:#1a6b3c;margin:0;text-transform:uppercase;letter-spacing:0.1em">Job Number</p>
        <p style="font-size:28px;font-weight:800;color:#1a6b3c;margin:4px 0;letter-spacing:2px;font-family:monospace">${e.jobNum}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
        <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-family:monospace;font-size:11px">KIOSK</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${e.location}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-family:monospace;font-size:11px">STUDENT ID</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${e.studentId}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-family:monospace;font-size:11px">FILE</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${e.fileName}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-family:monospace;font-size:11px">COPIES</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${e.copies} copies · ${e.paper} · ${e.sides}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-family:monospace;font-size:11px">PAYMENT</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${e.payment} — ${e.amount}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-family:monospace;font-size:11px">COLLECT BY</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${e.collectBy}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b6b6b;font-family:monospace;font-size:11px">CONTACT</td><td style="padding:8px 12px;font-weight:600;text-align:right">${e.email} · ${e.phone}</td></tr>
      </table>
      <p style="margin-top:16px;font-size:11px;color:#aaa;font-family:monospace">CampusPrint · Campus kiosk printing</p>
    </div>`;

  const customerBody = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <div style="background:#0e0e0e;border-radius:12px;padding:20px;margin-bottom:16px">
        <h2 style="color:#2d9e5f;margin:0 0 4px;font-size:20px">Campus<span style="color:#fff">Print</span></h2>
        <p style="color:#999;font-size:11px;margin:0;font-family:monospace">Your print job is confirmed</p>
      </div>
      <div style="background:#e8f5ee;border:1px dashed #1a6b3c;border-radius:8px;padding:16px;text-align:center;margin-bottom:16px">
        <p style="font-size:11px;color:#1a6b3c;margin:0;text-transform:uppercase;letter-spacing:0.1em">Job Number</p>
        <p style="font-size:28px;font-weight:800;color:#1a6b3c;margin:4px 0;letter-spacing:2px;font-family:monospace">${e.jobNum}</p>
        <p style="font-size:12px;color:#6b6b6b;margin:0">Show this at the kiosk to collect your prints</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
        <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-size:11px">Kiosk</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${e.location}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-size:11px">File</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${e.fileName}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-size:11px">Copies</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${e.copies} × ${e.paper} · ${e.sides}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-size:11px">Amount Paid</td><td style="padding:8px 12px;font-weight:700;text-align:right;border-bottom:1px solid #ddd9cf;color:#1a6b3c">${e.amount}</td></tr>
        <tr><td style="padding:8px 12px;color:#6b6b6b;font-size:11px">Collect By</td><td style="padding:8px 12px;font-weight:600;text-align:right">${e.collectBy}</td></tr>
      </table>
      <p style="margin-top:16px;font-size:13px;color:#6b6b6b">Collect your prints within <strong>2 hours</strong>. If you have any issues contact us immediately.</p>
      <p style="margin-top:16px;font-size:11px;color:#aaa;font-family:monospace">CampusPrint · Campus kiosk printing</p>
    </div>`;

  try {
    const sendOne = (to, subject, html) => fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
    });

    const operatorRes = await sendOne(OPERATOR_EMAIL, operatorSubject, operatorBody);
    if (!operatorRes.ok) {
      console.error('resend operator send failed:', operatorRes.status, await operatorRes.text());
      return res.status(502).json({ error: 'email_send_failed' });
    }

    if (data.email && looksLikeEmail(data.email)) {
      const customerRes = await sendOne(data.email, customerSubject, customerBody);
      if (!customerRes.ok) {
        console.warn('resend customer send failed (non-fatal):',
                     customerRes.status, await customerRes.text());
      }
    }

    const result = await operatorRes.json();
    return res.status(200).json({ success: true, id: result.id });
  } catch (err) {
    console.error('email handler error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
};
