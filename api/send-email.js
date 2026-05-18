// Vercel Serverless Function — /api/send-email.js
// CommonJS · Node 24 runtime · Fluid Compute compatible
//
// Accepts three message types from the static front-end:
//   - print_job       : student submits a print
//   - topup_request   : student requests a print-credit top-up
//   - bulk_request    : lecturer requests a bulk handout job
//
// All types share the same hardening pass (HTML-escape every interpolated
// field; lock CORS to ALLOWED_ORIGINS; strict schema validation per type;
// generic error responses; refuse Resend's onboarding@resend.dev sender).

const MAX_FIELD_LEN = 400;

/* ─── helpers ───────────────────────────────────────────────────── */
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
  return typeof v === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) &&
    v.length <= MAX_FIELD_LEN;
}

function clean(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).slice(0, MAX_FIELD_LEN);
}

function escapeAll(data, keys) {
  return Object.fromEntries(keys.map(k => [k, escapeHtml(clean(data[k]))]));
}

/* ─── validators (one per type) ─────────────────────────────────── */
function validatePrintJob(data) {
  if (!data || typeof data !== 'object') return 'data must be an object';
  const required = ['jobNum', 'location', 'studentId', 'email', 'phone',
                    'copies', 'paper', 'sides', 'fileName', 'collectBy'];
  for (const k of required) {
    if (!(k in data)) return `missing field: ${k}`;
    if (typeof data[k] !== 'string' && typeof data[k] !== 'number') return `invalid type for: ${k}`;
    if (String(data[k]).length > MAX_FIELD_LEN) return `field too long: ${k}`;
  }
  if (data.email && !looksLikeEmail(data.email)) return 'invalid email';
  return null;
}

function validateTopUp(data) {
  if (!data || typeof data !== 'object') return 'data must be an object';
  const required = ['amount', 'studentId', 'email'];
  for (const k of required) {
    if (!data[k]) return `missing field: ${k}`;
    if (String(data[k]).length > MAX_FIELD_LEN) return `field too long: ${k}`;
  }
  if (!looksLikeEmail(data.email)) return 'invalid email';
  if (data.reason && String(data.reason).length > MAX_FIELD_LEN) return 'reason too long';
  return null;
}

function validateBulk(data) {
  if (!data || typeof data !== 'object') return 'data must be an object';
  const required = ['lecturerId', 'courseCode', 'copies', 'finishing', 'deliver', 'email'];
  for (const k of required) {
    if (!data[k]) return `missing field: ${k}`;
    if (String(data[k]).length > MAX_FIELD_LEN) return `field too long: ${k}`;
  }
  if (!looksLikeEmail(data.email)) return 'invalid email';
  const copies = Number(data.copies);
  if (!Number.isFinite(copies) || copies < 1 || copies > 10000) return 'invalid copies count';
  return null;
}

