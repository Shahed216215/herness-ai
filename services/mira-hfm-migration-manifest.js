'use strict';

// Pure dry-run planner. It never reads or writes files, storage, providers or production data.
// A READY_FOR_REVIEW result is not migration approval and cannot be consumed as a write command.
const crypto = require('node:crypto');

const DOMAINS = new Set(['general_memory', 'knowledge', 'crm_conversation_message']);
const MAPPING_KEYS = [
  'domain', 'legacyId', 'canonicalMemoryId', 'projectId',
  'revision', 'sourceDigest', 'classification', 'approvalReference'
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
    .update(JSON.stringify(stableValue(value)), 'utf8')
    .digest('hex');
}
function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function validateMapping(mapping, domain, legacyId, sourceDigest) {
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
    if (nonEmpty(entry.messageId)) legacyId = entry.messageId;
    else blockers.push('GENERAL_MEMORY_IMMUTABLE_MESSAGE_ID_ABSENT');
  } else if (domain === 'knowledge') {
    if (nonEmpty(entry.id)) legacyId = entry.id;
    else blockers.push('KNOWLEDGE_LEGACY_ID_ABSENT');
  } else {
    if (nonEmpty(entry.messageId)) legacyId = entry.messageId;
    else blockers.push('CRM_PERSISTED_MESSAGE_ID_ABSENT');
    if (!nonEmpty(entry.conversationId)) blockers.push('CRM_CONVERSATION_ID_ABSENT');
    if (!isObject(parentConversation) || parentConversation.conversationId !== entry.conversationId) {
      blockers.push('CRM_PARENT_CONVERSATION_NOT_VERIFIED');
    }
  }

  let sourceDigest;
  try {
    sourceDigest = digest(entry);
  } catch (error) {
    blockers.push('SOURCE_RECORD_NOT_CANONICALLY_DIGESTIBLE');
  }

  const mappingErrors = validateMapping(mapping, domain, legacyId, sourceDigest);
  blockers.push(...mappingErrors);
  const uniqueBlockers = [...new Set(blockers)];
  const candidate = {
    schemaVersion: '1.0.0',
    domain,
    sourceFileDigest,
    sourceOrdinal,
    legacyId,
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
module.exports = { digest, buildMigrationCandidate, validateCandidateSet };
