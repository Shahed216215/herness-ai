'use strict';

// Pure dry-run planner. It never reads or writes files, storage, providers or production data.
// A READY_FOR_REVIEW result is not migration approval and cannot be consumed as a write command.
const crypto = require('node:crypto');

const DOMAINS = new Set(['general_memory', 'knowledge', 'crm_conversation_message']);
const MAPPING_KEYS = [
  'domain', 'legacyId', 'canonicalMemoryId', 'projectId',
  'revision', 'sourceDigest', 'sourceFileDigest', 'sourceOrdinal',
  'classification', 'approvalReference'
];
const CLASSIFICATIONS = new Set(['PUBLIC', 'PROJECT_PRIVATE', 'RESTRICTED']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function stableValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite numbers are not supported.');
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('Circular source record rejected.');
    seen.add(value);
    const result = value.map(item => stableValue(item, seen));
    seen.delete(value);
    return result;
  }
  if (isObject(value)) {
    if (seen.has(value)) throw new Error('Circular source record rejected.');
    seen.add(value);
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new Error('Undefined source field rejected.');
      result[key] = stableValue(value[key], seen);
    }
    seen.delete(value);
    return result;
  }
  throw new Error('Unsupported source value rejected.');
}
function digest(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}
function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function validateMapping(mapping, domain, legacyId, sourceDigest, sourceFileDigest, sourceOrdinal) {
  const errors = [];
  if (!isObject(mapping)) return ['EXPLICIT_MAPPING_MISSING'];
  const keys = Object.keys(mapping);
  if (keys.length !== MAPPING_KEYS.length || MAPPING_KEYS.some(key => !Object.prototype.hasOwnProperty.call(mapping, key))) {
    errors.push('MAPPING_FIELDS_MUST_MATCH_CONTRACT');
  }
  if (mapping.domain !== domain) errors.push('DOMAIN_MAPPING_MISMATCH');
  if (mapping.legacyId !== legacyId || !nonEmpty(mapping.legacyId)) errors.push('LEGACY_ID_MISMATCH');
  if (!nonEmpty(mapping.canonicalMemoryId) || mapping.canonicalMemoryId.length < 8) errors.push('CANONICAL_MEMORY_ID_REQUIRED');
  if (!nonEmpty(mapping.projectId)) errors.push('AUTHORITATIVE_PROJECT_ID_REQUIRED');
  if (!Number.isInteger(mapping.revision) || mapping.revision !== 1) errors.push('INITIAL_REVISION_MUST_BE_1');
  if (mapping.sourceDigest !== sourceDigest || !/^[a-f0-9]{64}$/.test(mapping.sourceDigest || '')) errors.push('SOURCE_DIGEST_MISMATCH');
  if (mapping.sourceFileDigest !== sourceFileDigest || mapping.sourceOrdinal !== sourceOrdinal) errors.push('SOURCE_SNAPSHOT_LOCATOR_MISMATCH');
  if (!CLASSIFICATIONS.has(mapping.classification)) errors.push('EXPLICIT_CLASSIFICATION_REQUIRED');
  if (!nonEmpty(mapping.approvalReference)) errors.push('APPROVAL_REFERENCE_REQUIRED');
  return errors;
}
function buildMigrationCandidate({ domain, entry, sourceFileDigest, sourceOrdinal, mapping, parentConversation } = {}) {
  if (!DOMAINS.has(domain)) throw new Error('Unsupported migration domain.');
  if (!isObject(entry)) throw new Error('Source entry must be a plain object.');
  if (!/^[a-f0-9]{64}$/.test(sourceFileDigest || '')) throw new Error('Valid source file digest is required.');
  if (!Number.isInteger(sourceOrdinal) || sourceOrdinal < 0) throw new Error('Non-negative source ordinal is required.');

  let legacyId = null;
  const blockers = [];
  if (domain === 'general_memory') {
    // Legacy general Memory has no per-record ID. Bind a sidecar locator to
    // the exact source snapshot digest and stable array ordinal, never content.
    legacyId = 'legacy-memory:' + sourceFileDigest + ':' + sourceOrdinal;
  } else if (domain === 'knowledge') {
    if (nonEmpty(entry.id)) legacyId = entry.id;
    else blockers.push('KNOWLEDGE_LEGACY_ID_ABSENT');
  } else {
    if (nonEmpty(entry.messageId)) legacyId = entry.messageId;
    else blockers.push('CRM_PERSISTED_MESSAGE_ID_ABSENT');
    if (!nonEmpty(entry.conversationId)) blockers.push('CRM_CONVERSATION_ID_ABSENT');
    if (!isObject(parentConversation) ||
        parentConversation.conversationId !== entry.conversationId ||
        parentConversation.mappingStatus !== 'APPROVED' ||
        !nonEmpty(parentConversation.projectId) ||
        parentConversation.projectId !== mapping?.projectId ||
        !nonEmpty(parentConversation.approvalReference)) {
      blockers.push('CRM_APPROVED_CONVERSATION_PROJECT_MAPPING_REQUIRED');
    }
  }

  let sourceDigest;
  try {
    sourceDigest = digest(entry);
  } catch (error) {
    blockers.push('SOURCE_RECORD_NOT_CANONICALLY_DIGESTIBLE');
  }

  const mappingErrors = validateMapping(mapping, domain, legacyId, sourceDigest, sourceFileDigest, sourceOrdinal);
  blockers.push(...mappingErrors);
  const uniqueBlockers = [...new Set(blockers)];
  const candidate = {
    schemaVersion: '1.0.0',
    domain,
    sourceFileDigest,
    sourceOrdinal,
    legacyId,
    identityLocator: domain === 'general_memory' ? 'SOURCE_FILE_DIGEST_AND_ORDINAL' : 'PERSISTED_LEGACY_ID',
    sourceDigest: sourceDigest || null,
    canonicalMemoryId: mapping?.canonicalMemoryId || null,
    projectId: mapping?.projectId || null,
    revision: Number.isInteger(mapping?.revision) ? mapping.revision : null,
    classification: mapping?.classification || null,
    approvalReference: mapping?.approvalReference || null,
    status: uniqueBlockers.length ? 'BLOCKED' : 'READY_FOR_REVIEW',
    blockers: uniqueBlockers,
    writeAuthorized: false
  };
  return Object.freeze(candidate);
}
function validateCandidateSet(candidates) {
  if (!Array.isArray(candidates)) throw new Error('Candidate list must be an array.');
  const blockers = [];
  const seenLegacy = new Set();
  const seenCanonical = new Set();
  for (let index = 0; index < candidates.length; index++) {
    const item = candidates[index];
    if (!isObject(item) || item.status !== 'READY_FOR_REVIEW' || item.writeAuthorized !== false) {
      blockers.push('CANDIDATE_NOT_REVIEWABLE:' + index);
      continue;
    }
    const legacyKey = item.domain + ':' + item.legacyId;
    if (seenLegacy.has(legacyKey)) blockers.push('DUPLICATE_LEGACY_ID:' + legacyKey);
    seenLegacy.add(legacyKey);
    if (seenCanonical.has(item.canonicalMemoryId)) blockers.push('DUPLICATE_CANONICAL_MEMORY_ID:' + item.canonicalMemoryId);
    seenCanonical.add(item.canonicalMemoryId);
  }
  return { ok: blockers.length === 0, blockers };
}

