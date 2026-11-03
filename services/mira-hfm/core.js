'use strict';

const crypto = require('node:crypto');

const RECORD_TYPES = new Set([
  'fact', 'decision', 'preference', 'procedure', 'lesson',
  'experience', 'strategy', 'project', 'conversation_reference',
  'knowledge', 'research_reference'
]);
const SOURCE_TYPES = new Set([
  'facebook_page', 'facebook_group', 'web', 'manual',
  'legacy_import', 'internal_system', 'google_drive_backup'
]);
const INTEGRITY_STATES = new Set(['UNVERIFIED', 'VERIFIED', 'FAILED', 'QUARANTINED']);
const TRUST_STATES = new Set([
  'UNVERIFIED', 'SOURCE_RECORDED', 'SOURCE_REACHABLE',
  'CONTENT_VERIFIED', 'HUMAN_VERIFIED', 'QUARANTINED'
]);
const ACCESS_CLASSES = new Set(['PUBLIC', 'PROJECT_PRIVATE', 'RESTRICTED']);
const LIFECYCLE_STATES = new Set([
  'ACTIVE', 'SUPERSEDED', 'ARCHIVED', 'QUARANTINED', 'PENDING_REVIEW'
]);
const CAPABILITIES = ['READ', 'WRITE', 'SEARCH', 'VERIFY', 'BACKUP', 'RESTORE'];
const CAPABILITY_STATES = new Set([
  'AVAILABLE', 'UNAVAILABLE', 'NOT_CONFIGURED',
  'PERMISSION_DENIED', 'RATE_LIMITED', 'UNKNOWN'
]);
const ROOT_KEYS = [
  'schemaVersion', 'memoryId', 'projectId', 'recordType', 'content',
  'source', 'timestamps', 'version', 'integrity', 'trust', 'access', 'lifecycle'
];

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasLoneSurrogate(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      i += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

/*
 * RFC 8785-compatible serialization for the supported I-JSON subset.
 * Unsupported JS values, non-finite numbers, unsafe integer values,
 * sparse arrays, cycles and invalid Unicode are rejected, never coerced.
 */
function canonicalize(value, stack) {
  const seen = stack || new Set();

  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (hasLoneSurrogate(value)) throw new TypeError('INVALID_UNICODE');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('NON_FINITE_NUMBER');
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError('UNSAFE_INTEGER');
    }
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError('UNSUPPORTED_JSON_VALUE');
  if (seen.has(value)) throw new TypeError('CIRCULAR_JSON_VALUE');
  seen.add(value);

  let result;
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length) throw new TypeError('SPARSE_OR_EXTENDED_ARRAY');
    for (let i = 0; i < value.length; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        throw new TypeError('SPARSE_ARRAY');
      }
    }
    result = '[' + value.map(item => canonicalize(item, seen)).join(',') + ']';
  } else {
    if (!isPlainObject(value)) throw new TypeError('NON_PLAIN_JSON_OBJECT');
    const keys = Object.keys(value);
    for (const key of keys) {
      if (hasLoneSurrogate(key)) throw new TypeError('INVALID_UNICODE_KEY');
      if (value[key] === undefined) throw new TypeError('UNDEFINED_OBJECT_VALUE');
    }
    keys.sort();
    result = '{' + keys.map(key =>
      JSON.stringify(key) + ':' + canonicalize(value[key], seen)
    ).join(',') + '}';
  }

  seen.delete(value);
  return result;
}

function sha256Canonical(value) {
  return crypto.createHash('sha256')
    .update(Buffer.from(canonicalize(value), 'utf8'))
    .digest('hex');
}

function exactKeys(value, allowed, required, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(label + '_MUST_BE_OBJECT');
    return false;
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(label + '_UNKNOWN_FIELD:' + key);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push(label + '_MISSING_FIELD:' + key);
    }
  }
  return true;
}

function boundedString(value, min, max, label, errors) {
  if (typeof value !== 'string' || value.length < min || value.length > max ||
      value.trim() !== value || hasLoneSurrogate(value)) {
    errors.push(label + '_INVALID');
    return false;
  }
  return true;
}

function validDateTime(value) {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) return false;
  return /T/.test(value) && /(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value);
}

