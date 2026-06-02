// Tests for the pure helpers in api/send-email.js
// Run with: npm test  (uses the built-in node:test runner — zero deps)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  escapeHtml,
  looksLikeEmail,
  isAllowedOrigin,
  clean,
  escapeAll,
  payloadFingerprint,
  validatePrintJob,
  validateTopUp,
  validateBulk,
} = require('../api/send-email.js');

/* ─── escapeHtml (XSS / §4 §8) ─────────────────────────────────── */
test('escapeHtml neutralises every HTML-significant character', () => {
  assert.equal(
    escapeHtml(`<script>alert("x&y")'</script>`),
    '&lt;script&gt;alert(&quot;x&amp;y&quot;)&#39;&lt;/script&gt;'
  );
});

test('escapeHtml treats null/undefined as empty string', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml is idempotent on already-safe input', () => {
  assert.equal(escapeHtml('CP-ABC123'), 'CP-ABC123');
});

/* ─── looksLikeEmail ───────────────────────────────────────────── */
test('looksLikeEmail accepts a normal address', () => {
  assert.equal(looksLikeEmail('student@students.uz.ac.zw'), true);
});

test('looksLikeEmail rejects malformed / non-string / over-long values', () => {
  assert.equal(looksLikeEmail('nope'), false);
  assert.equal(looksLikeEmail('a@b'), false);
  assert.equal(looksLikeEmail('a b@c.d'), false);
  assert.equal(looksLikeEmail(12345), false);
  assert.equal(looksLikeEmail('a@'.padEnd(450, 'x') + '.com'), false);
});

/* ─── isAllowedOrigin (CORS / §5) ──────────────────────────────── */
test('isAllowedOrigin only matches an exact allowlist entry', () => {
  const allow = ['https://campusprint.vercel.app'];
  assert.equal(isAllowedOrigin('https://campusprint.vercel.app', allow), true);
  assert.equal(isAllowedOrigin('https://evil.example', allow), false);
  // Substring / prefix attacks must not pass.
  assert.equal(isAllowedOrigin('https://campusprint.vercel.app.evil.com', allow), false);
});

test('isAllowedOrigin fails closed on empty allowlist or missing origin', () => {
  assert.equal(isAllowedOrigin('https://campusprint.vercel.app', []), false);
  assert.equal(isAllowedOrigin(undefined, ['https://campusprint.vercel.app']), false);
});

/* ─── clean (field caps / §8) ──────────────────────────────────── */
test('clean caps strings at the field limit and stringifies numbers', () => {
  assert.equal(clean('x'.repeat(500)).length, 400);
  assert.equal(clean(42), '42');
  assert.equal(clean({}), '');
  assert.equal(clean(null), '');
});

/* ─── escapeAll ────────────────────────────────────────────────── */
test('escapeAll escapes every requested key and ignores others', () => {
  const out = escapeAll({ a: '<b>', c: 'safe' }, ['a']);
  assert.deepEqual(out, { a: '&lt;b&gt;' });
});

/* ─── validatePrintJob ─────────────────────────────────────────── */
const goodPrintJob = {
  jobNum: 'CP-ABC123', location: 'UZ — Main Library', studentId: 'R123456',
  email: 'student@students.uz.ac.zw', phone: '+263771234567',
  copies: 2, paper: 'A4', sides: 'Single', fileName: 'notes.pdf',
  collectBy: '14:00',
};

test('validatePrintJob accepts a well-formed payload', () => {
  assert.equal(validatePrintJob(goodPrintJob), null);
});

test('validatePrintJob rejects non-objects', () => {
  assert.equal(typeof validatePrintJob(null), 'string');
  assert.equal(typeof validatePrintJob('string'), 'string');
});

test('validatePrintJob reports the first missing required field', () => {
  const { jobNum, ...rest } = goodPrintJob;
  assert.match(validatePrintJob(rest), /missing field: jobNum/);
});

test('validatePrintJob rejects an over-long field', () => {
  assert.match(
    validatePrintJob({ ...goodPrintJob, studentId: 'x'.repeat(401) }),
    /field too long: studentId/
  );
});

test('validatePrintJob rejects a malformed email', () => {
  assert.equal(validatePrintJob({ ...goodPrintJob, email: 'not-an-email' }), 'invalid email');
});

test('validatePrintJob rejects object/array field types', () => {
  assert.match(validatePrintJob({ ...goodPrintJob, location: { a: 1 } }), /invalid type for: location/);
});

/* ─── validateTopUp ────────────────────────────────────────────── */
test('validateTopUp accepts a valid request and rejects bad email / missing field', () => {
  assert.equal(validateTopUp({ amount: '50', studentId: 'R1', email: 'a@b.ac.zw' }), null);
  assert.equal(validateTopUp({ amount: '50', studentId: 'R1', email: 'bad' }), 'invalid email');
  assert.match(validateTopUp({ amount: '50', studentId: 'R1' }), /missing field: email/);
});

/* ─── validateBulk (numeric bounds) ────────────────────────────── */
const goodBulk = {
  lecturerId: 'L1', courseCode: 'CS101', copies: 100, finishing: 'stapled',
  deliver: 'Dept office', email: 'lect@uz.ac.zw',
};

test('validateBulk enforces the 1..10000 copies bound', () => {
  assert.equal(validateBulk(goodBulk), null);
  // copies:0 is falsy, so it trips the required-field check first — still rejected.
  assert.match(validateBulk({ ...goodBulk, copies: 0 }), /missing field: copies/);
  assert.equal(validateBulk({ ...goodBulk, copies: 10001 }), 'invalid copies count');
  assert.equal(validateBulk({ ...goodBulk, copies: 'lots' }), 'invalid copies count');
});

/* ─── payloadFingerprint (idempotency dedupe) ──────────────────── */
test('payloadFingerprint is order-independent for the same data', () => {
  assert.equal(
    payloadFingerprint('topup_request', { amount: '50', studentId: 'R1' }),
    payloadFingerprint('topup_request', { studentId: 'R1', amount: '50' })
  );
});

test('payloadFingerprint differs across types and values', () => {
  assert.notEqual(
    payloadFingerprint('topup_request', { amount: '50' }),
    payloadFingerprint('bulk_request', { amount: '50' })
  );
  assert.notEqual(
    payloadFingerprint('topup_request', { amount: '50' }),
    payloadFingerprint('topup_request', { amount: '51' })
  );
});
