'use strict';

const { auditProviderReadiness, verifyDurableAuditEvent } = require('./audit-contract');
const { operationRegistryReadiness, claimOperation, markOperationUncertain, completeOperation } = require('./operation-registry');
const { evaluateCapabilitySet } = require('./capability-observations');

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
  const readiness = auditProviderReadiness(audit);
  if (!readiness.ready) {
    return { confirmed: false, status: 'NOT_CONFIGURED', reason: readiness.reason };
  }
  let result;
  try {
    result = await audit.append(event, context);
  } catch (error) {
    result = { status: 'UNKNOWN', errorCode: normalizeAdapterError(error) };
  }
  if (result && (result.status === 'APPENDED' || result.status === 'ALREADY_APPENDED')) {
    const proof = await verifyDurableAuditEvent(audit, event, context);
    return proof.valid
      ? { confirmed: true, status: result.status, verification: proof }
      : { confirmed: false, status: proof.status, reason: proof.reason };
  }
  if (result && result.status === 'UNKNOWN' &&
      typeof audit.reconcileEvent === 'function') {
    try {
      const reconciled = await audit.reconcileEvent(event.eventId, context);
      if (reconciled && (reconciled.status === 'APPENDED' ||
          reconciled.status === 'ALREADY_APPENDED')) {
        const proof = await verifyDurableAuditEvent(audit, event, context);
        return proof.valid
          ? { confirmed: true, status: reconciled.status, reconciled: true, verification: proof }
          : { confirmed: false, status: proof.status, reason: proof.reason };
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
  if (!input || !input.provider || !input.audit || !input.registry || !input.context) {
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
  if (record.integrity.status !== 'VERIFIED' || !contentCheck.valid) {
    return fail('INTEGRITY_FAILED', 'CONTENT_HASH_MISMATCH');
  }
  const accessCheck = evaluateAccess(record, context);
  if (!accessCheck.allowed) return fail('NOT_APPROVED', 'WRITE_ACCESS_DENIED', { accessReason: accessCheck.reason });

  if (typeof provider.getCapabilityObservations !== 'function' ||
      typeof provider.write !== 'function' ||
      typeof provider.read !== 'function' ||
      typeof provider.verify !== 'function' ||
      typeof provider.reconcileOperation !== 'function') {
    return fail('NOT_SUPPORTED', 'PROVIDER_CONTRACT_INCOMPLETE');
  }
  if (!provider.guarantees || provider.guarantees.conditionalWrite !== true ||
      provider.guarantees.stableIdempotency !== true ||
      provider.guarantees.authoritativeReconciliation !== true) {
    return fail('NOT_SUPPORTED', 'ATOMIC_CONDITIONAL_WRITE_AND_RECONCILIATION_GUARANTEES_REQUIRED');
  }
  if (!audit || audit.durable !== true) {
    return fail('NOT_CONFIGURED', 'DURABLE_AUDIT_REQUIRED');
  }

  let capabilityResult;
  try {
    const observations = await provider.getCapabilityObservations(context);
    capabilityResult = evaluateCapabilitySet(observations, ['READ', 'WRITE', 'VERIFY'], context, provider.providerId);
  } catch (error) {
    return fail('UNKNOWN', 'CAPABILITY_LOOKUP_FAILED', { errorCode: normalizeAdapterError(error) });
  }
  const capabilities = capabilityResult.states;
  if (!capabilityResult.valid ||
      !isCapabilityAvailable(capabilities, 'READ') ||
      !isCapabilityAvailable(capabilities, 'WRITE') ||
      !isCapabilityAvailable(capabilities, 'VERIFY')) {
    return fail('NOT_APPROVED', 'WRITE_AND_VERIFY_CAPABILITIES_REQUIRED', {
      writeCapability: capabilities && capabilities.WRITE || 'UNKNOWN',
      verifyCapability: capabilities && capabilities.VERIFY || 'UNKNOWN'
    });
  }

  let preState;
  try {
    preState = await provider.read(record.memoryId, context);
  } catch (error) {
    return fail('PROVIDER_ERROR', 'PREWRITE_STATE_READ_FAILED', { errorCode: normalizeAdapterError(error) });
  }
  if (input.expectedRevision === 0) {
    if (preState !== null && preState !== undefined) {
      return fail('CONFLICT', 'CREATE_TARGET_ALREADY_EXISTS');
    }
  } else {
    const preCheck = validateCanonicalRecord(preState);
    if (!preCheck.valid || preState.memoryId !== record.memoryId ||
        preState.projectId !== record.projectId ||
        preState.version.revision !== input.expectedRevision ||
        preState.integrity.status !== 'VERIFIED' || !verifyContentHash(preState).valid) {
      return fail('CONFLICT', 'PREWRITE_REVISION_OR_INTEGRITY_MISMATCH', { errors: preCheck.errors || [] });
    }
  }

  const claim = await claimOperation(input.registry, identity, context);
  if (claim.status === 'REPLAY_COMMITTED') {
    return { ok: true, status: 'REPLAY_COMMITTED', operationId: identity.operationId, priorResult: claim.priorResult || null };
  }
  if (claim.status !== 'CLAIMED') {
    return fail(claim.status, 'IDEMPOTENCY_CLAIM_NOT_GRANTED', { registryReason: claim.reason || null });
  }
  const claimId = claim.claimId;

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
    const registryState = await markOperationUncertain(input.registry, identity, claimId, 'AUDIT_INTENT_UNCERTAIN', context);
    return fail('RECOVERY_REQUIRED', 'AUDIT_INTENT_NOT_CONFIRMED', { audit: intentResult, registry: registryState });
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
      const registryState = await markOperationUncertain(input.registry, identity, claimId, 'WRITE_OUTCOME_UNKNOWN', context);
      return fail('RECOVERY_REQUIRED', 'WRITE_OUTCOME_UNKNOWN', {
        errorCode: normalizeAdapterError(error), registry: registryState
      });
    }
    if (!reconciled || reconciled.status !== 'COMMITTED') {
      const registryState = await markOperationUncertain(input.registry, identity, claimId, 'WRITE_OUTCOME_NOT_CONFIRMED', context);
      return fail('RECOVERY_REQUIRED', 'WRITE_OUTCOME_NOT_CONFIRMED', {
        reconciliationStatus: reconciled && reconciled.status || 'UNKNOWN', registry: registryState
      });
    }
    writeResult = reconciled;
  }

  if (writeResult.status !== 'COMMITTED' ||
      !Number.isSafeInteger(writeResult.revision) ||
      writeResult.revision < 1 ||
      writeResult.revision !== record.version.revision) {
    const registryState = await markOperationUncertain(input.registry, identity, claimId, 'PROVIDER_COMMIT_NOT_VERIFIED', context);
    return fail('PROVIDER_ERROR', 'PROVIDER_COMMIT_NOT_VERIFIED', {
      providerStatus: writeResult.status || 'UNKNOWN', registry: registryState
    });
  }

  let readback;
  try {
    readback = await provider.read(record.memoryId, context);
  } catch (error) {
    const registryState = await markOperationUncertain(input.registry, identity, claimId, 'READBACK_FAILED', context);
    return fail('RECOVERY_REQUIRED', 'READBACK_FAILED', {
      errorCode: normalizeAdapterError(error), revision: writeResult.revision, registry: registryState
    });
  }
  const readbackCheck = validateCanonicalRecord(readback);
  if (!readbackCheck.valid ||
      readback.memoryId !== record.memoryId ||
      readback.projectId !== record.projectId ||
      readback.version.revision !== writeResult.revision ||
      readback.version.contentHash !== record.version.contentHash ||
      sha256Canonical(readback) !== sha256Canonical(record) ||
      !verifyContentHash(readback).valid) {
    const registryState = await markOperationUncertain(input.registry, identity, claimId, 'READBACK_VERIFICATION_FAILED', context);
    return fail('INTEGRITY_FAILED', 'READBACK_VERIFICATION_FAILED', {
      revision: writeResult.revision, errors: readbackCheck.errors || [], registry: registryState
    });
  }

  let providerVerification;
  try {
    providerVerification = await provider.verify(record.memoryId, Object.assign({}, context, {
      expectedRevision: writeResult.revision,
      expectedContentHash: record.version.contentHash
    }));
  } catch (error) {
    const registryState = await markOperationUncertain(input.registry, identity, claimId, 'PROVIDER_VERIFY_FAILED', context);
    return fail('RECOVERY_REQUIRED', 'PROVIDER_VERIFY_FAILED', { errorCode: normalizeAdapterError(error), registry: registryState });
  }
  if (!providerVerification || providerVerification.status !== 'VERIFIED' ||
      providerVerification.memoryId !== record.memoryId ||
      providerVerification.projectId !== record.projectId ||
      providerVerification.revision !== writeResult.revision ||
      providerVerification.contentHash !== record.version.contentHash) {
    const registryState = await markOperationUncertain(input.registry, identity, claimId, 'PROVIDER_VERIFY_MISMATCH', context);
    return fail('INTEGRITY_FAILED', 'PROVIDER_VERIFY_MISMATCH', { registry: registryState });
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
    const registryState = await markOperationUncertain(input.registry, identity, claimId, 'COMMITTED_AUDIT_PENDING', context);
    return fail('COMMITTED_AUDIT_PENDING', 'COMPLETION_AUDIT_NOT_CONFIRMED', {
      revision: writeResult.revision, audit: completionResult, registry: registryState
    });
  }

  const registryResult = await completeOperation(input.registry, identity, claimId, {
    status: 'COMPLETED', revision: writeResult.revision, memoryId: record.memoryId,
    auditEventId: completion.eventId, payloadHash: identity.payloadHash
  }, context);
  if (!registryResult.confirmed) {
    return fail('RECOVERY_REQUIRED', 'REGISTRY_COMPLETION_NOT_CONFIRMED', {
      revision: writeResult.revision, auditCompletion: completionResult.status,
      registry: registryResult
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
    registryCompletion: registryResult.status,
    readbackVerified: true
  };
}

module.exports = { executeGovernedWrite, appendDurableAudit, auditEventId };
