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
  'ACTIVE', 'SUPERSEDED', 'ARCHIVED', 'TRASHED', 'QUARANTINED', 'PENDING_REVIEW'
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

function stringLength(value, min, max = Infinity) {
  return typeof value === 'string' &&
    value.length >= min &&
    value.length <= max;
}

function isRfc3339(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== 'Z' &&
      (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

function validateCanonicalRecord(record) {
  const errors = [];
  if (!isPlainObject(record)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['record.object_required']) });
  }

  const topKeys = [
    'schemaVersion', 'memoryId', 'projectId', 'recordType', 'content',
    'source', 'provenance', 'timestamps', 'version', 'integrity', 'trust', 'access', 'lifecycle'
  ];
  hasOnlyKeys(record, topKeys, 'record', errors);
  for (const key of topKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) errors.push('record.' + key + '.required');
  }

  const schemaVersion = record.schemaVersion;
  if (![SCHEMA_V1, SCHEMA_V1_1].includes(schemaVersion)) {
    errors.push('record.schemaVersion.unsupported');
  }

  if (!stringLength(record.memoryId, 8, 128)) errors.push('record.memoryId.invalid');
  if (!stringLength(record.projectId, 1, 128)) errors.push('record.projectId.invalid');

  const allowedRecordTypes = schemaVersion === SCHEMA_V1_1
    ? LEGACY_RECORD_TYPES.concat(EXTENDED_RECORD_TYPES)
    : LEGACY_RECORD_TYPES;
  if (typeof record.recordType !== 'string' || !allowedRecordTypes.includes(record.recordType)) {
    errors.push('record.recordType.unsupported_for_schema_version');
  }

  if (!stringLength(record.content, 1, 100000)) errors.push('record.content.invalid');

  if (!isPlainObject(record.source)) {
    errors.push('record.source.object_required');
  } else {
    hasOnlyKeys(record.source, ['sourceType', 'sourceId', 'sourceUrl', 'observedAt'], 'record.source', errors);
    if (!SOURCE_TYPES.includes(record.source.sourceType)) errors.push('record.source.sourceType.invalid');
    if (!stringLength(record.source.sourceId, 1)) errors.push('record.source.sourceId.invalid');
    if (!(record.source.sourceUrl === undefined ||
        record.source.sourceUrl === null ||
        typeof record.source.sourceUrl === 'string')) {
      errors.push('record.source.sourceUrl.invalid');
    }
    if (!isRfc3339(record.source.observedAt)) errors.push('record.source.observedAt.invalid');
  }

  if (record.provenance !== undefined) {
    if (!isPlainObject(record.provenance)) {
      errors.push('record.provenance.object_required');
    } else {
      hasOnlyKeys(record.provenance, [
        'collectionMethod', 'capturedAt', 'originalPublishedAt',
        'verificationStatus', 'redactionApplied'
      ], 'record.provenance', errors);
      if (!['manual_copy', 'user_file_import', 'public_url_preview', 'web_search'].includes(record.provenance.collectionMethod)) {
        errors.push('record.provenance.collectionMethod.invalid');
      }
      if (!isRfc3339(record.provenance.capturedAt)) errors.push('record.provenance.capturedAt.invalid');
      if (!(record.provenance.originalPublishedAt === null ||
          record.provenance.originalPublishedAt === undefined ||
          isRfc3339(record.provenance.originalPublishedAt))) {
        errors.push('record.provenance.originalPublishedAt.invalid');
      }
      if (!['SOURCE_RECORDED', 'SOURCE_REACHABLE', 'CONTENT_VERIFIED', 'HUMAN_VERIFIED'].includes(record.provenance.verificationStatus)) {
        errors.push('record.provenance.verificationStatus.invalid');
      }
      if (typeof record.provenance.redactionApplied !== 'boolean') {
        errors.push('record.provenance.redactionApplied.invalid');
      }
    }
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
    if (!Number.isInteger(record.version.revision) || record.version.revision < 1) {
      errors.push('record.version.revision.invalid');
    }
    if (typeof record.version.contentHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(record.version.contentHash)) {
      errors.push('record.version.contentHash.invalid');
    } else if (typeof record.content === 'string') {
      try {
        if (record.version.contentHash !== createContentHash(record.content)) {
          errors.push('record.version.contentHash.mismatch');
        }
      } catch (_error) {
        errors.push('record.version.contentHash.content_invalid');
      }
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
          ids.some(id => typeof id !== 'string') ||
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
    if (['daily_activity', 'learning_note', 'social_post_draft'].includes(record.recordType) &&
        record.access?.classification !== 'PROJECT_PRIVATE') {
      errors.push('record.private_activity_learning_draft.must_be_PROJECT_PRIVATE');
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
  if (!isWellFormedUnicode(content)) {
    throw new TypeError('HFM_CONTENT_UNICODE_INVALID');
  }
  // RFC 8785 JCS serialization of a JSON string is its JSON string literal.
  // The hash covers UTF-8(JCS(content)), not the unquoted raw string bytes.
  const canonical = JSON.stringify(content);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
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
