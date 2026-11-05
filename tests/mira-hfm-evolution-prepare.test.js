'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prepareGovernedEvolution } = require('../services/mira-hfm-evolution-prepare');

const now = new Date('2026-11-05T12:00:00.000Z');
const requestContext = {
  actorId: 'actor-fixture-01', actorType: 'HUMAN', projectId: 'project-alpha',
  purpose: 'phase8-evolution-prepare-test', requestId: 'request-evolution-001',
  authorityRef: 'host-authority-fixture',
  issuedAt: '2026-11-05T11:59:00.000Z', expiresAt: '2026-11-05T12:05:00.000Z'
};
function authorize(input) {
  return {
    decision: 'ALLOW', replayStatus: 'FRESH',
    actorId: input.actorId, actorType: input.actorType,
    projectId: input.projectId, purpose: input.purpose,
    requestId: input.requestId, operation: input.operation,
    resourceScope: input.resourceScope, authorityRef: input.authorityRef,
    issuedAt: '2026-11-05T11:59:30.000Z', expiresAt: '2026-11-05T12:04:00.000Z'
  };
}
function makeSource(overrides = {}) {
  const raw = {
    domain: 'work_learning',
    record: {
      learningId: 'learning-evolution-001',
      taskId: 'task-evolution-001',
      lessons: ['Validate changes before release.']
    }
  };
  Object.assign(raw.record, overrides);
  const content = JSON.stringify(raw);
  return {
    schemaVersion: '1.0.0',
    memoryId: 'canonical-learning-evolution-001',
    projectId: 'project-alpha',
    recordType: 'lesson',
    content,
    source: {
      sourceType: 'legacy_import', sourceId: 'learning-evolution-001',
      sourceUrl: null, observedAt: '2026-11-05T10:00:00.000Z'
    },
    timestamps: {
      createdAt: '2026-11-05T10:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z'
    },
    version: {
      revision: 2,
      contentHash: crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex')
    },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'CONTENT_VERIFIED' },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: ['project-alpha'] },
    lifecycle: 'ACTIVE'
  };
}
const source = makeSource();
const recordDigest = crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex');
const recoveryPoint = {
  backupId: 'backup-fixture-001',
  backupDigest: 'a'.repeat(64)
};
function verifyRecoveryPoint(claim) {
  return {
    decision: 'VERIFIED',
    backupId: claim.backupId,
    backupDigest: claim.backupDigest,
    projectId: claim.projectId,
    sourceMemoryId: claim.sourceMemoryId,
    sourceRecordDigest: claim.sourceRecordDigest,
    sourceRevision: claim.sourceRevision,
    verifiedAt: '2026-11-05T11:59:30.000Z',
    expiresAt: '2026-11-05T12:04:00.000Z'
  };
}
const proposal = {
  proposalId: 'proposal-evolution-001',
  title: 'Improve learning validation',
  category: 'learning_rule',
  risk: 'medium',
  instruction: 'Prepare a reviewable improvement proposal.',
  requestedChanges: ['Add an additional regression check.'],
  idempotencyKey: 'evolution-idem-001'
};
const prepared = prepareGovernedEvolution({
  records: [source], pendingConflicts: [], projectId: 'project-alpha',
  requestContext, authorizeRequest: authorize,
  sourceMemoryId: source.memoryId, expectedSourceRevision: 2,
  expectedSourceDigest: recordDigest, proposal, recoveryPoint,
  verifyRecoveryPoint, now
});
assert.equal(prepared.status, 'PREPARED_NOT_COMMITTED');
assert.equal(prepared.governance.approvalRequired, true);
assert.equal(prepared.governance.autoApplied, false);
assert.equal(prepared.governance.executionAllowed, false);
assert.equal(prepared.governance.applyAllowed, false);
assert.equal(prepared.governance.persistentWrite, false);
assert.equal(prepared.sourceLineage.recordDigest, recordDigest);
assert.equal(prepared.recoveryEvidence.decision, 'VERIFIED');
assert.equal(prepared.idempotencyPlan.status, 'NOT_RESERVED_PREPARE_ONLY');
assert.equal(prepared.auditPlan.status, 'PLAN_ONLY_NOT_EMITTED');
assert.equal(Object.isFrozen(prepared), true);
assert.equal(Object.isFrozen(prepared.proposal.requestedChanges), true);
console.log('HFM_EVOLUTION_PREPARE_ONLY_APPROVAL_AND_RECOVERY_GATES_PASS');

