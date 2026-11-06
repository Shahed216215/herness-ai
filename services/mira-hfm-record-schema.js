'use strict';

const crypto = require('node:crypto');

const SCHEMA_V1 = '1.0.0';
const SCHEMA_V1_1 = '1.1.0';
const LEGACY_RECORD_TYPES = Object.freeze([
  'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
  'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference'
]);
const EXTENDED_RECORD_TYPES = Object.freeze([
  'daily_activity', 'learning_note', 'knowledge_item', 'social_post_draft',
  'client_vault_record', 'financial_vault_record'
]);
const SOURCE_TYPES = Object.freeze([
  'facebook_page', 'facebook_group', 'web', 'manual', 'legacy_import',
  'internal_system', 'google_drive_backup'
]);
const INTEGRITY_STATES = Object.freeze([
  'UNVERIFIED', 'VERIFIED', 'FAILED', 'QUARANTINED'
]);
const TRUST_STATES = Object.freeze([
  'UNVERIFIED', 'SOURCE_RECORDED', 'SOURCE_REACHABLE',
  'CONTENT_VERIFIED', 'HUMAN_VERIFIED', 'QUARANTINED'
]);
const CLASSIFICATIONS = Object.freeze([
  'PUBLIC', 'PROJECT_PRIVATE', 'RESTRICTED'
]);
const LIFECYCLE_STATES = Object.freeze([
  'ACTIVE', 'SUPERSEDED', 'ARCHIVED', 'QUARANTINED', 'PENDING_REVIEW'
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(path + '.unknown_property:' + key);
  }
}

function boundedString(value, min, max) {
  return typeof value === 'string' &&
    value.length >= min &&
    value.length <= max &&
    value.trim() === value;
}

