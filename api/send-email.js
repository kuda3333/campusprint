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

const crypto = require('crypto');

const MAX_FIELD_LEN = 400;
const AUTH_VERIFY_TIMEOUT_MS = 4000;
const RESEND_TIMEOUT_MS = 8000;

/* ─── structured logger ─────────────────────────────────────────── */
function makeLogger(requestId) {
  return function log(level, event, ctx = {}) {
    const entry = JSON.stringify({ ts: new Date().toISOString(), level, event, requestId, ...ctx });
    if (level === 'error') console.error(entry);
    else if (level === 'warn') console.warn(entry);
    else console.log(entry);
  };
}

/* ─── Sentry (activates only when SENTRY_DSN is set) ────────────── */
async function captureException(err, ctx = {}) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const url = new URL(dsn);
    const key = url.username;
    const projectId = url.pathname.replace(/^\//, '');
    const endpoint = `${url.protocol}//${url.hostname}/api/${projectId}/store/`;
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}, sentry_client=campusprint-api/1.0`,
      },
      body: JSON.stringify({
        event_id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        level: 'error',
        platform: 'node',
        exception: { values: [{ type: err?.name || 'Error', value: err?.message || String(err) }] },
        extra: ctx,
        tags: { service: 'send-email', runtime: 'vercel-fluid' },
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* never let Sentry errors surface */ }
}

/* ─── rate limit + idempotency (in-memory; per warm instance) ───
 * Fluid Compute reuses instances across concurrent requests, so a Map
 * here gives real throttling for the common case. Cross-instance
 * limiting is a P1 hardening item (move to Upstash / Vercel KV). */
const RL_WINDOW_MS  = 60_000;
const RL_MAX_HITS   = 10;        // per identity, per minute
const IDEMP_TTL_MS  = 10 * 60_000;
const _rlMap   = new Map(); // key -> [timestamps]
const _idemMap = new Map(); // key -> { at, response }

function _purgeRl(arr, now) {
  while (arr.length && arr[0] < now - RL_WINDOW_MS) arr.shift();
}
function rateLimitHit(key) {
  const now = Date.now();
  const arr = _rlMap.get(key) || [];
  _purgeRl(arr, now);
  arr.push(now);
  _rlMap.set(key, arr);
  // opportunistic GC: cap map size
  if (_rlMap.size > 5000) {
    for (const k of _rlMap.keys()) { _rlMap.delete(k); if (_rlMap.size <= 2500) break; }
  }
  return arr.length > RL_MAX_HITS;
}
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
function idempotencyHit(key) {
  if (!key) return null;
  const now = Date.now();
  const entry = _idemMap.get(key);
  if (entry && now - entry.at < IDEMP_TTL_MS) return entry.response;
  // opportunistic GC
  if (_idemMap.size > 5000) {
    for (const [k, v] of _idemMap) if (now - v.at > IDEMP_TTL_MS) _idemMap.delete(k);
  }
  return null;
}
function idempotencyStore(key, response) {
  if (!key) return;
  _idemMap.set(key, { at: Date.now(), response });
}
function payloadFingerprint(type, data) {
  // Stable order-independent fingerprint for dedupe of top-up / bulk.
  const keys = Object.keys(data || {}).sort();
  const flat = keys.map(k => `${k}=${String(data[k]).slice(0, 80)}`).join('|');
  return `${type}:${flat}`;
}

/* ─── auth ──────────────────────────────────────────────────────── */
// Verifies a Supabase access token by calling /auth/v1/user. Returns the
// verified email on success, or null if the request is unauthenticated /
// the token is invalid / Supabase is unreachable. Never throws.
async function verifySupabaseToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnon = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    console.error('auth verify skipped: SUPABASE_URL / SUPABASE_ANON_KEY missing');
    return null;
  }

  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnon,
      },
      signal: AbortSignal.timeout(AUTH_VERIFY_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const user = await r.json();
    if (!user || typeof user.email !== 'string' || !looksLikeEmail(user.email)) return null;
    return { id: user.id, email: user.email };
  } catch (err) {
    console.warn('auth verify error:', err && err.message);
    return null;
  }
}

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
const _base = process.env.CANONICAL_ORIGIN || 'https://campusprint-pi.vercel.app';
const SHELL_OPEN = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#faf9f4">
  <img src="${_base}/assets/img/email-banner.png" alt="CampusPrint" width="560" style="display:block;width:100%;border-radius:10px;margin-bottom:16px">`;
