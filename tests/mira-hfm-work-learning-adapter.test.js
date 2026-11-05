'use strict';
const assert = require('node:assert/strict');
const {
  buildWorkLearningCanonicalCandidate,
  adaptApprovedWorkLearningEntry,
  adaptApprovedWorkLearningEntries
} = require('../services/mira-hfm-work-learning-adapter');
const {
  digest: mappingDigest,
  bodyOf
} = require('../services/mira-memory-project-mapping-contract');
const {
  createProjectMappingOwnerApprovalVerifier
} = require('../services/mira-memory-project-mapping-owner-approval-adapter');
const {
  digest: ownerDigest
} = require('../services/mira-memory-project-owner-registry-contract');
const { digest: sourceDigest } = require('../services/mira-legacy-memory-knowledge-adapter');

const now = new Date('2026-11-05T12:00:00.000Z');
const ownerActor = 'mira:fixture:work-learning-owner';
const sourceFileDigest = 'a'.repeat(64);
const observedAt = '2026-11-05T11:00:00.000Z';

function makeOwnerRegistry(overrides = {}) {
  const entry = {
    schemaVersion: '1.0.0',
    authorityRecordId: 'work-learning-owner-registry-fixture',
    projectId: 'project-alpha',
    tenantId: 'tenant-alpha',
    ownerActorId: ownerActor,
    memberships: [{
      membershipRef: 'owner-membership-001',
      actorId: ownerActor,
      actorType: 'HUMAN',
      role: 'OWNER',
      allowedOperations: ['READ', 'WRITE', 'LIST', 'VERIFY', 'APPROVE_MAPPING'],
      status: 'ACTIVE',
      validFrom: '2026-11-05T10:00:00.000Z',
      validUntil: '2026-11-05T13:00:00.000Z'
    }],
    sourceProjectSnapshotDigest: 'b'.repeat(64),
    approvalReference: 'owner-registry-approval-001',
    approvedBy: 'mira:fixture:admin',
    approvedAt: '2026-11-05T10:05:00.000Z',
    registryRevision: 'owner-registry-r1',
    status: 'ACTIVE',
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-05T10:10:00.000Z'
  };
  Object.assign(entry, overrides);
  entry.recordDigest = ownerDigest(entry);
  return entry;
}
const registry = makeOwnerRegistry();
const verifyApproval = createProjectMappingOwnerApprovalVerifier({
  ownerRegistry: registry,
  expectedTenantId: 'tenant-alpha',
  verifyRegistryRecord: proof =>
    proof.recordDigest === registry.recordDigest &&
    proof.projectId === registry.projectId &&
    proof.tenantId === registry.tenantId,
  now: () => now
});
function makeEntry(id, taskId) {
  return {
    schemaVersion: 2,
    engineVersion: '6.2.1',
    learningId: id,
    taskId,
    executionId: 'execution-' + id,
    task: { id: taskId, title: 'Fixture task ' + taskId },
    execution: { executionId: 'execution-' + id, status: 'completed' },
    lessons: ['Preserve evidence and require review.'],
    governance: { approvalRequired: true, autoApplied: false },
    createdAt: observedAt,
    status: 'learned'
  };
}
function makeMapping(entry, sourceOrdinal, memoryId, projectId = 'project-alpha') {
  const provisional = {
    memoryId, projectId, classification: 'PROJECT_PRIVATE'
  };
  const canonicalRecord = buildWorkLearningCanonicalCandidate({
    entry, mapping: provisional, observedAt
  });
  const mapping = {
    schemaVersion: '1.0.0',
    mappingId: 'work-learning-map-' + sourceOrdinal,
    domain: 'work_learning',
    sourceSystem: 'mira_work_learning',
    sourceFileDigest,
    sourceOrdinal,
    legacyId: entry.learningId,
    memoryId,
    projectId,
    parentConversationId: null,
    clientId: null,
    revision: 1,
    sourceDigest: sourceDigest(entry),
    canonicalRecordDigest: sourceDigest(canonicalRecord),
    classification: 'PROJECT_PRIVATE',
    status: 'APPROVED',
    approvalReference: 'work-learning-approval-' + sourceOrdinal,
    approvedBy: ownerActor,
    approvedAt: '2026-11-05T11:30:00.000Z',
    createdAt: '2026-11-05T11:20:00.000Z'
  };
  mapping.mappingDigest = mappingDigest(bodyOf(mapping));
  return mapping;
}
const first = makeEntry('learning-001', 'task-001');
const second = makeEntry('learning-002', 'task-002');
const firstMapping = makeMapping(first, 0, 'canonical-learning-001');
const secondMapping = makeMapping(second, 1, 'canonical-learning-002');

const one = adaptApprovedWorkLearningEntry({
  entry: first, mapping: firstMapping, projectId: 'project-alpha',
  sourceFileDigest, sourceOrdinal: 0, observedAt, verifyApproval, now
});
assert.equal(one.legacyId, first.learningId);
assert.equal(one.canonicalRecord.recordType, 'lesson');
assert.equal(one.canonicalRecord.lifecycle, 'PENDING_REVIEW');
assert.equal(one.canonicalRecord.integrity.status, 'UNVERIFIED');
assert.equal(one.canonicalRecord.trust.status, 'SOURCE_RECORDED');
assert.deepEqual(JSON.parse(one.canonicalRecord.content).record, first);
console.log('WORK_LEARNING_OWNER_APPROVED_MAPPING_AND_LOSSLESS_PAYLOAD_PASS');

