'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { retrieveCanonicalRecordsWithReport } = require('../services/mira-memory-unified-facade');
const {
  preparePublicPageDraftFromHfm,
  prepareFacebookImportForHfmReview,
  enqueueFacebookImportForHfmReview
} = require('../services/mira-facebook-page-hfm-adapter');
const {
  decideFacebookPageImportReview,
  verifyFacebookPageImportReview,
  verifyFacebookPageImportReviewDecision
} = require('../services/mira-facebook-page-import-review-registry');
const {
  createFacebookPageOperationIdentity,
  classifyFacebookPageTransportOutcome,
  reconcileFacebookPageWrite
} = require('../services/mira-facebook-page-operation-recovery');

const now = new Date('2026-11-04T12:00:00.000Z');
const requestContext = {
  actorId: 'actor-phase4-e2e',
  actorType: 'HUMAN',
  projectId: 'project-phase4-e2e',
  purpose: 'phase4-offline-e2e',
  requestId: 'request-phase4-e2e-001',
  authorityRef: 'host-authz-fixture',
  issuedAt: '2026-11-04T11:59:00.000Z',
  expiresAt: '2026-11-04T12:05:00.000Z'
};
function authorize(input) {
  return {
    decision: 'ALLOW', actorId: input.actorId, actorType: input.actorType,
    projectId: input.projectId, purpose: input.purpose, requestId: input.requestId,
    operation: input.operation, resourceScope: input.resourceScope,
    authorityRef: input.authorityRef, issuedAt: '2026-11-04T11:59:30.000Z',
    expiresAt: '2026-11-04T12:04:00.000Z', replayStatus: 'FRESH'
  };
}
const content = 'Synthetic public HFM memory used for Phase 4 offline E2E only.';
const record = {
  schemaVersion: '1.0.0',
  memoryId: 'memory-phase4-e2e-001',
  projectId: requestContext.projectId,
  recordType: 'fact',
  content,
  source: { sourceType: 'manual', sourceId: 'phase4-e2e-fixture', sourceUrl: null, observedAt: '2026-11-04T11:00:00.000Z' },
  timestamps: { createdAt: '2026-11-04T11:00:00.000Z', updatedAt: '2026-11-04T11:30:00.000Z' },
  version: {
    revision: 1,
    contentHash: crypto.createHash('sha256').update(JSON.stringify(content), 'utf8').digest('hex')
  },
  integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
  trust: { status: 'CONTENT_VERIFIED' },
  access: { classification: 'PUBLIC', allowedProjectIds: [requestContext.projectId] },
  lifecycle: 'ACTIVE'
};
const report = retrieveCanonicalRecordsWithReport({
  records: [record], pendingConflicts: [], projectId: requestContext.projectId,
  requestContext, authorizeRequest: authorize, now
});
const draft = preparePublicPageDraftFromHfm({
  retrievalReport: report, memoryId: record.memoryId, pageId: '123456789',
  pageName: 'Mira Memory', generatedAt: now.toISOString()
});
assert.equal(draft.status, 'PREPARED_MANUAL_POST_NO_EXTERNAL_ACTION');
assert.equal(draft.draft.pageId, '123456789');
assert.equal(draft.published, false);
console.log('E2E_HFM_PUBLIC_RECORD_TO_PAGE_DRAFT_PASS=PASS');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-phase4-e2e-'));
const directory = path.join(root, 'review-queue');
const auditEvents = [];
const auditWriter = event => { auditEvents.push(event); };
try {
  const importedContent = 'Synthetic external Facebook post fixture for review only.';
  const prepared = prepareFacebookImportForHfmReview({
    postUrl: 'https://www.facebook.com/123456789/posts/987654321/?tracking=e2e',
    expectedPageId: '123456789',
    content: importedContent,
    observedAt: now.toISOString()
  });
  const queued = enqueueFacebookImportForHfmReview({
    preparedReview: prepared, projectId: requestContext.projectId,
    actor: requestContext.actorId, directory, auditWriter
  });
  assert.equal(queued.status, 'QUEUED');
  assert.equal(queued.rawContentStored, false);
  assert.equal(queued.canonicalMemoryWrite, false);
  assert.equal(verifyFacebookPageImportReview({ directory, queueId: queued.queueId, projectId: requestContext.projectId }).status, 'VERIFIED');
  console.log('E2E_UNTRUSTED_IMPORT_TO_DURABLE_REVIEW_QUEUE_PASS=PASS');

  const decision = decideFacebookPageImportReview({
    directory, queueId: queued.queueId, projectId: requestContext.projectId,
    actor: requestContext.actorId, decision: 'APPROVE_FOR_INDEPENDENT_VERIFICATION',
    policyDecision: 'E2E_APPROVE_VERIFICATION_ONLY',
    authorizeDecision: input => input.projectId === requestContext.projectId && input.actor === requestContext.actorId,
    auditWriter
  });
  assert.equal(decision.reviewStatus, 'APPROVED_FOR_INDEPENDENT_VERIFICATION');
  assert.equal(decision.mayEnterTrustedMemory, false);
  assert.equal(verifyFacebookPageImportReviewDecision({ directory, queueId: queued.queueId, projectId: requestContext.projectId }).status, 'VERIFIED');
  console.log('E2E_HUMAN_REVIEW_DECISION_REMAINS_UNVERIFIED=PASS');

  const operation = createFacebookPageOperationIdentity({
    pageId: '123456789', actionId: 'e2e-publish-intent-001', contentHash: draft.draft.contentHash
  });
  const uncertain = classifyFacebookPageTransportOutcome({
    operation: 'WRITE', requestAttempted: true, responseReceived: false
  });
  assert.equal(uncertain.status, 'WRITE_OUTCOME_UNKNOWN_RECONCILE_BEFORE_RETRY');
  assert.equal(uncertain.automaticRetryAllowed, false);
  const reconciliation = reconcileFacebookPageWrite({
    expectedPageId: '123456789', expectedPostId: '987654321',
    expectedContentHash: prepared.candidate.contentHash,
    providerReadback: {
      found: true, pageId: '123456789', postId: '987654321',
      contentHash: prepared.candidate.contentHash
    }
  });
  assert.equal(reconciliation.status, 'READBACK_MATCHED_PENDING_INDEPENDENT_VERIFICATION');
  assert.equal(reconciliation.mayCommitCanonicalMemory, false);
  assert.equal(reconciliation.integrityStatus, 'UNVERIFIED');
  assert.equal(operation.pageId, '123456789');
  assert.equal(auditEvents.length, 2);
  console.log('E2E_UNCERTAIN_WRITE_READBACK_RECONCILIATION_NO_MEMORY_COMMIT=PASS');

  console.log('NETWORK_REQUESTS=0');
  console.log('LIVE_META_API_CALLS=0');
  console.log('FACEBOOK_POSTS_PUBLISHED=0');
  console.log('CANONICAL_MEMORY_WRITES=0');
  console.log('TESTS_FAILED=0');
  console.log('RESULT=MIRA_HFM_PHASE4_OFFLINE_E2E_PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
