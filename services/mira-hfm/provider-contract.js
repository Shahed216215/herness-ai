'use strict';

const { CAPABILITIES, capabilityState } = require('./core');

function inspectProviderAdapter(adapter) {
  const requiredMethods = ['getCapabilities', 'read', 'search', 'write', 'reconcileOperation'];
  const missingMethods = requiredMethods.filter(name => !adapter || typeof adapter[name] !== 'function');
  const states = {};
  for (const capability of CAPABILITIES) {
    states[capability] = capabilityState(adapter && adapter.capabilities, capability);
  }
  return {
    valid: missingMethods.length === 0,
    missingMethods,
    capabilities: states,
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
    read: unavailable,
    search: unavailable,
    write: unavailable,
    reconcileOperation: unavailable
  });
}

module.exports = { inspectProviderAdapter, requireCapability, createUnavailableProvider };
