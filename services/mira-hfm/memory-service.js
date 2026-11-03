'use strict';

const {
  validateCanonicalRecord,
  verifyContentHash,
  evaluateAccess,
  isCapabilityAvailable,
  normalizeAdapterError
} = require('./core');

function deniedResult() {
  // Do not reveal whether an inaccessible record exists.
  return { ok: false, status: 'NOT_FOUND' };
}

function validateVisibleRecord(record, context, action) {
  const validation = validateCanonicalRecord(record);
  if (!validation.valid) return deniedResult();
  const access = evaluateAccess(record, Object.assign({}, context, { action }));
  if (!access.allowed) return deniedResult();
  if (record.integrity.status !== 'VERIFIED' || !verifyContentHash(record).valid) {
    return { ok: false, status: 'INTEGRITY_FAILED' };
  }
  if (record.lifecycle !== 'ACTIVE' ||
      record.trust.status === 'QUARANTINED') return deniedResult();
  return { ok: true, record };
}

async function capabilitiesFor(provider, context) {
  if (!provider || typeof provider.getCapabilities !== 'function') {
    return { ok: false, status: 'NOT_CONFIGURED' };
  }
  try {
    const capabilities = await provider.getCapabilities(context);
    return { ok: true, capabilities };
  } catch (error) {
    return { ok: false, status: 'UNKNOWN', errorCode: normalizeAdapterError(error) };
  }
}

async function readMemory(provider, memoryId, context) {
  if (typeof memoryId !== 'string' || !memoryId.trim() || !context) {
    return { ok: false, status: 'VALIDATION_FAILED' };
  }
  const capability = await capabilitiesFor(provider, context);
  if (!capability.ok) return capability;
  if (!isCapabilityAvailable(capability.capabilities, 'READ')) {
    return { ok: false, status: 'NOT_APPROVED', reason: 'READ_CAPABILITY_UNAVAILABLE' };
  }
  if (typeof provider.read !== 'function') {
    return { ok: false, status: 'NOT_SUPPORTED' };
  }
  let record;
  try {
    record = await provider.read(memoryId, context);
  } catch (error) {
    return { ok: false, status: normalizeAdapterError(error) };
  }
  if (!record) return { ok: false, status: 'NOT_FOUND' };
  const checked = validateVisibleRecord(record, context, 'read');
  if (!checked.ok) return checked;
  return { ok: true, status: 'SUCCESS', record: checked.record };
}

async function searchMemory(provider, query, filters, context) {
  if (typeof query !== 'string' || !query.trim() || !context) {
    return { ok: false, status: 'VALIDATION_FAILED' };
  }
  const limit = filters && filters.limit !== undefined ? filters.limit : 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, status: 'VALIDATION_FAILED', reason: 'RETRIEVAL_LIMIT_INVALID' };
  }
  const capability = await capabilitiesFor(provider, context);
  if (!capability.ok) return capability;
  if (!isCapabilityAvailable(capability.capabilities, 'SEARCH')) {
    return { ok: false, status: 'NOT_APPROVED', reason: 'SEARCH_CAPABILITY_UNAVAILABLE' };
  }
  if (typeof provider.search !== 'function') {
    return { ok: false, status: 'NOT_SUPPORTED' };
  }
  let result;
  try {
    result = await provider.search(query, Object.assign({}, filters, { limit }), context);
  } catch (error) {
    return { ok: false, status: normalizeAdapterError(error) };
  }
  if (!result || !Array.isArray(result.records)) {
    return { ok: false, status: 'PROVIDER_ERROR', reason: 'SEARCH_RESPONSE_INVALID' };
  }

  const visible = [];
  for (const record of result.records) {
    const checked = validateVisibleRecord(record, context, 'search');
    if (checked.ok) visible.push(checked.record);
  }
  return {
    ok: true,
    status: 'SUCCESS',
    records: visible.slice(0, limit),
    nextCursor: typeof result.nextCursor === 'string' ? result.nextCursor : null
  };
}

module.exports = { readMemory, searchMemory, validateVisibleRecord };