/* ─── email body templates ──────────────────────────────────────── */
const SHELL_OPEN = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:20px;background:#faf9f4">
  <div style="background:#0e120d;border-radius:12px;padding:20px;margin-bottom:16px">
    <h2 style="color:#2d9e5f;margin:0 0 4px;font-size:20px;font-family:sans-serif">Campus<span style="color:#fff">Print</span></h2>`;
const SHELL_CLOSE = `</div><p style="margin-top:16px;font-size:11px;color:#aaa;font-family:monospace">CampusPrint · Pre-alpha</p></div>`;
const ROW = (label, value) =>
  `<tr><td style="padding:9px 12px;color:#6b6b6b;border-bottom:1px solid #e6e5dc;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">${label}</td><td style="padding:9px 12px;font-weight:600;text-align:right;border-bottom:1px solid #e6e5dc">${value}</td></tr>`;

function bodyPrintJob(e) {
  return SHELL_OPEN +
    `<p style="color:#999;font-size:11px;margin:0;font-family:monospace">New print job received</p></div>
    <div style="background:#e9f3ec;border:1px dashed #1a6b3c;border-radius:8px;padding:16px;text-align:center;margin-bottom:16px">
      <p style="font-size:11px;color:#0e4a26;margin:0;text-transform:uppercase;letter-spacing:0.1em;font-family:monospace">Job Number</p>
      <p style="font-size:28px;font-weight:800;color:#0e4a26;margin:4px 0;letter-spacing:2px;font-family:monospace">${e.jobNum}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
      ${ROW('Location', e.location)}
      ${ROW('Student ID', e.studentId)}
      ${ROW('File', e.fileName)}
      ${ROW('Copies', `${e.copies} · ${e.paper} · ${e.sides}`)}
      ${ROW('Collect by', e.collectBy)}
      ${ROW('Contact', `${e.email} · ${e.phone}`)}
    </table>` + SHELL_CLOSE;
}

function bodyPrintJobCustomer(e) {
  return SHELL_OPEN +
    `<p style="color:#999;font-size:11px;margin:0;font-family:monospace">Your print job is confirmed</p></div>
    <div style="background:#e9f3ec;border:1px dashed #1a6b3c;border-radius:8px;padding:16px;text-align:center;margin-bottom:16px">
      <p style="font-size:11px;color:#0e4a26;margin:0;text-transform:uppercase;letter-spacing:0.1em;font-family:monospace">Job Number</p>
      <p style="font-size:28px;font-weight:800;color:#0e4a26;margin:4px 0;letter-spacing:2px;font-family:monospace">${e.jobNum}</p>
      <p style="font-size:12px;color:#6b6b6b;margin:0">Show this at the kiosk to collect your prints</p>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
      ${ROW('Kiosk', e.location)}
      ${ROW('File', e.fileName)}
      ${ROW('Copies', `${e.copies} × ${e.paper} · ${e.sides}`)}
      ${ROW('Collect by', e.collectBy)}
    </table>
    <p style="margin-top:16px;font-size:13px;color:#6b6b6b">Collect your prints within <strong>2 hours</strong>. If you have any issues contact us immediately.</p>` + SHELL_CLOSE;
}

function bodyTopUp(e) {
  return SHELL_OPEN +
    `<p style="color:#999;font-size:11px;margin:0;font-family:monospace">Print-credit top-up requested</p></div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
      ${ROW('Amount', `${e.amount} pages`)}
      ${ROW('Student ID', e.studentId)}
      ${ROW('Email', e.email)}
      ${e.reason ? ROW('Reason', e.reason) : ''}
    </table>
    <p style="margin-top:16px;font-size:13px;color:#6b6b6b">Forward to the bursary office for approval. Confirm by replying to the student within 24 hours.</p>` + SHELL_CLOSE;
}

function bodyBulk(e) {
  return SHELL_OPEN +
    `<p style="color:#999;font-size:11px;margin:0;font-family:monospace">Bulk handout request (lecturer)</p></div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
      ${ROW('Lecturer ID', e.lecturerId)}
      ${ROW('Course', e.courseCode)}
      ${ROW('Copies', e.copies)}
      ${ROW('Finishing', e.finishing)}
      ${ROW('Deliver to', e.deliver)}
      ${ROW('Email', e.email)}
    </table>
    <p style="margin-top:16px;font-size:13px;color:#6b6b6b">Confirm capacity + deadline with the lecturer at least 24 hours before delivery.</p>` + SHELL_CLOSE;
}

/* ─── handler ───────────────────────────────────────────────────── */
module.exports = async function handler(req, res) {
  // CORS — env allowlist, fail closed
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
  if (req.method !== 'POST')    return res.status(405).json({ error: 'method_not_allowed' });

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

  const { type, data } = req.body || {};

  /* Per-type validation + email body assembly */
  let operatorSubject, operatorBody, customerSubject, customerBody, customerEmail;

  if (type === 'print_job') {
    const err = validatePrintJob(data);
    if (err) { console.warn('print_job validation:', err); return res.status(400).json({ error: 'invalid_payload' }); }
    const e = escapeAll(data, ['jobNum','location','studentId','fileName','copies','paper','sides','email','phone','collectBy']);
    operatorSubject = `New Print Job ${e.jobNum} — ${e.location}`;
    operatorBody    = bodyPrintJob(e);
    customerSubject = `Your CampusPrint Job is Confirmed — ${e.jobNum}`;
    customerBody    = bodyPrintJobCustomer(e);
    customerEmail   = looksLikeEmail(data.email) ? data.email : null;

  } else if (type === 'topup_request') {
    const err = validateTopUp(data);
    if (err) { console.warn('topup_request validation:', err); return res.status(400).json({ error: 'invalid_payload' }); }
    const e = escapeAll(data, ['amount','studentId','email','reason']);
    operatorSubject = `Top-up Request — ${e.amount} pages — ${e.studentId}`;
    operatorBody    = bodyTopUp(e);
    customerSubject = `CampusPrint: Top-up request received`;
    customerBody    = SHELL_OPEN +
      `<p style="color:#999;font-size:11px;margin:0;font-family:monospace">We've received your top-up request</p></div>
      <p style="font-size:14px;color:#1d211b;line-height:1.55">Hi there — your request for <strong>${e.amount} additional pages</strong> has been sent to your institution's bursary office. You'll receive a confirmation within 24 hours.</p>` + SHELL_CLOSE;
    customerEmail   = data.email;

  } else if (type === 'bulk_request') {
    const err = validateBulk(data);
    if (err) { console.warn('bulk_request validation:', err); return res.status(400).json({ error: 'invalid_payload' }); }
    const e = escapeAll(data, ['lecturerId','courseCode','copies','finishing','deliver','email']);
    operatorSubject = `Bulk Handout — ${e.courseCode} — ${e.copies} copies`;
    operatorBody    = bodyBulk(e);
    customerSubject = `CampusPrint: Bulk handout request received`;
    customerBody    = SHELL_OPEN +
      `<p style="color:#999;font-size:11px;margin:0;font-family:monospace">We've received your bulk handout request</p></div>
      <p style="font-size:14px;color:#1d211b;line-height:1.55">Thanks — your request for <strong>${e.copies} copies</strong> of <strong>${e.courseCode}</strong> with <strong>${e.finishing}</strong>, delivered to <strong>${e.deliver}</strong>, is queued. Operations will confirm by email before the deadline.</p>` + SHELL_CLOSE;
    customerEmail   = data.email;

  } else {
    return res.status(400).json({ error: 'unsupported_type' });
  }

  /* Send */
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

    if (customerEmail && customerEmail !== OPERATOR_EMAIL) {
      const customerRes = await sendOne(customerEmail, customerSubject, customerBody);
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
