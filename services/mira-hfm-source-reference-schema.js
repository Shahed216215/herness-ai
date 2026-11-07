'use strict';

const crypto = require('node:crypto');

const SOURCE_REFERENCE_VERSION = '1.0.0';
const SOURCE_REFERENCE_POLICY = 'HFM-SOURCE-REFERENCE-1.0.0';
const SOURCE_REFERENCE_TYPES = Object.freeze([
  'web', 'facebook_page', 'facebook_group', 'manual', 'internal_system', 'legacy_import'
]);
const ACCESS_RESULTS = Object.freeze([
  'AVAILABLE', 'PARTIAL', 'UNAVAILABLE', 'AUTH_REQUIRED',
  'BLOCKED', 'HTTP_ERROR', 'USER_SUPPLIED', 'NOT_FETCHED'
]);
const RETRIEVAL_METHODS = Object.freeze([
  'public_web_search', 'public_http_fetch', 'user_supplied_url',
  'manual_import', 'internal_system'
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRfc3339(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== 'Z' &&
      (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function canonicalizeSourceReferenceUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    fail('HFM_SOURCE_REFERENCE_URL_INVALID');
  }
  let parsed;
  try { parsed = new URL(value.trim()); } catch (_error) {
    fail('HFM_SOURCE_REFERENCE_URL_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      !parsed.hostname || parsed.hostname.endsWith('.local') ||
      parsed.hostname === 'localhost' || parsed.hostname === 'localhost.' || parsed.hostname.endsWith('.localhost') ||
      /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(parsed.hostname) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(parsed.hostname) ||
      parsed.hostname.includes(':')) {
    fail('HFM_SOURCE_REFERENCE_URL_NOT_ALLOWED');
  }
  let decodedPath = parsed.pathname;
  try { decodedPath = decodeURIComponent(parsed.pathname); } catch (_error) {
    fail('HFM_SOURCE_REFERENCE_URL_INVALID');
  }
  if (/(?:^|[\\/._-])(?:access[_-]?token|auth(?:orization)?|session(?:id)?|api[_-]?key|client[_-]?secret|password|signature|credential|private[_-]?key)(?:[\\/._=-]|$)/i.test(decodedPath)) {
    fail('HFM_SOURCE_REFERENCE_URL_CONTAINS_SECRET_PATH');
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.search = '';
  parsed.hash = '';
  if (parsed.pathname.length > 1536) fail('HFM_SOURCE_REFERENCE_URL_TOO_LONG');
  return parsed.origin + parsed.pathname;
}

function validateSourceReferencePayload(payload) {
  const errors = [];
  if (!isPlainObject(payload)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['payload.object_required']) });
  }
  const required = [
    'referenceVersion', 'sourceType', 'sourceId', 'retrievedAt',
    'accessResult', 'retrievalMethod', 'provenanceActor',
    'provenanceEventId', 'policyVersion'
  ];
  const allowed = required.concat([
    'canonicalUrl', 'contentHash', 'contentType', 'contentLength',
    'retrievalTool', 'notes'
  ]);
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key)) errors.push('payload.unknown_property:' + key);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) errors.push('payload.' + key + '.required');
  }
  if (payload.referenceVersion !== SOURCE_REFERENCE_VERSION) errors.push('payload.referenceVersion.unsupported');
  if (!SOURCE_REFERENCE_TYPES.includes(payload.sourceType)) errors.push('payload.sourceType.invalid');
  if (typeof payload.sourceId !== 'string' || !/^src-[a-f0-9]{64}$/.test(payload.sourceId)) {
    errors.push('payload.sourceId.invalid');
  }
  if (!isRfc3339(payload.retrievedAt)) errors.push('payload.retrievedAt.invalid');
  if (!ACCESS_RESULTS.includes(payload.accessResult)) errors.push('payload.accessResult.invalid');
  if (!RETRIEVAL_METHODS.includes(payload.retrievalMethod)) errors.push('payload.retrievalMethod.invalid');
  if (typeof payload.provenanceActor !== 'string' ||
      !/^mira:[A-Za-z0-9._:-]{3,512}$/.test(payload.provenanceActor)) {
    errors.push('payload.provenanceActor.invalid');
  }
  if (typeof payload.provenanceEventId !== 'string' ||
      !/^evt-[a-f0-9]{64}$/.test(payload.provenanceEventId)) {
    errors.push('payload.provenanceEventId.invalid');
  }
  if (payload.policyVersion !== SOURCE_REFERENCE_POLICY) errors.push('payload.policyVersion.invalid');
  if (payload.canonicalUrl !== undefined) {
    try {
      if (canonicalizeSourceReferenceUrl(payload.canonicalUrl) !== payload.canonicalUrl) {
        errors.push('payload.canonicalUrl.not_canonical');
      }
    } catch (_error) {
      errors.push('payload.canonicalUrl.invalid');
    }
  }
  if (payload.contentHash !== undefined &&
      (typeof payload.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.contentHash))) {
    errors.push('payload.contentHash.invalid');
  }
  if (payload.contentType !== undefined &&
      (typeof payload.contentType !== 'string' ||
       !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(payload.contentType) ||
       payload.contentType.length > 128)) {
    errors.push('payload.contentType.invalid');
  }
  if (payload.contentLength !== undefined &&
      (!Number.isSafeInteger(payload.contentLength) || payload.contentLength < 0 ||
       payload.contentLength > 100 * 1024 * 1024)) {
    errors.push('payload.contentLength.invalid');
  }
  if (payload.retrievalTool !== undefined &&
      (typeof payload.retrievalTool !== 'string' ||
       !/^[A-Za-z0-9._:-]{1,128}$/.test(payload.retrievalTool))) {
    errors.push('payload.retrievalTool.invalid');
  }
  if (payload.notes !== undefined &&
      (typeof payload.notes !== 'string' || payload.notes.length > 512 ||
       /(?:bearer\s+[A-Za-z0-9._~+/-]{12,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/)/i.test(payload.notes))) {
    errors.push('payload.notes.invalid_or_sensitive');
  }
  if (payload.accessResult === 'NOT_FETCHED' &&
      payload.retrievalMethod !== 'user_supplied_url') {
    errors.push('payload.not_fetched_method_mismatch');
  }
  if (payload.retrievalMethod === 'user_supplied_url' &&
      !['NOT_FETCHED', 'USER_SUPPLIED'].includes(payload.accessResult)) {
    errors.push('payload.user_supplied_url_must_not_claim_fetch_result');
  }
  if (payload.accessResult === 'USER_SUPPLIED' &&
      payload.retrievalMethod !== 'user_supplied_url' &&
      payload.retrievalMethod !== 'manual_import') {
    errors.push('payload.user_supplied_method_mismatch');
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function buildUserSuppliedSourceReferencePayload(options = {}) {
  const canonicalUrl = canonicalizeSourceReferenceUrl(options.url);
  const sourceType = options.sourceType || 'web';
  if (!SOURCE_REFERENCE_TYPES.includes(sourceType)) fail('HFM_SOURCE_REFERENCE_TYPE_INVALID');
  const actor = options.provenanceActor;
  const eventId = options.provenanceEventId;
  const retrievedAt = options.retrievedAt || new Date().toISOString();
  const sourceId = 'src-' + crypto.createHash('sha256')
    .update(sourceType + '\u0000' + canonicalUrl, 'utf8').digest('hex');
  const payload = Object.freeze({
    referenceVersion: SOURCE_REFERENCE_VERSION,
    sourceType,
    canonicalUrl,
    sourceId,
    retrievedAt,
    accessResult: 'NOT_FETCHED',
    retrievalMethod: 'user_supplied_url',
    provenanceActor: actor,
    provenanceEventId: eventId,
    policyVersion: SOURCE_REFERENCE_POLICY
  });
  const validation = validateSourceReferencePayload(payload);
  if (!validation.valid) fail('HFM_SOURCE_REFERENCE_PAYLOAD_INVALID');
  return payload;
}

module.exports = Object.freeze({
  SOURCE_REFERENCE_VERSION,
  SOURCE_REFERENCE_POLICY,
  SOURCE_REFERENCE_TYPES,
  ACCESS_RESULTS,
  RETRIEVAL_METHODS,
  canonicalizeSourceReferenceUrl,
  validateSourceReferencePayload,
  buildUserSuppliedSourceReferencePayload
});
