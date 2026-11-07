'use strict';

// Validate a live, database-backed standing memory.read authority before
// Work planning/model activity. This helper deliberately has no fallback.
const { retrieveProjectMemory } = require('./mira-hfm-authorized-memory-reader');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function compareTimestampToNow(value, nowMs) {
  if (typeof value !== 'string' || !Number.isFinite(nowMs)) return null;
  const match = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:[.]([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})$/.exec(value);
  if (match) {
    const wholeSecondMs = Date.parse(match[1] + match[3]);
    if (!Number.isFinite(wholeSecondMs)) return null;
    const fractionalMicros = Number(((match[2] || '') + '000000').slice(0, 6));
    const valueMicros = wholeSecondMs * 1000 + fractionalMicros;
    const nowMicros = Math.trunc(nowMs) * 1000;
    return valueMicros < nowMicros ? -1 : valueMicros > nowMicros ? 1 : 0;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed < nowMs ? -1 : parsed > nowMs ? 1 : 0;
}

async function preflightHfmStandingRead(options = {}) {
  const pool = options.pool;
  const req = options.req;
  if (!pool || typeof pool.connect !== 'function' || !req) {
    fail('HFM_STANDING_READ_PREFLIGHT_RUNTIME_REQUIRED');
  }

  const includeLearning = options.includeLearning === true;
  const readMemory = options.readMemory || retrieveProjectMemory;
  if (typeof readMemory !== 'function') {
    fail('HFM_STANDING_READ_PREFLIGHT_READER_INVALID');
  }

  const result = await readMemory({
    pool,
    req,
    standingReadAuthority: true,
    recordTypes: ['learning_note', 'knowledge_item'],
    lifecycle: 'ACTIVE',
    limit: includeLearning ? 100 : 1,
    env: options.env || process.env
  });

  const context = result && result.hostAuthorizationContext;
  const now = options.now instanceof Date && Number.isFinite(options.now.getTime())
    ? options.now
    : new Date();
  const eligibleRecords = result && Array.isArray(result.records) &&
    result.records.every(record =>
      record && typeof record.memoryId === 'string' && record.memoryId &&
      record.projectId === result.projectId &&
      ['learning_note', 'knowledge_item'].includes(record.recordType) &&
      record.lifecycle === 'ACTIVE'
    );
  const validContext = context &&
    context.projectId === result.projectId &&
    context.actorType === 'HUMAN' &&
    typeof context.actorId === 'string' && context.actorId.startsWith('mira:') &&
    typeof context.authorityRef === 'string' && context.authorityRef &&
    typeof context.requestId === 'string' && context.requestId &&
    typeof context.purpose === 'string' && context.purpose &&
    compareTimestampToNow(context.issuedAt, now.getTime()) !== null &&
    compareTimestampToNow(context.issuedAt, now.getTime()) <= 0 &&
    compareTimestampToNow(context.expiresAt, now.getTime()) === 1 &&
    typeof result.projectId === 'string' && result.projectId.length > 0 &&
    result.standingAuthorityId === context.authorityRef &&
    result.authorityExpiresAt === context.expiresAt &&
    compareTimestampToNow(result.scanStartedAt, now.getTime()) !== null &&
    compareTimestampToNow(result.scanStartedAt, now.getTime()) <= 0 &&
    Number.isInteger(result.count) && result.count === result.records.length &&
    result.records.length <= (includeLearning ? 100 : 1) &&
    (result.nextCursor === undefined || result.nextCursor === null ||
      (typeof result.nextCursor === 'string' && result.nextCursor.length > 0 && result.nextCursor.length <= 2048));

  if (!result || result.status !== 'AUTHORIZED_AND_COMMITTED' ||
      result.standingAuthority !== true ||
      result.authorityConsumed !== false ||
      result.approvalRequiredPerRead !== false ||
      result.memoryWrites !== false ||
      result.localFallback !== false ||
      result.driveFallback !== false ||
      !eligibleRecords ||
      !validContext) {
    fail('HFM_STANDING_READ_PREFLIGHT_AUTHORIZATION_REQUIRED');
  }

  return result;
}

module.exports = Object.freeze({ preflightHfmStandingRead });
