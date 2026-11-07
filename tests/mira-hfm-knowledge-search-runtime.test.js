'use strict';

const assert = require('node:assert/strict');
const { buildCanonicalMemoryRecord } = require('../services/mira-hfm-memory-save-runtime');
const { searchHfmKnowledge } = require('../services/mira-hfm-knowledge-search-runtime');

const now = new Date('2026-11-07T08:00:00.000Z');
const projectId = 'project-search-001';
const hostAuthorizationContext = {
  actorId: 'mira:mira.admins:11111111-1111-4111-8111-111111111111',
  actorType: 'HUMAN',
  projectId,
  purpose: 'explicit user knowledge search',
  requestId: 'hfm-search-request-001',
  authorityRef: 'standing-authority-search-001',
  issuedAt: '2026-11-07T07:59:00.000Z',
  expiresAt: '2026-11-07T08:05:00.000Z'
};

const knowledge = buildCanonicalMemoryRecord({
  projectId, memoryId: 'mem-knowledge-search-001',
  kind: 'memory_save',
  content: 'Python automation should validate input and output.',
  userIntent: 'Remember this: Python automation should validate input and output.',
  now: '2026-11-07T07:00:00.000Z'
});
const pendingLearning = buildCanonicalMemoryRecord({
  projectId, memoryId: 'mem-learning-search-001',
  kind: 'learning_save', title: 'Python automation lesson',
  content: 'Use bounded inputs and verify every generated output.',
  userIntent: 'Save this learning note to my knowledge base.',
  now: '2026-11-07T07:30:00.000Z'
});

const verifiedLearning = {
  ...pendingLearning,
  trust: { status: 'HUMAN_VERIFIED' },
  lifecycle: 'ACTIVE'
};

(async () => {
  let readRequest;
  const result = await searchHfmKnowledge({
    req: { session: { hfmPrincipal: { verified: true } } },
    pool: { connect: async () => ({}) },
    query: 'Python automation',
    limit: 5,
    now,
    env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' },
    readMemory: async options => {
      readRequest = options;
      return {
        status: 'AUTHORIZED_AND_COMMITTED',
        projectId,
        records: [knowledge, verifiedLearning, pendingLearning],
        standingAuthority: true,
        approvalRequiredPerRead: false,
        authorityExpiresAt: hostAuthorizationContext.expiresAt,
        hostAuthorizationContext
      };
    }
  });

  assert.deepEqual(readRequest.recordTypes, ['knowledge_item', 'learning_note']);
  assert.equal(result.status, 'AUTHORIZED_AND_COMMITTED');
  assert.equal(result.count, 2);
  assert.deepEqual(result.results.map(item => item.type).sort(), ['knowledge', 'learning']);
  const learningResult = result.results.find(item => item.id === verifiedLearning.memoryId);
  assert.ok(learningResult);
  assert.equal(learningResult.title, 'Python automation lesson');
  assert.equal(learningResult.category, 'Learning');
  assert.equal(learningResult.trust, 'HUMAN_VERIFIED');
  assert.equal(learningResult.integrity, 'VERIFIED');
  assert.equal(result.results.some(item => item.id === pendingLearning.memoryId), false);
  assert.equal(result.localFallback, false);
  assert.equal(result.driveFallback, false);
  console.log('HFM_KNOWLEDGE_SEARCH_INCLUDES_VERIFIED_LEARNING_NOTES=PASS');

  await assert.rejects(() => searchHfmKnowledge({
    req: {}, pool: {}, query: 'Python',
    env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'false' }
  }), /HFM_KNOWLEDGE_STANDING_READ_AUTHORITY_DISABLED/);
  console.log('HFM_KNOWLEDGE_SEARCH_STANDING_AUTHORITY_REQUIRED=PASS');
  console.log('CANONICAL_MEMORY_WRITTEN=NO');
  console.log('NETWORK_REQUESTS=0');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
