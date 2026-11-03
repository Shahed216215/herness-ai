'use strict';

const {
  validateCanonicalRecord,
  verifyContentHash,
  sha256Canonical,
  evaluateAccess,
  validateOperationIdentity,
  isCapabilityAvailable,
  normalizeAdapterError
} = require('./core');

function auditEventId(context, phase) {
  return 'mira-hfm:' + sha256Canonical({
    projectId: context.projectId,
    operationId: context.operationId,
    phase
  });
}

async function appendDurableAudit(audit, event, context) {
  if (!audit || audit.durable !== true || typeof audit.append !== 'function') {
    return { confirmed: false, status: 'NOT_CONFIGURED', reason: 'DURABLE_AUDIT_REQUIRED' };
  }
  let result;
  try {
    result = await audit.append(event, context);
  } catch (error) {
    result = { status: 'UNKNOWN', errorCode: normalizeAdapterError(error) };
  }
  if (result && (result.status === 'APPENDED' || result.status === 'ALREADY_APPENDED')) {
    return { confirmed: true, status: result.status };
  }
  if (result && result.status === 'UNKNOWN' &&
      typeof audit.reconcileEvent === 'function') {
    try {
      const reconciled = await audit.reconcileEvent(event.eventId, context);
      if (reconciled && (reconciled.status === 'APPENDED' ||
          reconciled.status === 'ALREADY_APPENDED')) {
        return { confirmed: true, status: reconciled.status, reconciled: true };
      }
    } catch (_) {
      // Uncertain audit state remains uncertain; never retry blindly.
    }
  }
  return {
    confirmed: false,
    status: result && result.status ? result.status : 'UNKNOWN',
    reason: 'AUDIT_APPEND_NOT_CONFIRMED'
  };
}

