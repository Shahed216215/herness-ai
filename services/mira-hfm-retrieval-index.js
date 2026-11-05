'use strict';

// Ephemeral project-scoped lexical index. HFM authorization/eligibility filters
// run before any record is tokenized or ranked. No index is persisted.
const crypto = require('node:crypto');
const { retrieveCanonicalRecordsWithReport } = require('./mira-memory-unified-facade');
const { assertNoSecretFields } = require('./mira-hfm-work-learning-adapter');

const ALGORITHM_VERSION = 'mira-hfm-lexical-v1';
const MAX_RECORDS = 5000;
const MAX_QUERY_TERMS = 32;
const MAX_RESULTS = 50;
const MAX_TERMS_PER_RECORD = 5000;
const MAX_UNIQUE_TERMS = 250000;
const MAX_POSTINGS = 1000000;
function fail(message, code = 'HFM_RETRIEVAL_INDEX_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function requiredText(value, label, max = 10000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail(label + ' is required and must be bounded text.');
  }
  return value.trim();
}
function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
function tokenize(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}_-]{1,}/gu) || [];
}
function flattenJson(value, state = { nodes: 0, parts: [] }, depth = 0) {
  if (++state.nodes > 10000 || depth > 16) {
    fail('JSON content exceeds the bounded retrieval-index traversal budget.',
      'HFM_RETRIEVAL_INDEX_BUDGET_EXCEEDED');
  }
  if (typeof value === 'string') {
    state.parts.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) flattenJson(item, state, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) flattenJson(item, state, depth + 1);
  }
  return state.parts.join(' ');
}
function extractIndexableText(record) {
  if (typeof record.content !== 'string' || record.content.length > 100000) {
    fail('Canonical record content is not bounded for indexing.');
  }
  try {
    const parsed = JSON.parse(record.content);
    assertNoSecretFields(parsed);
    if (parsed && parsed.domain === 'work_learning' && parsed.record &&
        typeof parsed.record === 'object') {
      const item = parsed.record;
      return [
        item.task?.title, item.task?.description,
        ...(Array.isArray(item.task?.requirements) ? item.task.requirements : []),
        ...(Array.isArray(item.lessons) ? item.lessons : [])
      ].filter(x => typeof x === 'string').join(' ');
    }
    return flattenJson(parsed);
  } catch (error) {
    if (error.code === 'HFM_WORK_LEARNING_MAPPING_INVALID') return '';
    if (error instanceof SyntaxError) return record.content;
    if (error.code === 'HFM_RETRIEVAL_INDEX_BUDGET_EXCEEDED') throw error;
    // A parsed JSON payload with prohibited secret-like fields is not indexed.
    if (/prohibited secret-like field/.test(error.message)) return '';
    throw error;
  }
}
function searchProjectScopedMemory({
  records, pendingConflicts, projectId, requestContext, authorizeRequest,
  query, limit = 10, now = new Date()
}) {
  requiredText(projectId, 'projectId', 128);
  requiredText(query, 'query', 2000);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS) {
    fail('limit must be an integer from 1 to ' + MAX_RESULTS + '.');
  }
  const queryTerms = [...new Set(tokenize(query))];
  if (!queryTerms.length || queryTerms.length > MAX_QUERY_TERMS) {
    fail('query must contain 1-' + MAX_QUERY_TERMS + ' distinct searchable terms.');
  }
  const started = Date.now();

  // No untrusted or out-of-scope record reaches the index builder.
  const report = retrieveCanonicalRecordsWithReport({
    records, pendingConflicts, projectId, requestContext, authorizeRequest, now
  });
  if (report.records.length > MAX_RECORDS) {
    fail('Eligible record count exceeds the bounded retrieval index capacity.',
      'HFM_RETRIEVAL_INDEX_BUDGET_EXCEEDED');
  }
  const documents = [];
  const postings = new Map();
  let postingCount = 0;
  for (const record of report.records) {
    let text;
    try { text = extractIndexableText(record); }
    catch (error) {
      if (error.code === 'HFM_RETRIEVAL_INDEX_BUDGET_EXCEEDED') throw error;
      continue;
    }
    const tokens = tokenize(text).slice(0, MAX_TERMS_PER_RECORD);
    if (!tokens.length) continue;
    const frequencies = new Map();
    for (const term of tokens) frequencies.set(term, (frequencies.get(term) || 0) + 1);
    const docIndex = documents.length;
    documents.push({
      record,
      length: tokens.length,
      frequencies
    });
    for (const [term, frequency] of frequencies) {
      let list = postings.get(term);
      if (!list) {
        if (postings.size >= MAX_UNIQUE_TERMS) {
          fail('Unique-term index budget exceeded.', 'HFM_RETRIEVAL_INDEX_BUDGET_EXCEEDED');
        }
        list = [];
        postings.set(term, list);
      }
      list.push({ docIndex, frequency });
      if (++postingCount > MAX_POSTINGS) {
        fail('Posting-list index budget exceeded.', 'HFM_RETRIEVAL_INDEX_BUDGET_EXCEEDED');
      }
    }
  }

  const avgLength = documents.length
    ? documents.reduce((sum, doc) => sum + doc.length, 0) / documents.length
    : 0;
  const scoreByDocument = new Map();
  for (const term of queryTerms) {
    const list = postings.get(term) || [];
    const df = list.length;
    if (!df) continue;
    const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
    for (const posting of list) {
      const doc = documents[posting.docIndex];
      const k = 1.2 * (0.25 + 0.75 * (avgLength ? doc.length / avgLength : 1));
      const score = idf * ((posting.frequency * 2.2) / (posting.frequency + k));
      let item = scoreByDocument.get(posting.docIndex);
      if (!item) {
        item = { record: doc.record, score: 0, matchedTerms: [] };
        scoreByDocument.set(posting.docIndex, item);
      }
      item.score += score;
      item.matchedTerms.push(term);
    }
  }
  const results = [...scoreByDocument.values()];
  const provenanceById = new Map(report.provenance.map(item => [item.memoryId, item]));
  results.sort((a, b) =>
    b.score - a.score || a.record.memoryId.localeCompare(b.record.memoryId)
  );
  const selected = results.slice(0, limit).map(item => {
    const provenance = provenanceById.get(item.record.memoryId);
    return Object.freeze({
      memoryId: item.record.memoryId,
      projectId: item.record.projectId,
      recordType: item.record.recordType,
      revision: item.record.version.revision,
      classification: item.record.access.classification,
      source: Object.freeze({ ...item.record.source }),
      recordDigest: provenance.recordDigest,
      score: item.score,
      matchedTerms: Object.freeze([...new Set(item.matchedTerms)].sort())
    });
  });
  const recordDigests = report.provenance.map(x => x.recordDigest).sort();
  const indexDigest = sha256(JSON.stringify({
    algorithmVersion: ALGORITHM_VERSION,
    projectId,
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
    recordDigests
  }));
  const elapsedMs = Date.now() - started;
  return Object.freeze({
    projectId,
    requestId: requestContext.requestId,
    algorithmVersion: ALGORITHM_VERSION,
    results: Object.freeze(selected),
    count: selected.length,
    excludedSummary: report.excludedSummary,
    index: Object.freeze({
      persisted: false,
      ephemeral: true,
      indexedDocuments: documents.length,
      eligibleRecords: report.records.length,
      uniqueTerms: postings.size,
      postings: postingCount,
      averageDocumentLength: avgLength,
      indexDigest
    }),
    performance: Object.freeze({ totalMs: elapsedMs }),
    governance: Object.freeze({
      projectScopeFilteredBeforeIndexing: true,
      hostAuthorizationRequired: true,
      activeVerifiedTrustedRecordsOnly: true,
      conflictQuarantineAppliedBeforeIndexing: true,
      readOnly: true,
      persistentIndexWrite: false,
      crossProjectSearch: false
    })
  });
}
module.exports = {
  searchProjectScopedMemory,
  tokenize,
  extractIndexableText,
  ALGORITHM_VERSION,
  MAX_RECORDS,
  MAX_QUERY_TERMS,
  MAX_RESULTS
};
