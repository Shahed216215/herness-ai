'use strict';

const { retrieveProjectMemory, retrieveProjectMemoryRecord } = require('./mira-hfm-authorized-memory-reader');
const { collectStandingReadPages, MAX_STANDING_READ_PAGES } = require('./mira-hfm-standing-read-pages');
const { retrieveCanonicalRecordsWithReport } = require('./mira-memory-unified-facade');
const { buildHfmAuthorizeRequest } = require('./mira-hfm-work-learning-runtime');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function queryTerms(value) {
  return new Set(String(value || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}_-]{1,}/gu) || []);
}
function extractKnowledgeTitle(record) {
  const content = typeof record?.content === 'string' ? record.content.trim() : '';
  if (content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      const candidate = parsed.title || parsed.record?.title || parsed.task?.title;
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 300);
    } catch (_error) {
      // Fall through to the first content line for non-JSON records.
    }
  }
  const firstLine = content.split(/\r?\n/, 1)[0].trim();
  const sourceId = typeof record?.source?.sourceId === 'string' ? record.source.sourceId : 'Untitled memory';
  return (firstLine || sourceId).slice(0, 300);
}

function scoreRecord(query, record) {
  const tokens = queryTerms(query);
  if (!tokens.size) return 0;
  const searchable = [record.memoryId, record.content, record.source?.sourceId, record.source?.sourceUrl]
    .filter(value => typeof value === 'string').join(' ').toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (searchable.includes(token)) score += 1;
  }
  return score / tokens.size;
}

function mapKnowledgeRecord(record, score) {
  return {
    id: record.memoryId,
    title: extractKnowledgeTitle(record),
    topic: '',
    category: record.recordType === 'learning_note' ? 'Learning' : 'Knowledge',
    type: record.recordType === 'learning_note' ? 'learning' : 'knowledge',
    url: typeof record.source.sourceUrl === 'string' ? record.source.sourceUrl.slice(0, 1000) : '',
    source: (record.source.sourceUrl || record.source.sourceId).slice(0, 1000),
    content: record.content.slice(0, 20000),
    savedAt: record.timestamps.createdAt,
    score,
    projectId: record.projectId,
    revision: record.version.revision,
    trust: record.trust.status,
    integrity: record.integrity.status
  };
}

async function getHfmKnowledgeById({
  req, pool, memoryId, env = process.env, now = new Date(),
  readRecord = retrieveProjectMemoryRecord
} = {}) {
  if (typeof memoryId !== 'string' || !memoryId.trim() || memoryId.length > 128) {
    fail('HFM_KNOWLEDGE_ID_INVALID');
  }
  if (env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED !== 'true') {
    fail('HFM_KNOWLEDGE_STANDING_READ_AUTHORITY_DISABLED');
  }
  if (typeof readRecord !== 'function') fail('HFM_KNOWLEDGE_READ_RUNTIME_INVALID');

  const result = await readRecord({
    req, pool, memoryId: memoryId.trim(),
    standingReadAuthority: true,
    recordTypes: ['knowledge_item', 'learning_note'],
    env
  });
  if (!result || result.status !== 'AUTHORIZED_AND_COMMITTED' ||
      result.standingAuthority !== true ||
      result.authorityConsumed !== false ||
      result.approvalRequiredPerRead !== false ||
      result.memoryWrites !== false ||
      result.localFallback !== false ||
      result.driveFallback !== false ||
      !result.hostAuthorizationContext ||
      typeof result.projectId !== 'string' || !result.projectId ||
      result.hostAuthorizationContext.projectId !== result.projectId ||
      result.hostAuthorizationContext.actorType !== 'HUMAN' ||
      typeof result.hostAuthorizationContext.actorId !== 'string' ||
      !result.hostAuthorizationContext.actorId.startsWith('mira:') ||
      typeof result.hostAuthorizationContext.purpose !== 'string' ||
      !result.hostAuthorizationContext.purpose ||
      typeof result.hostAuthorizationContext.requestId !== 'string' ||
      !result.hostAuthorizationContext.requestId ||
      typeof result.hostAuthorizationContext.issuedAt !== 'string' ||
      !Number.isFinite(Date.parse(result.hostAuthorizationContext.issuedAt)) ||
      Date.parse(result.hostAuthorizationContext.issuedAt) > now.getTime() ||
      typeof result.hostAuthorizationContext.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(result.hostAuthorizationContext.expiresAt)) ||
      Date.parse(result.hostAuthorizationContext.expiresAt) <= now.getTime() ||
      typeof result.hostAuthorizationContext.authorityRef !== 'string' ||
      !result.hostAuthorizationContext.authorityRef ||
      result.hostAuthorizationContext.authorityRef !== result.standingAuthorityId ||
      result.hostAuthorizationContext.expiresAt !== result.authorityExpiresAt ||
      !['FOUND', 'NOT_FOUND'].includes(result.recordStatus) ||
      (result.recordStatus === 'FOUND' && !result.record) ||
      (result.recordStatus === 'NOT_FOUND' && result.record)) {
    fail('HFM_KNOWLEDGE_AUTHORIZED_EXACT_READ_REQUIRED');
  }
  if (result.recordStatus === 'NOT_FOUND') {
    return Object.freeze({
      status: 'AUTHORIZED_AND_COMMITTED',
      projectId: result.projectId,
      entry: null,
      standingAuthority: true,
      authorityExpiresAt: result.authorityExpiresAt,
      approvalRequiredPerRead: false,
      localFallback: false,
      driveFallback: false,
      memoryWrites: false
    });
  }

  const report = retrieveCanonicalRecordsWithReport({
    records: [result.record],
    projectId: result.projectId,
    requestContext: result.hostAuthorizationContext,
    authorizeRequest: buildHfmAuthorizeRequest(
      result.hostAuthorizationContext, [memoryId.trim()]
    ),
    now
  });
  const record = report.records.find(item =>
    item.memoryId === memoryId.trim() &&
    item.lifecycle === 'ACTIVE' &&
    item.integrity?.status === 'VERIFIED' &&
    ['CONTENT_VERIFIED', 'HUMAN_VERIFIED'].includes(item.trust?.status) &&
    ['knowledge_item', 'learning_note'].includes(item.recordType)
  );
  return Object.freeze({
    status: 'AUTHORIZED_AND_COMMITTED',
    projectId: result.projectId,
    entry: record ? mapKnowledgeRecord(record, 1) : null,
    standingAuthority: true,
    authorityExpiresAt: result.authorityExpiresAt,
    approvalRequiredPerRead: false,
    localFallback: false,
    driveFallback: false,
    memoryWrites: false
  });
}

