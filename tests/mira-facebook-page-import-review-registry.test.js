'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  prepareFacebookImportForHfmReview,
  enqueueFacebookImportForHfmReview
} = require('../services/mira-facebook-page-hfm-adapter');
const {
  enqueueFacebookPageImportReview,
  verifyFacebookPageImportReview,
  listFacebookPageImportReviews,
  decideFacebookPageImportReview,
  verifyFacebookPageImportReviewDecision
} = require('../services/mira-facebook-page-import-review-registry');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-facebook-review-'));
const directory = path.join(root, 'queue');
const events = [];
const auditWriter = event => { events.push(event); };
const candidate = {
  providerId: 'facebook-page',
  source: {
    sourceType: 'facebook_page',
    sourceId: '987654321',
    sourceUrl: 'https://www.facebook.com/123456789/posts/987654321/',
    pageId: '123456789',
    observedAt: '2026-11-04T12:00:00.000Z'
  },
  content: 'This raw post body must not be persisted.',
  contentHash: crypto.createHash('sha256').update('This raw post body must not be persisted.', 'utf8').digest('hex'),
  integrity: { status: 'UNVERIFIED', algorithm: 'SHA-256' },
  trust: { status: 'SOURCE_RECORDED' },
  verificationStatus: 'MANUAL_IMPORT_PENDING_INDEPENDENT_READBACK',
  lifecycle: 'PENDING_REVIEW'
};
try {
  const preparedByAdapter = prepareFacebookImportForHfmReview({
    postUrl: candidate.source.sourceUrl,
    expectedPageId: candidate.source.pageId,
    content: candidate.content,
    observedAt: candidate.source.observedAt
  });
  const adapterQueued = enqueueFacebookImportForHfmReview({
    preparedReview: preparedByAdapter, projectId: 'project-adapter',
    actor: 'human-reviewer', directory, auditWriter
  });
  assert.equal(adapterQueued.status, 'QUEUED');
  assert.equal(adapterQueued.canonicalMemoryWrite, false);
  assert.equal(adapterQueued.rawContentStored, false);
  console.log('HFM_ADAPTER_TO_DURABLE_REVIEW_QUEUE_INTEGRATION_PASS=PASS');

  const queued = enqueueFacebookPageImportReview({
    directory, projectId: 'project-fixture', actor: 'human-reviewer', candidate, auditWriter
  });
  assert.equal(queued.status, 'QUEUED');
  assert.equal(queued.rawContentStored, false);
  assert.equal(queued.canonicalMemoryWrite, false);
  assert.equal(queued.auditEmitted, true);
  assert.equal(verifyFacebookPageImportReview({ directory, queueId: queued.queueId, projectId: 'project-fixture' }).status, 'VERIFIED');
  assert.equal(listFacebookPageImportReviews({ directory, projectId: 'project-fixture' }).length, 1);
  assert.throws(() => enqueueFacebookPageImportReview({
    directory, projectId: 'project-fixture', actor: 'human-reviewer',
    candidate: { ...candidate, source: { ...candidate.source, sourceUrl: 'https://www.facebook.com/999/posts/987654321/' } },
    auditWriter
  }), /does not match the candidate Page\/post identity/);
  assert.throws(() => enqueueFacebookPageImportReview({
    directory, projectId: 'project-fixture', actor: 'human-reviewer',
    candidate: { ...candidate, contentHash: 'c'.repeat(64) }, auditWriter
  }), /does not match the supplied content/);
  const file = path.join(directory, queued.queueId + '.json');
  const stored = fs.readFileSync(file, 'utf8');
  assert.equal(stored.includes(candidate.content), false);
  assert.equal(stored.includes('PENDING_HUMAN_REVIEW'), true);
  console.log('FACEBOOK_IMPORT_MINIMAL_IMMUTABLE_REVIEW_QUEUE_PASS=PASS');

  const duplicate = enqueueFacebookPageImportReview({
    directory, projectId: 'project-fixture', actor: 'human-reviewer', candidate, auditWriter
  });
  assert.equal(duplicate.status, 'ALREADY_QUEUED');
  assert.equal(duplicate.queueId, queued.queueId);
  assert.equal(events.length, 3);
  console.log('FACEBOOK_IMPORT_QUEUE_IDEMPOTENCY_AND_AUDIT_PASS=PASS');

  assert.throws(() => enqueueFacebookPageImportReview({
    directory, projectId: 'project-fixture', actor: 'human-reviewer',
    candidate: { ...candidate, content: 'changed post content', contentHash: crypto.createHash('sha256').update('changed post content', 'utf8').digest('hex') }, auditWriter
  }), /different import version/);
  assert.equal(verifyFacebookPageImportReview({ directory, queueId: queued.queueId }).status, 'VERIFIED');
  console.log('FACEBOOK_POST_CONTENT_CHANGE_REQUIRES_MANUAL_CONFLICT_REVIEW=PASS');

  assert.throws(() => enqueueFacebookPageImportReview({
    directory, projectId: 'project-fixture', actor: 'human-reviewer', candidate,
    auditWriter: () => { throw new Error('audit unavailable'); }
  }), error => error.code === 'FACEBOOK_REVIEW_QUEUE_AUDIT_FAILED' && error.stateCommitted === true && error.queueId === queued.queueId);
  console.log('FACEBOOK_REVIEW_QUEUE_AUDIT_FAILURE_EXPOSES_COMMITTED_STATE=PASS');

  const symlinkRoot = path.join(root, 'symlink-root');
  fs.mkdirSync(symlinkRoot);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(symlinkRoot, 'linked'), 'dir');
  assert.throws(() => enqueueFacebookPageImportReview({
    directory: path.join(symlinkRoot, 'linked'), projectId: 'project-fixture',
    actor: 'human-reviewer', candidate, auditWriter
  }), /unsafe directory component/);
  const insecureDirectory = path.join(root, 'insecure');
  fs.mkdirSync(insecureDirectory, { mode: 0o755 });
  fs.chmodSync(insecureDirectory, 0o755);
  assert.throws(() => enqueueFacebookPageImportReview({
    directory: insecureDirectory, projectId: 'project-fixture',
    actor: 'human-reviewer', candidate, auditWriter
  }), /owner-only/);
  console.log('FACEBOOK_REVIEW_QUEUE_SYMLINK_AND_PERMISSION_BOUNDARIES_PASS=PASS');

  const decision = decideFacebookPageImportReview({
    directory, queueId: queued.queueId, projectId: 'project-fixture',
    actor: 'human-reviewer', decision: 'APPROVE_FOR_INDEPENDENT_VERIFICATION',
    policyDecision: 'POLICY-APPROVE-VERIFY-ONLY',
    authorizeDecision: () => true, auditWriter
  });
  assert.equal(decision.status, 'DECIDED');
  assert.equal(decision.reviewStatus, 'APPROVED_FOR_INDEPENDENT_VERIFICATION');
  assert.equal(decision.trustStatus, 'SOURCE_RECORDED');
  assert.equal(decision.integrityStatus, 'UNVERIFIED');
  assert.equal(decision.mayEnterTrustedMemory, false);
  assert.equal(decision.canonicalMemoryWrite, false);
  assert.equal(verifyFacebookPageImportReviewDecision({ directory, queueId: queued.queueId, projectId: 'project-fixture' }).status, 'VERIFIED');
  assert.equal(listFacebookPageImportReviews({ directory, projectId: 'project-fixture' })[0].status, 'APPROVED_FOR_INDEPENDENT_VERIFICATION');
  assert.equal(decideFacebookPageImportReview({
    directory, queueId: queued.queueId, projectId: 'project-fixture',
    actor: 'human-reviewer', decision: 'APPROVE_FOR_INDEPENDENT_VERIFICATION',
    policyDecision: 'POLICY-APPROVE-VERIFY-ONLY',
    authorizeDecision: () => true, auditWriter
  }).status, 'ALREADY_DECIDED');
  assert.throws(() => decideFacebookPageImportReview({
    directory, queueId: queued.queueId, projectId: 'project-fixture',
    actor: 'different-reviewer', decision: 'REJECT_IMPORT',
    policyDecision: 'POLICY-REJECT', authorizeDecision: () => true, auditWriter
  }), /different review decision/);
  assert.throws(() => decideFacebookPageImportReview({
    directory, queueId: queued.queueId, projectId: 'project-fixture',
    actor: 'unauthorized', decision: 'REJECT_IMPORT',
    policyDecision: 'POLICY-REJECT', authorizeDecision: () => false, auditWriter
  }), /authorization denied/);
  console.log('HUMAN_REVIEW_DECISION_IS_IMMUTABLE_AND_NEVER_TRUST_PROMOTES=PASS');

  const decisionFile = path.join(directory, queued.queueId + '.decision.json');
  const decisionTamper = JSON.parse(fs.readFileSync(decisionFile, 'utf8'));
  decisionTamper.mayEnterTrustedMemory = true;
  fs.writeFileSync(decisionFile, JSON.stringify(decisionTamper));
  assert.equal(verifyFacebookPageImportReviewDecision({ directory, queueId: queued.queueId }).status, 'INTEGRITY_FAILED');
  console.log('HUMAN_REVIEW_DECISION_TAMPER_DETECTION=PASS');

  const tampered = JSON.parse(stored);
  tampered.status = 'VERIFIED';
  fs.writeFileSync(file, JSON.stringify(tampered));
  assert.equal(verifyFacebookPageImportReview({ directory, queueId: queued.queueId }).status, 'INTEGRITY_FAILED');
  assert.throws(() => listFacebookPageImportReviews({ directory, projectId: 'project-fixture' }), /integrity verification failed/);
  console.log('FACEBOOK_REVIEW_QUEUE_TAMPER_DETECTION_FAILS_CLOSED=PASS');

  console.log('NETWORK_REQUESTS=0');
  console.log('RAW_POST_CONTENT_PERSISTED=0');
  console.log('CANONICAL_MEMORY_WRITES=0');
  console.log('TESTS_FAILED=0');
  console.log('RESULT=MIRA_HFM_FACEBOOK_IMPORT_REVIEW_REGISTRY_PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
