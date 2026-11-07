'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SOURCE_REFERENCE_VERSION,
  SOURCE_REFERENCE_POLICY,
  canonicalizeSourceReferenceUrl,
  validateSourceReferencePayload,
  buildUserSuppliedSourceReferencePayload
} = require('../services/mira-hfm-source-reference-schema');

function validPayload(overrides = {}) {
  return {
    referenceVersion: SOURCE_REFERENCE_VERSION,
    sourceType: 'web',
    canonicalUrl: 'https://example.com/article',
    sourceId: 'src-' + 'a'.repeat(64),
    retrievedAt: '2026-11-07T12:00:00.000Z',
    accessResult: 'NOT_FETCHED',
    retrievalMethod: 'user_supplied_url',
    provenanceActor: 'mira:mira.admins:admin-001',
    provenanceEventId: 'evt-' + 'b'.repeat(64),
    policyVersion: SOURCE_REFERENCE_POLICY,
    ...overrides
  };
}

test('source reference URL canonicalization strips query and fragment and preserves HTTPS path', () => {
  assert.equal(
    canonicalizeSourceReferenceUrl('HTTPS://Example.COM/article?access_token=secret#private'),
    'https://example.com/article'
  );
  assert.throws(() => canonicalizeSourceReferenceUrl('http://example.com/article'), /HFM_SOURCE_REFERENCE_URL_NOT_ALLOWED/);
  assert.throws(() => canonicalizeSourceReferenceUrl('https://user:pass@example.com/article'), /HFM_SOURCE_REFERENCE_URL_NOT_ALLOWED/);
  assert.throws(() => canonicalizeSourceReferenceUrl('https://localhost/private'), /HFM_SOURCE_REFERENCE_URL_NOT_ALLOWED/);
  assert.throws(() => canonicalizeSourceReferenceUrl('https://192.168.1.10/private'), /HFM_SOURCE_REFERENCE_URL_NOT_ALLOWED/);
});

test('source reference payload requires explicit not-fetched semantics and server provenance', () => {
  assert.deepEqual(validateSourceReferencePayload(validPayload()), { valid: true, errors: [] });
  const mismatch = validateSourceReferencePayload(validPayload({ accessResult: 'AVAILABLE' }));
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.errors.includes('payload.user_supplied_url_must_not_claim_fetch_result'));
  const badActor = validateSourceReferencePayload(validPayload({ provenanceActor: 'admin-001' }));
  assert.equal(badActor.valid, false);
  assert.ok(badActor.errors.includes('payload.provenanceActor.invalid'));
  const badEvent = validateSourceReferencePayload(validPayload({ provenanceEventId: 'event-1' }));
  assert.equal(badEvent.valid, false);
  assert.ok(badEvent.errors.includes('payload.provenanceEventId.invalid'));
});

test('source reference rejects unknown fields, invalid enums, unsafe URLs, and credential-bearing notes', () => {
  assert.equal(validateSourceReferencePayload(validPayload({ unexpected: true })).valid, false);
  assert.equal(validateSourceReferencePayload(validPayload({ sourceType: 'private_scrape' })).valid, false);
  assert.equal(validateSourceReferencePayload(validPayload({ canonicalUrl: 'http://example.com' })).valid, false);
  assert.equal(validateSourceReferencePayload(validPayload({ notes: 'Bearer abcdefghijklmnopqrstuvwxyz' })).valid, false);
  assert.equal(validateSourceReferencePayload(validPayload({ contentHash: 'not-a-hash' })).valid, false);
});

test('user-supplied source payload is NOT_FETCHED, deterministic, and secret-free', () => {
  const options = {
    url: 'https://example.com/article?token=secret#fragment',
    sourceType: 'web',
    provenanceActor: 'mira:mira.admins:admin-001',
    provenanceEventId: 'evt-' + 'c'.repeat(64),
    retrievedAt: '2026-11-07T12:00:00.000Z'
  };
  const first = buildUserSuppliedSourceReferencePayload(options);
  const second = buildUserSuppliedSourceReferencePayload(options);
  assert.deepEqual(first, second);
  assert.equal(first.accessResult, 'NOT_FETCHED');
  assert.equal(first.retrievalMethod, 'user_supplied_url');
  assert.equal(first.canonicalUrl, 'https://example.com/article');
  assert.equal(first.canonicalUrl.includes('secret'), false);
  assert.match(first.sourceId, /^src-[a-f0-9]{64}$/);
  assert.equal(validateSourceReferencePayload(first).valid, true);
});
