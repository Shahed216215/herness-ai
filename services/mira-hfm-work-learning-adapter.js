'use strict';

// Read-only Phase 8 bridge: verifies an explicit owner-approved Work Learning
// mapping, then emits a pending-review canonical candidate. It never writes.
const crypto = require('node:crypto');
const { validateCanonicalMemoryRecord } = require('./mira-memory-conflict-assessment');
const { validateProjectMapping } = require('./mira-memory-project-mapping-contract');
const {
  adaptLegacyEntry,
  digest: payloadDigest,
  serializeLegacyPayload
} = require('./mira-legacy-memory-knowledge-adapter');

const DOMAIN = 'work_learning';
const SOURCE_SYSTEM = 'mira_work_learning';
const CLASSIFICATIONS = new Set(['PUBLIC', 'PROJECT_PRIVATE', 'RESTRICTED']);
function fail(message, code = 'HFM_WORK_LEARNING_MAPPING_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function text(value, label, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail(label + ' is required and must be bounded text.');
  }
}
function hashContent(content) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(content), 'utf8')
    .digest('hex');
}
function buildWorkLearningCanonicalCandidate({ entry, mapping, observedAt }) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    fail('A raw Work Learning source record is required.');
  }
  text(entry.learningId, 'learningId', 256);
  text(mapping?.memoryId, 'mapping.memoryId', 128);
  text(mapping?.projectId, 'mapping.projectId', 128);
  if (!CLASSIFICATIONS.has(mapping?.classification)) {
    fail('An explicit canonical access classification is required.');
  }
  text(observedAt, 'observedAt', 64);
  const content = serializeLegacyPayload(DOMAIN, entry);
  const record = {
    schemaVersion: '1.0.0',
    memoryId: mapping.memoryId,
    projectId: mapping.projectId,
    recordType: 'lesson',
    content,
    source: {
      sourceType: 'legacy_import',
      sourceId: entry.learningId,
      sourceUrl: null,
      observedAt
    },
    timestamps: { createdAt: observedAt, updatedAt: observedAt },
    version: { revision: 1, contentHash: hashContent(content) },
    integrity: { status: 'UNVERIFIED', algorithm: 'SHA-256' },
    trust: { status: 'SOURCE_RECORDED' },
    access: {
      classification: mapping.classification,
      allowedProjectIds: [mapping.projectId]
    },
    lifecycle: 'PENDING_REVIEW'
  };
  const errors = validateCanonicalMemoryRecord(record, 'workLearningCandidate');
  if (errors.length) fail('Generated Work Learning candidate is invalid: ' + errors.join('; '));
  return record;
}
function adaptApprovedWorkLearningEntry({
  entry, mapping, projectId, sourceFileDigest, sourceOrdinal,
  observedAt, verifyApproval, now = new Date()
}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    fail('A raw Work Learning record is required.');
  }
  text(entry.learningId, 'learningId', 256);
  if (!Number.isInteger(sourceOrdinal) || sourceOrdinal < 0) {
    fail('A non-negative sourceOrdinal is required.');
  }
  const canonicalRecord = buildWorkLearningCanonicalCandidate({
    entry, mapping, observedAt
  });
  const validated = validateProjectMapping({
    mapping,
    expectedDomain: DOMAIN,
    expectedProjectId: projectId,
    expectedSourceFileDigest: sourceFileDigest,
    verifyApproval,
    now
  });
  if (validated.sourceSystem !== SOURCE_SYSTEM ||
      validated.legacyId !== entry.learningId ||
      validated.sourceOrdinal !== sourceOrdinal ||
      validated.sourceDigest !== payloadDigest(entry)) {
    fail('Work Learning mapping does not bind the exact raw source identity, ordinal and digest.');
  }
  if (validated.canonicalRecordDigest !== payloadDigest(canonicalRecord)) {
    fail('Work Learning canonical candidate digest does not match the approved mapping.');
  }
  const adapterMapping = {
    domain: DOMAIN,
    projectId: validated.projectId,
    legacyId: validated.legacyId,
    memoryId: validated.memoryId,
    revision: validated.revision,
    sourceDigest: validated.sourceDigest,
    sourceFileDigest: validated.sourceFileDigest,
    sourceOrdinal: validated.sourceOrdinal,
    classification: validated.classification,
    approvalReference: validated.approvalReference,
    canonicalRecord
  };
  return adaptLegacyEntry({
    domain: DOMAIN,
    entry,
    mapping: adapterMapping,
    projectId: validated.projectId,
    sourceFileDigest: validated.sourceFileDigest,
    sourceOrdinal
  });
}
function adaptApprovedWorkLearningEntries({
  entries, mappings, projectId, sourceFileDigest,
  observedAt, verifyApproval, now = new Date()
}) {
  if (!Array.isArray(entries) || !Array.isArray(mappings)) {
    fail('Work Learning entries and approved mappings must be arrays.');
  }
  if (!/^[a-f0-9]{64}$/.test(sourceFileDigest || '')) {
    fail('An exact SHA-256 sourceFileDigest is required.');
  }
  const byLegacyId = new Map();
  for (const mapping of mappings) {
    if (!mapping || typeof mapping.legacyId !== 'string' ||
        !mapping.legacyId || byLegacyId.has(mapping.legacyId)) {
      fail('Missing or duplicate Work Learning mapping identity.');
    }
    byLegacyId.set(mapping.legacyId, mapping);
  }
  const seenLearningIds = new Set();
  const adapted = entries.map((entry, sourceOrdinal) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail('Every Work Learning source record must be an object.');
    }
    text(entry.learningId, 'learningId', 256);
    if (seenLearningIds.has(entry.learningId)) {
      fail('Duplicate Work Learning learningId in source snapshot.');
    }
    seenLearningIds.add(entry.learningId);
    const mapping = byLegacyId.get(entry.learningId);
    if (!mapping) fail('Explicit owner-approved mapping missing for Work Learning record.');
    if (mapping.sourceOrdinal !== sourceOrdinal) {
      fail('Work Learning mapping sourceOrdinal does not match the exact snapshot position.');
    }
    return adaptApprovedWorkLearningEntry({
      entry, mapping, projectId, sourceFileDigest, sourceOrdinal,
      observedAt, verifyApproval, now
    });
  });
  if (byLegacyId.size !== adapted.length) {
    fail('Unused Work Learning mapping rejected.');
  }
  if (new Set(adapted.map(item => item.memoryId)).size !== adapted.length) {
    fail('Duplicate canonical Work Learning memoryId mapping rejected.');
  }
  return adapted;
}
module.exports = {
  DOMAIN,
  SOURCE_SYSTEM,
  buildWorkLearningCanonicalCandidate,
  adaptApprovedWorkLearningEntry,
  adaptApprovedWorkLearningEntries
};
