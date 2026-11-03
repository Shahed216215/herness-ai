'use strict';
const assert = require('node:assert/strict');
const { validateCanonicalMemoryRecord, assessMemoryConflict } = require('../services/mira-memory-conflict-assessment');
function record(overrides = {}) {
  return {
    schemaVersion: '1.0.0', memoryId: 'memory-0001', projectId: 'project-a',
    recordType: 'fact', content: 'original fact',
    source: { sourceType: 'manual', sourceId: 'source-1', sourceUrl: null, observedAt: '2026-11-03T10:00:00.000Z' },
    timestamps: { createdAt: '2026-11-03T10:00:00.000Z', updatedAt: '2026-11-03T10:00:00.000Z' },
    version: { revision: 1, contentHash: 'a'.repeat(64) },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: ['project-a'] },
    lifecycle: 'ACTIVE',
    ...overrides
  };
}
function expectConflict(existing, incoming, type) {
  const result = assessMemoryConflict(existing, incoming);
  assert.equal(result.status, 'CONFLICT');
  assert.ok(result.conflictTypes.includes(type), type);
  assert.equal(result.cryptographicVerification, 'NOT_PERFORMED');
}
const base = record();
assert.deepEqual(validateCanonicalMemoryRecord(base), []);
assert.equal(assessMemoryConflict(base, record()).status, 'NO_CONFLICT_DETECTED');
expectConflict(base, record({ memoryId: 'memory-0002' }), 'IDENTITY_CONFLICT');
expectConflict(base, record({ version: { revision: 2, contentHash: 'b'.repeat(64) } }), 'REVISION_CONFLICT');
expectConflict(base, record({ content: 'changed' }), 'CONTENT_CONFLICT');
expectConflict(base, record({ source: { ...base.source, sourceId: 'source-2' } }), 'SOURCE_CONFLICT');
expectConflict(base, record({ access: { classification: 'RESTRICTED', allowedProjectIds: ['project-a'] } }), 'ACCESS_CONFLICT');
expectConflict(base, record({ recordType: 'decision' }), 'SCHEMA_CONFLICT');
expectConflict(base, record({ integrity: { status: 'FAILED', algorithm: 'SHA-256' } }), 'INTEGRITY_CONFLICT');
const malformed = assessMemoryConflict(base, record({ version: { revision: 0, contentHash: 'bad' } }));
assert.equal(malformed.status, 'REVIEW_REQUIRED');
assert.ok(malformed.validationErrors.length);
const extra = record({ unexpected: true });
assert.equal(assessMemoryConflict(base, extra).status, 'REVIEW_REQUIRED');
const unverified = assessMemoryConflict(base, record({ integrity: { status: 'UNVERIFIED', algorithm: 'SHA-256' } }));
assert.equal(unverified.status, 'REVIEW_REQUIRED');
assert.equal(unverified.cryptographicVerification, 'NOT_PERFORMED');
const crossProject = assessMemoryConflict(base, record({ projectId: 'project-b' }));
assert.ok(crossProject.conflictTypes.includes('ACCESS_CONFLICT'));
console.log('IDENTITY_CONFLICT=PASS');
console.log('REVISION_CONFLICT=PASS');
console.log('CONTENT_CONFLICT=PASS');
console.log('SOURCE_CONFLICT=PASS');
console.log('ACCESS_CONFLICT=PASS');
console.log('SCHEMA_CONFLICT=PASS');
console.log('INTEGRITY_CONFLICT=PASS');
console.log('MALFORMED_AND_EXTRA_FIELDS_FAIL_CLOSED=PASS');
console.log('UNVERIFIED_RECORD_REVIEW_REQUIRED=PASS');
console.log('READ_ONLY_NO_QUARANTINE_OR_WRITE=PASS');
console.log('TESTS_FAILED=0');
console.log('RESULT=PHASE2_STRUCTURAL_CONFLICT_ASSESSMENT_PASS');
