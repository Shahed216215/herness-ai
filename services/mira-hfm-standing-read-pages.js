'use strict';

// Bounded, audited keyset pagination for the standing memory.read authority.
// Every page is a separate committed/audited read transaction. The cursor is
// generated and scope-bound by the repository; this helper never decodes it.
const MAX_STANDING_READ_PAGES = 20;
const PAGE_SIZE = 100;
const ALLOWED_TYPES = new Set(['learning_note', 'knowledge_item']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function timestampCompareToNow(value, nowMs) {
  if (typeof value !== 'string') return null;
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{1,6}))?Z$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1] ||
      hour > 23 || minute > 59 || second > 59) return null;
  const fraction = (match[7] || '').padEnd(6, '0');
  const normalized = match[1] + '-' + match[2] + '-' + match[3] + 'T' +
    match[4] + ':' + match[5] + ':' + match[6] + '.' + fraction + 'Z';
  const nowIso = new Date(nowMs).toISOString().slice(0, 23) + '000Z';
  return normalized < nowIso ? -1 : normalized > nowIso ? 1 : 0;
}

function validatePage(page, expected = null, now = new Date()) {
  if (!page || page.status !== 'AUTHORIZED_AND_COMMITTED' ||
      page.standingAuthority !== true ||
      page.authorityConsumed !== false ||
      page.approvalRequiredPerRead !== false ||
      page.memoryWrites !== false ||
      page.localFallback !== false ||
      page.driveFallback !== false ||
      !Array.isArray(page.records) ||
      !page.hostAuthorizationContext) {
    fail('HFM_STANDING_READ_PAGE_AUTHORIZATION_REQUIRED');
  }
  const context = page.hostAuthorizationContext;
  const nowMs = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : NaN;
  if (!Number.isFinite(nowMs)) fail('HFM_STANDING_READ_PAGE_CONTEXT_INVALID');
  if (typeof page.projectId !== 'string' || !page.projectId ||
      context.projectId !== page.projectId ||
      page.standingAuthorityId !== context.authorityRef ||
      page.authorityExpiresAt !== context.expiresAt ||
      typeof context.actorId !== 'string' || !context.actorId.startsWith('mira:') ||
      context.actorType !== 'HUMAN' ||
      typeof context.authorityRef !== 'string' || !context.authorityRef ||
      typeof context.requestId !== 'string' || !context.requestId ||
      typeof context.purpose !== 'string' || !context.purpose ||
      timestampCompareToNow(context.issuedAt, nowMs) === null ||
      timestampCompareToNow(context.issuedAt, nowMs) > 0 ||
      timestampCompareToNow(context.expiresAt, nowMs) === null ||
      timestampCompareToNow(context.expiresAt, nowMs) <= 0 ||
      timestampCompareToNow(page.scanStartedAt, nowMs) === null ||
      timestampCompareToNow(page.scanStartedAt, nowMs) > 0) {
    fail('HFM_STANDING_READ_PAGE_CONTEXT_INVALID');
  }
  const count = page.count === undefined ? page.records.length : page.count;
  if (!Number.isInteger(count) || count !== page.records.length ||
      count < 0 || count > PAGE_SIZE) {
    fail('HFM_STANDING_READ_PAGE_COUNT_INVALID');
  }
  if (expected && (
    context.actorId !== expected.actorId ||
    context.projectId !== expected.projectId ||
    context.authorityRef !== expected.authorityRef ||
    context.purpose !== expected.purpose ||
    context.issuedAt !== expected.issuedAt ||
    context.expiresAt !== expected.expiresAt ||
    page.scanStartedAt !== expected.scanStartedAt
  )) {
    fail('HFM_STANDING_READ_PAGE_CONTEXT_CHANGED');
  }
  for (const record of page.records) {
    if (!record || typeof record.memoryId !== 'string' || !record.memoryId ||
        record.projectId !== page.projectId ||
        !ALLOWED_TYPES.has(record.recordType) || record.lifecycle !== 'ACTIVE') {
      fail('HFM_STANDING_READ_PAGE_RECORD_SCOPE_INVALID');
    }
  }
  if (page.nextCursor !== undefined && page.nextCursor !== null &&
      (typeof page.nextCursor !== 'string' || !page.nextCursor || page.nextCursor.length > 2048)) {
    fail('HFM_STANDING_READ_PAGE_CURSOR_INVALID');
  }
  return { context, count, nextCursor: page.nextCursor || null };
}

async function collectStandingReadPages({
  readMemory, readOptions = {}, firstPage, maxPages = MAX_STANDING_READ_PAGES, now = new Date()
} = {}) {
  if (typeof readMemory !== 'function') fail('HFM_STANDING_READ_PAGE_READER_REQUIRED');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_STANDING_READ_PAGES) {
    fail('HFM_STANDING_READ_PAGE_LIMIT_INVALID');
  }
  let page = firstPage || await readMemory({ ...readOptions, limit: PAGE_SIZE });
  let cursor = readOptions.cursor || null;
  const records = [];
  const seenIds = new Set();
  const seenCursors = new Set(readOptions.cursor ? [readOptions.cursor] : []);
  const seenRequestIds = new Set();
  let expected = null;
  let firstContext = null;
  let pageCount = 0;
  let candidateScanCount = 0;

  while (page) {
    const validated = validatePage(page, expected, now);
    if (seenRequestIds.has(validated.context.requestId)) {
      fail('HFM_STANDING_READ_PAGE_AUDIT_REQUEST_REPLAY');
    }
    seenRequestIds.add(validated.context.requestId);
    if (!expected) {
      firstContext = validated.context;
      expected = {
        actorId: validated.context.actorId,
        projectId: validated.context.projectId,
        authorityRef: validated.context.authorityRef,
        purpose: validated.context.purpose,
        issuedAt: validated.context.issuedAt,
        expiresAt: validated.context.expiresAt,
        scanStartedAt: page.scanStartedAt
      };
    }
    for (const record of page.records) {
      if (seenIds.has(record.memoryId)) fail('HFM_STANDING_READ_PAGE_DUPLICATE_RECORD');
      seenIds.add(record.memoryId);
      records.push(record);
    }
    pageCount += 1;
    candidateScanCount += validated.count;
    cursor = validated.nextCursor;
    if (!cursor) break;
    if (seenCursors.has(cursor)) fail('HFM_STANDING_READ_PAGE_CURSOR_REPLAY');
    seenCursors.add(cursor);
    if (pageCount >= maxPages) break;
    page = await readMemory({ ...readOptions, limit: PAGE_SIZE, cursor });
  }

  return Object.freeze({
    projectId: expected.projectId,
    hostAuthorizationContext: firstContext,
    records: Object.freeze(records),
    pageCount,
    candidateScanCount,
    candidateScanLimit: PAGE_SIZE * maxPages,
    scanStartedAt: expected.scanStartedAt,
    nextCursor: cursor,
    candidateScanMayBeIncomplete: cursor !== null
  });
}

module.exports = Object.freeze({
  MAX_STANDING_READ_PAGES,
  PAGE_SIZE,
  collectStandingReadPages
});
