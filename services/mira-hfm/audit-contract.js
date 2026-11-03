'use strict';

const { sha256Canonical } = require('./core');

const REQUIRED_CAPABILITIES = [
  'DURABLE_APPEND', 'APPEND_ONLY', 'LOOKUP',
  'RECONCILE', 'VERIFY', 'PROJECT_ISOLATED'
];

function auditProviderReadiness(audit) {
  if (!audit || audit.durable !== true || !audit.capabilities ||
      REQUIRED_CAPABILITIES.some(name => audit.capabilities[name] !== true) ||
      typeof audit.append !== 'function' ||
      typeof audit.lookup !== 'function' ||
      typeof audit.reconcileEvent !== 'function' ||
      typeof audit.verifyEvent !== 'function') {
    return { ready: false, reason: 'DURABLE_PROJECT_SCOPED_AUDIT_CONTRACT_UNAVAILABLE' };
  }
  return { ready: true };
}

function createAuditEventHash(event, previousEventHash, sequence) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      !Number.isSafeInteger(sequence) || sequence < 1 ||
      previousEventHash !== null && !/^[a-f0-9]{64}$/.test(previousEventHash)) {
    throw new TypeError('AUDIT_EVENT_INPUT_INVALID');
  }
  return sha256Canonical({
    profile: 'MIRA-HFM-AUDIT-EVENT-JCS-SHA256-1',
    sequence,
    previousEventHash,
    event
  });
}

function validateAuditEvent(event) {
  const required = ['eventId', 'eventType', 'projectId', 'operationId', 'payloadHash', 'requestId', 'actor', 'policyDecisionId', 'timestamp'];
  const allowed = new Set(required.concat(['idempotencyKey', 'purpose', 'revision', 'memoryId']));
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      Object.keys(event).some(key => !allowed.has(key)) ||
      required.some(key => typeof event[key] !== 'string' || !event[key].trim()) ||
      !['MEMORY_WRITE_INTENT', 'MEMORY_WRITE_COMPLETED'].includes(event.eventType) ||
      !/^[a-f0-9]{64}$/.test(event.payloadHash) ||
      !/T/.test(event.timestamp) || !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(event.timestamp) ||
      Number.isNaN(Date.parse(event.timestamp))) {
    return { valid: false, reason: 'AUDIT_EVENT_SCHEMA_INVALID' };
  }
  if (event.eventType === 'MEMORY_WRITE_INTENT' &&
      (typeof event.idempotencyKey !== 'string' || !event.idempotencyKey.trim() ||
       typeof event.purpose !== 'string' || !event.purpose.trim())) {
    return { valid: false, reason: 'AUDIT_INTENT_FIELDS_REQUIRED' };
  }
  if (event.eventType === 'MEMORY_WRITE_COMPLETED' &&
      (!Number.isSafeInteger(event.revision) || event.revision < 1 ||
       typeof event.memoryId !== 'string' || !event.memoryId.trim())) {
    return { valid: false, reason: 'AUDIT_COMPLETION_FIELDS_REQUIRED' };
  }
  return { valid: true };
}

async function verifyDurableAuditEvent(audit, event, context) {
  const ready = auditProviderReadiness(audit);
  if (!ready.ready) return { valid: false, status: 'NOT_CONFIGURED', reason: ready.reason };
  let proof;
  try {
    proof = await audit.verifyEvent(event.eventId, context);
  } catch (_) {
    return { valid: false, status: 'UNKNOWN', reason: 'AUDIT_VERIFICATION_UNAVAILABLE' };
  }
  if (!proof || proof.valid !== true || proof.chainVerified !== true ||
      proof.authenticityVerified !== true ||
      proof.eventId !== event.eventId || proof.projectId !== event.projectId ||
      !Number.isSafeInteger(proof.sequence) || proof.sequence < 1 ||
      typeof proof.eventHash !== 'string' || !/^[a-f0-9]{64}$/.test(proof.eventHash) ||
      (proof.previousEventHash !== null && typeof proof.previousEventHash !== 'string') ||
      proof.eventHash !== createAuditEventHash(event, proof.previousEventHash, proof.sequence)) {
    return { valid: false, status: 'INTEGRITY_FAILED', reason: 'AUDIT_EVENT_PROOF_INVALID' };
  }
  return { valid: true, status: 'VERIFIED', sequence: proof.sequence, eventHash: proof.eventHash };
}

module.exports = {
  REQUIRED_CAPABILITIES,
  auditProviderReadiness,
  validateAuditEvent,
  createAuditEventHash,
  verifyDurableAuditEvent
};
