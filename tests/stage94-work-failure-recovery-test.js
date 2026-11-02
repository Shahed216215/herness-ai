'use strict';

const assert = require('assert');
const {
  STATES,
  createRecovery,
  diagnose,
  retry,
  alternativeMethod,
  reTest,
  assertNoFakeCompletion,
  getRecoverySummary
} = require('../services/work-failure-recovery-engine');

function testNormalRecovery() {
  let s = createRecovery({id: 'normal'}, {maxRetries: 3});
  s = diagnose(s, 'temporary_execution_error');
  s = retry(s, () => ({success: true, output: 'verified'}));

  assert.strictEqual(s.status, STATES.SUCCESS);
  assert.strictEqual(s.attempt, 1);
  assert.strictEqual(s.result.success, true);
  assert.doesNotThrow(() => assertNoFakeCompletion(s));
}

function testAlternativeRecovery() {
  let s = createRecovery({id: 'alternative'}, {maxRetries: 3});
  s = diagnose(s, 'primary_method_failed');
  s = retry(s, () => ({success: false, error: 'primary_failed'}));
  s = alternativeMethod(s, 'secondary_verified_method');
  s = retry(s, () => ({success: true, output: 'verified'}));

  assert.strictEqual(s.status, STATES.SUCCESS);
  assert.strictEqual(s.alternativesTried.length, 1);
}

function testRepeatedFailureEscalation() {
  let s = createRecovery({id: 'escalation'}, {maxRetries: 2});
  s = diagnose(s, 'persistent_failure');

  s = retry(s, () => ({success: false, error: 'attempt_1_failed'}));
  s = diagnose(s, 'persistent_failure');
  s = retry(s, () => ({success: false, error: 'attempt_2_failed'}));

  assert.strictEqual(s.status, STATES.CLIENT_SAFE);
  assert.strictEqual(s.escalated, true);
  assert.ok(s.clientResponse);
  assert.strictEqual(s.fakeCompletionBlocked, true);
  assert.throws(() => assertNoFakeCompletion(s), /FAKE_COMPLETION_BLOCKED/);
}

function testRetestFailure() {
  let s = createRecovery({id: 'retest'}, {maxRetries: 3});
  s = diagnose(s, 'output_uncertain');
  s = retry(s, () => ({success: false, error: 'execution_failed'}));
  s = alternativeMethod(s, 'fallback_method');
  s = reTest(s, () => ({success: false, error: 'verification_failed'}));

  assert.strictEqual(s.status, STATES.FAILURE);
  assert.strictEqual(s.fakeCompletionBlocked, true);
  assert.throws(() => assertNoFakeCompletion(s), /FAKE_COMPLETION_BLOCKED/);
}

function testSummary() {
  const s = createRecovery({id: 'summary'});
  const summary = getRecoverySummary(s);

  assert.strictEqual(summary.id, 'summary');
  assert.strictEqual(summary.completionVerified, false);
  assert.strictEqual(summary.fakeCompletionBlocked, true);
}

testNormalRecovery();
testAlternativeRecovery();
testRepeatedFailureEscalation();
testRetestFailure();
testSummary();

console.log('STAGE94_WORK_FAILURE_RECOVERY_TEST: PASS');