function validateCanonicalRecord(record) {
  const errors = [];
  const rootAllowed = ROOT_KEYS;
  if (!exactKeys(record, rootAllowed, ROOT_KEYS, 'RECORD', errors)) {
    return { valid: false, errors };
  }

  if (record.schemaVersion !== '1.0.0') errors.push('SCHEMA_VERSION_UNSUPPORTED');
  boundedString(record.memoryId, 8, 128, 'MEMORY_ID', errors);
  boundedString(record.projectId, 1, 128, 'PROJECT_ID', errors);
  if (!RECORD_TYPES.has(record.recordType)) errors.push('RECORD_TYPE_INVALID');
  boundedString(record.content, 1, 100000, 'CONTENT', errors);
  if (!isPlainObject(record.source)) {
    errors.push('SOURCE_MUST_BE_OBJECT');
  } else {
    exactKeys(
      record.source,
      ['sourceType', 'sourceId', 'sourceUrl', 'observedAt'],
      ['sourceType', 'sourceId', 'observedAt'],
      'SOURCE',
      errors
    );
    if (!SOURCE_TYPES.has(record.source.sourceType)) errors.push('SOURCE_TYPE_INVALID');
    boundedString(record.source.sourceId, 1, 512, 'SOURCE_ID', errors);
    if (record.source.sourceUrl !== undefined && record.source.sourceUrl !== null) {
      boundedString(record.source.sourceUrl, 1, 2048, 'SOURCE_URL', errors);
    }
    if (!validDateTime(record.source.observedAt)) errors.push('SOURCE_OBSERVED_AT_INVALID');
  }

  if (!isPlainObject(record.timestamps)) {
    errors.push('TIMESTAMPS_MUST_BE_OBJECT');
  } else {
    exactKeys(record.timestamps, ['createdAt', 'updatedAt'],
      ['createdAt', 'updatedAt'], 'TIMESTAMPS', errors);
    if (!validDateTime(record.timestamps.createdAt)) errors.push('CREATED_AT_INVALID');
    if (!validDateTime(record.timestamps.updatedAt)) errors.push('UPDATED_AT_INVALID');
  }

  if (!isPlainObject(record.version)) {
    errors.push('VERSION_MUST_BE_OBJECT');
  } else {
    exactKeys(record.version, ['revision', 'contentHash'],
      ['revision', 'contentHash'], 'VERSION', errors);
    if (!Number.isSafeInteger(record.version.revision) || record.version.revision < 1) {
      errors.push('REVISION_INVALID');
    }
    if (typeof record.version.contentHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(record.version.contentHash)) {
      errors.push('CONTENT_HASH_INVALID');
    }
  }

  if (!isPlainObject(record.integrity)) {
    errors.push('INTEGRITY_MUST_BE_OBJECT');
  } else {
    exactKeys(record.integrity, ['status', 'algorithm'],
      ['status', 'algorithm'], 'INTEGRITY', errors);
    if (!INTEGRITY_STATES.has(record.integrity.status)) errors.push('INTEGRITY_STATUS_INVALID');
    if (record.integrity.algorithm !== 'SHA-256') errors.push('INTEGRITY_ALGORITHM_INVALID');
  }

  if (!isPlainObject(record.trust)) {
    errors.push('TRUST_MUST_BE_OBJECT');
  } else {
    exactKeys(record.trust, ['status'], ['status'], 'TRUST', errors);
    if (!TRUST_STATES.has(record.trust.status)) errors.push('TRUST_STATUS_INVALID');
  }

  if (!isPlainObject(record.access)) {
    errors.push('ACCESS_MUST_BE_OBJECT');
  } else {
    exactKeys(record.access, ['classification', 'allowedProjectIds'],
      ['classification'], 'ACCESS', errors);
    if (!ACCESS_CLASSES.has(record.access.classification)) errors.push('ACCESS_CLASS_INVALID');
    if (record.access.allowedProjectIds !== undefined) {
      if (!Array.isArray(record.access.allowedProjectIds) ||
          record.access.allowedProjectIds.some(id => typeof id !== 'string' || !id.trim()) ||
          new Set(record.access.allowedProjectIds).size !== record.access.allowedProjectIds.length) {
        errors.push('ACCESS_ALLOWLIST_INVALID');
      }
    }
  }

  if (!LIFECYCLE_STATES.has(record.lifecycle)) errors.push('LIFECYCLE_INVALID');

  if (errors.length === 0 && record.integrity.status === 'VERIFIED') {
    if (sha256Canonical(record.content) !== record.version.contentHash) {
      errors.push('VERIFIED_CONTENT_HASH_MISMATCH');
    }
  }
  return { valid: errors.length === 0, errors };
}

