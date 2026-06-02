// Tests for the Svix signature verification in api/webhook-resend.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { verifySignature } = require('../api/webhook-resend.js');

// A secret in the same shape Resend issues: "whsec_" + base64 bytes.
const SECRET = 'whsec_' + Buffer.from('campusprint-test-signing-key').toString('base64');

function sign(rawBody, { id = 'msg_123', ts = Math.floor(Date.now() / 1000) } = {}) {
  const secretBytes = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const signed = `${id}.${ts}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signed).digest('base64');
  return {
    'svix-id': id,
    'svix-timestamp': String(ts),
    'svix-signature': `v1,${sig}`,
  };
}

const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e1' } });

test('verifySignature accepts a correctly signed, fresh payload', () => {
  assert.equal(verifySignature(body, sign(body), SECRET), true);
});

test('verifySignature accepts a space-separated multi-signature header', () => {
  const headers = sign(body);
  headers['svix-signature'] = `v1,deadbeef ${headers['svix-signature']}`;
  assert.equal(verifySignature(body, headers, SECRET), true);
});

test('verifySignature rejects a tampered body', () => {
  const headers = sign(body);
  assert.equal(verifySignature(body + 'x', headers, SECRET), false);
});

test('verifySignature rejects a wrong secret', () => {
  const otherSecret = 'whsec_' + Buffer.from('different-key').toString('base64');
  assert.equal(verifySignature(body, sign(body), otherSecret), false);
});

test('verifySignature rejects a stale timestamp (> 5 min)', () => {
  const old = Math.floor(Date.now() / 1000) - 600;
  assert.equal(verifySignature(body, sign(body, { ts: old }), SECRET), false);
});

test('verifySignature rejects missing headers', () => {
  assert.equal(verifySignature(body, {}, SECRET), false);
  assert.equal(verifySignature(body, { 'svix-id': 'x' }, SECRET), false);
});

test('verifySignature rejects a non-numeric timestamp', () => {
  const headers = sign(body);
  headers['svix-timestamp'] = 'not-a-number';
  assert.equal(verifySignature(body, headers, SECRET), false);
});
