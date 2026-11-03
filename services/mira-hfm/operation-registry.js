'use strict';

const { validateOperationIdentity, sha256Canonical } = require('./core');

function operationRegistryReadiness(store) {
  if (!store || store.durable !== true || store.atomicClaim !== true ||
      store.projectScoped !== true || typeof store.claim !== 'function' ||
      typeof store.lookup !== 'function' || typeof store.complete !== 'function' ||
      typeof store.markUncertain !== 'function' || typeof store.reconcile !== 'function') {
    return { ready: false, reason: 'DURABLE_ATOMIC_PROJECT_SCOPED_REGISTRY_REQUIRED' };
  }
  return { ready: true };
}

async function claimOperation(store, identity, context) {
  const valid = validateOperationIdentity(identity);
  if (!valid.valid) return { status: 'VALIDATION_FAILED', errors: valid.errors };
  const ready = operationRegistryReadiness(store);
  if (!ready.ready) return { status: 'NOT_CONFIGURED', reason: ready.reason };
  let result;
  try {
    result = await store.claim(identity, context);
  } catch (_) {
    return { status: 'UNKNOWN', reason: 'REGISTRY_CLAIM_UNCERTAIN' };
  }
  if (!result || typeof result.status !== 'string') {
    return { status: 'UNKNOWN', reason: 'REGISTRY_CLAIM_RESPONSE_INVALID' };
  }
  if (result.status === 'CLAIMED') {
    if (typeof result.claimId !== 'string' || !result.claimId ||
        result.identityHash !== sha256Canonical(identity)) {
      return { status: 'UNKNOWN', reason: 'REGISTRY_CLAIM_BINDING_INVALID' };
    }
    return { status: 'CLAIMED', claimId: result.claimId, identityHash: result.identityHash };
  }
  if (['REPLAY_COMMITTED', 'IN_PROGRESS', 'PAYLOAD_CONFLICT', 'UNKNOWN', 'REVIEW_REQUIRED'].includes(result.status)) {
    return result;
  }
  return { status: 'UNKNOWN', reason: 'REGISTRY_STATUS_UNSUPPORTED' };
}

async function markOperationUncertain(store, identity, claimId, state, context) {
  const ready = operationRegistryReadiness(store);
  if (!ready.ready || typeof claimId !== 'string' || !claimId) {
    return { confirmed: false, status: 'NOT_CONFIGURED' };
  }
  try {
    const result = await store.markUncertain({
      identity, claimId, state, identityHash: sha256Canonical(identity)
    }, context);
    return result && result.status === 'RECORDED'
      ? { confirmed: true, status: 'RECORDED' }
      : { confirmed: false, status: result && result.status || 'UNKNOWN' };
  } catch (_) {
    return { confirmed: false, status: 'UNKNOWN' };
  }
}

async function completeOperation(store, identity, claimId, result, context) {
  const ready = operationRegistryReadiness(store);
  if (!ready.ready || typeof claimId !== 'string' || !claimId) {
    return { confirmed: false, status: 'NOT_CONFIGURED' };
  }
  try {
    const response = await store.complete({
      identity, claimId, result, identityHash: sha256Canonical(identity)
    }, context);
    if (response && ['COMPLETED', 'ALREADY_COMPLETED'].includes(response.status) &&
        response.identityHash === sha256Canonical(identity)) {
      return { confirmed: true, status: response.status };
    }
    return { confirmed: false, status: response && response.status || 'UNKNOWN' };
  } catch (_) {
    return { confirmed: false, status: 'UNKNOWN' };
  }
}

module.exports = {
  operationRegistryReadiness,
  claimOperation,
  markOperationUncertain,
  completeOperation
};
