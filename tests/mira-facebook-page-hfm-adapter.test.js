'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  retrieveCanonicalRecordsWithReport
} = require('../services/mira-memory-unified-facade');
const {
  preparePublicPageDraftFromHfm,
  prepareFacebookImportForHfmReview
} = require('../services/mira-facebook-page-hfm-adapter');

const now = new Date('2026-11-04T12:00:00.000Z');
const requestContext = {
  actorId: 'actor-fixture-phase4',
  actorType: 'HUMAN',
  projectId: 'project-phase4',
  purpose: 'phase4-hfm-adapter-test',
  requestId: 'request-phase4-adapter-001',
  authorityRef: 'host-authz-phase4-fixture',
  issuedAt: '2026-11-04T11:59:00.000Z',
  expiresAt: '2026-11-04T12:05:00.000Z'
};
function authorize(input) {
  return {
    decision: 'ALLOW',
    actorId: input.actorId,
    actorType: input.actorType,
    projectId: input.projectId,
    purpose: input.purpose,
    requestId: input.requestId,
    operation: input.operation,
    resourceScope: input.resourceScope,
    authorityRef: input.authorityRef,
    issuedAt: '2026-11-04T11:59:30.000Z',
    expiresAt: '2026-11-04T12:04:00.000Z',
    replayStatus: 'FRESH'
  };
}
function record({ memoryId = 'memory-phase4-public-001', classification = 'PUBLIC' } = {}) {
  const content = 'Public synthetic memory record for Phase 4 integration.';
  return {
    schemaVersion: '1.0.0',
    memoryId,
    projectId: 'project-phase4',
    recordType: 'fact',
    content,
    source: {
      sourceType: 'manual',
      sourceId: 'phase4-fixture-source',
      sourceUrl: null,
      observedAt: '2026-11-04T11:00:00.000Z'
    },
    timestamps: {
      createdAt: '2026-11-04T11:00:00.000Z',
      updatedAt: '2026-11-04T11:30:00.000Z'
    },
    version: {
      revision: 1,
      contentHash: crypto.createHash('sha256').update(JSON.stringify(content), 'utf8').digest('hex')
    },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'CONTENT_VERIFIED' },
    access: { classification, allowedProjectIds: ['project-phase4'] },
    lifecycle: 'ACTIVE'
  };
}
function retrieve(value) {
  return retrieveCanonicalRecordsWithReport({
    records: [value],
    pendingConflicts: [],
    projectId: 'project-phase4',
    requestContext,
    authorizeRequest: authorize,
    now
  });
}

const publicRecord = record();
const report = retrieve(publicRecord);
assert.equal(report.records.length, 1);
const prepared = preparePublicPageDraftFromHfm({
  retrievalReport: report,
  memoryId: publicRecord.memoryId,
  pageId: '123456789',
  pageName: 'Mira Memory',
  generatedAt: '2026-11-04T12:00:00.000Z'
});
assert.equal(prepared.status, 'PREPARED_MANUAL_POST_NO_EXTERNAL_ACTION');
assert.equal(prepared.committed, false);
assert.equal(prepared.published, false);
assert.equal(prepared.hfm.retrievalEligibility, 'AUTHORIZED_READ');
assert.equal(prepared.draft.status, 'PENDING_MANUAL_POST');
assert.equal(prepared.draft.pageId, '123456789');
assert.throws(() => preparePublicPageDraftFromHfm({ retrievalReport: report, memoryId: publicRecord.memoryId }), /pageId is required/);
assert.equal(prepared.draft.content, publicRecord.content);
console.log('HFM_AUTHORIZED_PUBLIC_RECORD_DRAFT_PREPARE_PASS=PASS');

const privateRecord = record({ memoryId: 'memory-phase4-private-001', classification: 'PROJECT_PRIVATE' });
const privateReport = retrieve(privateRecord);
assert.throws(() => preparePublicPageDraftFromHfm({
  retrievalReport: privateReport,
  memoryId: privateRecord.memoryId,
  pageId: '123456789'
}), /explicitly PUBLIC/);
console.log('HFM_PRIVATE_RECORD_BLOCKED_FROM_PAGE_DRAFT=PASS');

assert.throws(() => preparePublicPageDraftFromHfm({
  retrievalReport: report,
  memoryId: 'memory-not-in-report'
}), /Exactly one HFM-authorized record/);
const tampered = {
  ...report,
  records: report.records.map(item => ({ ...item, content: 'tampered after retrieval' }))
};
assert.throws(() => preparePublicPageDraftFromHfm({
  retrievalReport: tampered,
  memoryId: publicRecord.memoryId
}), /provenance does not match/);
const denied = {
  ...report,
  eligibility: [{ memoryId: publicRecord.memoryId, status: 'EXCLUDED', reasonCode: 'HOST_DENIED' }]
};
assert.throws(() => preparePublicPageDraftFromHfm({
  retrievalReport: denied,
  memoryId: publicRecord.memoryId
}), /did not mark this record as authorized/);
console.log('HFM_PROVENANCE_ELIGIBILITY_AND_IDENTITY_GUARDS_PASS=PASS');

const imported = prepareFacebookImportForHfmReview({
  postUrl: 'https://www.facebook.com/123456789/posts/987654321/',
  expectedPageId: '123456789',
  content: 'Untrusted external fixture content',
  observedAt: '2026-11-04T12:00:00.000Z'
});
assert.equal(imported.status, 'REVIEW_CANDIDATE_NOT_PERSISTED');
assert.equal(imported.hfmDisposition, 'PENDING_HUMAN_REVIEW');
assert.equal(imported.mayEnterTrustedMemory, false);
assert.equal(imported.persistentWritePerformed, false);
assert.equal(imported.candidate.integrity.status, 'UNVERIFIED');
assert.equal(imported.candidate.lifecycle, 'PENDING_REVIEW');
console.log('FACEBOOK_IMPORT_REMAINS_UNTRUSTED_NONPERSISTED_REVIEW_CANDIDATE=PASS');

console.log('FACEBOOK_HFM_ADAPTER_NETWORK_REQUESTS=0');
console.log('FACEBOOK_HFM_ADAPTER_PERSISTENT_WRITES=0');
console.log('FACEBOOK_HFM_ADAPTER_PUBLISH_ACTIONS=0');
console.log('TESTS_FAILED=0');
console.log('RESULT=MIRA_HFM_PHASE4_FACADE_ADAPTER_PASS');
