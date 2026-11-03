'use strict';

const crypto = require('node:crypto');
const { createContentHash, validateCanonicalRecord } = require('./core');

const DOMAIN_TYPES = Object.freeze({
  knowledge: 'knowledge',
  memory: 'fact',
  work_learning: 'lesson',
  conversation_reference: 'conversation_reference',
  conversation_store: 'conversation_reference',
  experience: 'experience',
  experience_memory: 'experience',
  experience_retrieval: 'research_reference',
  strategy: 'strategy',
  future_strategy: 'strategy',
  cross_task_learning: 'strategy',
  learning_history: 'lesson',
  knowledge_consolidation: 'knowledge',
  google_drive_backup: 'knowledge'
});

function stableLegacyId(domain, legacyId, projectId) {
  const identity = JSON.stringify([domain, String(legacyId), projectId]);
  return 'legacy_' + crypto.createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 32);
}

function mapLegacyRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 'VALIDATION_FAILED', errors: ['LEGACY_INPUT_INVALID'] };
  }
  const domain = input.domain;
  const source = input.record;
  if (!Object.prototype.hasOwnProperty.call(DOMAIN_TYPES, domain) ||
      !source || typeof source !== 'object' || Array.isArray(source)) {
    return { ok: false, status: 'VALIDATION_FAILED', errors: ['LEGACY_DOMAIN_OR_RECORD_INVALID'] };
  }
  if (typeof input.projectId !== 'string' || !input.projectId.trim() ||
      typeof source.id !== 'string' && typeof source.id !== 'number' ||
      typeof input.observedAt !== 'string' || Number.isNaN(Date.parse(input.observedAt))) {
    return { ok: false, status: 'VALIDATION_FAILED', errors: ['LEGACY_ID_PROJECT_OR_TIMESTAMP_REQUIRED'] };
  }

  const content = typeof source.content === 'string' ? source.content :
    typeof source.concept === 'string' ? source.concept :
    typeof source.text === 'string' ? source.text : '';
  if (!content.trim()) {
    return { ok: false, status: 'VALIDATION_FAILED', errors: ['LEGACY_CONTENT_REQUIRED'] };
  }
  const title = typeof source.title === 'string' ? source.title : '';
  const timestamp = typeof source.savedAt === 'string' && !Number.isNaN(Date.parse(source.savedAt))
    ? new Date(source.savedAt).toISOString()
    : new Date(input.observedAt).toISOString();
  const observedAt = new Date(input.observedAt).toISOString();
  const updatedAt = typeof source.updatedAt === 'string' && !Number.isNaN(Date.parse(source.updatedAt))
    ? new Date(source.updatedAt).toISOString()
    : timestamp;
  const sourceUrl = typeof source.url === 'string' && source.url.trim() ? source.url.trim() :
    typeof source.source === 'string' && /^https?:\/\//i.test(source.source) ? source.source.trim() : null;

  const record = {
    schemaVersion: '1.0.0',
    memoryId: stableLegacyId(domain, source.id, input.projectId),
    projectId: input.projectId,
    recordType: DOMAIN_TYPES[domain],
    content: title ? title + '\n\n' + content : content,
    source: {
      sourceType: 'legacy_import',
      sourceId: domain + ':' + String(source.id),
      sourceUrl,
      observedAt
    },
    timestamps: { createdAt: timestamp, updatedAt },
    version: { revision: 1, contentHash: createContentHash(title ? title + '\n\n' + content : content) },
    integrity: { status: 'VERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'UNVERIFIED' },
    access: {
      classification: input.accessClassification || 'PROJECT_PRIVATE'
    },
    lifecycle: 'PENDING_REVIEW'
  };
  const validation = validateCanonicalRecord(record);
  if (!validation.valid) return { ok: false, status: 'VALIDATION_FAILED', errors: validation.errors };
  return {
    ok: true,
    status: 'MAPPED_NOT_MIGRATED',
    record,
    migrationPerformed: false,
    sourceDomain: domain,
    sourceId: String(source.id)
  };
}

module.exports = { mapLegacyRecord, stableLegacyId };