function planSnapshot({ domain, sourceText, mappings = [], parentConversations = {} } = {}) {
  if (!DOMAINS.has(domain)) throw new Error('Unsupported migration domain.');
  if (typeof sourceText !== 'string' || !sourceText.length) throw new Error('Exact source snapshot text is required.');
  if (!Array.isArray(mappings)) throw new Error('Mappings must be an array.');
  if (!isObject(parentConversations)) throw new Error('parentConversations must be an object.');
  let entries;
  try {
    entries = JSON.parse(sourceText);
  } catch {
    throw new Error('Source snapshot is not valid JSON.');
  }
  if (!Array.isArray(entries)) throw new Error('Source snapshot must be a JSON array.');
  const sourceFileDigest = crypto.createHash('sha256').update(sourceText, 'utf8').digest('hex');
  const byLegacyId = new Map();
  const mappingErrors = [];
  for (const mapping of mappings) {
    if (!isObject(mapping) || !nonEmpty(mapping.legacyId)) {
      mappingErrors.push('MAPPING_WITHOUT_LEGACY_ID');
      continue;
    }
    if (byLegacyId.has(mapping.legacyId)) {
      mappingErrors.push('DUPLICATE_MAPPING:' + mapping.legacyId);
      continue;
    }
    byLegacyId.set(mapping.legacyId, mapping);
  }
  const used = new Set();
  const candidates = entries.map((entry, sourceOrdinal) => {
    const legacyId = domain === 'knowledge' ? entry?.id
      : domain === 'crm_conversation_message' ? entry?.messageId
      : 'legacy-memory:' + sourceFileDigest + ':' + sourceOrdinal;
    const mapping = nonEmpty(legacyId) ? byLegacyId.get(legacyId) : undefined;
    if (mapping) used.add(legacyId);
    const parentConversation = domain === 'crm_conversation_message' && nonEmpty(entry?.conversationId)
      ? parentConversations[entry.conversationId]
      : undefined;
    return buildMigrationCandidate({
      domain, entry, sourceFileDigest, sourceOrdinal, mapping, parentConversation
    });
  });
  for (const legacyId of byLegacyId.keys()) {
    if (!used.has(legacyId)) mappingErrors.push('UNUSED_MAPPING:' + legacyId);
  }
  const setValidation = validateCandidateSet(candidates.filter(item => item.status === 'READY_FOR_REVIEW'));
  const blockers = [
    ...mappingErrors,
    ...candidates.flatMap((item, index) => item.blockers.map(reason => 'ENTRY_' + index + ':' + reason)),
    ...setValidation.blockers
  ];
  return Object.freeze({
    schemaVersion: '1.0.0',
    domain,
    sourceFileDigest,
    entryCount: entries.length,
    candidates,
    status: blockers.length ? 'BLOCKED' : 'READY_FOR_REVIEW',
    blockers,
    writeAuthorized: false
  });
}
module.exports = { digest, buildMigrationCandidate, validateCandidateSet, planSnapshot };
