'use strict';

const crypto = require('node:crypto');

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function requiredText(value, label, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(label + ' must be bounded non-empty text.');
  return value.trim();
}
function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
function createFacebookPageOperationIdentity({ pageId, actionId, contentHash } = {}) {
  const safePageId = requiredText(pageId, 'pageId', 32);
  if (!/^\d{1,32}$/.test(safePageId)) throw new Error('pageId must be numeric.');
  const safeActionId = requiredText(actionId, 'actionId', 256);
  const safeHash = requiredText(contentHash, 'contentHash', 64);
  if (!/^[a-f0-9]{64}$/.test(safeHash)) throw new Error('contentHash must be SHA-256.');
  const operationId = 'fbpage-op-' + digest(safePageId + '|' + safeActionId + '|' + safeHash);
  return Object.freeze({ operationId, idempotencyKey: operationId, pageId: safePageId, actionId: safeActionId, contentHash: safeHash });
}

/**
 * Classify a transport outcome without performing transport or authorizing a retry.
 * A Page-post WRITE with an uncertain result must reconcile by readback first.
 */
function classifyFacebookPageTransportOutcome({
  operation, requestAttempted, responseReceived, httpStatus = null, retryAfterSeconds = null
} = {}) {
  if (!['READ', 'WRITE'].includes(operation)) throw new Error('operation must be READ or WRITE.');
  if (typeof requestAttempted !== 'boolean' || typeof responseReceived !== 'boolean') {
    throw new Error('requestAttempted and responseReceived must be boolean.');
  }
  if (!requestAttempted && responseReceived) throw new Error('A response cannot exist when no request was attempted.');
  if (responseReceived && (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) {
    throw new Error('A received response requires a valid HTTP status.');
  }
  if (!responseReceived && httpStatus !== null) throw new Error('httpStatus must be null when no response was received.');
  if (retryAfterSeconds !== null && (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0 || retryAfterSeconds > 86400)) {
    throw new Error('retryAfterSeconds must be between 0 and 86400.');
  }
  if (!requestAttempted) {
    return Object.freeze({ status: 'NOT_SENT', operation, readbackRequired: false, automaticRetryAllowed: false, retryAfterSeconds: null });
  }
  if (!responseReceived) {
    return Object.freeze({
      status: operation === 'WRITE' ? 'WRITE_OUTCOME_UNKNOWN_RECONCILE_BEFORE_RETRY' : 'READ_OUTCOME_UNKNOWN_RETRY_POLICY_REQUIRED',
      operation, readbackRequired: operation === 'WRITE', automaticRetryAllowed: operation === 'READ',
      retryAfterSeconds: null
    });
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    return Object.freeze({
      status: operation === 'WRITE' ? 'PROVIDER_ACCEPTED_PENDING_READBACK' : 'PROVIDER_READ_RESPONSE_UNVERIFIED',
      operation, readbackRequired: operation === 'WRITE', automaticRetryAllowed: false, retryAfterSeconds: null
    });
  }
  if (httpStatus === 429) {
    return Object.freeze({
      status: operation === 'WRITE' ? 'WRITE_RATE_LIMITED_RECONCILE_BEFORE_RETRY' : 'READ_RATE_LIMITED_WAIT_THEN_RETRY',
      operation, readbackRequired: operation === 'WRITE', automaticRetryAllowed: operation === 'READ',
      retryAfterSeconds
    });
  }
  if (httpStatus >= 500) {
    return Object.freeze({
      status: operation === 'WRITE' ? 'WRITE_SERVER_ERROR_OUTCOME_UNKNOWN' : 'READ_SERVER_ERROR_RETRYABLE',
      operation, readbackRequired: operation === 'WRITE', automaticRetryAllowed: operation === 'READ',
      retryAfterSeconds
    });
  }
  return Object.freeze({
    status: httpStatus === 401 || httpStatus === 403 ? 'AUTH_OR_PERMISSION_FAILURE_NO_AUTOMATIC_RETRY' : 'CLIENT_ERROR_NO_AUTOMATIC_RETRY',
    operation, readbackRequired: operation === 'WRITE', automaticRetryAllowed: false, retryAfterSeconds: null
  });
}

/** Produce a retry schedule only; this function never sleeps or sends a request. */
function planFacebookPageRetry({ operation, attempt, maxAttempts = 3, retryAfterSeconds = null, baseDelaySeconds = 2 } = {}) {
  if (!['READ', 'WRITE'].includes(operation)) throw new Error('operation must be READ or WRITE.');
  if (!Number.isInteger(attempt) || attempt < 1 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error('attempt and maxAttempts are invalid.');
  }
  if (!Number.isFinite(baseDelaySeconds) || baseDelaySeconds < 1 || baseDelaySeconds > 60) throw new Error('baseDelaySeconds is invalid.');
  if (retryAfterSeconds !== null && (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0 || retryAfterSeconds > 86400)) {
    throw new Error('retryAfterSeconds is invalid.');
  }
  if (operation === 'WRITE') {
    return Object.freeze({ status: 'RECONCILE_READBACK_BEFORE_ANY_RETRY', automaticRetryAllowed: false, attempt, maxAttempts, waitSeconds: null });
  }
  if (attempt >= maxAttempts) {
    return Object.freeze({ status: 'RETRY_LIMIT_REACHED', automaticRetryAllowed: false, attempt, maxAttempts, waitSeconds: null });
  }
  const exponential = Math.min(baseDelaySeconds * (2 ** (attempt - 1)), 300);
  return Object.freeze({
    status: 'WAIT_THEN_RETRY_READ',
    automaticRetryAllowed: true, attempt, nextAttempt: attempt + 1, maxAttempts,
    waitSeconds: retryAfterSeconds === null ? exponential : Math.max(exponential, retryAfterSeconds)
  });
}

/**
 * Compare a supplied provider readback with the intended write. The input remains
 * caller-supplied evidence; matching does not verify Memory integrity or authorize commit.
 */
function reconcileFacebookPageWrite({ expectedPageId, expectedPostId, expectedContentHash, providerReadback } = {}) {
  const pageId = requiredText(expectedPageId, 'expectedPageId', 32);
  if (!/^\d{1,32}$/.test(pageId)) throw new Error('expectedPageId must be numeric.');
  const contentHash = requiredText(expectedContentHash, 'expectedContentHash', 64);
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error('expectedContentHash must be SHA-256.');
  if (!object(providerReadback) || typeof providerReadback.found !== 'boolean') throw new Error('providerReadback must explicitly declare found.');
  const base = {
    evidenceTrust: 'CALLER_SUPPLIED_NOT_INDEPENDENTLY_VERIFIED',
    integrityStatus: 'UNVERIFIED',
    mayEnterTrustedMemory: false,
    mayCommitCanonicalMemory: false,
    automaticRetryAllowed: false
  };
  if (providerReadback.found === false) {
    return Object.freeze({ ...base, status: 'POST_ABSENCE_ASSERTED_RETRY_REQUIRES_HUMAN_APPROVAL' });
  }
  const postId = requiredText(providerReadback.postId, 'providerReadback.postId', 160);
  const readbackPageId = requiredText(providerReadback.pageId, 'providerReadback.pageId', 32);
  const readbackHash = requiredText(providerReadback.contentHash, 'providerReadback.contentHash', 64);
  if (readbackPageId !== pageId || readbackHash !== contentHash ||
      (expectedPostId !== undefined && expectedPostId !== null && postId !== expectedPostId)) {
    return Object.freeze({ ...base, status: 'READBACK_CONFLICT_REQUIRES_QUARANTINE', postId });
  }
  return Object.freeze({ ...base, status: 'READBACK_MATCHED_PENDING_INDEPENDENT_VERIFICATION', postId, pageId: readbackPageId });
}

module.exports = {
  createFacebookPageOperationIdentity,
  classifyFacebookPageTransportOutcome,
  planFacebookPageRetry,
  reconcileFacebookPageWrite
};