function isRfc3339(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function validateCanonicalRecord(record) {
  const errors = [];
  if (!isPlainObject(record)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['record.object_required']) });
  }

  const topKeys = [
    'schemaVersion', 'memoryId', 'projectId', 'recordType', 'content',
    'source', 'timestamps', 'version', 'integrity', 'trust', 'access', 'lifecycle'
  ];
  hasOnlyKeys(record, topKeys, 'record', errors);
  for (const key of topKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) errors.push('record.' + key + '.required');
  }

  const schemaVersion = record.schemaVersion;
  if (![SCHEMA_V1, SCHEMA_V1_1].includes(schemaVersion)) {
    errors.push('record.schemaVersion.unsupported');
  }

  if (!boundedString(record.memoryId, 8, 128)) errors.push('record.memoryId.invalid');
  if (!boundedString(record.projectId, 1, 128)) errors.push('record.projectId.invalid');

  const allowedRecordTypes = schemaVersion === SCHEMA_V1_1
    ? LEGACY_RECORD_TYPES.concat(EXTENDED_RECORD_TYPES)
    : LEGACY_RECORD_TYPES;
  if (typeof record.recordType !== 'string' || !allowedRecordTypes.includes(record.recordType)) {
    errors.push('record.recordType.unsupported_for_schema_version');
  }

  if (!boundedString(record.content, 1, 100000)) errors.push('record.content.invalid');

  if (!isPlainObject(record.source)) {
    errors.push('record.source.object_required');
  } else {
    hasOnlyKeys(record.source, ['sourceType', 'sourceId', 'sourceUrl', 'observedAt'], 'record.source', errors);
    if (!SOURCE_TYPES.includes(record.source.sourceType)) errors.push('record.source.sourceType.invalid');
    if (!boundedString(record.source.sourceId, 1, 1024)) errors.push('record.source.sourceId.invalid');
    if (!(record.source.sourceUrl === null ||
        boundedString(record.source.sourceUrl, 1, 2048))) {
      errors.push('record.source.sourceUrl.invalid');
    }
    if (!isRfc3339(record.source.observedAt)) errors.push('record.source.observedAt.invalid');
  }

  if (!isPlainObject(record.timestamps)) {
    errors.push('record.timestamps.object_required');
  } else {
    hasOnlyKeys(record.timestamps, ['createdAt', 'updatedAt'], 'record.timestamps', errors);
    if (!isRfc3339(record.timestamps.createdAt)) errors.push('record.timestamps.createdAt.invalid');
    if (!isRfc3339(record.timestamps.updatedAt)) errors.push('record.timestamps.updatedAt.invalid');
    if (isRfc3339(record.timestamps.createdAt) &&
        isRfc3339(record.timestamps.updatedAt) &&
        Date.parse(record.timestamps.updatedAt) < Date.parse(record.timestamps.createdAt)) {
      errors.push('record.timestamps.order_invalid');
    }
  }

  if (!isPlainObject(record.version)) {
    errors.push('record.version.object_required');
  } else {
    hasOnlyKeys(record.version, ['revision', 'contentHash'], 'record.version', errors);
    if (!Number.isSafeInteger(record.version.revision) || record.version.revision < 1) {
      errors.push('record.version.revision.invalid');
    }
    if (typeof record.version.contentHash !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(record.version.contentHash)) {
      errors.push('record.version.contentHash.invalid');
    }
  }

  if (!isPlainObject(record.integrity)) {
    errors.push('record.integrity.object_required');
  } else {
    hasOnlyKeys(record.integrity, ['status', 'algorithm'], 'record.integrity', errors);
    if (!INTEGRITY_STATES.includes(record.integrity.status)) errors.push('record.integrity.status.invalid');
    if (record.integrity.algorithm !== 'SHA-256') errors.push('record.integrity.algorithm.invalid');
  }

  if (!isPlainObject(record.trust)) {
    errors.push('record.trust.object_required');
  } else {
    hasOnlyKeys(record.trust, ['status'], 'record.trust', errors);
    if (!TRUST_STATES.includes(record.trust.status)) errors.push('record.trust.status.invalid');
  }

  if (!isPlainObject(record.access)) {
    errors.push('record.access.object_required');
  } else {
    hasOnlyKeys(record.access, ['classification', 'allowedProjectIds'], 'record.access', errors);
    if (!CLASSIFICATIONS.includes(record.access.classification)) {
      errors.push('record.access.classification.invalid');
    }
    if (record.access.allowedProjectIds !== undefined) {
      const ids = record.access.allowedProjectIds;
      if (!Array.isArray(ids) ||
          ids.some(id => !boundedString(id, 1, 128)) ||
          new Set(ids).size !== ids.length) {
        errors.push('record.access.allowedProjectIds.invalid');
      }
    }
  }

  if (!LIFECYCLE_STATES.includes(record.lifecycle)) errors.push('record.lifecycle.invalid');

  if (schemaVersion === SCHEMA_V1_1) {
    if (['client_vault_record', 'financial_vault_record'].includes(record.recordType) &&
        record.access?.classification !== 'RESTRICTED') {
      errors.push('record.vault_record.must_be_RESTRICTED');
    }
    if (record.recordType === 'social_post_draft' &&
        record.access?.classification !== 'PROJECT_PRIVATE') {
      errors.push('record.social_post_draft.must_be_PROJECT_PRIVATE');
    }
    if (['client_vault_record', 'financial_vault_record'].includes(record.recordType) &&
        typeof record.content === 'string') {
      try {
        const payload = JSON.parse(record.content);
        if (!isPlainObject(payload)) errors.push('record.vault_payload.object_required');
      } catch (_error) {
        errors.push('record.vault_payload.json_required');
      }
    }
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors)
  });
}

function createContentHash(content) {
  if (typeof content !== 'string') {
    throw new TypeError('HFM_CONTENT_STRING_REQUIRED');
  }
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

module.exports = Object.freeze({
  SCHEMA_V1,
  SCHEMA_V1_1,
  LEGACY_RECORD_TYPES,
  EXTENDED_RECORD_TYPES,
  SOURCE_TYPES,
  validateCanonicalRecord,
  createContentHash
});