async function searchHfmKnowledge({
  req, pool, query, limit = 5, cursor, maxPages = MAX_STANDING_READ_PAGES,
  env = process.env, now = new Date(), readMemory = retrieveProjectMemory
} = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 2000) {
    fail('HFM_KNOWLEDGE_SEARCH_QUERY_INVALID');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    fail('HFM_KNOWLEDGE_SEARCH_LIMIT_INVALID');
  }
  if (env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED !== 'true') {
    fail('HFM_KNOWLEDGE_STANDING_READ_AUTHORITY_DISABLED');
  }
  if (typeof readMemory !== 'function') fail('HFM_KNOWLEDGE_READ_RUNTIME_INVALID');

  const pages = await collectStandingReadPages({
    readMemory,
    readOptions: {
      pool, req, standingReadAuthority: true,
      recordTypes: ['knowledge_item', 'learning_note'],
      lifecycle: 'ACTIVE', cursor, env
    },
    maxPages
  });
  const hostContext = pages.hostAuthorizationContext;
  const report = retrieveCanonicalRecordsWithReport({
    records: pages.records,
    projectId: pages.projectId,
    requestContext: hostContext,
    authorizeRequest: buildHfmAuthorizeRequest(
      hostContext, pages.records.map(record => record.memoryId)
    ),
    now
  });
  const results = report.records
    .filter(record => record.lifecycle === 'ACTIVE' &&
      record.integrity?.status === 'VERIFIED' &&
      ['CONTENT_VERIFIED', 'HUMAN_VERIFIED'].includes(record.trust?.status))
    .filter(record => ['knowledge_item', 'learning_note'].includes(record.recordType))
    .map(record => ({ record, score: scoreRecord(query, record) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score ||
      a.record.memoryId.localeCompare(b.record.memoryId))
    .slice(0, limit)
    .map(({ record, score }) => mapKnowledgeRecord(record, score));

  return Object.freeze({
    success: true,
    status: 'AUTHORIZED_AND_COMMITTED',
    projectId: pages.projectId,
    count: results.length,
    results: Object.freeze(results),
    candidateScanCount: pages.candidateScanCount,
    candidateScanLimit: pages.candidateScanLimit,
    scannedPages: pages.pageCount,
    nextCursor: pages.nextCursor,
    candidateScanMayBeIncomplete: pages.candidateScanMayBeIncomplete,
    standingAuthority: true,
    authorityExpiresAt: hostContext.expiresAt,
    approvalRequiredPerRead: false,
    localFallback: false,
    driveFallback: false,
    memoryWrites: false
  });
}

module.exports = Object.freeze({ searchHfmKnowledge, getHfmKnowledgeById, extractKnowledgeTitle });