async function executeGovernedWrite(input) {
  const fail = (status, reason, extra) =>
    Object.assign({ ok: false, status, reason }, extra || {});
  if (!input || !input.provider || !input.audit || !input.context) {
    return fail('VALIDATION_FAILED', 'DEPENDENCIES_REQUIRED');
  }
  const provider = input.provider;
  const audit = input.audit;
  const context = input.context;
  const record = input.record;
  const identity = input.operation;

  const identityCheck = validateOperationIdentity(identity);
  if (!identityCheck.valid) {
    return fail('VALIDATION_FAILED', 'OPERATION_IDENTITY_INVALID', { errors: identityCheck.errors });
  }
  if (!record || record.projectId !== identity.projectId ||
      identity.payloadHash !== sha256Canonical(record) ||
      context.authenticated !== true || context.actorAuthorized !== true ||
      context.actionAuthorized !== true || context.policyAllowed !== true ||
      context.action !== 'write' ||
      !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
      record.version.revision !== input.expectedRevision + 1 ||
      context.projectId !== identity.projectId ||
      context.actor !== identity.actor ||
      context.requestId !== identity.requestId ||
      context.purpose !== identity.purpose ||
      context.policyDecisionId !== identity.policyDecisionId) {
    return fail('VALIDATION_FAILED', 'OPERATION_CONTEXT_MISMATCH');
  }
  const recordCheck = validateCanonicalRecord(record);
  if (!recordCheck.valid) {
    return fail('VALIDATION_FAILED', 'CANONICAL_RECORD_INVALID', { errors: recordCheck.errors });
  }
  const contentCheck = verifyContentHash(record);
  if (!contentCheck.valid) return fail('INTEGRITY_FAILED', 'CONTENT_HASH_MISMATCH');
  const accessCheck = evaluateAccess(record, context);
  if (!accessCheck.allowed) return fail('NOT_APPROVED', 'WRITE_ACCESS_DENIED', { accessReason: accessCheck.reason });

  if (typeof provider.getCapabilities !== 'function' ||
      typeof provider.write !== 'function' ||
      typeof provider.read !== 'function' ||
      typeof provider.reconcileOperation !== 'function') {
    return fail('NOT_SUPPORTED', 'PROVIDER_CONTRACT_INCOMPLETE');
  }
  if (!audit || audit.durable !== true) {
    return fail('NOT_CONFIGURED', 'DURABLE_AUDIT_REQUIRED');
  }

  let capabilities;
  try {
    capabilities = await provider.getCapabilities(context);
  } catch (error) {
    return fail('UNKNOWN', 'CAPABILITY_LOOKUP_FAILED', { errorCode: normalizeAdapterError(error) });
  }
  if (!isCapabilityAvailable(capabilities, 'WRITE') ||
      !isCapabilityAvailable(capabilities, 'VERIFY')) {
    return fail('NOT_APPROVED', 'WRITE_AND_VERIFY_CAPABILITIES_REQUIRED', {
      writeCapability: capabilities && capabilities.WRITE || 'UNKNOWN',
      verifyCapability: capabilities && capabilities.VERIFY || 'UNKNOWN'
    });
  }

  const intent = {
    eventId: auditEventId(identity, 'intent'),
    eventType: 'MEMORY_WRITE_INTENT',
    projectId: identity.projectId,
    operationId: identity.operationId,
    idempotencyKey: identity.idempotencyKey,
    payloadHash: identity.payloadHash,
    requestId: identity.requestId,
    actor: identity.actor,
    purpose: identity.purpose,
    policyDecisionId: identity.policyDecisionId
  };
  const intentResult = await appendDurableAudit(audit, intent, context);
  if (!intentResult.confirmed) {
    return fail('RECOVERY_REQUIRED', 'AUDIT_INTENT_NOT_CONFIRMED', { audit: intentResult });
  }

  let writeResult;
  try {
    writeResult = await provider.write(record, {
      ...context,
      operationId: identity.operationId,
      idempotencyKey: identity.idempotencyKey,
      payloadHash: identity.payloadHash,
      expectedRevision: input.expectedRevision
    });
  } catch (error) {
    writeResult = { status: 'UNKNOWN', errorCode: normalizeAdapterError(error) };
  }

  if (!writeResult || writeResult.status === 'UNKNOWN' || writeResult.status === 'TIMEOUT') {
    let reconciled;
    try {
      reconciled = await provider.reconcileOperation(
        identity.operationId,
        identity.idempotencyKey,
        Object.assign({}, context, {
          payloadHash: identity.payloadHash,
          requestId: identity.requestId
        })
      );
    } catch (error) {
      return fail('RECOVERY_REQUIRED', 'WRITE_OUTCOME_UNKNOWN', {
        errorCode: normalizeAdapterError(error)
      });
    }
    if (!reconciled || reconciled.status !== 'COMMITTED') {
      return fail('RECOVERY_REQUIRED', 'WRITE_OUTCOME_NOT_CONFIRMED', {
        reconciliationStatus: reconciled && reconciled.status || 'UNKNOWN'
      });
    }
    writeResult = reconciled;
  }

  if (writeResult.status !== 'COMMITTED' ||
      !Number.isSafeInteger(writeResult.revision) ||
      writeResult.revision < 1) {
    return fail('PROVIDER_ERROR', 'PROVIDER_COMMIT_NOT_VERIFIED', {
      providerStatus: writeResult.status || 'UNKNOWN'
    });
  }

  let readback;
  try {
    readback = await provider.read(record.memoryId, context);
  } catch (error) {
    return fail('RECOVERY_REQUIRED', 'READBACK_FAILED', {
      errorCode: normalizeAdapterError(error),
      revision: writeResult.revision
    });
  }
  const readbackCheck = validateCanonicalRecord(readback);
  if (!readbackCheck.valid ||
      readback.memoryId !== record.memoryId ||
      readback.projectId !== record.projectId ||
      readback.version.revision !== writeResult.revision ||
      readback.version.contentHash !== record.version.contentHash ||
      !verifyContentHash(readback).valid) {
    return fail('INTEGRITY_FAILED', 'READBACK_VERIFICATION_FAILED', {
      revision: writeResult.revision,
      errors: readbackCheck.errors || []
    });
  }

  const completion = {
    eventId: auditEventId(identity, 'completion'),
    eventType: 'MEMORY_WRITE_COMPLETED',
    projectId: identity.projectId,
    operationId: identity.operationId,
    idempotencyKey: identity.idempotencyKey,
    payloadHash: identity.payloadHash,
    revision: writeResult.revision,
    memoryId: record.memoryId,
    requestId: identity.requestId,
    actor: identity.actor,
    policyDecisionId: identity.policyDecisionId
  };
  const completionResult = await appendDurableAudit(audit, completion, context);
  if (!completionResult.confirmed) {
    return fail('COMMITTED_AUDIT_PENDING', 'COMPLETION_AUDIT_NOT_CONFIRMED', {
      revision: writeResult.revision,
      audit: completionResult
    });
  }

  return {
    ok: true,
    status: 'COMPLETED',
    operationId: identity.operationId,
    memoryId: record.memoryId,
    revision: writeResult.revision,
    auditIntent: intentResult.status,
    auditCompletion: completionResult.status,
    readbackVerified: true
  };
}

module.exports = { executeGovernedWrite, appendDurableAudit, auditEventId };
