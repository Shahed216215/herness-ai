'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SCHEMA_V1,
  SCHEMA_V1_1,
  validateCanonicalRecord,
  createContentHash
} = require('../services/mira-hfm-record-schema');

function record(overrides = {}) {
  const content = 'Synthetic non-sensitive test content';
  return {
    schemaVersion: SCHEMA_V1,
    memoryId: 'memory-record-001',
    projectId: 'project-001',
    recordType: 'knowledge',
    content,
    source: {
      sourceType: 'manual',
      sourceId: 'synthetic-fixture',
      sourceUrl: null,
      observedAt: '2026-11-06T00:00:00Z'
    },
    timestamps: {
      createdAt: '2026-11-06T00:00:00Z',
      updatedAt: '2026-11-06T00:00:00Z'
    },
    version: {
      revision: 1,
      contentHash: createContentHash(content)
    },
    integrity: { status: 'UNVERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: [] },
    lifecycle: 'PENDING_REVIEW',
    ...overrides
  };
}

test('v1.0.0 legacy record remains valid without changing its record type', () => {
  const result = validateCanonicalRecord(record());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});


test('v1.0.0 preserves optional sourceUrl compatibility', () => {
  const candidate = record({
    source: {
      sourceType: 'manual',
      sourceId: 'synthetic-fixture',
      observedAt: '2026-11-06T00:00:00Z'
    }
  });
  assert.equal(validateCanonicalRecord(candidate).valid, true);
});

test('v1.0.0 rejects new v1.1.0 record types rather than silently coercing them', () => {
  const candidate = record({ recordType: 'daily_activity' });
  assert.equal(validateCanonicalRecord(candidate).valid, false);
});

test('v1.1.0 accepts daily activity, learning, knowledge, and social draft record families', () => {
  for (const recordType of ['daily_activity', 'learning_note', 'knowledge_item', 'social_post_draft']) {
    const candidate = record({
      schemaVersion: SCHEMA_V1_1,
      recordType,
      access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: [] }
    });
    assert.equal(validateCanonicalRecord(candidate).valid, true, recordType);
  }
});


test('daily activity and learning notes cannot be stored as PUBLIC records', () => {
  for (const recordType of ['daily_activity', 'learning_note']) {
    const candidate = record({
      schemaVersion: SCHEMA_V1_1,
      recordType,
      access: { classification: 'PUBLIC', allowedProjectIds: [] }
    });
    assert.ok(
      validateCanonicalRecord(candidate).errors.includes('record.private_activity_learning_draft.must_be_PROJECT_PRIVATE')
    );
  }
});

test('v1.1.0 client and financial records require RESTRICTED classification and JSON payloads', () => {
  for (const recordType of ['client_vault_record', 'financial_vault_record']) {
    const content = JSON.stringify({ synthetic: true, value: 'not-real-client-data' });
    const candidate = record({
      schemaVersion: SCHEMA_V1_1,
      recordType,
      content,
      version: { revision: 1, contentHash: createContentHash(content) },
      access: { classification: 'RESTRICTED', allowedProjectIds: [] }
    });
    assert.equal(validateCanonicalRecord(candidate).valid, true, recordType);
    const publicCopy = {
      ...candidate,
      access: { classification: 'PUBLIC', allowedProjectIds: [] }
    };
    assert.equal(validateCanonicalRecord(publicCopy).valid, false);
  }
});

test('social post drafts must remain project-private until manual user publication', () => {
  const candidate = record({
    schemaVersion: SCHEMA_V1_1,
    recordType: 'social_post_draft',
    access: { classification: 'PUBLIC', allowedProjectIds: [] }
  });
  assert.equal(validateCanonicalRecord(candidate).valid, false);
});

test('unknown fields, invalid trust states, and invalid revision are rejected', () => {
  const candidate = record({
    unexpected: 'not-allowed',
    trust: { status: 'TRUSTED_BY_MAGIC' },
    version: { revision: 0, contentHash: 'f'.repeat(64) }
  });
  const result = validateCanonicalRecord(candidate);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('unknown_property')));
  assert.ok(result.errors.includes('record.trust.status.invalid'));
  assert.ok(result.errors.includes('record.version.revision.invalid'));
});

test('timestamps must be RFC3339 and monotonic', () => {
  const invalid = record({
    timestamps: {
      createdAt: 'not-a-date',
      updatedAt: '2026-11-05T00:00:00Z'
    }
  });
  assert.equal(validateCanonicalRecord(invalid).valid, false);
  const reversed = record({
    timestamps: {
      createdAt: '2026-11-06T00:00:00Z',
      updatedAt: '2026-11-05T00:00:00Z'
    }
  });
  assert.ok(validateCanonicalRecord(reversed).errors.includes('record.timestamps.order_invalid'));
});

test('allowed project IDs must be unique bounded strings', () => {
  const invalid = record({
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: ['project-2', 'project-2'] }
  });
  assert.ok(validateCanonicalRecord(invalid).errors.includes('record.access.allowedProjectIds.invalid'));
});


test('content hash follows RFC 8785 JCS string serialization and detects mismatches', () => {
  assert.equal(
    createContentHash('sample'),
    'efaa9d1b2193174ba24d21a8594b9f7a3fac82944b6327067cc1003b6d101e0b'
  );
  const candidate = record({
    version: { revision: 1, contentHash: 'f'.repeat(64) }
  });
  assert.ok(validateCanonicalRecord(candidate).errors.includes('record.version.contentHash.mismatch'));
  assert.throws(
    () => createContentHash('bad' + String.fromCharCode(0xD800)),
    /HFM_CONTENT_UNICODE_INVALID/
  );
});

test('invalid calendar dates are rejected even when Date.parse normalizes them', () => {
  const candidate = record({
    timestamps: {
      createdAt: '2026-02-30T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z'
    }
  });
  assert.equal(validateCanonicalRecord(candidate).valid, false);
});

test('content hash is deterministic SHA-256 hex', () => {
  const a = createContentHash('sample');
  const b = createContentHash('sample');
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});