function createContentHash(content) {
  if (typeof content !== 'string') throw new TypeError('CONTENT_MUST_BE_STRING');
  return sha256Canonical(content);
}

function verifyContentHash(record) {
  if (!record || !record.version || typeof record.content !== 'string') {
    return { valid: false, reason: 'RECORD_CONTENT_HASH_FIELDS_MISSING' };
  }
  const actual = createContentHash(record.content);
  return {
    valid: actual === record.version.contentHash,
    expected: record.version.contentHash,
    actual,
    profile: 'MIRA-HFM-CONTENT-JCS-SHA256-1'
  };
}

function evaluateAccess(record, request) {
  const deny = reason => ({ allowed: false, reason });
  if (!record || !isPlainObject(request)) return deny('INVALID_INPUT');
  if (request.authenticated !== true) return deny('AUTHENTICATION_REQUIRED');
  if (typeof request.actor !== 'string' || !request.actor.trim()) return deny('ACTOR_REQUIRED');
  if (typeof request.projectId !== 'string' || !request.projectId.trim()) return deny('PROJECT_REQUIRED');
  if (request.actorAuthorized !== true) return deny('ACTOR_NOT_AUTHORIZED');
  if (request.actionAuthorized !== true) return deny('ACTION_NOT_AUTHORIZED');
  if (request.policyAllowed !== true) return deny('POLICY_DENIED');
  if (!ACCESS_CLASSES.has(record.access && record.access.classification)) {
    return deny('ACCESS_CLASS_INVALID');
  }
  const quarantined = record.trust && record.trust.status === 'QUARANTINED' ||
    record.integrity && ['FAILED', 'QUARANTINED'].includes(record.integrity.status) ||
    record.lifecycle === 'QUARANTINED';
  if (quarantined && (request.action !== 'review_quarantined' ||
      request.quarantineReviewAuthorized !== true || request.auditRecorded !== true)) {
    return deny('RECORD_QUARANTINED');
  }
  if (!quarantined && record.lifecycle !== 'ACTIVE' && request.action !== 'review_quarantined') {
    return deny('RECORD_NOT_ACTIVE');
  }

  const owner = request.projectId === record.projectId;
  if (record.access.classification === 'PROJECT_PRIVATE' && !owner) {
    return deny('PROJECT_SCOPE_DENIED');
  }
  if (record.access.classification === 'RESTRICTED' && !owner) {
    const allowlist = record.access.allowedProjectIds;
    if (!Array.isArray(allowlist) || !allowlist.includes(request.projectId)) {
      return deny('EXTERNAL_PROJECT_NOT_DELEGATED');
    }
    if (request.delegationAuthorized !== true) {
      return deny('DELEGATION_NOT_AUTHORIZED');
    }
  }
  if (request.action !== 'read' && request.action !== 'search' &&
      request.action !== 'list' && request.action !== 'export' &&
      request.action !== 'backup' && request.action !== 'restore' &&
      request.action !== 'write' && request.action !== 'update' &&
      request.action !== 'delete' && request.action !== 'resolve_conflict' &&
      request.action !== 'review_quarantined') {
    return deny('ACTION_UNSUPPORTED');
  }
  return { allowed: true, reason: 'AUTHORIZED_BY_CALLER_POLICY' };
}

const TRUST_TRANSITIONS = Object.freeze({
  UNVERIFIED: ['SOURCE_RECORDED', 'QUARANTINED'],
  SOURCE_RECORDED: ['SOURCE_REACHABLE', 'QUARANTINED'],
  SOURCE_REACHABLE: ['CONTENT_VERIFIED', 'QUARANTINED'],
  CONTENT_VERIFIED: ['HUMAN_VERIFIED', 'QUARANTINED'],
  HUMAN_VERIFIED: ['QUARANTINED'],
  QUARANTINED: ['UNVERIFIED']
});

