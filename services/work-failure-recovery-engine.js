'use strict';

const crypto = require('crypto');

const STATES = Object.freeze({
  FAILURE: 'failure',
  DIAGNOSE: 'diagnose',
  RETRY: 'retry',
  ALTERNATIVE: 'alternative_method',
  RE_TEST: 're_test',
  SUCCESS: 'success',
  ESCALATE: 'escalate',
  CLIENT_SAFE: 'client_safe_response'
});

const DEFAULT_MAX_RETRIES = 3;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRecovery(work = {}, options = {}) {
  const maxRetries = Number.isInteger(options.maxRetries)
    ? Math.max(1, options.maxRetries)
    : DEFAULT_MAX_RETRIES;

  return {
    id: work.id || crypto.randomUUID(),
    workId: work.id || null,
    status: STATES.FAILURE,
    attempt: 0,
    maxRetries,
    diagnosis: null,
    errors: [],
    alternativesTried: [],
    result: null,
    clientResponse: null,
    fakeCompletionBlocked: true,
    escalated: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function diagnose(state, diagnosis) {
  if (!state || state.status !== STATES.FAILURE)
    throw new Error('Recovery must start from failure');

  state.diagnosis = String(diagnosis || 'unknown_failure');
  state.status = STATES.DIAGNOSE;
  state.updatedAt = new Date().toISOString();
  return state;
}

function retry(state, executor) {
  if (state.status !== STATES.DIAGNOSE &&
      state.status !== STATES.ALTERNATIVE)
    throw new Error('Retry requires diagnosis or alternative method');

  if (state.attempt >= state.maxRetries) {
    return escalate(state, 'retry_limit_reached');
  }

  state.attempt += 1;
  state.status = STATES.RETRY;
  state.updatedAt = new Date().toISOString();

  let result;
  try {
    result = typeof executor === 'function' ? executor(state) : null;
  } catch (error) {
    state.errors.push({
      type: 'retry_exception',
      message: error.message,
      attempt: state.attempt
    });
    state.status = STATES.FAILURE;
    state.updatedAt = new Date().toISOString();
    return state;
  }

  if (result && result.success === true) {
    return markSuccess(state, result);
  }

  state.errors.push({
    type: 'retry_failed',
    message: result && result.error
      ? String(result.error)
      : 'retry_failed',
    attempt: state.attempt
  });

  if (state.attempt >= state.maxRetries) {
    return escalate(state, 'retry_limit_reached');
  }

  state.status = STATES.FAILURE;
  state.updatedAt = new Date().toISOString();
  return state;
}

function alternativeMethod(state, method) {
  if (state.status !== STATES.FAILURE)
    throw new Error('Alternative method requires failure');

  const name = String(method || '').trim();
  if (!name) throw new Error('Alternative method is required');

  state.alternativesTried.push({
    method: name,
    at: new Date().toISOString()
  });
  state.status = STATES.ALTERNATIVE;
  state.updatedAt = new Date().toISOString();
  return state;
}

function reTest(state, tester) {
  if (state.status !== STATES.FAILURE &&
      state.status !== STATES.ALTERNATIVE &&
      state.status !== STATES.RETRY)
    throw new Error('Re-test requires an execution attempt');

  let result;
  try {
    result = typeof tester === 'function' ? tester(state) : null;
  } catch (error) {
    state.errors.push({
      type: 'retest_exception',
      message: error.message
    });
    state.status = STATES.FAILURE;
    state.updatedAt = new Date().toISOString();
    return state;
  }

  if (result && result.success === true)
    return markSuccess(state, result);

  state.errors.push({
    type: 'retest_failed',
    message: result && result.error
      ? String(result.error)
      : 'retest_failed'
  });
  state.status = STATES.FAILURE;
  state.updatedAt = new Date().toISOString();

  if (state.attempt >= state.maxRetries)
    return escalate(state, 'retest_limit_reached');

  return state;
}

function markSuccess(state, result) {
  if (!result || result.success !== true)
    throw new Error('SUCCESS requires verified success');

  state.status = STATES.SUCCESS;
  state.result = clone(result);
  state.fakeCompletionBlocked = true;
  state.updatedAt = new Date().toISOString();
  return state;
}

function escalate(state, reason) {
  state.status = STATES.ESCALATE;
  state.escalated = true;
  state.errors.push({
    type: 'escalation',
    message: String(reason || 'repeated_failure')
  });
  state.updatedAt = new Date().toISOString();
  return clientSafeResponse(state);
}

function clientSafeResponse(state, message) {
  if (state.status !== STATES.ESCALATE)
    throw new Error('Client-safe response requires escalation');

  state.status = STATES.CLIENT_SAFE;
  state.clientResponse = String(
    message ||
    'The requested work could not be completed reliably after recovery attempts. The issue has been escalated for review.'
  );
  state.fakeCompletionBlocked = true;
  state.updatedAt = new Date().toISOString();
  return state;
}

function canClaimCompletion(state) {
  return Boolean(
    state &&
    state.status === STATES.SUCCESS &&
    state.result &&
    state.result.success === true
  );
}

function assertNoFakeCompletion(state) {
  if (!canClaimCompletion(state))
    throw new Error('FAKE_COMPLETION_BLOCKED');
  return true;
}

function getRecoverySummary(state) {
  return {
    id: state.id,
    workId: state.workId,
    status: state.status,
    attempt: state.attempt,
    maxRetries: state.maxRetries,
    diagnosis: state.diagnosis,
    errors: state.errors.length,
    alternatives: state.alternativesTried.length,
    escalated: state.escalated,
    completionVerified: canClaimCompletion(state),
    fakeCompletionBlocked: state.fakeCompletionBlocked
  };
}

module.exports = {
  STATES,
  createRecovery,
  diagnose,
  retry,
  alternativeMethod,
  reTest,
  markSuccess,
  escalate,
  clientSafeResponse,
  canClaimCompletion,
  assertNoFakeCompletion,
  getRecoverySummary
};
