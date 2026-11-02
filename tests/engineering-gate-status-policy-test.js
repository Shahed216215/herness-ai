'use strict';

const assert = require('node:assert/strict');
const { classify, aggregate } =
  require('../services/engineering/gate-status-policy');

const valid = {
  executed: true,
  exitCode: 0,
  assertionsPassed: true,
  coverageComplete: true,
  evidenceVerified: true
};

const cases = [
  ['complete verified execution', valid, 'PASS'],
  ['not executed', { ...valid, executed: false }, 'INCONCLUSIVE'],
  ['missing exit code', { ...valid, exitCode: null }, 'INCONCLUSIVE'],
  ['timeout', { ...valid, timedOut: true }, 'INCONCLUSIVE'],
  ['skipped', { ...valid, skipped: true }, 'INCONCLUSIVE'],
  ['missing dependency', { ...valid, dependencyMissing: true }, 'INCONCLUSIVE'],
  ['incomplete coverage', { ...valid, coverageComplete: false }, 'INCONCLUSIVE'],
  ['unverified evidence', { ...valid, evidenceVerified: false }, 'INCONCLUSIVE'],
  ['assertions not proven', { ...valid, assertionsPassed: false }, 'INCONCLUSIVE'],
  ['assertion failure', { ...valid, assertionFailed: true }, 'FAIL'],
  ['security violation', { ...valid, securityViolation: true }, 'FAIL'],
  ['nonzero exit', { ...valid, exitCode: 2 }, 'FAIL'],
  ['execution error', { ...valid, executionError: true }, 'INCONCLUSIVE']
];

for (const [name, input, expected] of cases) {
  assert.equal(classify(input), expected, name);
}

// Caller-supplied gate statuses cannot grant approval without trusted
// gate registry and evidence verification; remain fail-closed.
for (const result of [
  aggregate([]),
  aggregate([
    { id: 'security', mandatory: true, status: 'PASS' },
    { id: 'model-eval', mandatory: true, status: 'INCONCLUSIVE' }
  ]),
  aggregate([
    { id: 'security', mandatory: true, status: 'PASS' },
    { id: 'model-eval', mandatory: true, status: 'PASS' }
  ]),
  aggregate([
    { id: 'unknown', mandatory: true, status: 'INVALID' }
  ])
]) {
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.approved, false);
  assert.equal(result.mayApply, false);
}

console.log(`POLICY_TESTS=${cases.length + 4}`);
console.log('POLICY_TEST_STATUS=PASS');
