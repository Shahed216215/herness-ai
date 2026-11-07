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
    const calendarParts = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})$/.exec(match[1]);
    if (!calendarParts) return null;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = calendarParts;
    const [year, month, day, hour, minute, second] =
      [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
    const calendar = new Date(0);
    calendar.setUTCFullYear(year, month - 1, day);
    calendar.setUTCHours(hour, minute, second, 0);
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 ||
        calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour ||
        calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) return null;
    if (match[3] !== 'Z') {
      const offset = /^([+-])([0-9]{2}):([0-9]{2})$/.exec(match[3]);
      if (!offset || Number(offset[2]) > 23 || Number(offset[3]) > 59) return null;
    }
    const wholeSecondMs = Date.parse(match[1] + match[3]);
    if (!Number.isFinite(wholeSecondMs)) return null;
    const fractionalNanos = BigInt(((match[2] || '') + '000000000').slice(0, 9));
    const valueNanos = BigInt(wholeSecondMs) * 1000000n + fractionalNanos;
    const nowNanos = BigInt(Math.trunc(nowMs)) * 1000000n;
    return valueNanos < nowNanos ? -1 : valueNanos > nowNanos ? 1 : 0;
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
