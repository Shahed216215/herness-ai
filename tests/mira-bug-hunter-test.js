'use strict';

const assert = require('node:assert/strict');
const { classify } = require('../scripts/mira-bug-hunter');

assert.equal(typeof classify, 'function');

const base = {
  executed: true,
  exitCode: 0,
  assertionsPassed: true,
  coverageComplete: true,
  evidenceVerified: true
};

assert.equal(classify(base), 'PASS');
assert.equal(classify({ ...base, executed: false }), 'INCONCLUSIVE');
assert.equal(classify({ ...base, timedOut: true }), 'INCONCLUSIVE');
assert.equal(classify({ ...base, coverageComplete: false }), 'INCONCLUSIVE');
assert.equal(classify({ ...base, evidenceVerified: false }), 'INCONCLUSIVE');
assert.equal(classify({ ...base, assertionFailed: true }), 'FAIL');
assert.equal(classify({ ...base, exitCode: 1 }), 'FAIL');

console.log('BUG_HUNTER_POLICY_TESTS=7');
console.log('BUG_HUNTER_POLICY_TEST_STATUS=PASS');