assert.throws(() => prepareGovernedEvolution({
  records: [source], pendingConflicts: [], projectId: 'project-alpha',
  requestContext, authorizeRequest: authorize,
  sourceMemoryId: source.memoryId, expectedSourceRevision: 1,
  expectedSourceDigest: recordDigest, proposal, recoveryPoint,
  verifyRecoveryPoint, now
}), /source revision is stale/);
console.log('HFM_EVOLUTION_STALE_SOURCE_REVISION_BLOCK_PASS');

assert.throws(() => prepareGovernedEvolution({
  records: [source], pendingConflicts: [], projectId: 'project-alpha',
  requestContext, authorizeRequest: authorize,
  sourceMemoryId: source.memoryId, expectedSourceRevision: 2,
  expectedSourceDigest: '0'.repeat(64), proposal, recoveryPoint,
  verifyRecoveryPoint, now
}), /source digest does not match/);
console.log('HFM_EVOLUTION_SOURCE_DIGEST_MISMATCH_BLOCK_PASS');

assert.throws(() => prepareGovernedEvolution({
  records: [source], pendingConflicts: [], projectId: 'project-alpha',
  requestContext, authorizeRequest: authorize,
  sourceMemoryId: source.memoryId, expectedSourceRevision: 2,
  expectedSourceDigest: recordDigest, proposal, recoveryPoint,
  now
}), /trusted recovery-point verifier is required/);
console.log('HFM_EVOLUTION_UNVERIFIED_RECOVERY_POINT_BLOCK_PASS');

assert.throws(() => prepareGovernedEvolution({
  records: [source], pendingConflicts: [], projectId: 'project-alpha',
  requestContext, authorizeRequest: authorize,
  sourceMemoryId: source.memoryId, expectedSourceRevision: 2,
  expectedSourceDigest: recordDigest, proposal, recoveryPoint,
  verifyRecoveryPoint: claim => ({
    ...verifyRecoveryPoint(claim),
    expiresAt: '2026-11-05T11:59:00.000Z'
  }), now
}), /future-dated or expired/);
console.log('HFM_EVOLUTION_EXPIRED_RECOVERY_EVIDENCE_BLOCK_PASS');

assert.throws(() => prepareGovernedEvolution({
  records: [source], pendingConflicts: [], projectId: 'project-alpha',
  requestContext: { ...requestContext, projectId: 'project-beta' },
  authorizeRequest: authorize,
  sourceMemoryId: source.memoryId, expectedSourceRevision: 2,
  expectedSourceDigest: recordDigest, proposal, recoveryPoint,
  verifyRecoveryPoint, now
}), /project scope/);
console.log('HFM_EVOLUTION_CROSS_PROJECT_AUTHORITY_BLOCK_PASS');

assert.throws(() => prepareGovernedEvolution({
  records: [source], pendingConflicts: [], projectId: 'project-alpha',
  requestContext, authorizeRequest: authorize,
  sourceMemoryId: source.memoryId, expectedSourceRevision: 2,
  expectedSourceDigest: recordDigest, proposal: { ...proposal, idempotencyKey: '' },
  recoveryPoint, verifyRecoveryPoint, now
}), /idempotencyKey/);
console.log('HFM_EVOLUTION_IDEMPOTENCY_REQUIRED_PASS');

console.log('NETWORK_REQUESTS=0');
console.log('CANONICAL_MEMORY_WRITTEN=NO');
console.log('CANONICAL_KNOWLEDGE_WRITTEN=NO');
console.log('EVOLUTION_APPLIED=NO');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_EVOLUTION_PREPARE_ONLY_PASS');
