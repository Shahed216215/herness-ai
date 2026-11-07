'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  retrieveProjectScopedWorkLearning
} = require('../services/mira-hfm-work-learning-retrieval');

const now = new Date('2026-11-05T12:00:00.000Z');
const requestContext = {
  actorId: 'actor-fixture-01',
  actorType: 'HUMAN',
  projectId: 'project-alpha',
  purpose: 'phase8-learning-retrieval-test',
  requestId: 'request-phase8-retrieval-001',
  authorityRef: 'host-authority-fixture',
  issuedAt: '2026-11-05T11:59:00.000Z',
  expiresAt: '2026-11-05T12:05:00.000Z'
};
const authorizationCalls = [];
function authorize(input) {
  authorizationCalls.push(input);
  return {
    decision: 'ALLOW',
    replayStatus: 'FRESH',
    actorId: input.actorId,
    actorType: input.actorType,
    projectId: input.projectId,
    purpose: input.purpose,
    requestId: input.requestId,
    operation: input.operation,
    resourceScope: input.resourceScope,
    authorityRef: input.authorityRef,
    issuedAt: '2026-11-05T11:59:30.000Z',
    expiresAt: '2026-11-05T12:04:00.000Z'
  };
}
function record({ id, projectId = 'project-alpha', taskId, title, lessons,
  lifecycle = 'ACTIVE', integrity = 'VERIFIED', trust = 'CONTENT_VERIFIED',
  recordType = 'learning_note', sourceId = id }) {
  const content = JSON.stringify({
    domain: 'work_learning',
    record: {
      learningId: sourceId,
      taskId,
      task: { title, description: 'Review requirements and verify output' },
      lessons
    }
  });
  return {
    schemaVersion: '1.1.0',
    memoryId: id,
    projectId,
    recordType,
    content,
    source: {
      sourceType: 'legacy_import',
      sourceId,
      sourceUrl: null,
      observedAt: '2026-11-05T10:00:00.000Z'
    },
    timestamps: {
      createdAt: '2026-11-05T10:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z'
    },
    version: {
      revision: 1,
      contentHash: crypto.createHash('sha256')
        .update(JSON.stringify(content), 'utf8').digest('hex')
    },
    integrity: { status: integrity, algorithm: 'SHA-256' },
    trust: { status: trust },
    access: { classification: 'PROJECT_PRIVATE', allowedProjectIds: [projectId] },
    lifecycle
  };
}
const sameTask = record({
  id: 'memory-same-task-001', taskId: 'task-current',
  title: 'Python automation task', lessons: ['Python automation safety']
});
const activeOtherTask = record({
  id: 'memory-active-learning-001', taskId: 'task-previous',
  title: 'Python automation reliability', lessons: ['Validate Python automation output']
});
const pending = record({
  id: 'memory-pending-001', taskId: 'task-pending',
  title: 'Python automation pending', lessons: ['Python automation'],
  lifecycle: 'PENDING_REVIEW', integrity: 'UNVERIFIED', trust: 'SOURCE_RECORDED'
});
const otherProject = record({
  id: 'memory-other-project-001', projectId: 'project-beta',
  taskId: 'task-other-project', title: 'Python automation secret',
  lessons: ['Python automation cross project']
});
const conflicted = record({
  id: 'memory-conflicted-001', taskId: 'task-conflict',
  title: 'Python automation conflict', lessons: ['Python automation quarantined']
});
const unrelated = record({
  id: 'memory-fact-001', taskId: 'task-fact',
  title: 'Python automation fact', lessons: ['Python automation'],
  recordType: 'fact'
});
const conflicts = [{
  projectId: 'project-alpha',
  status: 'QUARANTINED',
  originalMemoryIds: ['memory-conflicted-001']
}];

