'use strict';

// Rebuildable, non-canonical Work Learning projections.
// Source records are authorized and filtered by HFM before derivation.
const crypto = require('node:crypto');
const { retrieveCanonicalRecordsWithReport } = require('./mira-memory-unified-facade');
const { assertNoSecretFields } = require('./mira-hfm-work-learning-adapter');

const PROJECTION_KINDS = new Set(['work_knowledge', 'experience_memory']);
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
function fail(message) {
  const error = new Error(message);
  error.code = 'HFM_WORK_LEARNING_PROJECTION_INVALID';
  throw error;
}
function requiredText(value, label, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail(label + ' is required and must be bounded text.');
  }
  return value.trim();
}
function projectionIdentity({ projectionKind, algorithmVersion, memoryId, revision, recordDigest }) {
  return 'mira-hfm-projection-' + digest({
    projectionKind, algorithmVersion, memoryId, revision, recordDigest
  });
}
function projectionBody(projection) {
  const body = {};
  for (const key of Object.keys(projection)) {
    if (key !== 'projectionDigest') body[key] = projection[key];
  }
  return body;
}
function verifyLearningProjection(projection) {
  try {
    if (!projection || typeof projection !== 'object' || Array.isArray(projection) ||
        projection.schemaVersion !== '1.0.0' ||
        !PROJECTION_KINDS.has(projection.projectionKind) ||
        projection.status !== 'DERIVED_READ_ONLY_NOT_CANONICAL' ||
        projection.rebuildable !== true ||
        projection.sourceLineage?.projectId !== projection.projectId ||
        projection.data?.learningId !== projection.sourceLineage?.sourceId ||
        !Array.isArray(projection.data?.lessons) ||
        projection.mayEnterCanonicalMemory !== false ||
        (projection.projectionKind === 'experience_memory' &&
          projection.data.experienceId !== projection.projectionId) ||
        (projection.projectionKind === 'work_knowledge' &&
          projection.data.experienceId !== null) ||
        projection.projectionId !== projectionIdentity({
          projectionKind: projection.projectionKind,
          algorithmVersion: projection.algorithmVersion,
          memoryId: projection.sourceLineage.memoryId,
          revision: projection.sourceLineage.revision,
          recordDigest: projection.sourceLineage.recordDigest
        }) ||
        projection.projectionDigest !== digest(projectionBody(projection))) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
function createProjectScopedLearningProjections({
  records, pendingConflicts, projectId, requestContext, authorizeRequest,
  algorithmVersion = '1', now = new Date()
}) {
  requiredText(projectId, 'projectId', 128);
  requiredText(algorithmVersion, 'algorithmVersion', 64);
  const report = retrieveCanonicalRecordsWithReport({
    records, pendingConflicts, projectId, requestContext, authorizeRequest, now
  });
  const provenanceById = new Map(report.provenance.map(item => [item.memoryId, item]));
  const projections = [];
  let malformedSources = 0;

  for (const canonical of report.records) {
    if (canonical.recordType !== 'lesson' ||
        canonical.source?.sourceType !== 'legacy_import') continue;
    let payload;
    try {
      payload = JSON.parse(canonical.content);
    } catch {
      malformedSources++;
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
      malformedSources++;
      continue;
    }
    try {
      assertNoSecretFields(payload.record);
    } catch {
      malformedSources++;
      continue;
    }
    const lineage = provenanceById.get(canonical.memoryId);
    if (!lineage) {
      malformedSources++;
      continue;
    }
    const record = payload.record;
    const data = {
      learningId: record.learningId,
      taskId: record.taskId,
      executionId: typeof record.executionId === 'string' ? record.executionId : null,
      planId: typeof record.planId === 'string' ? record.planId : null,
      engineVersion: typeof record.engineVersion === 'string' ? record.engineVersion : null,
      task: {
        title: typeof record.task?.title === 'string' ? record.task.title.slice(0, 300) : '',
        description: typeof record.task?.description === 'string' ? record.task.description.slice(0, 3000) : '',
        requirements: Array.isArray(record.task?.requirements)
          ? record.task.requirements.filter(x => typeof x === 'string').slice(0, 50) : []
      },
      lessons: record.lessons.filter(x => typeof x === 'string' && x.trim()).slice(0, 50),
      qaStatus: typeof record.qa?.status === 'string' ? record.qa.status : null
    };
    for (const projectionKind of PROJECTION_KINDS) {
      const projection = {
        schemaVersion: '1.0.0',
        projectionKind,
        projectionId: projectionIdentity({
          projectionKind, algorithmVersion,
          memoryId: canonical.memoryId,
          revision: lineage.revision,
          recordDigest: lineage.recordDigest
        }),
        algorithmVersion,
        projectId: canonical.projectId,
        sourceLineage: {
          memoryId: canonical.memoryId,
          revision: lineage.revision,
          projectId: canonical.projectId,
          recordDigest: lineage.recordDigest,
          sourceType: lineage.source.sourceType,
          sourceId: lineage.source.sourceId
        },
        data: {
          ...data,
          experienceId: projectionKind === 'experience_memory'
            ? projectionIdentity({
                projectionKind, algorithmVersion,
                memoryId: canonical.memoryId,
                revision: lineage.revision,
                recordDigest: lineage.recordDigest
              }) : null
        },
        status: 'DERIVED_READ_ONLY_NOT_CANONICAL',
        rebuildable: true,
        mayEnterCanonicalMemory: false
      };
      projection.projectionDigest = digest(projection);
      if (!verifyLearningProjection(projection)) fail('Generated learning projection failed self-verification.');
      projections.push(Object.freeze({
        ...projection,
        sourceLineage: Object.freeze({ ...projection.sourceLineage }),
        data: Object.freeze({
          ...projection.data,
          task: Object.freeze({
            ...projection.data.task,
            requirements: Object.freeze([...projection.data.task.requirements])
          }),
          lessons: Object.freeze([...projection.data.lessons])
        })
      }));
    }
  }
  return Object.freeze({
    projectId,
    projections: Object.freeze(projections),
    count: projections.length,
    malformedSources,
    excludedSummary: report.excludedSummary,
    governance: Object.freeze({
      readOnly: true,
      canonicalWrite: false,
      persistence: false,
      rebuildable: true,
      projectScopeInheritedFromVerifiedCanonicalSource: true,
      crossProjectTransferAllowed: false
    })
  });
}
module.exports = {
  createProjectScopedLearningProjections,
  verifyLearningProjection,
  projectionIdentity,
  digest
};
