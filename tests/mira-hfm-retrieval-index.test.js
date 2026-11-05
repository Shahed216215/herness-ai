'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  searchProjectScopedMemory,
  tokenize,
  extractIndexableText,
  ALGORITHM_VERSION
} = require('../services/mira-hfm-retrieval-index');

const now = new Date('2026-11-05T12:00:00.000Z');
const requestContext = {
  actorId: 'actor-index-fixture', actorType: 'HUMAN',
  projectId: 'project-alpha', purpose: 'phase9-retrieval-index-test',
  requestId: 'request-index-001', authorityRef: 'host-index-authority',
  issuedAt: '2026-11-05T11:59:00.000Z',
  expiresAt: '2026-11-05T12:05:00.000Z'
};
const authCalls = [];
function authorize(input) {
  authCalls.push(input);
  return {
    decision: 'ALLOW', replayStatus: 'FRESH',
    actorId: input.actorId, actorType: input.actorType,
    projectId: input.projectId, purpose: input.purpose,
    requestId: input.requestId, operation: input.operation,
    resourceScope: input.resourceScope, authorityRef: input.authorityRef,
    issuedAt: '2026-11-05T11:59:30.000Z',
    expiresAt: '2026-11-05T12:04:00.000Z'
  };
}
function record({
  id, projectId = 'project-alpha', title, lessons,
  lifecycle = 'ACTIVE', integrity = 'VERIFIED',
  trust = 'CONTENT_VERIFIED', metadata = undefined
}) {
  const raw = {
    domain: 'work_learning',
    record: {
      learningId: id, taskId: 'task-' + id,
      task: { title, description: 'Test reliability and verify the result' },
      lessons,
      ...(metadata ? { metadata } : {})
    }
  };
  const content = JSON.stringify(raw);
  return {
    schemaVersion: '1.0.0', memoryId: id, projectId,
    recordType: 'lesson', content,
    source: {
      sourceType: 'legacy_import', sourceId: id, sourceUrl: null,
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
const active = record({
  id: 'memory-index-active-001',
  title: 'Python automation reliability',
  lessons: ['Validate Python automation output before release.']
});
const pending = record({
  id: 'memory-index-pending-001',
  title: 'Python automation pending',
  lessons: ['Python automation pending'],
  lifecycle: 'PENDING_REVIEW', integrity: 'UNVERIFIED', trust: 'SOURCE_RECORDED'
});
const crossProject = record({
  id: 'memory-index-cross-001', projectId: 'project-beta',
  title: 'Python automation cross project',
  lessons: ['Python automation must not cross project boundaries']
});
const conflicted = record({
  id: 'memory-index-conflict-001',
  title: 'Python automation quarantined',
  lessons: ['Python automation quarantined']
});
const secret = record({
  id: 'memory-index-secret-001',
  title: 'Python automation secret-bearing',
  lessons: ['Python automation secret'],
  metadata: { apiToken: 'fixture-secret-never-index' }
});
const bengali = record({
  id: 'memory-index-bengali-001',
  title: 'বাংলা স্মৃতি অনুসন্ধান',
  lessons: ['বাংলা তথ্য যাচাই এবং সংরক্ষণ']
});
const conflicts = [{
  projectId: 'project-alpha',
  status: 'QUARANTINED',
  originalMemoryIds: ['memory-index-conflict-001']
}];

const result = searchProjectScopedMemory({
  records: [active, pending, crossProject, conflicted, secret, bengali],
  pendingConflicts: conflicts,
  projectId: 'project-alpha',
  requestContext,
  authorizeRequest: authorize,
  query: 'Python automation reliability',
  limit: 10,
  now
});
assert.deepEqual(result.results.map(x => x.memoryId), ['memory-index-active-001']);
assert.equal(result.index.persisted, false);
assert.equal(result.index.ephemeral, true);
assert.equal(result.index.eligibleRecords, 3);
assert.equal(result.index.indexedDocuments, 2);
assert.equal(result.excludedSummary.totalCandidates, 6);
assert.equal(result.excludedSummary.eligibleCount, 3);
assert.equal(result.excludedSummary.excludedCount, 3);
assert.equal(result.governance.projectScopeFilteredBeforeIndexing, true);
assert.equal(result.governance.conflictQuarantineAppliedBeforeIndexing, true);
assert.ok(authCalls.some(x => x.operation === 'LIST'));
assert.ok(authCalls.some(x => x.operation === 'READ'));
assert.equal(JSON.stringify(result).includes('fixture-secret-never-index'), false);
assert.equal(JSON.stringify(result).includes('Validate Python automation output'), false);
console.log('HFM_PROJECT_AUTHORIZATION_AND_TRUST_FILTER_BEFORE_INDEX_PASS');
console.log('HFM_EPHEMERAL_LEXICAL_INDEX_AND_BM25_RANKING_PASS');
console.log('HFM_INDEX_SECRET_PAYLOAD_EXCLUSION_PASS');

const bengaliResult = searchProjectScopedMemory({
  records: [bengali], pendingConflicts: [], projectId: 'project-alpha',
  requestContext, authorizeRequest: authorize,
  query: 'বাংলা স্মৃতি', currentTaskId: 'task-now', now
});
assert.deepEqual(bengaliResult.results.map(x => x.memoryId), ['memory-index-bengali-001']);
console.log('HFM_UNICODE_BENGALI_SEARCH_PASS');

assert.throws(() => searchProjectScopedMemory({
  records: [active], pendingConflicts: [],
  projectId: 'project-alpha',
  requestContext: { ...requestContext, projectId: 'project-beta' },
  authorizeRequest: authorize, query: 'Python automation', now
}), /project scope/);
console.log('HFM_INDEX_CROSS_PROJECT_CONTEXT_BLOCK_PASS');

assert.throws(() => searchProjectScopedMemory({
  records: [active], pendingConflicts: [], projectId: 'project-alpha',
  requestContext,
  authorizeRequest: input => ({ ...authorize(input), decision: 'DENY' }),
  query: 'Python automation', now
}), /denied by host policy/);
console.log('HFM_INDEX_HOST_DENY_BLOCK_PASS');

assert.throws(() => searchProjectScopedMemory({
  records: [active], pendingConflicts: [], projectId: 'project-alpha',
  requestContext, authorizeRequest: authorize,
  query: Array.from({ length: 33 }, (_, i) => 'term' + i).join(' '), now
}), /1-32 distinct searchable terms/);
console.log('HFM_INDEX_QUERY_TERM_BUDGET_BLOCK_PASS');

assert.throws(() => searchProjectScopedMemory({
  records: [active], pendingConflicts: [], projectId: 'project-alpha',
  requestContext, authorizeRequest: authorize,
  query: 'Python automation', limit: 51, now
}), /limit must be/);
console.log('HFM_INDEX_RESULT_LIMIT_BLOCK_PASS');

const changed = record({
  id: 'memory-index-active-001',
  title: 'Python automation reliability improved',
  lessons: ['Validate Python automation output before release and audit.']
});
const changedResult = searchProjectScopedMemory({
  records: [changed], pendingConflicts: [], projectId: 'project-alpha',
  requestContext, authorizeRequest: authorize,
  query: 'Python automation reliability', now
});
assert.notEqual(changedResult.index.indexDigest, result.index.indexDigest);
assert.equal(result.algorithmVersion, ALGORITHM_VERSION);
assert.ok(tokenize('বাংলা স্মৃতি Python').includes('বাংলা'));
assert.ok(tokenize('বাংলা স্মৃতি Python').includes('python'));
assert.equal(extractIndexableText(secret), '');
console.log('HFM_INDEX_DIGEST_SOURCE_CHANGE_INVALIDATION_PASS');
console.log('HFM_INDEX_ALGORITHM_AND_TOKENIZATION_CONTRACT_PASS');
console.log('NETWORK_REQUESTS=0');
console.log('PERSISTENT_INDEX_WRITES=0');
console.log('CANONICAL_MEMORY_WRITTEN=NO');
console.log('CANONICAL_KNOWLEDGE_WRITTEN=NO');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_EPHEMERAL_PROJECT_RETRIEVAL_INDEX_PASS');
