'use strict';

const { createContentHash, validateCanonicalRecord } = require('./core');

function createRetrievalEvidence(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 'VALIDATION_FAILED', errors: ['RETRIEVAL_INPUT_INVALID'] };
  }
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const content = typeof input.content === 'string' ? input.content.trim() :
    typeof input.snippet === 'string' ? input.snippet.trim() : '';
  const url = typeof input.sourceUrl === 'string' ? input.sourceUrl.trim() : '';
  if (!title || !content || !/^https?:\/\//i.test(url) ||
      typeof input.retrievedAt !== 'string' || Number.isNaN(Date.parse(input.retrievedAt)) ||
      typeof input.projectId !== 'string' || !input.projectId.trim() ||
      typeof input.sourceId !== 'string' || !input.sourceId.trim()) {
    return { ok: false, status: 'VALIDATION_FAILED', errors: ['RETRIEVAL_PROVENANCE_REQUIRED'] };
  }
  const observedAt = new Date(input.retrievedAt).toISOString();
  const recordContent = title + '\n\n' + content;
  const record = {
    schemaVersion: '1.0.0',
    memoryId: 'web_' + createContentHash(input.projectId + '|' + input.sourceId).slice(0, 32),
    projectId: input.projectId,
    recordType: 'research_reference',
    content: recordContent,
    source: {
      sourceType: 'web',
      sourceId: input.sourceId,
      sourceUrl: url,
      observedAt
    },
    timestamps: { createdAt: observedAt, updatedAt: observedAt },
    version: { revision: 1, contentHash: createContentHash(recordContent) },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' },
    access: { classification: 'PUBLIC' },
    lifecycle: 'ACTIVE'
  };
  const validation = validateCanonicalRecord(record);
  if (!validation.valid) return { ok: false, status: 'VALIDATION_FAILED', errors: validation.errors };
  return {
    ok: true,
    status: 'EVIDENCE_ONLY',
    record,
    canonicalMemoryWrite: false,
    trustPromotion: false
  };
}

module.exports = { createRetrievalEvidence };
