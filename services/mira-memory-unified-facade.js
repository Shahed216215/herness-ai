'use strict';

// Synthetic-only contract facade. It performs no I/O and never commits state.
const crypto = require('node:crypto');
const { validateCanonicalMemoryRecord } = require('./mira-memory-conflict-assessment');
const { filterTrustedRecords } = require('./mira-conflict-quarantine-registry');
const { authorizeMemoryRequest } = require('./mira-memory-request-authorization');

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' is required.');
}
function authorize({ requestContext, operation, resourceScope, authorizeRequest, now }) {
  return authorizeMemoryRequest({ requestContext, operation, resourceScope, authorizeRequest, now });
}
function retrieveCanonicalRecords({
  records, pendingConflicts, projectId, requestContext, authorizeRequest, now = new Date()
}) {
  if (!Array.isArray(records) || !Array.isArray(pendingConflicts)) {
    throw new Error('Synthetic records and conflict metadata must be arrays.');
  }
  requiredText(projectId, 'projectId');
  if (!requestContext || requestContext.projectId !== projectId) {
    throw new Error('Request actor project scope does not match retrieval project.');
  }
  const listDecision = authorize({
    requestContext, operation: 'LIST', resourceScope: 'project:' + projectId,
    authorizeRequest, now
  });
  const actorContext = {
    actorId: listDecision.actorId,
    projectId: listDecision.projectId,
    purpose: listDecision.purpose,
    requestId: listDecision.requestId
  };
  const authorizeRecord = record => {
    try {
      authorize({
        requestContext, operation: 'READ',
        resourceScope: 'memory:' + record.memoryId,
        authorizeRequest, now
      });
      return true;
    } catch {
      return false;
    }
  };
  return filterTrustedRecords(records, pendingConflicts, projectId, authorizeRecord, actorContext);
}
function prepareCanonicalWrite({
  incomingRecord, existingRecords, pendingConflicts, requestContext,
  authorizeRequest, expectedRevision, idempotencyKey, seenIdempotencyKeys = [],
  now = new Date()
}) {
  if (!Array.isArray(existingRecords) || !Array.isArray(pendingConflicts) ||
      !Array.isArray(seenIdempotencyKeys)) {
    throw new Error('Existing records, conflict metadata and idempotency history must be arrays.');
  }
  if (seenIdempotencyKeys.some(key => typeof key !== 'string' || !key.trim())) {
    throw new Error('Idempotency history is malformed; write preparation fails closed.');
  }
  if (pendingConflicts.some(conflict => !conflict || typeof conflict !== 'object' || Array.isArray(conflict) ||
      typeof conflict.projectId !== 'string' || !conflict.projectId.trim() ||
      typeof conflict.status !== 'string' || !conflict.status.trim() ||
      !Array.isArray(conflict.originalMemoryIds) ||
      conflict.originalMemoryIds.some(id => typeof id !== 'string' || !id.trim()))) {
    throw new Error('Conflict metadata is malformed; write preparation fails closed.');
  }
  const errors = validateCanonicalMemoryRecord(incomingRecord, 'incomingRecord');
  if (errors.length) throw new Error('Incoming canonical record is invalid: ' + errors.join('; '));
  requiredText(idempotencyKey, 'idempotencyKey');
  if (seenIdempotencyKeys.includes(idempotencyKey)) throw new Error('Duplicate idempotency key rejected.');
  if (!requestContext || requestContext.projectId !== incomingRecord.projectId) {
    throw new Error('Request actor project scope does not match write project.');
  }
  authorize({
    requestContext, operation: 'WRITE',
    resourceScope: 'memory:' + incomingRecord.memoryId,
    authorizeRequest, now
  });
  const matches = existingRecords.filter(record =>
    record && record.memoryId === incomingRecord.memoryId
  );
  if (matches.length > 1) throw new Error('Duplicate existing canonical identity requires conflict review.');
  const relatedConflicts = pendingConflicts.filter(conflict =>
    conflict && conflict.projectId === incomingRecord.projectId &&
    Array.isArray(conflict.originalMemoryIds) &&
    conflict.originalMemoryIds.includes(incomingRecord.memoryId)
  );
  if (relatedConflicts.length) throw new Error('Memory identity has unresolved conflict metadata.');

  const current = matches[0] || null;
  if (!current) {
    if (expectedRevision !== null || incomingRecord.version.revision !== 1) {
      throw new Error('New memory requires expectedRevision=null and revision=1.');
    }
  } else {
    const currentErrors = validateCanonicalMemoryRecord(current, 'existingRecord');
    if (currentErrors.length) throw new Error('Existing canonical record is invalid: ' + currentErrors.join('; '));
    if (current.projectId !== incomingRecord.projectId) throw new Error('Existing memory project mismatch.');
    if (current.lifecycle !== 'ACTIVE' || current.integrity.status !== 'VERIFIED') {
      throw new Error('Existing memory is not eligible for update; review/recovery is required.');
    }
    if (!Number.isInteger(expectedRevision) || current.version.revision !== expectedRevision) {
      throw new Error('Expected revision does not match current record.');
    }
    if (incomingRecord.memoryId !== current.memoryId ||
        incomingRecord.projectId !== current.projectId ||
        incomingRecord.recordType !== current.recordType ||
        incomingRecord.version.revision !== current.version.revision + 1) {
      throw new Error('Update must preserve identity/scope/type and increment revision by exactly one.');
    }
    if (incomingRecord.timestamps.createdAt !== current.timestamps.createdAt) {
      throw new Error('Original creation timestamp is immutable across revisions.');
    }
    if (JSON.stringify(incomingRecord.source) !== JSON.stringify(current.source) ||
        JSON.stringify(incomingRecord.access) !== JSON.stringify(current.access)) {
      throw new Error('Source provenance or access changes require a separate governed operation.');
    }
    if (Date.parse(incomingRecord.timestamps.updatedAt) <= Date.parse(current.timestamps.updatedAt)) {
      throw new Error('Updated revision timestamp must advance.');
    }
  }
  if (incomingRecord.integrity.status !== 'VERIFIED' ||
      incomingRecord.lifecycle !== 'ACTIVE') {
    throw new Error('Only integrity-verified ACTIVE canonical records can be prepared for write.');
  }
  return Object.freeze({
    status: 'PREPARED_NOT_COMMITTED',
    committed: false,
    projectId: incomingRecord.projectId,
    memoryId: incomingRecord.memoryId,
    expectedRevision: current ? current.version.revision : null,
    nextRevision: incomingRecord.version.revision,
    idempotencyKey,
    previousRecordDigest: current ? digest(current) : null,
    incomingRecordDigest: digest(incomingRecord),
    incomingRecord
  });
}
module.exports = { retrieveCanonicalRecords, prepareCanonicalWrite, digest };