const SHELL_CLOSE = `<p style="margin-top:20px;font-size:11px;color:#aaa;font-family:monospace;text-align:center">CampusPrint · Pre-alpha</p></div>`;
const ROW = (label, value) =>
  `<tr><td style="padding:9px 12px;color:#6b6b6b;border-bottom:1px solid #e6e5dc;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">${label}</td><td style="padding:9px 12px;font-weight:600;text-align:right;border-bottom:1px solid #e6e5dc">${value}</td></tr>`;

function bodyPrintJob(e) {
  return SHELL_OPEN +
    `<p style="color:#0e4a26;font-size:11px;margin:0 0 16px;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em">New print job received</p>
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
    `<p style="color:#0e4a26;font-size:11px;margin:0 0 16px;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em">Your print job is confirmed</p>
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
    `<p style="color:#0e4a26;font-size:11px;margin:0 0 16px;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em">Print-credit top-up requested</p>
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
    `<p style="color:#0e4a26;font-size:11px;margin:0 0 16px;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em">Bulk handout request (lecturer)</p>
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
async function handler(req, res) {
  const requestId = crypto.randomBytes(4).toString('hex').toUpperCase();
  const log = makeLogger(requestId);
  res.setHeader('X-Request-Id', requestId);

  // CORS — env allowlist, fail closed
  const rawAllow = process.env.ALLOWED_ORIGINS || '';
  const allowList = rawAllow.split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin, allowList)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'method_not_allowed' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM    = process.env.RESEND_FROM;
  const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL;
  if (!RESEND_API_KEY || !RESEND_FROM || !OPERATOR_EMAIL) {
    log('error', 'config_missing', { missing: [!RESEND_API_KEY&&'RESEND_API_KEY', !RESEND_FROM&&'RESEND_FROM', !OPERATOR_EMAIL&&'OPERATOR_EMAIL'].filter(Boolean) });
    return res.status(500).json({ error: 'service_unavailable' });
  }
  if (RESEND_FROM.includes('onboarding@resend.dev')) {
    log('error', 'sandbox_sender_rejected');
    return res.status(500).json({ error: 'service_misconfigured' });
  }

  // Optional auth: when a valid Supabase JWT is supplied, we trust the
  // verified email; otherwise we still accept the submission (operator
  // email only) but we never send a customer-confirmation to an
  // unverified address. This eliminates the spoof / email-bomb surface
  // where an attacker could forge "your job is confirmed" emails from
  // our verified Resend domain to arbitrary victims.
  const verified = await verifySupabaseToken(req);

  // Rate limit BEFORE any expensive work. Bucket by verified email if we
  // have one (cheap to roll IPs), otherwise by IP.
  const rlKey = verified ? `u:${verified.email}` : `ip:${clientIp(req)}`;
  if (rateLimitHit(rlKey)) {
    log('warn', 'rate_limited', { rlKey, authenticated: !!verified });
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limited' });
  }

  const { type, data } = req.body || {};

  /* Per-type validation + email body assembly */
  let operatorSubject, operatorBody, customerSubject, customerBody, customerEmail;

  if (type === 'print_job') {
    const err = validatePrintJob(data);
    if (err) { log('warn', 'validation_failed', { type, err }); return res.status(400).json({ error: 'invalid_payload' }); }
    const e = escapeAll(data, ['jobNum','location','studentId','fileName','copies','paper','sides','email','phone','collectBy']);
    operatorSubject = `New Print Job ${e.jobNum} — ${e.location}${verified ? ' ✓' : ''}`;
    operatorBody    = bodyPrintJob(e);
    customerSubject = `Your CampusPrint Job is Confirmed — ${e.jobNum}`;
    customerBody    = bodyPrintJobCustomer(e);
    customerEmail   = verified ? verified.email : null;

  } else if (type === 'topup_request') {
    const err = validateTopUp(data);
    if (err) { log('warn', 'validation_failed', { type, err }); return res.status(400).json({ error: 'invalid_payload' }); }
    const e = escapeAll(data, ['amount','studentId','email','reason']);
    operatorSubject = `Top-up Request — ${e.amount} pages — ${e.studentId}${verified ? ' ✓' : ''}`;
    operatorBody    = bodyTopUp(e);
    customerSubject = `CampusPrint: Top-up request received`;
    customerBody    = SHELL_OPEN +
      `<p style="color:#0e4a26;font-size:11px;margin:0 0 16px;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em">We've received your top-up request</p>
      <p style="font-size:14px;color:#1d211b;line-height:1.55">Hi there — your request for <strong>${e.amount} additional pages</strong> has been sent to your institution's bursary office. You'll receive a confirmation within 24 hours.</p>` + SHELL_CLOSE;
    customerEmail   = verified ? verified.email : null;

  } else if (type === 'bulk_request') {
    const err = validateBulk(data);
    if (err) { log('warn', 'validation_failed', { type, err }); return res.status(400).json({ error: 'invalid_payload' }); }
    const e = escapeAll(data, ['lecturerId','courseCode','copies','finishing','deliver','email']);
    operatorSubject = `Bulk Handout — ${e.courseCode} — ${e.copies} copies${verified ? ' ✓' : ''}`;
    operatorBody    = bodyBulk(e);
    customerSubject = `CampusPrint: Bulk handout request received`;
    customerBody    = SHELL_OPEN +
      `<p style="color:#0e4a26;font-size:11px;margin:0 0 16px;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em">We've received your bulk handout request</p>
      <p style="font-size:14px;color:#1d211b;line-height:1.55">Thanks — your request for <strong>${e.copies} copies</strong> of <strong>${e.courseCode}</strong> with <strong>${e.finishing}</strong>, delivered to <strong>${e.deliver}</strong>, is queued. Operations will confirm by email before the deadline.</p>` + SHELL_CLOSE;
    customerEmail   = verified ? verified.email : null;

  } else {
    return res.status(400).json({ error: 'unsupported_type' });
  }

  /* Idempotency: replay the prior response for a recent duplicate.
   * print_job dedupes on the client-generated jobNum (crypto-random,
   * collision-resistant). Other types dedupe on a payload fingerprint
   * scoped to the caller (verified email or IP). */
  const idemKey = type === 'print_job'
    ? `print_job:${data.jobNum}`
    : `${rlKey}:${payloadFingerprint(type, data)}`;
  const replay = idempotencyHit(idemKey);
  if (replay) return res.status(200).json(replay);

  /* Send */
  try {
    const sendOne = (to, subject, html) => fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });

    const operatorRes = await sendOne(OPERATOR_EMAIL, operatorSubject, operatorBody);
    if (!operatorRes.ok) {
      const body = await operatorRes.text();
      log('error', 'resend_operator_failed', { status: operatorRes.status, resendBody: body.slice(0, 200) });
      return res.status(502).json({ error: 'email_send_failed' });
    }

    if (customerEmail && customerEmail !== OPERATOR_EMAIL) {
      const customerRes = await sendOne(customerEmail, customerSubject, customerBody);
      if (!customerRes.ok) {
        log('warn', 'resend_customer_failed_nonfatal', { status: customerRes.status });
      }
    }

    const result = await operatorRes.json();
    log('info', 'email_sent', { type, resendId: result.id, authenticated: !!verified });
    const response = { success: true, id: result.id };
    idempotencyStore(idemKey, response);
    return res.status(200).json(response);
  } catch (err) {
    const isTimeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    log('error', isTimeout ? 'upstream_timeout' : 'unhandled_error', { message: err?.message });
    await captureException(err, { requestId, type });
    return res.status(isTimeout ? 504 : 500).json({ error: isTimeout ? 'upstream_timeout' : 'internal_error' });
  }
}

/* ─── exports ───────────────────────────────────────────────────────
 * The Vercel runtime invokes the default export (the handler). The pure
 * helpers are attached so the test suite (test/send-email.test.js) can
 * exercise them in isolation without booting the HTTP layer. */
module.exports = handler;
module.exports.escapeHtml = escapeHtml;
module.exports.looksLikeEmail = looksLikeEmail;
module.exports.isAllowedOrigin = isAllowedOrigin;
module.exports.clean = clean;
module.exports.escapeAll = escapeAll;
module.exports.payloadFingerprint = payloadFingerprint;
module.exports.validatePrintJob = validatePrintJob;
module.exports.validateTopUp = validateTopUp;
module.exports.validateBulk = validateBulk;
