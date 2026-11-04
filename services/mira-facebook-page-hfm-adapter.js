'use strict';

// Phase 4 -> Phase 3 HFM facade bridge.
// This adapter is deliberately prepare-only: no provider I/O, persistence,
// audit emission, Facebook transport, or Memory commit is performed.
const { digest } = require('./mira-memory-unified-facade');
const {
  createManualPostDraft,
  prepareManualPostImport
} = require('./mira-facebook-page-memory-connector');

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function requiredText(value, label, max = 128) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(label + ' is required and must be bounded text.');
  }
  return value.trim();
}

/**
 * Consume a Phase 3 retrieval report and prepare a manual Page post draft.
 * The report is a structural handoff, not a cryptographic authorization token;
 * callers must obtain it directly from the trusted in-process HFM facade.
 */
function preparePublicPageDraftFromHfm({
  retrievalReport, memoryId, pageId, pageName, generatedAt
} = {}) {
  if (!object(retrievalReport) ||
      !Array.isArray(retrievalReport.records) ||
      !Array.isArray(retrievalReport.provenance) ||
      !Array.isArray(retrievalReport.eligibility)) {
    throw new Error('A Phase 3 HFM retrieval report is required.');
  }
  const targetId = requiredText(memoryId, 'memoryId');
  const targetPageId = requiredText(pageId, 'pageId');
  const records = retrievalReport.records.filter(record =>
    object(record) && record.memoryId === targetId
  );
  if (records.length !== 1) {
    throw new Error('Exactly one HFM-authorized record must match memoryId.');
  }
  const record = records[0];
  const provenance = retrievalReport.provenance.filter(item =>
    object(item) && item.memoryId === targetId
  );
  const eligibility = retrievalReport.eligibility.filter(item =>
    object(item) && item.memoryId === targetId
  );
  if (provenance.length !== 1 || eligibility.length !== 1) {
    throw new Error('HFM provenance and eligibility must each contain one matching record.');
  }
  const evidence = provenance[0];
  if (evidence.projectId !== record.projectId ||
      evidence.revision !== record.version?.revision ||
      evidence.recordDigest !== digest(record) ||
      JSON.stringify(evidence.source) !== JSON.stringify(record.source)) {
    throw new Error('HFM provenance does not match the selected canonical record.');
  }
  if (eligibility[0].status !== 'ELIGIBLE' ||
      eligibility[0].reasonCode !== 'AUTHORIZED_READ') {
    throw new Error('HFM retrieval did not mark this record as authorized and eligible.');
  }
  if (record.access?.classification !== 'PUBLIC') {
    throw new Error('Facebook Page drafts accept only explicitly PUBLIC Memory records.');
  }
  const draft = createManualPostDraft({ record, pageId: targetPageId, pageName, generatedAt });
  return Object.freeze({
    schemaVersion: '1.0.0',
    providerId: 'facebook-page',
    hfm: Object.freeze({
      projectId: record.projectId,
      memoryId: record.memoryId,
      revision: record.version.revision,
      recordDigest: evidence.recordDigest,
      retrievalEligibility: 'AUTHORIZED_READ',
      auditStatus: retrievalReport.auditStatus || 'UNKNOWN_NOT_EMITTED'
    }),
    status: 'PREPARED_MANUAL_POST_NO_EXTERNAL_ACTION',
    committed: false,
    published: false,
    draft
  });
}

/**
 * Prepare an externally supplied post as an untrusted HFM review candidate.
 * This does not persist a quarantine record or create canonical Memory.
 */
function prepareFacebookImportForHfmReview({
  postUrl, expectedPageId, content, observedAt
} = {}) {
  const candidate = prepareManualPostImport({
    postUrl, expectedPageId, content, observedAt
  });
  return Object.freeze({
    schemaVersion: '1.0.0',
    providerId: 'facebook-page',
    status: 'REVIEW_CANDIDATE_NOT_PERSISTED',
    hfmDisposition: 'PENDING_HUMAN_REVIEW',
    mayEnterTrustedMemory: false,
    persistentWritePerformed: false,
    candidate
  });
}

module.exports = {
  preparePublicPageDraftFromHfm,
  prepareFacebookImportForHfmReview
};
