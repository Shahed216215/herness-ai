'use strict';

const {
  validateCanonicalRecord,
  verifyContentHash,
  evaluateAccess,
  isCapabilityAvailable,
  normalizeAdapterError,
  canonicalize
} = require('./core');
const { evaluateCapabilitySet } = require('./capability-observations');

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

async function capabilitiesFor(provider, context, requiredCapabilities) {
  if (!provider || typeof provider.getCapabilityObservations !== 'function' || typeof provider.providerId !== 'string') {
    return { ok: false, status: 'NOT_CONFIGURED' };
  }
  try {
    const observations = await provider.getCapabilityObservations(context);
    const evaluated = evaluateCapabilitySet(observations, requiredCapabilities, context, provider.providerId);
    return { ok: true, capabilities: evaluated.states, observationsValid: evaluated.valid };
  } catch (error) {
    return { ok: false, status: 'UNKNOWN', errorCode: normalizeAdapterError(error) };
  }
}

async function readMemory(provider, memoryId, context) {
  if (typeof memoryId !== 'string' || !memoryId.trim() || !context) {
    return { ok: false, status: 'VALIDATION_FAILED' };
  }
  const capability = await capabilitiesFor(provider, context, ['READ', 'VERIFY']);
  if (!capability.ok) return capability;
  if (!isCapabilityAvailable(capability.capabilities, 'READ') ||
      !isCapabilityAvailable(capability.capabilities, 'VERIFY')) {
    return { ok: false, status: 'NOT_APPROVED', reason: 'READ_AND_VERIFY_CAPABILITIES_REQUIRED' };
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
  if (filters !== undefined && (!filters || typeof filters !== 'object' || Array.isArray(filters))) {
    return { ok: false, status: 'VALIDATION_FAILED', reason: 'SEARCH_FILTERS_INVALID' };
  }
  if (filters && filters.projectId !== undefined && filters.projectId !== context.projectId) {
    return { ok: false, status: 'NOT_APPROVED', reason: 'SEARCH_PROJECT_SCOPE_MISMATCH' };
  }
  const limit = filters && filters.limit !== undefined ? filters.limit : 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, status: 'VALIDATION_FAILED', reason: 'RETRIEVAL_LIMIT_INVALID' };
  }
  const capability = await capabilitiesFor(provider, context, ['SEARCH', 'VERIFY']);
  if (!capability.ok) return capability;
  if (!isCapabilityAvailable(capability.capabilities, 'SEARCH') ||
      !isCapabilityAvailable(capability.capabilities, 'VERIFY')) {
    return { ok: false, status: 'NOT_APPROVED', reason: 'SEARCH_AND_VERIFY_CAPABILITIES_REQUIRED' };
  }
  if (typeof provider.search !== 'function') {
    return { ok: false, status: 'NOT_SUPPORTED' };
  }
  if (!provider.guarantees || provider.guarantees.boundedSearch !== true) {
    return { ok: false, status: 'NOT_APPROVED', reason: 'BOUNDED_SEARCH_GUARANTEE_REQUIRED' };
  }
  const cursor = filters && filters.cursor !== undefined ? filters.cursor : null;
  const snapshotToken = filters && filters.snapshotToken !== undefined ? filters.snapshotToken : null;
  if (cursor !== null && (typeof cursor !== 'string' || cursor.length > 2048 ||
      !/^[A-Za-z0-9._~=-]+$/.test(cursor) || !provider.guarantees.opaqueCursor)) {
    return { ok: false, status: 'VALIDATION_FAILED', reason: 'SEARCH_CURSOR_INVALID' };
  }
  if (snapshotToken !== null && (typeof snapshotToken !== 'string' || snapshotToken.length > 2048 ||
      !/^[A-Za-z0-9._~=-]+$/.test(snapshotToken) || provider.guarantees.stablePagination !== true)) {
    return { ok: false, status: 'VALIDATION_FAILED', reason: 'SEARCH_SNAPSHOT_TOKEN_INVALID_OR_UNSUPPORTED' };
  }
  const timeoutMs = context.searchTimeoutMs === undefined ? 5000 : context.searchTimeoutMs;
  const maxResponseBytes = filters && filters.maxResponseBytes !== undefined ? filters.maxResponseBytes : 1000000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000 ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 2000000) {
    return { ok: false, status: 'VALIDATION_FAILED', reason: 'SEARCH_BOUND_INVALID' };
  }
  if (context.signal && context.signal.aborted) {
    return { ok: false, status: 'CANCELLED' };
  }
  let result;
  try {
    result = await provider.search(query, Object.assign({}, filters, {
      projectId: context.projectId, cursor, snapshotToken,
      limit, timeoutMs, maxResponseBytes, signal: context.signal || null
    }), context);
  } catch (error) {
    return { ok: false, status: normalizeAdapterError(error) };
  }
  if (context.signal && context.signal.aborted) return { ok: false, status: 'CANCELLED' };
  if (!result || !Array.isArray(result.records) || result.records.length > limit) {
    return { ok: false, status: 'PROVIDER_ERROR', reason: 'SEARCH_RESPONSE_INVALID_OR_OVER_LIMIT' };
  }
  let responseBytes;
  try {
    responseBytes = Buffer.byteLength(canonicalize(result.records), 'utf8');
  } catch (_) {
    return { ok: false, status: 'PROVIDER_ERROR', reason: 'SEARCH_RESPONSE_NOT_CANONICAL_JSON' };
  }
  if (responseBytes > maxResponseBytes) {
    return { ok: false, status: 'PROVIDER_ERROR', reason: 'SEARCH_RESPONSE_BYTE_LIMIT_EXCEEDED' };
  }
  if (result.nextCursor !== undefined && result.nextCursor !== null &&
      (typeof result.nextCursor !== 'string' || result.nextCursor.length > 2048 ||
       !/^[A-Za-z0-9._~=-]+$/.test(result.nextCursor) ||
       !provider.guarantees.opaqueCursor)) {
    return { ok: false, status: 'PROVIDER_ERROR', reason: 'SEARCH_CURSOR_INVALID_OR_NOT_OPAQUE' };
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
    nextCursor: typeof result.nextCursor === 'string' ? result.nextCursor : null,
    truncated: typeof result.nextCursor === 'string'
  };
}

module.exports = { readMemory, searchMemory, validateVisibleRecord };
