'use strict';

// Read-only HFM retrieval bridge for Work Learning lessons.
// Authorization, project scope, trust, integrity and conflict filtering happen
// in the unified facade BEFORE relevance ranking.
const {
  retrieveCanonicalRecordsWithReport
} = require('./mira-memory-unified-facade');

const MAX_RESULTS = 20;
function fail(message, code = 'HFM_WORK_LEARNING_RETRIEVAL_INVALID') {
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
function terms(value) {
  return new Set(
    String(value || '').toLowerCase()
      .match(/[a-z0-9][a-z0-9_-]{1,}/g) || []
  );
}
function relevanceScore(queryTerms, record) {
  const task = record.task && typeof record.task === 'object' ? record.task : {};
  const text = [
    task.title, task.description,
    ...(Array.isArray(task.requirements) ? task.requirements : []),
    ...(Array.isArray(record.lessons) ? record.lessons : [])
  ].filter(value => typeof value === 'string').join(' ');
  const candidateTerms = terms(text);
  const matchedTerms = [...queryTerms].filter(term => candidateTerms.has(term));
  return {
    score: queryTerms.size ? matchedTerms.length / queryTerms.size : 0,
    matchedTerms
  };
}
function retrieveProjectScopedWorkLearning({
  records, pendingConflicts, projectId, requestContext, authorizeRequest,
  taskText, currentTaskId, limit = MAX_RESULTS, now = new Date()
}) {
  requiredText(projectId, 'projectId', 128);
  requiredText(taskText, 'taskText');
  requiredText(currentTaskId, 'currentTaskId', 256);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS) {
    fail('limit must be an integer from 1 to ' + MAX_RESULTS + '.');
  }

  // The facade performs request LIST authorization, per-record READ
  // authorization, project/access checks, ACTIVE + VERIFIED + trusted-state
  // checks, and unresolved-conflict exclusion before this function ranks.
  const report = retrieveCanonicalRecordsWithReport({
    records, pendingConflicts, projectId, requestContext,
    authorizeRequest, now
  });
  const provenanceById = new Map(
    report.provenance.map(item => [item.memoryId, item])
  );
  const queryTerms = terms(taskText);
  const candidates = [];
  let malformedLearningPayloads = 0;

  for (const canonical of report.records) {
    if (canonical.recordType !== 'lesson' ||
        canonical.source?.sourceType !== 'legacy_import') continue;
    let payload;
    try {
      payload = JSON.parse(canonical.content);
    } catch {
      malformedLearningPayloads++;
      continue;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        payload.domain !== 'work_learning' ||
        !payload.record || typeof payload.record !== 'object' ||
        Array.isArray(payload.record) ||
        payload.record.learningId !== canonical.source.sourceId ||
        typeof payload.record.taskId !== 'string' ||
        !payload.record.taskId.trim() ||
        !Array.isArray(payload.record.lessons)) {
      malformedLearningPayloads++;
      continue;
    }
    if (payload.record.taskId === currentTaskId) continue;
    const relevance = relevanceScore(queryTerms, payload.record);
    if (relevance.score <= 0) continue;
    const provenance = provenanceById.get(canonical.memoryId);
    if (!provenance) {
      malformedLearningPayloads++;
      continue;
    }
    candidates.push({
      memoryId: canonical.memoryId,
      learningId: payload.record.learningId,
      sourceTaskId: payload.record.taskId,
      projectId: canonical.projectId,
      lessons: payload.record.lessons.filter(
        item => typeof item === 'string' && item.trim()
      ).slice(0, 50),
      task: {
        title: typeof payload.record.task?.title === 'string'
          ? payload.record.task.title.slice(0, 300) : '',
        description: typeof payload.record.task?.description === 'string'
          ? payload.record.task.description.slice(0, 3000) : ''
      },
      provenance: {
        revision: provenance.revision,
        recordDigest: provenance.recordDigest,
        source: provenance.source
      },
      relevance,
      governance: {
        readOnly: true,
        executable: false,
        modifiesCode: false,
        bypassesPolicy: false,
        requiresNormalTaskChecks: true
      }
    });
  }
  candidates.sort((a, b) =>
    b.relevance.score - a.relevance.score ||
    a.learningId.localeCompare(b.learningId)
  );
  const transfers = candidates.slice(0, limit);
  return Object.freeze({
    projectId,
    currentTaskId,
    transfers: Object.freeze(transfers.map(item => Object.freeze({
      ...item,
      lessons: Object.freeze([...item.lessons]),
      task: Object.freeze({ ...item.task }),
      provenance: Object.freeze({
        ...item.provenance,
        source: Object.freeze({ ...item.provenance.source })
      }),
      relevance: Object.freeze({
        score: item.relevance.score,
        matchedTerms: Object.freeze([...item.relevance.matchedTerms])
      }),
      governance: Object.freeze({ ...item.governance })
    }))),
    count: transfers.length,
    excludedSummary: report.excludedSummary,
    malformedLearningPayloads,
    governance: Object.freeze({
      readOnly: true,
      executable: false,
      modifiesCode: false,
      bypassesPolicy: false,
      requiresNormalTaskChecks: true,
      rankedAfterHfmEligibilityFilter: true
    })
  });
}
module.exports = { retrieveProjectScopedWorkLearning, MAX_RESULTS };
