'use strict';

// Read-only validator for explicit, snapshot-bound domain-to-project mappings.
// It never creates mappings, authenticates approvers, or writes a registry.
const crypto = require('node:crypto');
const DOMAINS = new Set([
  'general_memory', 'knowledge', 'crm_conversation_message',
  'work_learning', 'work_knowledge', 'experience_memory'
]);
const CLASSIFICATIONS = new Set(['PUBLIC', 'PROJECT_PRIVATE', 'RESTRICTED']);
const STATUSES = new Set(['PENDING_REVIEW', 'APPROVED', 'REVOKED']);
const KEYS = [
  'schemaVersion', 'mappingId', 'domain', 'sourceSystem', 'sourceFileDigest',
  'sourceOrdinal', 'legacyId', 'memoryId', 'projectId', 'revision',
  'sourceDigest', 'canonicalRecordDigest', 'classification', 'status',
  'approvalReference', 'approvedBy', 'approvedAt', 'createdAt', 'mappingDigest'
];
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
function text(value, label, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(label + ' is required and must be bounded text.');
  }
}
function timestamp(value, label) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))) throw new Error(label + ' must be RFC 3339.');
}
function bodyOf(mapping) {
  const body = {};
  for (const key of KEYS) if (key !== 'mappingDigest') body[key] = mapping[key];
  return body;
}
function validateProjectMapping({
  mapping, expectedDomain, expectedProjectId, expectedSourceFileDigest,
  verifyApproval, now = new Date()
}) {
  if (!object(mapping) || Object.keys(mapping).length !== KEYS.length ||
      KEYS.some(key => !Object.prototype.hasOwnProperty.call(mapping, key))) {
    throw new Error('Mapping must contain the exact supported fields.');
  }
  if (mapping.schemaVersion !== '1.0.0') throw new Error('Unsupported mapping schemaVersion.');
  text(mapping.mappingId, 'mappingId');
  if (!DOMAINS.has(mapping.domain)) throw new Error('Unsupported mapping domain.');
  text(mapping.sourceSystem, 'sourceSystem');
  if (!/^[a-f0-9]{64}$/.test(mapping.sourceFileDigest || '') ||
      !/^[a-f0-9]{64}$/.test(mapping.sourceDigest || '') ||
      !/^[a-f0-9]{64}$/.test(mapping.canonicalRecordDigest || '')) {
    throw new Error('Mapping source and canonical digests must be SHA-256 hex values.');
  }
  if (!Number.isInteger(mapping.sourceOrdinal) || mapping.sourceOrdinal < 0) {
    throw new Error('Mapping sourceOrdinal must be a non-negative integer.');
  }
  for (const key of ['legacyId', 'memoryId', 'projectId']) text(mapping[key], key, 128);
  if (mapping.memoryId.length < 8) throw new Error('Canonical memoryId must contain at least 8 characters.');
  if (!Number.isInteger(mapping.revision) || mapping.revision !== 1) {
    throw new Error('Migration baseline revision must be exactly 1.');
  }
  if (!CLASSIFICATIONS.has(mapping.classification)) throw new Error('Mapping classification is invalid.');
  if (!STATUSES.has(mapping.status)) throw new Error('Mapping status is invalid.');
  text(mapping.approvalReference, 'approvalReference');
  text(mapping.approvedBy, 'approvedBy');
  timestamp(mapping.approvedAt, 'approvedAt');
  timestamp(mapping.createdAt, 'createdAt');
  if (!/^[a-f0-9]{64}$/.test(mapping.mappingDigest || '') ||
      mapping.mappingDigest !== digest(bodyOf(mapping))) {
    throw new Error('Mapping digest mismatch.');
  }
  if (expectedDomain && mapping.domain !== expectedDomain) throw new Error('Mapping domain mismatch.');
  if (expectedProjectId && mapping.projectId !== expectedProjectId) throw new Error('Mapping project scope mismatch.');
  if (expectedSourceFileDigest && mapping.sourceFileDigest !== expectedSourceFileDigest) {
    throw new Error('Mapping source snapshot mismatch.');
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('Current time is invalid.');
  if (Date.parse(mapping.approvedAt) > nowMs || Date.parse(mapping.createdAt) > nowMs) {
    throw new Error('Mapping approval/creation timestamp is in the future.');
  }
  if (mapping.status !== 'APPROVED') throw new Error('Mapping is not approved and cannot authorize adaptation.');
  if (typeof verifyApproval !== 'function') throw new Error('Trusted approval verifier is required.');
  const approval = verifyApproval(Object.freeze({
    mappingId: mapping.mappingId, domain: mapping.domain,
    projectId: mapping.projectId, legacyId: mapping.legacyId,
    memoryId: mapping.memoryId, approvalReference: mapping.approvalReference,
    approvedBy: mapping.approvedBy, approvedAt: mapping.approvedAt,
    mappingDigest: mapping.mappingDigest
  }));
  if (approval !== true) throw new Error('Mapping approval could not be independently verified.');
  return Object.freeze({ ...mapping });
}
function validateProjectMappings({ mappings, expectedDomain, expectedProjectId, expectedSourceFileDigest, verifyApproval, now }) {
  if (!Array.isArray(mappings)) throw new Error('Mappings must be an array.');
  const validated = mappings.map(mapping => validateProjectMapping({
    mapping, expectedDomain, expectedProjectId, expectedSourceFileDigest, verifyApproval, now
  }));
  const legacyKeys = new Set();
  const memoryIds = new Set();
  const mappingIds = new Set();
  for (const mapping of validated) {
    const legacyKey = mapping.domain + ':' + mapping.sourceFileDigest + ':' + mapping.legacyId;
    if (legacyKeys.has(legacyKey)) throw new Error('Duplicate legacy mapping rejected.');
    if (memoryIds.has(mapping.memoryId)) throw new Error('Duplicate canonical memoryId mapping rejected.');
    if (mappingIds.has(mapping.mappingId)) throw new Error('Duplicate mappingId rejected.');
    legacyKeys.add(legacyKey);
    memoryIds.add(mapping.memoryId);
    mappingIds.add(mapping.mappingId);
  }
  return Object.freeze(validated);
}
module.exports = { validateProjectMapping, validateProjectMappings, digest, bodyOf, DOMAINS };
