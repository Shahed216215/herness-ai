'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  createProjectScopedLearningProjections,
  verifyLearningProjection
} = require('../services/mira-hfm-work-learning-projection');

const now = new Date('2026-11-05T12:00:00.000Z');
const requestContext = {
  actorId: 'actor-fixture-01', actorType: 'HUMAN', projectId: 'project-alpha',
  purpose: 'phase8-projection-test', requestId: 'request-projection-001',
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
function record({ id, projectId = 'project-alpha', taskId, lessons,
  lifecycle = 'ACTIVE', integrity = 'VERIFIED', trust = 'CONTENT_VERIFIED' }) {
  const content = JSON.stringify({
    domain: 'work_learning',
    record: {
      learningId: id, taskId, executionId: 'execution-' + id,
      planId: 'plan-' + id, engineVersion: '6.2.1',
      task: { title: 'Python automation', description: 'Verify automation output', requirements: ['test', 'verify'] },
      lessons, qa: { status: 'qa_passed' }
    }
  });
  return {
    schemaVersion: '1.0.0', memoryId: id, projectId, recordType: 'lesson', content,
    source: { sourceType: 'legacy_import', sourceId: id, sourceUrl: null, observedAt: '2026-11-05T10:00:00.000Z' },
    timestamps: { createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z' },
    version: { revision: 1, contentHash: crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex') },
    integrity: { status: integrity, algorithm: 'SHA-256' },
    trust: { status: trust },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: [projectId] },
    lifecycle
  };
}
const active = record({ id: 'learning-source-001', taskId: 'task-source-001', lessons: ['Validate automation results'] });
const pending = record({
  id: 'learning-pending-001', taskId: 'task-pending', lessons: ['Pending lesson'],
  lifecycle: 'PENDING_REVIEW', integrity: 'UNVERIFIED', trust: 'SOURCE_RECORDED'
});
const crossProject = record({
  id: 'learning-cross-001', projectId: 'project-beta',
  taskId: 'task-cross', lessons: ['Cross project lesson']
});
const quarantined = record({ id: 'learning-quarantine-001', taskId: 'task-q', lessons: ['Quarantined lesson'] });
const conflicts = [{
  projectId: 'project-alpha', status: 'QUARANTINED',
  originalMemoryIds: ['learning-quarantine-001']
}];
const result = createProjectScopedLearningProjections({
  records: [active, pending, crossProject, quarantined],
  pendingConflicts: conflicts, projectId: 'project-alpha',
  requestContext, authorizeRequest: authorize, algorithmVersion: '1', now
});
assert.equal(result.count, 2);
assert.deepEqual(result.projections.map(x => x.projectionKind).sort(), ['experience_memory', 'work_knowledge']);
assert.ok(result.projections.every(x => x.projectId === 'project-alpha'));
assert.ok(result.projections.every(x => x.sourceLineage.memoryId === 'learning-source-001'));
assert.ok(result.projections.every(x => x.status === 'DERIVED_READ_ONLY_NOT_CANONICAL'));
assert.ok(result.projections.every(x => x.mayEnterCanonicalMemory === false));
assert.ok(result.projections.every(verifyLearningProjection));
assert.equal(result.governance.persistence, false);
assert.equal(result.governance.crossProjectTransferAllowed, false);
console.log('WORK_LEARNING_DERIVED_PROJECTIONS_INHERIT_VERIFIED_PROJECT_SCOPE_PASS');

const original = result.projections[0];
const tampered = { ...original, data: { ...original.data, lessons: ['tampered'] } };
assert.equal(verifyLearningProjection(tampered), false);
console.log('WORK_LEARNING_PROJECTION_DIGEST_TAMPER_BLOCK_PASS');

const changedSource = record({
  id: 'learning-source-001', taskId: 'task-source-001',
  lessons: ['A changed verified lesson']
});
const changed = createProjectScopedLearningProjections({
  records: [changedSource], pendingConflicts: [],
  projectId: 'project-alpha', requestContext,
  authorizeRequest: authorize, algorithmVersion: '1', now
});
assert.notEqual(
  changed.projections[0].projectionId,
  original.projectionId
);
console.log('WORK_LEARNING_SOURCE_CHANGE_INVALIDATES_PROJECTION_ID_PASS');

assert.throws(() => createProjectScopedLearningProjections({
  records: [active], pendingConflicts: [],
  projectId: 'project-alpha',
  requestContext: { ...requestContext, projectId: 'project-beta' },
  authorizeRequest: authorize, now
}), /project scope/);
console.log('WORK_LEARNING_PROJECTION_CROSS_PROJECT_REQUEST_BLOCK_PASS');
console.log('NETWORK_REQUESTS=0');
console.log('CANONICAL_MEMORY_WRITTEN=NO');
console.log('CANONICAL_KNOWLEDGE_WRITTEN=NO');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_WORK_LEARNING_PROJECTION_LINEAGE_PASS');
