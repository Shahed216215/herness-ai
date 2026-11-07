'use strict';

const { retrieveProjectMemory } = require('./mira-hfm-authorized-memory-reader');
const { retrieveCanonicalRecordsWithReport } = require('./mira-memory-unified-facade');
const { buildHfmAuthorizeRequest } = require('./mira-hfm-work-learning-runtime');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function queryTerms(value) {
  return new Set(String(value || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu) || []);
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

async function searchHfmKnowledge({ req, pool, query, limit = 5, cursor, env = process.env, now = new Date(), readMemory = retrieveProjectMemory } = {}) {
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
  const memory = await readMemory({
    pool, req, standingReadAuthority: true,
    recordTypes: ['knowledge_item', 'learning_note'], lifecycle: 'ACTIVE', limit: 100, cursor, env
  });
  if (!memory || memory.status !== 'AUTHORIZED_AND_COMMITTED' ||
      memory.standingAuthority !== true || memory.approvalRequiredPerRead !== false ||
      !Array.isArray(memory.records) || !memory.hostAuthorizationContext) {
    fail('HFM_KNOWLEDGE_AUTHORIZED_MEMORY_READ_REQUIRED');
  }
  // Older injected readers may omit count; the returned bounded array is
  // still an exact count of scanned candidates. A full 100-row page remains
  // conservatively marked as potentially incomplete.
  const candidateScanCount = memory.count === undefined ? memory.records.length : memory.count;
  if (!Number.isInteger(candidateScanCount) || candidateScanCount < 0 ||
      candidateScanCount > 100 || candidateScanCount !== memory.records.length) {
    fail('HFM_KNOWLEDGE_SCAN_COUNT_INVALID');
  }
  const hostContext = memory.hostAuthorizationContext;
  if (hostContext.projectId !== memory.projectId ||
      typeof hostContext.actorId !== 'string' || !hostContext.actorId.startsWith('mira:')) {
    fail('HFM_KNOWLEDGE_HOST_AUTHORIZATION_CONTEXT_INVALID');
  }
  const report = retrieveCanonicalRecordsWithReport({
    records: memory.records,
    projectId: hostContext.projectId,
    requestContext: hostContext,
    authorizeRequest: buildHfmAuthorizeRequest(
      hostContext, memory.records.map(record => record.memoryId)
    ),
    now
  });
  const candidateScanMayBeIncomplete =
    (typeof memory.nextCursor === 'string' && memory.nextCursor.length > 0) ||
    (memory.nextCursor === undefined && candidateScanCount === 100);
  const results = report.records
    // Defense in depth: only expose canonical records that are independently
    // ACTIVE, integrity-verified and in an eligible trusted state. The unified
    // facade already enforces this; repeat it at the public search boundary.
    .filter(record => record.lifecycle === 'ACTIVE' &&
      record.integrity?.status === 'VERIFIED' &&
      ['CONTENT_VERIFIED', 'HUMAN_VERIFIED'].includes(record.trust?.status))
    .filter(record => ['knowledge_item', 'learning_note'].includes(record.recordType))
    .map(record => ({ record, score: scoreRecord(query, record) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score ||
      a.record.memoryId.localeCompare(b.record.memoryId))
    .slice(0, limit)
    .map(({ record, score }) => ({
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
    }));
  return Object.freeze({
    success: true,
    status: 'AUTHORIZED_AND_COMMITTED',
    projectId: memory.projectId,
    count: results.length,
    results: Object.freeze(results),
    candidateScanCount,
    candidateScanLimit: 100,
    nextCursor: memory.nextCursor || null,
    candidateScanMayBeIncomplete,
    nextCursor: memory.nextCursor || null,
    standingAuthority: true,
    authorityExpiresAt: memory.authorityExpiresAt,
    approvalRequiredPerRead: false,
    localFallback: false,
    driveFallback: false
  });
}

module.exports = Object.freeze({ searchHfmKnowledge, extractKnowledgeTitle });
