'use strict';

// Read-only structural conflict assessment against the v0.2.4 canonical
// Memory record contract. This module never writes, merges, resolves,
// quarantines, or claims cryptographic verification.
const HASH_RE = /^[a-f0-9]{64}$/;
const SOURCE_TYPES = new Set([
  'facebook_page', 'facebook_group', 'web', 'manual',
  'legacy_import', 'internal_system', 'google_drive_backup'
]);
const RECORD_TYPES = new Set([
  'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
  'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference'
]);
const INTEGRITY = new Set(['UNVERIFIED', 'VERIFIED', 'FAILED', 'QUARANTINED']);
const TRUST = new Set([
  'UNVERIFIED', 'SOURCE_RECORDED', 'SOURCE_REACHABLE',
  'CONTENT_VERIFIED', 'HUMAN_VERIFIED', 'QUARANTINED'
]);
const ACCESS = new Set(['PUBLIC', 'PROJECT_PRIVATE', 'RESTRICTED']);
const LIFECYCLE = new Set(['ACTIVE', 'SUPERSEDED', 'ARCHIVED', 'QUARANTINED', 'PENDING_REVIEW']);
const ROOT_KEYS = [
  'schemaVersion', 'memoryId', 'projectId', 'recordType', 'content',
  'source', 'timestamps', 'version', 'integrity', 'trust', 'access', 'lifecycle'
];

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value, allowed) {
  return object(value) && Object.keys(value).every(key => allowed.includes(key));
}
function validDate(value) {
  if (typeof value !== 'string') return false;
  // Match the contract's RFC 3339 date-time shape. Date.parse alone is
  // permissive (for example, it accepts date-only strings).
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 60) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > monthDays[month - 1]) return false;
  if (zone !== 'Z' && zone !== 'z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return true;
}
function validateCanonicalMemoryRecord(record, label = 'record') {
  const errors = [];
  if (!object(record)) return [label + ' must be an object'];
  for (const key of ROOT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) errors.push(label + '.' + key + ' is required');
  }
  if (!exactKeys(record, ROOT_KEYS)) errors.push(label + ' contains unsupported top-level fields');
  if (record.schemaVersion !== '1.0.0') errors.push(label + '.schemaVersion must be 1.0.0');
  if (typeof record.memoryId !== 'string' || record.memoryId.length < 8 || record.memoryId.length > 128) errors.push(label + '.memoryId must contain 8-128 characters');
  if (typeof record.projectId !== 'string' || !record.projectId || record.projectId.length > 128) errors.push(label + '.projectId is invalid');
  if (!RECORD_TYPES.has(record.recordType)) errors.push(label + '.recordType is unsupported');
  if (typeof record.content !== 'string' || !record.content.length || record.content.length > 100000) errors.push(label + '.content must contain 1-100000 characters');

  if (!exactKeys(record.source, ['sourceType', 'sourceId', 'sourceUrl', 'observedAt']) ||
      !SOURCE_TYPES.has(record.source.sourceType) ||
      typeof record.source.sourceId !== 'string' || !record.source.sourceId ||
      !(record.source.sourceUrl === undefined || record.source.sourceUrl === null || typeof record.source.sourceUrl === 'string') ||
      !validDate(record.source.observedAt)) errors.push(label + '.source violates canonical provenance schema');

  if (!exactKeys(record.timestamps, ['createdAt', 'updatedAt']) ||
      !validDate(record.timestamps.createdAt) || !validDate(record.timestamps.updatedAt)) {
    errors.push(label + '.timestamps violates canonical timestamp shape');
  }
  if (!exactKeys(record.version, ['revision', 'contentHash']) ||
      !Number.isInteger(record.version.revision) || record.version.revision < 1 ||
      typeof record.version.contentHash !== 'string' || !HASH_RE.test(record.version.contentHash)) {
    errors.push(label + '.version violates canonical revision/hash shape');
  }
  if (!exactKeys(record.integrity, ['status', 'algorithm']) ||
      !INTEGRITY.has(record.integrity.status) || record.integrity.algorithm !== 'SHA-256') {
    errors.push(label + '.integrity violates canonical schema');
  }
  if (!exactKeys(record.trust, ['status']) || !TRUST.has(record.trust.status)) errors.push(label + '.trust violates canonical schema');
  if (!exactKeys(record.access, ['classification', 'allowedProjectIds']) ||
      !ACCESS.has(record.access.classification) ||
      !(record.access.allowedProjectIds === undefined ||
        (Array.isArray(record.access.allowedProjectIds) &&
         record.access.allowedProjectIds.every(id => typeof id === 'string') &&
         new Set(record.access.allowedProjectIds).size === record.access.allowedProjectIds.length))) {
    errors.push(label + '.access violates canonical schema');
  }
  if (!LIFECYCLE.has(record.lifecycle)) errors.push(label + '.lifecycle is unsupported');
  return errors;
}
function sameSet(a = [], b = []) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}
function sameSource(a, b) {
  return a.sourceType === b.sourceType && a.sourceId === b.sourceId &&
    (a.sourceUrl ?? null) === (b.sourceUrl ?? null);
}
function assessMemoryConflict(existing, incoming) {
  const validationErrors = [
    ...validateCanonicalMemoryRecord(existing, 'existing'),
    ...validateCanonicalMemoryRecord(incoming, 'incoming')
  ];
  if (validationErrors.length) {
    return { status: 'REVIEW_REQUIRED', conflictTypes: [], validationErrors, cryptographicVerification: 'NOT_PERFORMED' };
  }
  const conflicts = [];
  if (existing.memoryId !== incoming.memoryId) conflicts.push('IDENTITY_CONFLICT');
  if (existing.schemaVersion !== incoming.schemaVersion || existing.recordType !== incoming.recordType) conflicts.push('SCHEMA_CONFLICT');
  if (existing.version.revision !== incoming.version.revision) conflicts.push('REVISION_CONFLICT');
  if (existing.version.revision === incoming.version.revision &&
      (existing.content !== incoming.content || existing.version.contentHash !== incoming.version.contentHash)) {
    conflicts.push('CONTENT_CONFLICT');
  }
  if (!sameSource(existing.source, incoming.source)) conflicts.push('SOURCE_CONFLICT');
  if (existing.projectId !== incoming.projectId ||
      existing.access.classification !== incoming.access.classification ||
      !sameSet(existing.access.allowedProjectIds || [], incoming.access.allowedProjectIds || [])) {
    conflicts.push('ACCESS_CONFLICT');
  }
  if (['FAILED', 'QUARANTINED'].includes(existing.integrity.status) ||
      ['FAILED', 'QUARANTINED'].includes(incoming.integrity.status)) conflicts.push('INTEGRITY_CONFLICT');

  const conflictTypes = [...new Set(conflicts)];
  if (conflictTypes.length) {
    return { status: 'CONFLICT', conflictTypes, validationErrors: [], cryptographicVerification: 'NOT_PERFORMED' };
  }
  if (existing.integrity.status !== 'VERIFIED' || incoming.integrity.status !== 'VERIFIED') {
    return {
      status: 'REVIEW_REQUIRED', conflictTypes: [],
      validationErrors: ['Both records must declare VERIFIED integrity before a no-conflict structural assessment.'],
      cryptographicVerification: 'NOT_PERFORMED'
    };
  }
  return { status: 'NO_CONFLICT_DETECTED', conflictTypes: [], validationErrors: [], cryptographicVerification: 'NOT_PERFORMED' };
}
module.exports = { validateCanonicalMemoryRecord, assessMemoryConflict };
