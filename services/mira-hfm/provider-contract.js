'use strict';

const { CAPABILITIES, capabilityState } = require('./core');
const { evaluateCapabilitySet } = require('./capability-observations');

function inspectProviderAdapter(adapter) {
  const requiredMethods = ['getCapabilityObservations', 'read', 'search', 'write', 'reconcileOperation'];
  const missingMethods = requiredMethods.filter(name => !adapter || typeof adapter[name] !== 'function');
  const states = {};
  for (const capability of CAPABILITIES) {
    states[capability] = capabilityState(adapter && adapter.capabilities, capability);
  }
  return {
    valid: missingMethods.length === 0,
    missingMethods,
    capabilities: states,
    guarantees: {
      conditionalWrite: !!(adapter && adapter.guarantees && adapter.guarantees.conditionalWrite === true),
      stableIdempotency: !!(adapter && adapter.guarantees && adapter.guarantees.stableIdempotency === true),
      authoritativeReconciliation: !!(adapter && adapter.guarantees && adapter.guarantees.authoritativeReconciliation === true)
    },
    noFallback: true
  };
}

function requireCapability(adapter, capability) {
  if (!CAPABILITIES.includes(capability)) {
    return { allowed: false, status: 'NOT_SUPPORTED', reason: 'CAPABILITY_UNKNOWN' };
  }
  const state = capabilityState(adapter && adapter.capabilities, capability);
  return state === 'AVAILABLE'
    ? { allowed: true, status: 'AVAILABLE' }
    : { allowed: false, status: state, reason: 'CAPABILITY_NOT_AVAILABLE' };
}

function createUnavailableProvider(providerId) {
  const id = typeof providerId === 'string' && providerId.trim() ? providerId : 'UNCONFIGURED';
  const unavailable = async () => ({ status: 'NOT_CONFIGURED', providerId: id });
  return Object.freeze({
    providerId: id,
    guarantees: Object.freeze({ conditionalWrite: false, stableIdempotency: false, authoritativeReconciliation: false }),
    capabilities: Object.freeze({
      READ: 'NOT_CONFIGURED', WRITE: 'NOT_CONFIGURED',
      SEARCH: 'NOT_CONFIGURED', VERIFY: 'NOT_CONFIGURED',
      BACKUP: 'NOT_CONFIGURED', RESTORE: 'NOT_CONFIGURED'
    }),
    getCapabilities: async () => Object.assign({}, {
      READ: 'NOT_CONFIGURED', WRITE: 'NOT_CONFIGURED',
      SEARCH: 'NOT_CONFIGURED', VERIFY: 'NOT_CONFIGURED',
      BACKUP: 'NOT_CONFIGURED', RESTORE: 'NOT_CONFIGURED'
    }),
    getCapabilityObservations: async () => [],
    read: unavailable,
    search: unavailable,
    write: unavailable,
    reconcileOperation: unavailable
  });
}

module.exports = { inspectProviderAdapter, requireCapability, createUnavailableProvider, evaluateCapabilitySet };
