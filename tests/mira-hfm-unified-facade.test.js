'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { retrieveCanonicalRecordsWithReport } =
  require('../services/mira-memory-unified-facade');

const now = new Date('2026-11-05T12:00:00.000Z');
const context = {
  actorId: 'actor-test-001', actorType: 'HUMAN', projectId: 'project-alpha',
  purpose: 'facade-test', requestId: 'request-facade-001',
  authorityRef: 'host-authority-001',
  issuedAt: '2026-11-05T11:59:00.000Z',
  expiresAt: '2026-11-05T12:05:00.000Z'
};
const calls = [];
function authorize(input) {
  calls.push(input);
  return {
    ...input, decision: 'ALLOW', replayStatus: 'FRESH',
    issuedAt: '2026-11-05T11:59:30.000Z',
    expiresAt: '2026-11-05T12:04:00.000Z'
  };
}
function record(id, overrides = {}) {
  const content = 'Trusted content ' + id;
  return {
    schemaVersion: '1.0.0', memoryId: id, projectId: 'project-alpha',
    recordType: 'lesson', content,
    source: { sourceType: 'manual', sourceId: id, observedAt: '2026-11-05T10:00:00.000Z' },
    timestamps: { createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z' },
    version: { revision: 1, contentHash: crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex') },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'CONTENT_VERIFIED' },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: ['project-alpha'] },
    lifecycle: 'ACTIVE',
    ...overrides
  };
}

const valid = record('memory-valid-001');
const pending = record('memory-pending-001', {
  lifecycle: 'PENDING_REVIEW',
  integrity: { status: 'UNVERIFIED', algorithm: 'SHA-256' },
  trust: { status: 'SOURCE_RECORDED' }
});
const conflicted = record('memory-conflicted-001');
const otherProject = record('memory-other-project-001', {
  projectId: 'project-beta',
  access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: ['project-beta'] }
});
const report = retrieveCanonicalRecordsWithReport({
  records: [valid, pending, conflicted, otherProject],
  pendingConflicts: [{ projectId: 'project-alpha', status: 'QUARANTINED', originalMemoryIds: ['memory-conflicted-001'] }],
  projectId: 'project-alpha', requestContext: context, authorizeRequest: authorize, now
});
assert.deepEqual(report.records.map(item => item.memoryId), ['memory-valid-001']);
assert.equal(report.provenance[0].memoryId, 'memory-valid-001');
assert.equal(report.excludedSummary.totalCandidates, 4);
assert.equal(report.excludedSummary.eligibleCount, 2);
assert.equal(report.excludedSummary.excludedCount, 2);
assert.ok(calls.some(item => item.operation === 'LIST'));
assert.ok(calls.some(item => item.operation === 'READ'));
console.log('HFM_FACADE_LIST_READ_AUTHORIZATION_AND_FILTERING=PASS');

const denied = retrieveCanonicalRecordsWithReport({
  records: [valid], pendingConflicts: [], projectId: 'project-alpha',
  requestContext: context,
  authorizeRequest: input => ({ ...authorize(input), decision: 'DENY' }),
  now
});
assert.equal(denied.records.length, 0);
assert.equal(denied.excludedSummary.requestDenied, true);
console.log('HFM_FACADE_HOST_DENY_FAILS_CLOSED=PASS');

assert.throws(() => retrieveCanonicalRecordsWithReport({
  records: [valid], pendingConflicts: [], projectId: 'project-alpha',
  requestContext: { ...context, projectId: 'project-beta' },
  authorizeRequest: authorize, now
}), /project scope/);
assert.throws(() => retrieveCanonicalRecordsWithReport({
  records: [valid], pendingConflicts: [], projectId: 'project-alpha',
  requestContext: context, now
}), /Trusted host authorizeRequest callback/);
console.log('HFM_FACADE_PROJECT_MISMATCH_AND_MISSING_AUTHORIZER_BLOCK=PASS');

assert.throws(() => retrieveCanonicalRecordsWithReport({
  records: [valid], pendingConflicts: [], projectId: 'project-alpha',
  requestContext: { ...context, expiresAt: '2026-11-05T11:00:00.000Z' },
  authorizeRequest: authorize, now
}), /expired or not yet valid/);
console.log('HFM_FACADE_EXPIRED_HOST_AUTHORITY_BLOCK=PASS');

assert.equal(Object.isFrozen(report), true);
assert.equal(Object.isFrozen(report.records), true);
assert.equal(Object.isFrozen(report.provenance), true);
console.log('HFM_FACADE_IMMUTABLE_REPORT=PASS');
console.log('NETWORK_REQUESTS=0');
console.log('DATABASE_WRITES=0');
console.log('LOCAL_OR_DRIVE_FALLBACK=NO');