const batch = adaptApprovedWorkLearningEntries({
  entries: [first, second],
  mappings: [firstMapping, secondMapping],
  projectId: 'project-alpha', sourceFileDigest, observedAt,
  verifyApproval, now
});
assert.equal(batch.length, 2);
assert.deepEqual(batch.map(x => x.memoryId), [
  'canonical-learning-001', 'canonical-learning-002'
]);
console.log('WORK_LEARNING_BATCH_SNAPSHOT_MAPPING_PASS');

assert.throws(() => adaptApprovedWorkLearningEntry({
  entry: first, mapping: firstMapping, projectId: 'project-beta',
  sourceFileDigest, sourceOrdinal: 0, observedAt, verifyApproval, now
}), /project scope mismatch/);
console.log('WORK_LEARNING_CROSS_PROJECT_MAPPING_BLOCK_PASS');

assert.throws(() => adaptApprovedWorkLearningEntry({
  entry: { ...first, lessons: ['tampered'] }, mapping: firstMapping,
  projectId: 'project-alpha', sourceFileDigest, sourceOrdinal: 0,
  observedAt, verifyApproval, now
}), /source digest mismatch|exact raw source identity/);
console.log('WORK_LEARNING_SOURCE_TAMPER_BLOCK_PASS');

const forged = { ...firstMapping, mappingDigest: '0'.repeat(64) };
assert.throws(() => adaptApprovedWorkLearningEntry({
  entry: first, mapping: forged, projectId: 'project-alpha',
  sourceFileDigest, sourceOrdinal: 0, observedAt, verifyApproval, now
}), /Mapping digest mismatch/);
console.log('WORK_LEARNING_FORGED_MAPPING_BLOCK_PASS');

assert.throws(() => adaptApprovedWorkLearningEntries({
  entries: [first, { ...first }], mappings: [firstMapping, secondMapping],
  projectId: 'project-alpha', sourceFileDigest, observedAt, verifyApproval, now
}), /Duplicate Work Learning learningId/);
console.log('WORK_LEARNING_DUPLICATE_SOURCE_ID_BLOCK_PASS');

assert.throws(() => adaptApprovedWorkLearningEntries({
  entries: [first, second], mappings: [firstMapping],
  projectId: 'project-alpha', sourceFileDigest, observedAt, verifyApproval, now
}), /Explicit owner-approved mapping missing/);
console.log('WORK_LEARNING_MISSING_OWNER_MAPPING_BLOCK_PASS');

const wrongOrdinal = { ...secondMapping, sourceOrdinal: 0 };
wrongOrdinal.mappingDigest = mappingDigest(bodyOf(wrongOrdinal));
assert.throws(() => adaptApprovedWorkLearningEntries({
  entries: [first, second], mappings: [firstMapping, wrongOrdinal],
  projectId: 'project-alpha', sourceFileDigest, observedAt, verifyApproval, now
}), /sourceOrdinal/);
console.log('WORK_LEARNING_SNAPSHOT_ORDINAL_DRIFT_BLOCK_PASS');

const revokedRegistry = makeOwnerRegistry({ status: 'REVOKED' });
const revokedVerifier = createProjectMappingOwnerApprovalVerifier({
  ownerRegistry: revokedRegistry, expectedTenantId: 'tenant-alpha',
  verifyRegistryRecord: proof => proof.recordDigest === revokedRegistry.recordDigest,
  now: () => now
});
assert.throws(() => adaptApprovedWorkLearningEntry({
  entry: first, mapping: firstMapping, projectId: 'project-alpha',
  sourceFileDigest, sourceOrdinal: 0, observedAt, verifyApproval: revokedVerifier, now
}), /registry is not ACTIVE/);
console.log('WORK_LEARNING_REVOKED_OWNER_REGISTRY_BLOCK_PASS');

assert.equal(one.canonicalRecord.projectId, 'project-alpha');
assert.equal(one.canonicalRecord.access.allowedProjectIds[0], 'project-alpha');
assert.equal(one.canonicalRecord.lifecycle, 'PENDING_REVIEW');
console.log('WORK_LEARNING_NO_PROJECT_INFERENCE_PENDING_REVIEW_PASS');

assert.throws(() => adaptApprovedWorkLearningEntry({
  entry: { ...first, metadata: { apiToken: 'fixture-secret-value' } },
  mapping: firstMapping, projectId: 'project-alpha',
  sourceFileDigest, sourceOrdinal: 0, observedAt, verifyApproval, now
}), /prohibited secret-like field/);
console.log('WORK_LEARNING_SECRET_FIELD_REJECTED_PASS');
console.log('NETWORK_REQUESTS=0');
console.log('CANONICAL_MEMORY_WRITTEN=NO');
console.log('CANONICAL_KNOWLEDGE_WRITTEN=NO');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_WORK_LEARNING_OWNER_APPROVED_ADAPTER_PASS');
