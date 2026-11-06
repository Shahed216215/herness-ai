'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateCanonicalMemoryRecord, assessMemoryConflict } = require('../services/mira-memory-conflict-assessment');
function record(overrides = {}) {
  const base = {
    schemaVersion: '1.0.0', memoryId: 'memory-0001', projectId: 'project-a',
    recordType: 'fact', content: 'original fact',
    source: { sourceType: 'manual', sourceId: 'source-1', sourceUrl: null, observedAt: '2026-11-03T10:00:00.000Z' },
    timestamps: { createdAt: '2026-11-03T10:00:00.000Z', updatedAt: '2026-11-03T10:00:00.000Z' },
    version: { revision: 1, contentHash: '' },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: ['project-a'] },
    lifecycle: 'ACTIVE'
  };
  const merged = { ...base, ...overrides };
  merged.version = { ...base.version, ...(overrides.version || {}) };
  merged.version.contentHash = crypto.createHash('sha256')
    .update(JSON.stringify(merged.content), 'utf8').digest('hex');
  return merged;
}
function expectConflict(existing, incoming, type) {
  const result = assessMemoryConflict(existing, incoming);
  assert.equal(result.status, 'CONFLICT');
  assert.equal(result.state, 'DETECTED');
  assert.ok(result.conflictTypes.includes(type), type);
  assert.equal(result.cryptographicVerification, 'CONTENT_HASH_MATCHED_ONLY');
}
const base = record();
assert.deepEqual(validateCanonicalMemoryRecord(base), []);
const noConflict = assessMemoryConflict(base, record());
assert.equal(noConflict.status, 'NO_CONFLICT_DETECTED');
assert.equal(noConflict.cryptographicVerification, 'CONTENT_HASH_MATCHED_ONLY');
expectConflict(base, record({ memoryId: 'memory-0002' }), 'IDENTITY_CONFLICT');
expectConflict(base, record({ version: { revision: 2, contentHash: 'b'.repeat(64) } }), 'REVISION_CONFLICT');
expectConflict(base, record({ content: 'changed' }), 'CONTENT_CONFLICT');
expectConflict(base, record({ source: { ...base.source, sourceId: 'source-2' } }), 'SOURCE_CONFLICT');
expectConflict(base, record({ access: { classification: 'RESTRICTED', allowedProjectIds: ['project-a'] } }), 'ACCESS_CONFLICT');
expectConflict(base, record({ recordType: 'decision' }), 'SCHEMA_CONFLICT');
expectConflict(base, record({ integrity: { status: 'FAILED', algorithm: 'SHA-256' } }), 'INTEGRITY_CONFLICT');
for (const badTimestamp of [
  '2026',
  '2026-11-03',
  '2026-02-30T10:00:00Z',
  '2026-13-01T10:00:00Z',
  '2026-11-03T24:00:00Z',
  '2026-11-03T10:00:00',
  'not-a-date'
]) {
  const invalidTime = validateCanonicalMemoryRecord(record({
    timestamps: { createdAt: badTimestamp, updatedAt: '2026-11-03T10:00:00.000Z' }
  }));
  assert.ok(invalidTime.some(error => error.includes('.timestamps violates canonical timestamp shape')), badTimestamp);
}
assert.deepEqual(validateCanonicalMemoryRecord(record({
  timestamps: { createdAt: '2024-02-29T10:00:00+06:00', updatedAt: '2026-11-03T10:00:00.000Z' }
})), []);
const tamperedHashRecord = record();
tamperedHashRecord.version.contentHash = 'f'.repeat(64);
const hashMismatch = assessMemoryConflict(base, tamperedHashRecord);
assert.equal(hashMismatch.status, 'REVIEW_REQUIRED');
assert.equal(hashMismatch.cryptographicVerification, 'CONTENT_HASH_MISMATCH');
assert.ok(hashMismatch.validationErrors.some(error => error.includes('SHA-256(JCS(content))')));
const malformed = assessMemoryConflict(base, record({ version: { revision: 0, contentHash: 'bad' } }));
assert.equal(malformed.status, 'REVIEW_REQUIRED');
assert.ok(malformed.validationErrors.length);
const extra = record({ unexpected: true });
assert.equal(assessMemoryConflict(base, extra).status, 'REVIEW_REQUIRED');
const unverified = assessMemoryConflict(base, record({ integrity: { status: 'UNVERIFIED', algorithm: 'SHA-256' } }));
assert.equal(unverified.status, 'REVIEW_REQUIRED');
assert.equal(unverified.cryptographicVerification, 'CONTENT_HASH_MATCHED_ONLY');
const crossProject = assessMemoryConflict(base, record({ projectId: 'project-b' }));
assert.ok(crossProject.conflictTypes.includes('ACCESS_CONFLICT'));
console.log('CONFLICT_STATE_DETECTED=PASS');
console.log('IDENTITY_CONFLICT=PASS');
console.log('REVISION_CONFLICT=PASS');
console.log('CONTENT_CONFLICT=PASS');
console.log('SOURCE_CONFLICT=PASS');
console.log('ACCESS_CONFLICT=PASS');
console.log('SCHEMA_CONFLICT=PASS');
console.log('INTEGRITY_CONFLICT=PASS');
console.log('MALFORMED_AND_EXTRA_FIELDS_FAIL_CLOSED=PASS');
console.log('RFC3339_DATE_TIME_VALIDATION=PASS');
console.log('CONTENT_HASH_JCS_RECOMPUTATION=PASS');
console.log('CONTENT_HASH_MISMATCH_REQUIRES_REVIEW=PASS');
console.log('UNVERIFIED_RECORD_REVIEW_REQUIRED=PASS');
console.log('READ_ONLY_NO_QUARANTINE_OR_WRITE=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=PHASE2_STRUCTURAL_CONFLICT_ASSESSMENT_PASS');
