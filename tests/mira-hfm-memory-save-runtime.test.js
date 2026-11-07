'use strict';

const assert = require('node:assert/strict');
const {
  hasExplicitSaveIntent,
  isUserAuthoredMemoryContent,
  deriveIdempotencyKey,
  normalizeSourceUrl,
  buildCanonicalMemoryRecord,
  saveHfmMemoryRecord
} = require('../services/mira-hfm-memory-save-runtime');
const { validateCanonicalRecord } = require('../services/mira-hfm-record-schema');
const { extractKnowledgeTitle } = require('../services/mira-hfm-knowledge-search-runtime');
const { hasExplicitReviewIntent, safeReviewSourceUrl, listPendingHfmKnowledgeForReview } = require('../services/mira-hfm-knowledge-review-runtime');

function baseOptions(overrides = {}) {
  return {
    kind: 'memory_save',
    content: 'The user prefers concise Bengali explanations.',
    userIntent: 'Please remember this: the user prefers concise Bengali explanations.',
    taskId: 'task-001',
    toolCallId: 'call-001',
    toolName: 'memory_save',
    req: {
      session: {
        authenticated: true,
        role: 'admin',
        hfmPrincipal: { subject: 'admin-001' },
        hfmProjectBinding: { verified: true, projectId: 'project-001' }
      }
    },
    writerPool: { connect: async () => ({}) },
    issuerPool: { connect: async () => ({}) },
    env: {
      MIRA_HFM_MEMORY_WRITE_ENABLED: 'true',
      MIRA_HFM_AUTHORITY_ISSUER_ENABLED: 'true'
    },
    issueAuthority: async input => ({
      status: 'AUTHORITY_ISSUED',
      projectId: 'project-001',
      operation: 'memory.write',
      resource: input.resource,
      grant: { authorityId: 'authority-001', purpose: input.purpose, requestId: 'request-001' }
    }),
    executeAuthority: async input => ({
      status: 'AUTHORIZED_AND_COMMITTED',
      value: await input.perform({}, {
        projectId: 'project-001',
        actorId: 'mira:admin-001',
        operation: 'memory.write',
        resource: input.request.resource
      })
    }),
    createRecord: async input => ({
      status: 'CREATED',
      memoryId: input.record.memoryId,
      revision: input.record.version.revision
    }),
    ...overrides
  };
}

