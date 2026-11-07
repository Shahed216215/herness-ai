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
  memoryId: 'mem-learning-search-verified-001',
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
        records: [knowledge, verifiedLearning, { ...pendingLearning, lifecycle: 'ACTIVE' }],
        count: 3,
        standingAuthority: true,
        authorityConsumed: false,
        approvalRequiredPerRead: false,
        memoryWrites: false,
        localFallback: false,
        driveFallback: false,
        scanStartedAt: '2026-11-07T07:59:00.000Z',
        authorityExpiresAt: hostAuthorizationContext.expiresAt,
        standingAuthorityId: hostAuthorizationContext.authorityRef,
        authorityExpiresAt: hostAuthorizationContext.expiresAt,
        hostAuthorizationContext
      };
    }
  });

  assert.deepEqual(readRequest.recordTypes, ['knowledge_item', 'learning_note']);
  assert.equal(result.status, 'AUTHORIZED_AND_COMMITTED');
  assert.equal(result.count, 2);
  assert.equal(result.candidateScanCount, 3);
  assert.equal(result.candidateScanLimit, 2000);
  assert.equal(result.candidateScanMayBeIncomplete, false);
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

  const bengaliKnowledge = buildCanonicalMemoryRecord({
    projectId,
    memoryId: 'mem-knowledge-search-bengali-001',
    kind: 'memory_save',
    content: 'বাংলা ভাষায় অটোমেশন শেখার জন্য Python ব্যবহার করো।',
    userIntent: 'Remember this: বাংলা ভাষায় অটোমেশন শেখার জন্য Python ব্যবহার করো।',
    now: '2026-11-07T07:15:00.000Z'
  });
  const bengaliSearch = await searchHfmKnowledge({
    req: { session: { hfmPrincipal: { verified: true } } },
    pool: { connect: async () => ({}) },
    query: 'বাংলা অটোমেশন',
    limit: 5,
    now,
    env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' },
    readMemory: async () => ({
      status: 'AUTHORIZED_AND_COMMITTED',
      projectId,
      records: [bengaliKnowledge],
      count: 1,
      standingAuthority: true,
      authorityConsumed: false,
      approvalRequiredPerRead: false,
      memoryWrites: false,
      localFallback: false,
      driveFallback: false,
      scanStartedAt: '2026-11-07T07:59:00.000Z',
      authorityExpiresAt: hostAuthorizationContext.expiresAt,
      hostAuthorizationContext
    })
  });
  assert.equal(bengaliSearch.count, 1);
  assert.equal(bengaliSearch.results[0].id, bengaliKnowledge.memoryId);
  console.log('HFM_KNOWLEDGE_SEARCH_UNICODE_BENGALI_TOKENIZATION=PASS');

  const manyRecords = Array.from({ length: 100 }, (_, index) => ({
    ...knowledge,
    memoryId: 'mem-scan-bound-' + String(index).padStart(3, '0')
  }));
  const crossPageBestMatch = {
    ...verifiedLearning,
    memoryId: 'mem-000-cross-page'
  };
  const requestedCursors = [];
  const boundedScan = await searchHfmKnowledge({
    req: { session: { hfmPrincipal: { verified: true } } },
    pool: { connect: async () => ({}) },
    query: 'Python automation',
    limit: 1,
    cursor: 'opaque-page-cursor',
    now,
    env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' },
    readMemory: async options => {
      requestedCursors.push(options.cursor || null);
      const first = options.cursor === 'opaque-page-cursor';
      return {
        status: 'AUTHORIZED_AND_COMMITTED',
        projectId,
        records: first ? manyRecords : [crossPageBestMatch],
        count: first ? 100 : 1,
        nextCursor: first ? 'opaque-next-page' : null,
        standingAuthority: true,
        authorityConsumed: false,
        approvalRequiredPerRead: false,
        memoryWrites: false,
        localFallback: false,
        driveFallback: false,
        scanStartedAt: '2026-11-07T07:59:00.000Z',
        standingAuthorityId: hostAuthorizationContext.authorityRef,
        authorityExpiresAt: hostAuthorizationContext.expiresAt,
        hostAuthorizationContext: { ...hostAuthorizationContext, requestId: first ? 'hfm-search-page-001' : 'hfm-search-page-002' }
      };
    }
  });
  assert.deepEqual(requestedCursors, ['opaque-page-cursor', 'opaque-next-page']);
  assert.equal(boundedScan.candidateScanCount, 101);
  assert.equal(boundedScan.candidateScanLimit, 2000);
  assert.equal(boundedScan.scannedPages, 2);
  assert.equal(boundedScan.results[0].id, 'mem-000-cross-page');
  assert.equal(boundedScan.nextCursor, null);
  assert.equal(boundedScan.candidateScanMayBeIncomplete, false);
  console.log('HFM_KNOWLEDGE_SEARCH_DISCLOSES_FULL_PAGE_SCAN_LIMIT=PASS');

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