function transitionTrust(current, next, evidence, controls) {
  const from = current && current.status;
  if (!TRUST_STATES.has(from) || !TRUST_STATES.has(next)) {
    return { ok: false, status: 'REJECTED', reason: 'TRUST_STATE_INVALID' };
  }
  if (!(TRUST_TRANSITIONS[from] || []).includes(next)) {
    return { ok: false, status: 'REJECTED', reason: 'TRUST_TRANSITION_NOT_ALLOWED' };
  }
  if (!isPlainObject(evidence) ||
      !['actor', 'timestamp', 'evidenceReference', 'policyVersion', 'policyDecisionId', 'reason']
        .every(key => typeof evidence[key] === 'string' && evidence[key].trim()) ||
      !Number.isSafeInteger(evidence.recordRevision) || evidence.recordRevision < 1 ||
      (Number.isSafeInteger(current.revision) && evidence.recordRevision !== current.revision)) {
    return { ok: false, status: 'REJECTED', reason: 'TRUST_EVIDENCE_INCOMPLETE' };
  }
  if (!validDateTime(evidence.timestamp)) {
    return { ok: false, status: 'REJECTED', reason: 'TRUST_TIMESTAMP_INVALID' };
  }
  if (from === 'QUARANTINED' &&
      (!controls || controls.quarantineReleaseAuthorized !== true ||
       controls.auditRecorded !== true)) {
    return { ok: false, status: 'REJECTED', reason: 'QUARANTINE_RELEASE_NOT_AUTHORIZED' };
  }
  return {
    ok: true,
    status: 'ACCEPTED',
    transition: { from, to: next, evidence: Object.assign({}, evidence) }
  };
}

function invalidateTrustAfterMutation(trust) {
  if (!trust || !TRUST_STATES.has(trust.status)) {
    return { status: 'UNVERIFIED', invalidated: true, reason: 'UNKNOWN_PRIOR_TRUST' };
  }
  return {
    status: 'UNVERIFIED',
    invalidated: true,
    previousStatus: trust.status,
    reason: 'CONTENT_OR_SOURCE_MUTATION_REQUIRES_REVERIFICATION'
  };
}

function capabilityState(capabilities, name) {
  if (!isPlainObject(capabilities) || !CAPABILITIES.includes(name)) return 'UNKNOWN';
  const value = capabilities[name];
  return CAPABILITY_STATES.has(value) ? value : 'UNKNOWN';
}

function isCapabilityAvailable(capabilities, name) {
  return capabilityState(capabilities, name) === 'AVAILABLE';
}

function validateOperationIdentity(input) {
  const errors = [];
  if (!isPlainObject(input)) return { valid: false, errors: ['OPERATION_MUST_BE_OBJECT'] };
  for (const key of ['projectId', 'operationId', 'idempotencyKey', 'actor', 'purpose', 'policyDecisionId', 'requestId']) {
    if (typeof input[key] !== 'string' || !input[key].trim()) errors.push('OPERATION_FIELD_INVALID:' + key);
  }
  if (typeof input.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.payloadHash)) {
    errors.push('OPERATION_PAYLOAD_HASH_INVALID');
  }
  return { valid: errors.length === 0, errors };
}

function classifyIdempotency(existing, incoming) {
  if (!existing) return 'NEW';
  if (!incoming || existing.projectId !== incoming.projectId ||
      existing.operationId !== incoming.operationId ||
      existing.idempotencyKey !== incoming.idempotencyKey) return 'IDENTITY_CONFLICT';
  if (existing.payloadHash !== incoming.payloadHash) return 'PAYLOAD_CONFLICT';
  if (existing.status === 'COMMITTED' || existing.status === 'COMPLETED') return 'REPLAY_COMMITTED';
  if (existing.status === 'IN_PROGRESS' || existing.status === 'EXECUTING') return 'IN_PROGRESS';
  if (existing.status === 'UNKNOWN' || existing.status === 'RECOVERY_REQUIRED') return 'UNKNOWN';
  return 'REVIEW_REQUIRED';
}

function normalizeAdapterError(error) {
  const code = error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
  const allowed = new Set([
    'NOT_CONFIGURED', 'PERMISSION_DENIED', 'RATE_LIMITED', 'CONFLICT',
    'VALIDATION_FAILED', 'INTEGRITY_FAILED', 'TIMEOUT', 'PROVIDER_ERROR',
    'NOT_FOUND', 'NOT_SUPPORTED', 'UNKNOWN'
  ]);
  return allowed.has(code) ? code : 'UNKNOWN';
}

module.exports = {
  RECORD_TYPES, SOURCE_TYPES, TRUST_STATES, ACCESS_CLASSES,
  CAPABILITIES, CAPABILITY_STATES, canonicalize, sha256Canonical,
  createContentHash, validateCanonicalRecord, verifyContentHash,
  evaluateAccess, TRUST_TRANSITIONS, transitionTrust,
  invalidateTrustAfterMutation, capabilityState, isCapabilityAvailable,
  validateOperationIdentity, classifyIdempotency, normalizeAdapterError
};
