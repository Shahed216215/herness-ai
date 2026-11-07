'use strict';

const assert = require('node:assert/strict');
const { tools: registeredTools, declarations: registeredDeclarations } = require('../tools');
const {
  hasExplicitSaveIntent,
  hasExplicitDailyActivitySaveIntent,
  hasExplicitSourceReferenceSaveIntent,
  hasExplicitVaultSaveIntent,
  hasVaultOnlyDailyActivityContent,
  isUserAuthoredMemoryContent,
  deriveIdempotencyKey,
  normalizeSourceUrl,
  buildCanonicalMemoryRecord,
  saveHfmMemoryRecord
} = require('../services/mira-hfm-memory-save-runtime');
const { validateCanonicalRecord, SCHEMA_V1_2 } = require('../services/mira-hfm-record-schema');
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
  assert.ok(registeredTools.daily_activity_save);
  assert.equal(registeredTools.daily_activity_save.name, 'daily_activity_save');
  assert.ok(registeredDeclarations.some(declaration => declaration.name === 'daily_activity_save'));
  assert.ok(registeredTools.source_reference_save);
  assert.equal(registeredTools.source_reference_save.name, 'source_reference_save');
  assert.ok(registeredDeclarations.some(declaration => declaration.name === 'source_reference_save'));
  assert.ok(registeredTools.client_vault_save);
  assert.ok(registeredDeclarations.some(declaration => declaration.name === 'client_vault_save'));
  assert.ok(registeredTools.financial_vault_save);
  assert.ok(registeredDeclarations.some(declaration => declaration.name === 'financial_vault_save'));
  assert.equal(hasExplicitSaveIntent('Remember this: keep my learning plan.'), true);
  assert.equal(hasExplicitSaveIntent('এটা মনে রাখবে: আমার শেখার পরিকল্পনা।'), true);
  assert.equal(hasExplicitSaveIntent('Please save this to your memory.'), true);
  assert.equal(hasExplicitSaveIntent('Save this learning note to my knowledge base.'), true);
  assert.equal(hasExplicitSaveIntent('Save this daily activity summary to Mira Memory.'), true);
  assert.equal(hasExplicitSaveIntent('Do not record daily activity.'), false);
  assert.equal(hasExplicitSaveIntent('দৈনিক কাজের সারাংশ সংরক্ষণ করো।'), true);
  assert.equal(hasExplicitDailyActivitySaveIntent('Save this daily activity summary to Mira Memory.'), true);
  assert.equal(hasExplicitDailyActivitySaveIntent('দৈনিক কাজের সারাংশ সংরক্ষণ করো।'), true);
  assert.equal(hasExplicitDailyActivitySaveIntent('আজকের কাজের সারাংশ সেভ করে রাখো।'), true);
  assert.equal(hasExplicitDailyActivitySaveIntent('Please record my activity log for today.'), true);
  assert.equal(hasExplicitDailyActivitySaveIntent('Do not record the daily activity.'), false);
  assert.equal(hasExplicitDailyActivitySaveIntent('আজকের কাজ সংরক্ষণ করো না।'), false);
  assert.equal(hasExplicitDailyActivitySaveIntent('Remember this: I completed Python practice.'), false);
  assert.equal(hasExplicitSourceReferenceSaveIntent('Save this source reference: https://example.com/article'), true);
  assert.equal(hasExplicitSourceReferenceSaveIntent('Please save this link for later: https://example.com/article'), true);
  assert.equal(hasExplicitSourceReferenceSaveIntent('এই সোর্স লিংকটি সংরক্ষণ করো: https://example.com/article'), true);
  assert.equal(hasExplicitSourceReferenceSaveIntent('Do not save this source reference.'), false);
  assert.equal(hasExplicitSourceReferenceSaveIntent('সোর্স লিংকটি সংরক্ষণ করো না।'), false);
  assert.equal(hasExplicitSourceReferenceSaveIntent('Remember this URL.'), false);

  assert.equal(hasExplicitVaultSaveIntent(
    'client_vault_save',
    'Save this client record to the client vault: client name Example Client, email contact@example.com.'
  ), true);
  assert.equal(hasExplicitVaultSaveIntent(
    'client_vault_save',
    'এই ক্লায়েন্টের তথ্য ক্লায়েন্ট ভল্টে সংরক্ষণ করো: Example Client'
  ), true);
  assert.equal(hasExplicitVaultSaveIntent(
    'financial_vault_save',
    'Save this financial transaction to the financial vault: TXN-1042, 1200 BDT.'
  ), true);
  assert.equal(hasExplicitVaultSaveIntent(
    'financial_vault_save',
    'এই আর্থিক লেনদেনটি ভল্টে সংরক্ষণ করো: TXN-1042'
  ), true);
  assert.equal(hasExplicitVaultSaveIntent(
    'client_vault_save',
    'Do not save this client record to the client vault.'
  ), false);
  assert.equal(hasExplicitVaultSaveIntent(
    'financial_vault_save',
    'এই আর্থিক লেনদেনটি ভল্টে সংরক্ষণ করো না।'
  ), false);
  assert.equal(hasExplicitVaultSaveIntent('client_vault_save', 'Remember this client.'), false);
  assert.equal(hasExplicitVaultSaveIntent('financial_vault_save', 'Remember this payment.'), false);
  assert.equal(hasExplicitVaultSaveIntent('client_vault_save', 'Save this financial transaction.'), false);
  assert.equal(hasExplicitVaultSaveIntent('client_vault_save', 'Save this client record to the client vault.'), true);
  assert.equal(hasExplicitVaultSaveIntent('financial_vault_save', 'Save this financial transaction to the vault.'), true);
  assert.equal(hasExplicitVaultSaveIntent('client_vault_save', 'Do not save this client record.'), false);
  assert.equal(hasExplicitVaultSaveIntent('financial_vault_save', 'আর্থিক রেকর্ড ভল্টে সংরক্ষণ করো না।'), false);
  assert.equal(hasExplicitVaultSaveIntent('client_vault_save', 'Remember this client information.'), false);
  assert.equal(hasVaultOnlyDailyActivityContent('Client ID: C-1042 was updated.'), true);
  assert.equal(hasVaultOnlyDailyActivityContent('Contract #CT-2026-91 was signed.'), true);
  assert.equal(hasVaultOnlyDailyActivityContent('Invoice number INV-2026-001 was received.'), true);
  assert.equal(hasVaultOnlyDailyActivityContent('Bank account ref: ACCT-77881.'), true);
  assert.equal(hasVaultOnlyDailyActivityContent('National ID number was provided.'), true);
  assert.equal(hasVaultOnlyDailyActivityContent('Completed Python practice and fixed a local test.'), false);
  assert.equal(hasExplicitDailyActivitySaveIntent('Remember this: I completed Python practice.'), false);
  assert.equal(hasExplicitDailyActivitySaveIntent('Do not save daily activity.'), false);
  assert.equal(hasExplicitDailyActivitySaveIntent('দৈনিক কাজের সারাংশ সংরক্ষণ করো না।'), false);
  assert.equal(hasExplicitSaveIntent('Store this in my memory.'), true);
  assert.equal(hasExplicitSaveIntent('Add this to Mira memory.'), true);
  assert.equal(hasExplicitSaveIntent('Do not remember this.'), false);
  assert.equal(hasExplicitSaveIntent("Don't forget to remember this."), true);
  assert.equal(hasExplicitSaveIntent("I don't think you should remember this."), false);
  assert.equal(hasExplicitSaveIntent('এটা মনে রাখবে না।'), false);
  assert.equal(hasExplicitSaveIntent('এই নোটটি সংরক্ষণ করো।'), false);
  assert.equal(hasExplicitSaveIntent('এটা মেমোরিতে সংরক্ষণ করো।'), true);
  assert.equal(hasExplicitSaveIntent('এই শেখাটা জ্ঞানভাণ্ডারে রাখো।'), true);
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
  assert.equal(hasExplicitReviewIntent('অপেক্ষমাণ শেখার নোটগুলো দেখাও।'), true);
  assert.equal(hasExplicitReviewIntent('Remember this preference.'), false);
  assert.equal(safeReviewSourceUrl('https://example.com/article?token=secret#section'), 'https://example.com/article');
  assert.equal(safeReviewSourceUrl('https://user:pass@example.com/article'), null);

  const pendingRecord = buildCanonicalMemoryRecord({
    projectId: 'project-001', memoryId: 'mem-pending-review-001',
    kind: 'knowledge_save', title: 'Pending source title',
    url: 'https://example.com/pending',
    content: 'Pending source content.',
    userIntent: 'Remember this: Pending source content.',
    now: '2026-11-07T07:00:00.000Z'
  });
  const pendingLearningRecord = buildCanonicalMemoryRecord({
    projectId: 'project-001', memoryId: 'mem-pending-learning-001',
    kind: 'learning_save', title: 'Pending learning title',
    url: 'https://example.com/learning',
    content: 'Pending learning content.',
    userIntent: 'Save this learning note to my knowledge base.',
    now: '2026-11-07T07:00:00.000Z'
  });
  assert.equal(hasExplicitReviewIntent('Show pending learning notes for review.'), true);
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
    issuerPool: { connect: async () => ({}) },
    env: { MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED: 'true' },
    userIntent: 'Show pending knowledge sources and learning notes for review.',
    issueAuthority: async input => ({
      status: 'AUTHORITY_ISSUED',
      projectId: 'project-001',
      operation: 'memory.read',
      resource: 'memory:project:project-001',
      grant: {
        authorityId: 'review-authority-001',
        requestId: 'review-request-001',
        purpose: input.purpose,
        expiresAt: '2026-11-07T07:05:00.000Z'
      }
    }),
    readMemory: async input => {
      reviewReadRequest = input;
      return {
        status: 'AUTHORIZED_AND_COMMITTED',
        authorityConsumed: true,
        standingAuthority: false,
        approvalRequiredPerRead: true,
        projectId: 'project-001',
        hostAuthorizationContext: { projectId: 'project-001', actorId: 'mira:admin-001' },
        records: [pendingRecord, pendingLearningRecord]
      };
    }
  });
  assert.equal(reviewReadRequest.lifecycle, 'PENDING_REVIEW');
  assert.deepEqual(reviewReadRequest.recordTypes, ['knowledge_item', 'learning_note']);
  assert.equal(reviewQueue.status, 'REVIEW_REQUIRED');
  assert.equal(reviewQueue.count, 2);
  assert.equal(reviewQueue.items[0].title, 'Pending source title');
  assert.equal(reviewQueue.items[0].trust, 'SOURCE_RECORDED');
  assert.equal(reviewQueue.items[0].eligibleForTrustedSearch, false);
  assert.equal(reviewQueue.items[0].requiresHumanReview, true);
  assert.equal(reviewQueue.items[1].recordType, 'learning_note');
  assert.equal(reviewQueue.items[1].eligibleForTrustedSearch, false);
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

  const dailyActivityContent = 'Completed Python practice on 2026-11-07. Contact user@example.com or +8801712345678; budget BDT 5,000; source https://example.com/private. Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456; token ghp_abcdefghijklmnopqrstuvwxyz1234567890.';
  const dailyActivityRecord = buildCanonicalMemoryRecord({
    projectId: 'project-001',
    memoryId: 'mem-daily-activity-001',
    kind: 'daily_activity_save',
    content: dailyActivityContent,
    userIntent: 'Save this daily activity summary: ' + dailyActivityContent,
    now: '2026-11-07T07:00:00.000Z'
  });
  assert.equal(validateCanonicalRecord(dailyActivityRecord).valid, true);
  assert.equal(dailyActivityRecord.recordType, 'daily_activity');
  assert.equal(dailyActivityRecord.source.sourceType, 'manual');
  assert.equal(dailyActivityRecord.source.sourceId, 'user-confirmed-daily-activity');
  assert.equal(dailyActivityRecord.trust.status, 'HUMAN_VERIFIED');
  assert.equal(dailyActivityRecord.lifecycle, 'ACTIVE');
  assert.equal(dailyActivityRecord.access.classification, 'PROJECT_PRIVATE');
  assert.equal(dailyActivityRecord.content.includes('user@example.com'), false);
  assert.equal(dailyActivityRecord.content.includes('+880'), false);
  assert.equal(dailyActivityRecord.content.includes('5,000'), false);
  assert.equal(dailyActivityRecord.content.includes('https://'), false);
  assert.equal(dailyActivityRecord.content.includes('2026-11-07'), true);
  assert.equal(dailyActivityRecord.content.includes('Authorization:'), false);
  assert.equal(dailyActivityRecord.content.includes('ghp_'), false);
  assert.throws(() => buildCanonicalMemoryRecord({
    projectId: 'project-001',
    memoryId: 'mem-daily-activity-sensitive',
    kind: 'daily_activity_save',
    content: 'Client email and bank account details were shared.',
    userIntent: 'Save this daily activity summary: Client email and bank account details were shared.'
  }), /HFM_DAILY_ACTIVITY_SENSITIVE_CONTENT_REQUIRES_VAULT/);
  assert.throws(() => buildCanonicalMemoryRecord({
    projectId: 'project-001',
    memoryId: 'mem-daily-activity-no-specific-intent',
    kind: 'daily_activity_save',
    content: 'Completed a Python practice task.',
    userIntent: 'Remember this: Completed a Python practice task.'
  }), /HFM_DAILY_ACTIVITY_EXPLICIT_USER_INTENT_REQUIRED/);
  assert.throws(() => buildCanonicalMemoryRecord({
    projectId: 'project-001',
    memoryId: 'mem-daily-activity-not-user-authored',
    kind: 'daily_activity_save',
    content: 'Mira completed a task.',
    userIntent: 'Save this daily activity summary.'
  }), /HFM_DAILY_ACTIVITY_CONTENT_NOT_PRESENT_IN_USER_INTENT/);

  const memoryRecord = buildCanonicalMemoryRecord({
    projectId: 'project-001', memoryId: 'mem-1234567890abcdef',
    kind: 'memory_save', content: 'Remembered preference.',
    userIntent: 'Remember this: Remembered preference.',
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

  const pendingLearning = buildCanonicalMemoryRecord({
    projectId: 'project-001', memoryId: 'mem-learning-abcdef1234',
    kind: 'learning_save', title: 'Python automation lesson',
    url: 'https://example.com/python-lesson',
    content: 'A repeatable Python automation lesson.',
    userIntent: 'Save this learning note to my knowledge base.',
    now: '2026-11-07T07:00:00.000Z'
  });
  assert.equal(validateCanonicalRecord(pendingLearning).valid, true);
  assert.equal(pendingLearning.recordType, 'learning_note');
  assert.equal(pendingLearning.trust.status, 'SOURCE_RECORDED');
  assert.equal(pendingLearning.lifecycle, 'PENDING_REVIEW');

  let issued = null;
  let saved = null;
  const result = await saveHfmMemoryRecord(baseOptions({
    userIntent: 'Remember this: The user prefers concise Bengali explanations.',
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

  const dailySaveResult = await saveHfmMemoryRecord(baseOptions({
    kind: 'daily_activity_save',
    content: 'Completed the Python practice task.',
    userIntent: 'Save this daily activity summary: Completed the Python practice task.',
    toolName: 'daily_activity_save'
  }));
  assert.equal(dailySaveResult.recordType, 'daily_activity');
  assert.equal(dailySaveResult.trust, 'HUMAN_VERIFIED');
  assert.equal(dailySaveResult.lifecycle, 'ACTIVE');
  assert.equal(dailySaveResult.searchEligible, true);
  assert.equal(dailySaveResult.contentRedacted, false);

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
  const learningResult = await saveHfmMemoryRecord(baseOptions({
    kind: 'learning_save',
    title: 'Python automation lesson',
    url: 'https://example.com/python-lesson',
    content: 'A repeatable Python automation lesson.',
    userIntent: 'Save this learning note to my knowledge base.'
  }));
  assert.equal(learningResult.recordType, 'learning_note');
  assert.equal(learningResult.trust, 'SOURCE_RECORDED');
  assert.equal(learningResult.lifecycle, 'PENDING_REVIEW');
  assert.equal(learningResult.searchEligible, false);

  const sourcePrincipal = {
    verified: true,
    issuer: 'mira.admins',
    subject: '11111111-1111-4111-8111-111111111111',
    actorType: 'HUMAN',
    authenticationMethod: 'ADMIN_SUBJECT',
    authenticationRef: 'source-reference-session-001',
    authenticatedAt: new Date(Date.now() - 30000).toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString()
  };
  let sourceReferenceSaved = null;
  const sourceUrl = 'https://example.com/article?token=private-value#section';
  const sourceReferenceResult = await saveHfmMemoryRecord(baseOptions({
    kind: 'source_reference_save',
    content: '',
    url: sourceUrl,
    sourceType: 'web',
    userIntent: 'Save this source reference: ' + sourceUrl,
    taskId: 'task-source-reference-001',
    toolCallId: 'call-source-reference-001',
    toolName: 'source_reference_save',
    req: {
      session: {
        authenticated: true,
        role: 'admin',
        hfmPrincipal: sourcePrincipal,
        hfmProjectBinding: { verified: true, projectId: 'project-001' }
      }
    },
    createRecord: async input => {
      sourceReferenceSaved = input;
      return { status: 'CREATED', memoryId: input.record.memoryId, revision: 1 };
    }
  }));
  const sourcePayload = JSON.parse(sourceReferenceSaved.record.content);
  assert.equal(sourceReferenceSaved.record.schemaVersion, SCHEMA_V1_2);
  assert.equal(sourceReferenceSaved.record.recordType, 'source_reference');
  assert.equal(validateCanonicalRecord(sourceReferenceSaved.record).valid, true);
  assert.equal(sourceReferenceSaved.record.access.classification, 'PROJECT_PRIVATE');
  assert.equal(sourceReferenceSaved.record.trust.status, 'SOURCE_RECORDED');
  assert.equal(sourceReferenceSaved.record.lifecycle, 'ACTIVE');
  assert.equal(sourcePayload.accessResult, 'NOT_FETCHED');
  assert.equal(sourcePayload.retrievalMethod, 'user_supplied_url');
  assert.equal(sourcePayload.canonicalUrl, 'https://example.com/article');
  assert.equal(sourcePayload.canonicalUrl.includes('private-value'), false);
  assert.match(sourcePayload.provenanceActor, /^mira:/);
  assert.match(sourcePayload.provenanceEventId, /^evt-[a-f0-9]{64}$/);
  assert.equal(sourceReferenceResult.recordType, 'source_reference');
  assert.equal(sourceReferenceResult.trust, 'SOURCE_RECORDED');
  assert.equal(sourceReferenceResult.searchEligible, false);
  assert.equal(sourceReferenceResult.localFallback, false);
  assert.equal(sourceReferenceResult.driveFallback, false);

  const clientVaultPayload = {
    clientId: 'C-1042',
    clientName: 'Example Client',
    email: 'contact@example.com',
    phone: '+8801712345678'
  };
  let clientVaultSaved = null;
  let clientVaultAuthority = null;
  const clientVaultResult = await saveHfmMemoryRecord(baseOptions({
    kind: 'client_vault_save',
    content: JSON.stringify(clientVaultPayload),
    userIntent: 'Save this client record to the client vault: client ID C-1042, client name Example Client, email contact@example.com, phone +8801712345678.',
    taskId: 'task-client-vault-001',
    toolCallId: 'call-client-vault-001',
    toolName: 'client_vault_save',
    req: {
      session: {
        authenticated: true,
        role: 'admin',
        hfmPrincipal: sourcePrincipal,
        hfmProjectBinding: { verified: true, projectId: 'project-001' }
      }
    },
    issueAuthority: async input => {
      clientVaultAuthority = input;
      return {
        status: 'AUTHORITY_ISSUED',
        projectId: input.req.session.hfmProjectBinding.projectId,
        operation: input.operation,
        resource: input.resource,
        grant: { authorityId: 'authority-client-vault-001', purpose: input.purpose, requestId: 'request-client-vault-001' }
      };
    },
    createRecord: async input => {
      clientVaultSaved = input;
      return { status: 'CREATED', memoryId: input.record.memoryId, revision: 1 };
    }
  }));
  assert.equal(clientVaultAuthority.operation, 'memory.vault.write');
  assert.match(clientVaultAuthority.purpose, /^hfm-vault:client_vault_record:/);
  assert.equal(clientVaultSaved.allowRestrictedWrite, true);
  assert.equal(clientVaultSaved.allowPrivateWrite, false);
  assert.equal(clientVaultSaved.record.recordType, 'client_vault_record');
  assert.equal(clientVaultSaved.record.access.classification, 'RESTRICTED');
  assert.equal(clientVaultSaved.record.trust.status, 'SOURCE_RECORDED');
  assert.equal(clientVaultSaved.record.lifecycle, 'PENDING_REVIEW');
  assert.equal(validateCanonicalRecord(clientVaultSaved.record).valid, true);
  assert.equal(clientVaultResult.classification, 'RESTRICTED');
  assert.equal(clientVaultResult.searchEligible, false);
  assert.equal(clientVaultResult.localFallback, false);
  assert.equal(clientVaultResult.driveFallback, false);

  const financialVaultPayload = {
    transactionReference: 'TXN-1042',
    counterparty: 'Example Client',
    amount: 1200,
    currency: 'BDT',
    transactionDate: '2026-11-07',
    status: 'paid',
    accountLast4: '1234'
  };
  let financialVaultSaved = null;
  let financialVaultAuthority = null;
  const financialVaultResult = await saveHfmMemoryRecord(baseOptions({
    kind: 'financial_vault_save',
    content: JSON.stringify(financialVaultPayload),
    userIntent: 'Save this financial transaction to the financial vault: transaction TXN-1042, counterparty Example Client, amount 1200 BDT, date 2026-11-07, status paid, account ending 1234.',
    taskId: 'task-financial-vault-001',
    toolCallId: 'call-financial-vault-001',
    toolName: 'financial_vault_save',
    req: {
      session: {
        authenticated: true,
        role: 'admin',
        hfmPrincipal: sourcePrincipal,
        hfmProjectBinding: { verified: true, projectId: 'project-001' }
      }
    },
    issueAuthority: async input => {
      financialVaultAuthority = input;
      return {
        status: 'AUTHORITY_ISSUED',
        projectId: input.req.session.hfmProjectBinding.projectId,
        operation: input.operation,
        resource: input.resource,
        grant: { authorityId: 'authority-financial-vault-001', purpose: input.purpose, requestId: 'request-financial-vault-001' }
      };
    },
    createRecord: async input => {
      financialVaultSaved = input;
      return { status: 'CREATED', memoryId: input.record.memoryId, revision: 1 };
    }
  }));
  assert.equal(financialVaultAuthority.operation, 'memory.vault.write');
  assert.equal(financialVaultSaved.allowRestrictedWrite, true);
  assert.equal(financialVaultSaved.allowPrivateWrite, false);
  assert.equal(financialVaultSaved.record.recordType, 'financial_vault_record');
  assert.equal(financialVaultSaved.record.access.classification, 'RESTRICTED');
  assert.equal(financialVaultSaved.record.lifecycle, 'PENDING_REVIEW');
  assert.equal(validateCanonicalRecord(financialVaultSaved.record).valid, true);
  assert.equal(financialVaultResult.classification, 'RESTRICTED');
  assert.equal(financialVaultResult.searchEligible, false);
  assert.equal(financialVaultResult.localFallback, false);
  assert.equal(financialVaultResult.driveFallback, false);

  await assert.rejects(
    () => saveHfmMemoryRecord(baseOptions({
      kind: 'client_vault_save',
      content: JSON.stringify(clientVaultPayload),
      userIntent: 'Remember this client record: client ID C-1042, client name Example Client, email contact@example.com, phone +8801712345678.',
      req: {
        session: {
          authenticated: true,
          role: 'admin',
          hfmPrincipal: sourcePrincipal,
          hfmProjectBinding: { verified: true, projectId: 'project-001' }
        }
      }
    })),
    /HFM_VAULT_EXPLICIT_USER_INTENT_REQUIRED/
  );

  const { executeTool, executeHfmMemorySave, declarations } = require('../tools');  await assert.rejects(
    () => saveHfmMemoryRecord(baseOptions({
      kind: 'source_reference_save',
      url: sourceUrl,
      userIntent: 'Remember this URL: ' + sourceUrl,
      req: { session: { authenticated: true, role: 'admin', hfmPrincipal: sourcePrincipal,
        hfmProjectBinding: { verified: true, projectId: 'project-001' } } }
    })),
    /HFM_SOURCE_REFERENCE_EXPLICIT_USER_INTENT_REQUIRED/
  );
  await assert.rejects(
    () => saveHfmMemoryRecord(baseOptions({
      kind: 'source_reference_save',
      url: 'https://example.com/not-in-message',
      userIntent: 'Save this source reference: https://example.com/article',
      req: { session: { authenticated: true, role: 'admin', hfmPrincipal: sourcePrincipal,
        hfmProjectBinding: { verified: true, projectId: 'project-001' } } }
    })),
    /HFM_SOURCE_REFERENCE_URL_NOT_PRESENT_IN_USER_INTENT/
  );

  const { executeTool, executeHfmMemorySave, declarations } = require('../tools');
  assert.equal(declarations.some(tool => tool.name === 'daily_activity_save'), true);
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
      () => executeTool('learning_save', { content: 'Learning source.' }, null),
      error => error && error.code === 'HFM_MEMORY_WRITE_CONTEXT_REQUIRED'
    );
    await assert.rejects(
      () => executeTool('daily_activity_save', { content: 'Daily activity.' }, null),
      error => error && error.code === 'HFM_MEMORY_WRITE_CONTEXT_REQUIRED'
    );
    await assert.rejects(
      () => executeTool('source_reference_save', { url: 'https://example.com/article' }, null),
      error => error && error.code === 'HFM_MEMORY_WRITE_CONTEXT_REQUIRED'
    );
    await assert.rejects(
      () => executeTool('client_vault_save', { payload: { clientName: 'Example Client' } }, null),
      error => error && error.code === 'HFM_MEMORY_WRITE_CONTEXT_REQUIRED'
    );
    await assert.rejects(
      () => executeTool('financial_vault_save', { payload: { transactionReference: 'TXN-1' } }, null),
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
    await assert.rejects(
      () => executeTool('daily_activity_save', { content: 'Daily activity.' }, null),
      error => error && error.code === 'HFM_LEGACY_STORAGE_DISABLED'
    );
    const directMemorySave = require('../tools/memory-save');
    const directKnowledgeSave = require('../tools/knowledge-save');
    const directLearningSave = require('../tools/learning-save');
    const directDailyActivitySave = require('../tools/daily-activity-save');
    const directSourceReferenceSave = require('../tools/source-reference-save');
    const directClientVaultSave = require('../tools/client-vault-save');
    const directFinancialVaultSave = require('../tools/financial-vault-save');
    const directLearningResult = await directLearningSave.execute({ content: 'Learning source.' })
      .then(value => JSON.parse(value))
      .catch(error => ({ code: error && error.code }));
    assert.equal(directLearningResult.code, 'HFM_TOOL_ROUTER_REQUIRED');
    const directMemoryResult = await directMemorySave.execute({ content: 'Remember this.' })
      .then(value => JSON.parse(value))
      .catch(error => ({ code: error && error.code }));
    const directKnowledgeResult = await directKnowledgeSave.execute({
      title: 'Title', url: 'https://example.com', content: 'Source.'
    }).then(value => typeof value === 'string' ? JSON.parse(value) : value)
      .catch(error => ({ code: error && error.code }));
    assert.ok(['HFM_TOOL_ROUTER_REQUIRED', 'HFM_LEGACY_STORAGE_DISABLED_IN_HFM_MODE'].includes(directMemoryResult.code));
    assert.ok(['HFM_TOOL_ROUTER_REQUIRED', 'HFM_LEGACY_STORAGE_DISABLED_IN_HFM_MODE'].includes(directKnowledgeResult.code));
    const directDailyActivityResult = await directDailyActivitySave.execute({ content: 'Daily activity.' })
      .then(value => JSON.parse(value))
      .catch(error => ({ code: error && error.code }));
    assert.equal(directDailyActivityResult.code, 'HFM_TOOL_ROUTER_REQUIRED');
    const directSourceReferenceResult = await directSourceReferenceSave.execute({ url: 'https://example.com/article' })
      .then(value => JSON.parse(value))
      .catch(error => ({ code: error && error.code }));
    assert.equal(directSourceReferenceResult.code, 'HFM_TOOL_ROUTER_REQUIRED');
    assert.equal(JSON.parse(await directClientVaultSave.execute({})).code, 'HFM_TOOL_ROUTER_REQUIRED');
    assert.equal(JSON.parse(await directFinancialVaultSave.execute({})).code, 'HFM_TOOL_ROUTER_REQUIRED');

    let routedOptions = null;
    const routed = JSON.parse(await executeHfmMemorySave(
      'memory_save',
      { content: 'I prefer concise Bengali explanations.' },
      {
        hfmWrite: {
          req: { session: { authenticated: true, role: 'admin' } },
          writerPool: { connect: async () => ({}) },
          issuerPool: { connect: async () => ({}) },
          userIntent: 'Remember this: I prefer concise Bengali explanations.',
          taskId: 'task-001', toolCallId: 'call-001', toolName: 'memory_save'
        }
      },
      async options => {
        routedOptions = options;
        return {
          success: true, saved: true, status: 'CREATED',
          memoryId: 'mem-tool-route-0001', lifecycle: 'ACTIVE',
          classification: 'PROJECT_PRIVATE', trust: 'HUMAN_VERIFIED',
          searchable: true, localFallback: false, driveFallback: false
        };
      }
    ));
    assert.equal(routed.source, 'HFM_V02_CANONICAL');
    assert.equal(routed.localFallback, false);
    assert.equal(routed.driveFallback, false);
    assert.equal(routedOptions.kind, 'memory_save');
    assert.equal(routedOptions.content, 'I prefer concise Bengali explanations.');
    assert.match(routedOptions.userIntent, /Remember this/);
    const dailyActivityRoutedOptions = {};
    const dailyActivityRouted = JSON.parse(await executeHfmMemorySave(
      'daily_activity_save',
      { content: 'Completed a user-confirmed daily activity.' },
      {
        hfmWrite: {
          req: { session: { authenticated: true, role: 'admin' } },
          writerPool: { connect: async () => ({}) },
          issuerPool: { connect: async () => ({}) },
          userIntent: 'Save this daily activity summary: Completed a user-confirmed daily activity.',
          taskId: 'task-003', toolCallId: 'call-003', toolName: 'daily_activity_save'
        }
      },
      async options => {
        Object.assign(dailyActivityRoutedOptions, options);
        return {
          success: true, saved: true, status: 'CREATED',
          memoryId: 'mem-daily-activity-tool-0001', recordType: 'daily_activity',
          lifecycle: 'ACTIVE', classification: 'PROJECT_PRIVATE',
          trust: 'HUMAN_VERIFIED', contentRedacted: false,
          searchEligible: true, localFallback: false, driveFallback: false
        };
      }
    ));
    assert.equal(dailyActivityRouted.source, 'HFM_V02_CANONICAL');
    assert.equal(dailyActivityRouted.recordType, 'daily_activity');
    assert.equal(dailyActivityRoutedOptions.kind, 'daily_activity_save');
    assert.equal(dailyActivityRoutedOptions.content, 'Completed a user-confirmed daily activity.');
    assert.match(dailyActivityRouted.message, /Daily activity saved privately/);

    const learningRoutedOptions = {};
    const learningRouted = JSON.parse(await executeHfmMemorySave(
      'learning_save',
      {
        content: 'A repeatable Python automation lesson.',
        sourceTitle: 'Python automation lesson',
        sourceUrl: 'https://example.com/python-lesson'
      },
      {
        hfmWrite: {
          req: { session: { authenticated: true, role: 'admin' } },
          writerPool: { connect: async () => ({}) },
          issuerPool: { connect: async () => ({}) },
          userIntent: 'Save this learning note to my knowledge base.',
          taskId: 'task-002', toolCallId: 'call-002', toolName: 'learning_save'
        }
      },
      async options => {
        Object.assign(learningRoutedOptions, options);
        return {
          success: true, saved: true, status: 'CREATED',
          memoryId: 'mem-learning-tool-0001', recordType: 'learning_note',
          lifecycle: 'PENDING_REVIEW', classification: 'PROJECT_PRIVATE',
          trust: 'SOURCE_RECORDED', searchEligible: false,
          localFallback: false, driveFallback: false
        };
      }
    ));
    assert.equal(learningRouted.source, 'HFM_V02_CANONICAL');
    assert.equal(learningRouted.lifecycle, 'PENDING_REVIEW');
    assert.equal(learningRoutedOptions.kind, 'learning_save');
    assert.equal(learningRoutedOptions.title, 'Python automation lesson');
    assert.equal(learningRoutedOptions.url, 'https://example.com/python-lesson');

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