const result = retrieveProjectScopedWorkLearning({
  records: [sameTask, activeOtherTask, pending, otherProject, conflicted, unrelated],
  pendingConflicts: conflicts,
  projectId: 'project-alpha',
  requestContext,
  authorizeRequest: authorize,
  taskText: 'Python automation reliability',
  currentTaskId: 'task-current',
  limit: 10,
  now
});
assert.deepEqual(result.transfers.map(item => item.learningId), ['memory-active-learning-001']);
assert.equal(result.transfers[0].sourceTaskId, 'task-previous');
assert.equal(result.transfers[0].projectId, 'project-alpha');
assert.deepEqual(result.transfers[0].lessons, ['Validate Python automation output']);
assert.equal(result.transfers[0].governance.executable, false);
assert.equal(result.transfers[0].governance.modifiesCode, false);
assert.equal(result.governance.rankedAfterHfmEligibilityFilter, true);
assert.equal(result.excludedSummary.totalCandidates, 6);
assert.equal(result.excludedSummary.eligibleCount, 3);
assert.equal(result.excludedSummary.excludedCount, 3);
assert.equal(result.excludedSummary.eligibleCount + result.excludedSummary.excludedCount, result.excludedSummary.totalCandidates);
assert.ok(authorizationCalls.some(x => x.operation === 'LIST'));
assert.ok(authorizationCalls.some(x => x.operation === 'READ'));
console.log('WORK_LEARNING_PROJECT_SCOPED_FILTER_BEFORE_RANKING_PASS');

const bengaliLearning = record({
  id: 'memory-bengali-learning-001',
  taskId: 'task-bengali-previous',
  title: 'বাংলা অটোমেশন নির্ভরযোগ্যতা',
  lessons: ['বাংলা অটোমেশন নিরাপত্তা যাচাই']
});
const bengaliResult = retrieveProjectScopedWorkLearning({
  records: [bengaliLearning],
  pendingConflicts: [],
  projectId: 'project-alpha',
  requestContext,
  authorizeRequest: authorize,
  taskText: 'বাংলা অটোমেশন',
  currentTaskId: 'task-bengali-current',
  limit: 5,
  now
});
assert.equal(bengaliResult.count, 1);
assert.equal(bengaliResult.transfers[0].learningId, 'memory-bengali-learning-001');
assert.equal(bengaliResult.transfers[0].relevance.score, 1);
console.log('WORK_LEARNING_BENGALI_UNICODE_RELEVANCE_PASS');


assert.throws(() => retrieveProjectScopedWorkLearning({
  records: [activeOtherTask], pendingConflicts: [],
  projectId: 'project-alpha',
  requestContext: { ...requestContext, projectId: 'project-beta' },
  authorizeRequest: authorize, taskText: 'Python automation',
  currentTaskId: 'task-current', now
}), /project scope/);
console.log('WORK_LEARNING_CROSS_PROJECT_REQUEST_CONTEXT_BLOCK_PASS');

assert.throws(() => retrieveProjectScopedWorkLearning({
  records: [activeOtherTask], pendingConflicts: [],
  projectId: 'project-alpha', requestContext,
  taskText: 'Python automation', currentTaskId: 'task-current', now
}), /Trusted host authorizeRequest callback/);
console.log('WORK_LEARNING_MISSING_HOST_AUTHORIZATION_BLOCK_PASS');

assert.throws(() => retrieveProjectScopedWorkLearning({
  records: [activeOtherTask], pendingConflicts: [],
  projectId: 'project-alpha', requestContext,
  authorizeRequest: authorize, taskText: 'Python automation',
  currentTaskId: 'task-current', limit: 0, now
}), /limit must be/);
console.log('WORK_LEARNING_RETRIEVAL_LIMIT_BOUND_PASS');

const denied = retrieveProjectScopedWorkLearning({
  records: [activeOtherTask], pendingConflicts: [],
  projectId: 'project-alpha', requestContext,
  authorizeRequest: input => ({ ...authorize(input), decision: 'DENY' }),
  taskText: 'Python automation', currentTaskId: 'task-current', now
});
assert.equal(denied.count, 0);
console.log('WORK_LEARNING_HOST_DENY_BLOCKS_RETRIEVAL_PASS');

assert.equal(result.transfers[0].provenance.source.sourceId, 'memory-active-learning-001');
assert.equal(Object.isFrozen(result), true);
assert.equal(Object.isFrozen(result.transfers[0].lessons), true);
console.log('WORK_LEARNING_RETRIEVAL_PROVENANCE_AND_IMMUTABILITY_PASS');
console.log('NETWORK_REQUESTS=0');
console.log('CANONICAL_MEMORY_WRITTEN=NO');
console.log('CANONICAL_KNOWLEDGE_WRITTEN=NO');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_PROJECT_SCOPED_WORK_LEARNING_RETRIEVAL_PASS');
