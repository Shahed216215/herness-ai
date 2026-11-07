'use strict';

// HFM v0.2 unified retrieval policy facade.
// This module is intentionally pure: callers must supply records and a trusted
// host authorization callback. It never opens a database or falls back to local
// JSON / Drive. Persistence and authority consumption remain separate layers.

const { validateCanonicalRecord } = require('./mira-hfm-record-schema');

const MAX_RECORDS = 5000;
const TRUSTED_STATES = new Set(['CONTENT_VERIFIED', 'HUMAN_VERIFIED']);
const ELIGIBLE_INTEGRITY = new Set(['VERIFIED']);

function fail(message, code = 'HFM_MEMORY_FACADE_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requiredText(value, label, max = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail(label + ' is required and must be bounded text.');
  }
  return value.trim();
}

function validTime(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail(label + ' must be a valid timestamp.');
  }
  return Date.parse(value);
}

function validateRequestContext(projectId, context, now) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    fail('Trusted host request context is required.');
  }
  const actorId = requiredText(context.actorId, 'requestContext.actorId');
  const actorType = requiredText(context.actorType, 'requestContext.actorType', 32);
  const contextProjectId = requiredText(context.projectId, 'requestContext.projectId', 128);
  const purpose = requiredText(context.purpose, 'requestContext.purpose');
  const requestId = requiredText(context.requestId, 'requestContext.requestId');
  const authorityRef = requiredText(context.authorityRef, 'requestContext.authorityRef');
  const issuedAt = validTime(context.issuedAt, 'requestContext.issuedAt');
  const expiresAt = validTime(context.expiresAt, 'requestContext.expiresAt');
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(current) || actorType !== 'HUMAN' ||
      contextProjectId !== projectId) {
    fail('Request context project scope or actor type is invalid.', 'HFM_MEMORY_PROJECT_SCOPE_MISMATCH');
  }
  if (issuedAt > current || expiresAt <= current || expiresAt <= issuedAt) {
    fail('Trusted host authority is expired or not yet valid.', 'HFM_MEMORY_HOST_AUTHORITY_INVALID');
  }
  return Object.freeze({
    actorId, actorType, projectId, purpose, requestId, authorityRef,
    issuedAt: context.issuedAt, expiresAt: context.expiresAt
  });
}

function verifyAuthorization(decision, expected, operation, resourceScope, now) {
  if (!decision || typeof decision !== 'object' ||
      decision.decision !== 'ALLOW' || decision.replayStatus !== 'FRESH' ||
      decision.actorId !== expected.actorId ||
      decision.actorType !== expected.actorType ||
      decision.projectId !== expected.projectId ||
      decision.purpose !== expected.purpose ||
      decision.requestId !== expected.requestId ||
      decision.operation !== operation ||
      decision.resourceScope !== resourceScope ||
      decision.authorityRef !== expected.authorityRef) return false;
  const issued = Date.parse(decision.issuedAt);
  const expires = Date.parse(decision.expiresAt);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  const hostIssued = Date.parse(expected.issuedAt);
  const hostExpires = Date.parse(expected.expiresAt);
  return Number.isFinite(issued) && Number.isFinite(expires) &&
    issued <= current && expires > current && expires > issued &&
    issued >= hostIssued && expires <= hostExpires;
}

function conflictIds(pendingConflicts, projectId) {
  const ids = new Set();
  for (const conflict of pendingConflicts) {
    if (!conflict || conflict.projectId !== projectId ||
        !['OPEN', 'PENDING_REVIEW', 'QUARANTINED'].includes(conflict.status)) continue;
    for (const id of Array.isArray(conflict.originalMemoryIds) ? conflict.originalMemoryIds : []) {
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

function retrieveCanonicalRecordsWithReport({
  records, pendingConflicts = [], projectId, requestContext,
  authorizeRequest, now = new Date()
} = {}) {
  projectId = requiredText(projectId, 'projectId', 128);
  if (!Array.isArray(records) || records.length > MAX_RECORDS) {
    fail('records must be a bounded array.');
  }
  if (!Array.isArray(pendingConflicts)) fail('pendingConflicts must be an array.');
  if (typeof authorizeRequest !== 'function') {
    fail('Trusted host authorizeRequest callback is required.');
  }
  const trusted = validateRequestContext(projectId, requestContext, now);
  const listScope = 'project:' + projectId;
  const listDecision = authorizeRequest({
    ...trusted, operation: 'LIST', resourceScope: listScope
  });
  if (!verifyAuthorization(listDecision, trusted, 'LIST', listScope, now)) {
    return Object.freeze({
      records: Object.freeze([]), provenance: Object.freeze([]),
      excludedSummary: Object.freeze({
        totalCandidates: records.length, eligibleCount: 0,
        excludedCount: records.length, requestDenied: true
      })
    });
  }

  const quarantined = conflictIds(pendingConflicts, projectId);
  const eligible = [];
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        !validateCanonicalRecord(record).valid) {
      continue;
    }
    if (record.lifecycle !== 'ACTIVE' ||
        !ELIGIBLE_INTEGRITY.has(record.integrity?.status) ||
        !TRUSTED_STATES.has(record.trust?.status) ||
        quarantined.has(record.memoryId)) {
      continue;
    }
    eligible.push(record);
  }

  const scoped = [];
  const provenance = [];
  for (const record of eligible) {
    const classification = record.access?.classification;
    const allowedProjects = record.access?.allowedProjectIds;
    const projectAccessValid = classification === 'PROJECT_PRIVATE'
      ? Array.isArray(allowedProjects) && allowedProjects.length === 1 && allowedProjects[0] === projectId
      : classification === 'PUBLIC' &&
        (allowedProjects === undefined || allowedProjects === null ||
          (Array.isArray(allowedProjects) && allowedProjects.length === 1 && allowedProjects[0] === projectId));
    if (record.projectId !== projectId || !projectAccessValid) continue;

    const resourceScope = 'memory:' + requiredText(record.memoryId, 'record.memoryId', 128);
    const decision = authorizeRequest({
      ...trusted, operation: 'READ', resourceScope
    });
    if (!verifyAuthorization(decision, trusted, 'READ', resourceScope, now)) continue;
    scoped.push(record);
    provenance.push(Object.freeze({
      memoryId: record.memoryId,
      projectId: record.projectId,
      revision: record.version?.revision,
      recordDigest: record.version?.contentHash,
      source: Object.freeze({
        sourceType: record.source?.sourceType,
        sourceId: record.source?.sourceId,
        sourceUrl: record.source?.sourceUrl || null,
        observedAt: record.source?.observedAt
      })
    }));
  }

  return Object.freeze({
    records: Object.freeze(scoped),
    provenance: Object.freeze(provenance),
    excludedSummary: Object.freeze({
      totalCandidates: records.length,
      eligibleCount: scoped.length,
      excludedCount: records.length - scoped.length,
      requestDenied: false
    })
  });
}

module.exports = Object.freeze({
  retrieveCanonicalRecordsWithReport,
  MAX_RECORDS
});
