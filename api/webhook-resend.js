// POST /api/webhook-resend — receives Resend delivery events via Svix
// Configure in Resend dashboard → Webhooks → add endpoint:
//   https://campusprint-pi.vercel.app/api/webhook-resend
//   Events: email.sent, email.delivered, email.bounced, email.complained
// Set RESEND_WEBHOOK_SECRET to the signing secret shown after saving.
'use strict';
const crypto = require('crypto');

const SVIX_TOLERANCE_S = 300; // reject timestamps older than 5 minutes

function verifySignature(rawBody, headers, secret) {
  const msgId = headers['svix-id'];
  const msgTs = headers['svix-timestamp'];
  const msgSig = headers['svix-signature'];
  if (!msgId || !msgTs || !msgSig) return false;

  const ts = parseInt(msgTs, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SVIX_TOLERANCE_S) return false;

  // Svix secret is base64-encoded after stripping the "whsec_" prefix
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signed = `${msgId}.${msgTs}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signed).digest('base64');

  // svix-signature may be space-separated list of "v1,<b64>" tokens
  return msgSig.split(' ').some(token => {
    const b64 = token.split(',')[1];
    if (!b64) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(b64), Buffer.from(expected));
    } catch { return false; }
  });
}

function log(level, event, ctx = {}) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, event, service: 'webhook-resend', ...ctx });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.log(entry);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    log('error', 'webhook_secret_missing');
    return res.status(500).end();
  }

  // Vercel parses req.body as JSON; we need the raw string for signature verification.
  // Re-serialise deterministically. Svix signs the exact bytes sent by Resend, which
  // is compact JSON — this works because Resend's payload has no ambiguous key order.
  const rawBody = JSON.stringify(req.body);

  if (!verifySignature(rawBody, req.headers, secret)) {
    log('warn', 'invalid_signature', { svixId: req.headers['svix-id'] });
    return res.status(401).json({ error: 'invalid_signature' });
  }

  const { type, data } = req.body || {};
  const ctx = { type, emailId: data?.email_id, to: data?.to?.[0] };

  switch (type) {
    case 'email.bounced':
      log('warn', 'email_bounced', ctx);
      break;
    case 'email.complained':
      log('warn', 'email_spam_complaint', ctx);
      break;
    case 'email.delivered':
      log('info', 'email_delivered', ctx);
      break;
    default:
      log('info', 'webhook_event', ctx);
  }

  return res.status(200).json({ received: true });
};
