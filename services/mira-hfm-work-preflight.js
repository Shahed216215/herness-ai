'use strict';

// Validate a live, database-backed standing memory.read authority before
// Work planning/model activity. This helper deliberately has no fallback.
const { retrieveProjectMemory } = require('./mira-hfm-authorized-memory-reader');
const { compareTimestampToNow } = require('./mira-hfm-timestamp');
const { collectStandingReadPages, MAX_STANDING_READ_PAGES } = require('./mira-hfm-standing-read-pages');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
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

  if (!includeLearning) return result;

  // Work Learning must finish every bounded page authorization before the
  // planner invokes task understanding/model work. No cursor continuation is
  // deferred until after model activity.
  const pages = await collectStandingReadPages({
    readMemory,
    firstPage: result,
    readOptions: {
      pool,
      req,
      standingReadAuthority: true,
      recordTypes: ['learning_note', 'knowledge_item'],
      lifecycle: 'ACTIVE',
      env: options.env || process.env
    },
    maxPages: options.maxPages === undefined
      ? MAX_STANDING_READ_PAGES
      : options.maxPages,
    now
  });
  if (pages.candidateScanMayBeIncomplete) {
    fail('HFM_STANDING_READ_PREFLIGHT_SCAN_INCOMPLETE');
  }

  return Object.freeze({
    ...result,
    projectId: pages.projectId,
    records: pages.records,
    count: pages.records.length,
    nextCursor: null,
    scanStartedAt: pages.scanStartedAt,
    hostAuthorizationContext: pages.hostAuthorizationContext,
    pageCount: pages.pageCount,
    candidateScanCount: pages.candidateScanCount,
    candidateScanLimit: pages.candidateScanLimit,
    candidateScanMayBeIncomplete: false
  });
}

module.exports = Object.freeze({ preflightHfmStandingRead });
