'use strict';

const { sha256Canonical, validateCanonicalRecord } = require('./core');

const RESOLUTION_ACTIONS = new Set([
  'ACCEPT_EXISTING_VERSION',
  'ACCEPT_ALTERNATE_VERSION',
  'APPROVED_FIELD_MERGE',
  'REJECT_CONFLICTING_CHANGE',
  'RETAIN_QUARANTINED'
]);

function detectConflict(existing, incoming) {
  const a = validateCanonicalRecord(existing);
  const b = validateCanonicalRecord(incoming);
  if (!a.valid || !b.valid) {
    return { status: 'VALIDATION_FAILED', errors: a.errors.concat(b.errors) };
  }
  if (existing.memoryId !== incoming.memoryId || existing.projectId !== incoming.projectId) {
    return { status: 'NOT_SAME_LOGICAL_RECORD' };
  }
  if (existing.version.contentHash === incoming.version.contentHash) {
    return { status: 'DUPLICATE_VERSION', conflict: false };
  }
  const conflictId = 'conflict_' + sha256Canonical({
    projectId: existing.projectId,
    memoryId: existing.memoryId,
    existingRevision: existing.version.revision,
    incomingRevision: incoming.version.revision,
    existingHash: existing.version.contentHash,
    incomingHash: incoming.version.contentHash
  }).slice(0, 32);
  return {
    status: 'CONFLICT_REVIEW',
    conflict: true,
    conflictId,
    preserved: {
      existing: JSON.parse(JSON.stringify(existing)),
      incoming: JSON.parse(JSON.stringify(incoming))
    },
    automaticResolution: false,
    trustedRetrievalAllowed: false
  };
}

function prepareConflictResolution(conflict, decision) {
  if (!conflict || conflict.status !== 'CONFLICT_REVIEW' ||
      !conflict.preserved || !decision || !RESOLUTION_ACTIONS.has(decision.action)) {
    return { status: 'VALIDATION_FAILED', prepared: false };
  }
  if (decision.authorized !== true || decision.auditRecorded !== true ||
      typeof decision.actor !== 'string' || !decision.actor.trim() ||
      typeof decision.policyDecisionId !== 'string' || !decision.policyDecisionId.trim()) {
    return { status: 'NOT_APPROVED', prepared: false, reason: 'AUTHORIZATION_AND_AUDIT_REQUIRED' };
  }
  return {
    status: 'PROPOSAL_PREPARED',
    prepared: true,
    conflictId: conflict.conflictId,
    action: decision.action,
    actor: decision.actor,
    policyDecisionId: decision.policyDecisionId,
    originalsPreserved: true,
    newRevisionRequired: decision.action === 'APPROVED_FIELD_MERGE',
    persistencePerformed: false
  };
}

module.exports = { detectConflict, prepareConflictResolution, RESOLUTION_ACTIONS };
