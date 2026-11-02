'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const policy = require('../services/engineering/gate-status-policy');
const engine = require('../services/engineering/bug-hunter-repair-engine');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(name + '=PASS');
  } catch (e) {
    failed++;
    console.log(name + '=FAIL: ' + e.message);
  }
}

check('EMPTY_GATES_NOT_APPROVED', () => {
  assert.notEqual(policy.aggregate([]).status, 'APPROVED');
});

check('CLASSIFIER_REJECTS_MISSING_EXECUTION', () => {
  assert.equal(policy.classify({
    exitCode: 0,
    assertionsPassed: true,
    coverageComplete: true,
    evidenceVerified: true
  }), 'INCONCLUSIVE');
});

check('CLASSIFIER_REJECTS_UNVERIFIED_EVIDENCE', () => {
  assert.equal(policy.classify({
    executed: true,
    exitCode: 0,
    assertionsPassed: true,
    coverageComplete: true,
    evidenceVerified: false
  }), 'INCONCLUSIVE');
});

check('FORGED_GATE_STATUS_CANNOT_APPROVE', () => {
  const result = policy.aggregate([
    { id: 'caller-forged', mandatory: true, status: 'PASS' }
  ]);
  assert.notEqual(result.status, 'APPROVED');
  assert.equal(result.approved, false);
  assert.equal(result.mayApply, false);
  assert.equal(result.status, 'REVIEW_REQUIRED');
});

check('REPAIR_ENGINE_HAS_NO_PRODUCTION_APPLY_PERMISSION', () => {
  const source = require('node:fs').readFileSync(
    path.join(__dirname, '../services/engineering/bug-hunter-repair-engine.js'),
    'utf8'
  );
  assert.match(source, /productionApplyAllowed:\s*false/);
});

check('APPROVAL_GUARD_MODULES_DISCOVERED', () => {
  const fs = require('node:fs');
  const names = [
    '../services/mira-approval-validation-guard',
    '../services/mira-approval-provenance-guard',
    '../services/mira-approval-authority-guard',
    '../services/mira-approval-replay-guard'
  ];
  const available = names.filter(n => {
    try { require.resolve(n); return true; } catch { return false; }
  });
  assert.ok(available.length > 0, 'No existing approval guard module resolved');
  console.log('AVAILABLE_APPROVAL_GUARDS=' + available.length);
});

console.log('ASSERTIONS_PASSED=' + passed);
console.log('ASSERTIONS_FAILED=' + failed);
console.log('BUG_HUNTER_TRUST_GAP_TEST=' + (failed === 0 ? 'PASS' : 'FAIL'));
console.log('NOTE=PASS means expected behavior/gap was reproduced, not that the security gap is fixed');
if (failed) process.exitCode = 1;