(async () => {
  assert.equal(hasExplicitSaveIntent('Remember this: keep my learning plan.'), true);
  assert.equal(hasExplicitSaveIntent('এটা মনে রাখবে: আমার শেখার পরিকল্পনা।'), true);
  assert.equal(hasExplicitSaveIntent('Please save this to your memory.'), true);
  assert.equal(hasExplicitSaveIntent('Store this in my memory.'), true);
  assert.equal(hasExplicitSaveIntent('Add this to Mira memory.'), true);
  assert.equal(hasExplicitSaveIntent('Do not remember this.'), false);
  assert.equal(hasExplicitSaveIntent("Don't forget to remember this."), true);
  assert.equal(hasExplicitSaveIntent("I don't think you should remember this."), false);
  assert.equal(hasExplicitSaveIntent('এটা মনে রাখবে না।'), false);
  assert.equal(hasExplicitSaveIntent('Explain how memory works.'), false);
  assert.equal(isUserAuthoredMemoryContent(
    'Remember this: I prefer concise Bengali explanations.',
    'I prefer concise Bengali explanations.'
  ), true);
  assert.equal(isUserAuthoredMemoryContent(
    'Remember this: I prefer concise Bengali explanations.',
    'The user prefers concise Bengali explanations and likes examples.'
  ), false);

  const firstKey = deriveIdempotencyKey('task-001', 'call-001', 'memory_save');
  assert.equal(firstKey, deriveIdempotencyKey('task-001', 'call-001', 'memory_save'));
  assert.notEqual(firstKey, deriveIdempotencyKey('task-001', 'call-002', 'memory_save'));
  assert.match(firstKey, /^hfm-[a-f0-9]{64}$/);

  assert.equal(normalizeSourceUrl('https://example.com/article?utm_source=test#section'),
    'https://example.com/article');
  assert.throws(() => normalizeSourceUrl('http://example.com/article'), /HFM_KNOWLEDGE_SOURCE_URL_NOT_ALLOWED/);
  assert.throws(() => normalizeSourceUrl('https://user:pass@example.com/article'), /HFM_KNOWLEDGE_SOURCE_URL_NOT_ALLOWED/);

  assert.equal(extractKnowledgeTitle({
    content: 'My saved preference\n\nMore detail',
    source: { sourceId: 'user-confirmed-memory' }
  }), 'My saved preference');
  assert.equal(extractKnowledgeTitle({
    content: JSON.stringify({ title: 'Legacy JSON title', body: 'legacy body' }),
    source: { sourceId: 'legacy-source-id' }
  }), 'Legacy JSON title');
  assert.equal(extractKnowledgeTitle({
    content: '   ',
    source: { sourceId: 'fallback-source-id' }
  }), 'fallback-source-id');

  assert.equal(hasExplicitReviewIntent('Show pending knowledge sources for review.'), true);
  assert.equal(hasExplicitReviewIntent('Do not show pending knowledge.'), false);
  assert.equal(hasExplicitReviewIntent('অযাচাইকৃত জ্ঞান রিভিউ করে দেখাও।'), true);
  assert.equal(hasExplicitReviewIntent('Remember this preference.'), false);
  assert.equal(safeReviewSourceUrl('https://example.com/article?token=secret#section'), 'https://example.com/article');
  assert.equal(safeReviewSourceUrl('https://user:pass@example.com/article'), null);

  const pendingRecord = buildCanonicalMemoryRecord({
    projectId: 'project-001', memoryId: 'mem-pending-review-001',
    kind: 'knowledge_save', title: 'Pending source title',
    url: 'https://example.com/pending',
    content: 'Pending source content.',
    now: '2026-11-07T07:00:00.000Z'
  });
  let reviewReadRequest = null;
  const reviewQueue = await listPendingHfmKnowledgeForReview({
    req: {
      session: {
        authenticated: true,
        role: 'admin',
        hfmPrincipal: { subject: 'admin-001' },
        hfmProjectBinding: { verified: true, projectId: 'project-001' }
      }
    },
    pool: { connect: async () => ({}) },
    env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' },
    userIntent: 'Show pending knowledge sources for review.',
    readMemory: async input => {
      reviewReadRequest = input;
      return {
        status: 'AUTHORIZED_AND_COMMITTED',
        standingAuthority: true,
        approvalRequiredPerRead: false,
        projectId: 'project-001',
        authorityExpiresAt: '2027-11-07T07:00:00.000Z',
        hostAuthorizationContext: { projectId: 'project-001', actorId: 'mira:admin-001' },
        records: [pendingRecord]
      };
    }
  });
  assert.equal(reviewReadRequest.lifecycle, 'PENDING_REVIEW');
  assert.deepEqual(reviewReadRequest.recordTypes, ['knowledge_item']);
  assert.equal(reviewQueue.status, 'REVIEW_REQUIRED');
  assert.equal(reviewQueue.count, 1);
  assert.equal(reviewQueue.items[0].title, 'Pending source title');
  assert.equal(reviewQueue.items[0].trust, 'SOURCE_RECORDED');
  assert.equal(reviewQueue.items[0].eligibleForTrustedSearch, false);
  assert.equal(reviewQueue.items[0].requiresHumanReview, true);
  assert.equal(reviewQueue.promotionSupported, false);
  await assert.rejects(
    () => listPendingHfmKnowledgeForReview({
      req: { session: { authenticated: true, role: 'admin', hfmPrincipal: {}, hfmProjectBinding: { verified: true, projectId: 'project-001' } } },
      pool: { connect: async () => ({}) },
      env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' },
      userIntent: 'Show me my knowledge.'
    }),
    /HFM_KNOWLEDGE_REVIEW_EXPLICIT_USER_INTENT_REQUIRED/
  );

  const memoryRecord = buildCanonicalMemoryRecord({
    projectId: 'project-001', memoryId: 'mem-1234567890abcdef',
    kind: 'memory_save', content: 'Remembered preference.',
    now: '2026-11-07T07:00:00.000Z'
  });
  assert.equal(validateCanonicalRecord(memoryRecord).valid, true);
  assert.equal(memoryRecord.recordType, 'knowledge_item');
  assert.equal(memoryRecord.access.classification, 'PROJECT_PRIVATE');
  assert.equal(memoryRecord.trust.status, 'HUMAN_VERIFIED');
  assert.equal(memoryRecord.lifecycle, 'ACTIVE');

  const pendingKnowledge = buildCanonicalMemoryRecord({
    projectId: 'project-001', memoryId: 'mem-abcdef1234567890',
    kind: 'knowledge_save', title: 'Source title', url: 'https://example.com/article?token=secret',
    content: 'Unverified imported source content.',
    now: '2026-11-07T07:00:00.000Z'
  });
  assert.equal(validateCanonicalRecord(pendingKnowledge).valid, true);
  assert.equal(pendingKnowledge.trust.status, 'SOURCE_RECORDED');
  assert.equal(pendingKnowledge.lifecycle, 'PENDING_REVIEW');
  assert.equal(pendingKnowledge.source.sourceUrl, 'https://example.com/article');
  assert.equal(pendingKnowledge.content.includes('token=secret'), false);

  let issued = null;
  let saved = null;
  const result = await saveHfmMemoryRecord(baseOptions({
    issueAuthority: async input => {
      issued = input;
      return {
        status: 'AUTHORITY_ISSUED',
        projectId: 'project-001',
        operation: 'memory.write',
        resource: input.resource,
        grant: { authorityId: 'authority-001', purpose: input.purpose, requestId: 'request-001' }
      };
    },
    createRecord: async input => {
      saved = input;
      return { status: 'CREATED', memoryId: input.record.memoryId, revision: 1 };
    }
  }));
  assert.equal(issued.operation, 'memory.write');
  assert.equal(issued.approvalConfirmed, true);
  assert.equal(issued.resource, 'memory:' + result.memoryId);
  assert.equal(saved.allowPrivateWrite, true);
  assert.equal(saved.record.trust.status, 'HUMAN_VERIFIED');
  assert.equal(result.saved, true);
  assert.equal(result.searchEligible, true);
  assert.equal(result.localFallback, false);
  assert.equal(result.driveFallback, false);

  await assert.rejects(
    () => saveHfmMemoryRecord(baseOptions({
      env: { MIRA_HFM_MEMORY_WRITE_ENABLED: 'false', MIRA_HFM_AUTHORITY_ISSUER_ENABLED: 'true' }
    })),
    /HFM_MEMORY_SAVE_EXPLICIT_USER_INTENT_REQUIRED|HFM_MEMORY_WRITE_DISABLED/
  );
  await assert.rejects(
    () => saveHfmMemoryRecord(baseOptions({
      content: 'The user likes examples and prefers concise Bengali explanations.'
    })),
    /HFM_MEMORY_SAVE_CONTENT_NOT_PRESENT_IN_USER_INTENT/
  );
  await assert.rejects(
    () => saveHfmMemoryRecord(baseOptions({ userIntent: 'Explain memory storage.' })),
    /HFM_MEMORY_SAVE_EXPLICIT_USER_INTENT_REQUIRED/
  );

  const pendingResult = await saveHfmMemoryRecord(baseOptions({
    kind: 'knowledge_save',
    title: 'Source title',
    url: 'https://example.com/article',
    content: 'Imported source text.',
    userIntent: 'Save this knowledge source to memory.'
  }));
  assert.equal(pendingResult.trust, 'SOURCE_RECORDED');
  assert.equal(pendingResult.lifecycle, 'PENDING_REVIEW');
  assert.equal(pendingResult.searchEligible, false);

  const { executeTool } = require('../tools');
  const previousWriteFlag = process.env.MIRA_HFM_MEMORY_WRITE_ENABLED;
  const previousReadFlag = process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
  const previousWorkFlag = process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
  try {
    process.env.MIRA_HFM_MEMORY_WRITE_ENABLED = 'true';
    delete process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
    delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
    await assert.rejects(
      () => executeTool('memory_save', { content: 'Remember this.' }, null),
      error => error && error.code === 'HFM_MEMORY_WRITE_CONTEXT_REQUIRED'
    );
    await assert.rejects(
      () => executeTool('knowledge_save', { title: 'Title', url: 'https://example.com', content: 'Source.' }, null),
      error => error && error.code === 'HFM_MEMORY_WRITE_CONTEXT_REQUIRED'
    );
    await assert.rejects(
      () => executeTool('knowledge_search', { query: 'test' }, null),
      error => error && error.code === 'HFM_MEMORY_READ_MODE_REQUIRED'
    );
    process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = 'true';
    await assert.rejects(
      () => executeTool('knowledge_review_queue', { limit: 5 }, null),
      error => error && error.code === 'HFM_KNOWLEDGE_REVIEW_HFM_CONTEXT_REQUIRED'
    );
    const directReviewQueue = require('../tools/knowledge-review-queue');
    assert.equal(JSON.parse(await directReviewQueue.execute({ limit: 5 })).code, 'HFM_TOOL_ROUTER_REQUIRED');
    process.env.MIRA_HFM_MEMORY_WRITE_ENABLED = 'false';
    process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = 'true';
    await assert.rejects(
      () => executeTool('memory_save', { content: 'Remember this.' }, null),
      error => error && error.code === 'HFM_LEGACY_STORAGE_DISABLED'
    );
    const directMemorySave = require('../tools/memory-save');
    const directKnowledgeSave = require('../tools/knowledge-save');
    assert.equal(JSON.parse(await directMemorySave.execute({ content: 'Remember this.' })).code, 'HFM_TOOL_ROUTER_REQUIRED');
    assert.equal(JSON.parse(await directKnowledgeSave.execute({ title: 'Title', url: 'https://example.com', content: 'Source.' })).code, 'HFM_TOOL_ROUTER_REQUIRED');

    const servicePath = require.resolve('../services/mira-hfm-memory-save-runtime');
    const serviceModule = require.cache[servicePath];
    const originalSave = serviceModule.exports.saveHfmMemoryRecord;
    let routedOptions = null;
    serviceModule.exports.saveHfmMemoryRecord = async options => {
      routedOptions = options;
      return {
        success: true, saved: true, status: 'CREATED',
        memoryId: 'mem-tool-route-0001', lifecycle: 'ACTIVE',
        classification: 'PROJECT_PRIVATE', trust: 'HUMAN_VERIFIED',
        searchable: true, localFallback: false, driveFallback: false
      };
    };
    const routed = JSON.parse(await executeTool('memory_save', { content: 'I prefer concise Bengali explanations.' }, {
      hfmWrite: {
        req: { session: { authenticated: true, role: 'admin' } },
        writerPool: { connect: async () => ({}) },
        issuerPool: { connect: async () => ({}) },
        userIntent: 'Remember this: I prefer concise Bengali explanations.',
        taskId: 'task-001', toolCallId: 'call-001', toolName: 'memory_save'
      }
    }));
    assert.equal(routed.source, 'HFM_V02_CANONICAL');
    assert.equal(routed.localFallback, false);
    assert.equal(routed.driveFallback, false);
    assert.equal(routedOptions.kind, 'memory_save');
    assert.equal(routedOptions.content, 'I prefer concise Bengali explanations.');
    assert.match(routedOptions.userIntent, /Remember this/);
    serviceModule.exports.saveHfmMemoryRecord = originalSave;
  } finally {
    if (previousWriteFlag === undefined) delete process.env.MIRA_HFM_MEMORY_WRITE_ENABLED;
    else process.env.MIRA_HFM_MEMORY_WRITE_ENABLED = previousWriteFlag;
    if (previousReadFlag === undefined) delete process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED;
    else process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED = previousReadFlag;
    if (previousWorkFlag === undefined) delete process.env.MIRA_HFM_WORK_LEARNING_ENABLED;
    else process.env.MIRA_HFM_WORK_LEARNING_ENABLED = previousWorkFlag;
  }

  console.log('HFM_MEMORY_SAVE_RUNTIME_TESTS=PASS');
  console.log('HFM_MEMORY_TOOLS_FAIL_CLOSED_WITHOUT_SERVER_CONTEXT=PASS');
  console.log('HFM_LEGACY_MEMORY_AND_KNOWLEDGE_TOOLS_HAVE_NO_HFM_FALLBACK=PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
