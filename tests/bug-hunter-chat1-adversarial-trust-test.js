'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gate = require('../services/engineering/gate-status-policy');
const validation = require('../services/mira-approval-validation-guard');
const provenance = require('../services/mira-approval-provenance-guard');
const authority = require('../services/mira-approval-authority-guard');
const replay = require('../services/mira-approval-replay-guard');
const orchestrator = require('../services/engineering/bug-hunter-orchestrator');

let passed = 0;
let failed = 0;
let review = 0;

function check(name, fn) {
  try {
    const result = fn();
    passed++;
    console.log(name + '=PASS' +
      (result && result.review ? '_GAP_REPRODUCED' : ''));
    if (result && result.review) review++;
  } catch (e) {
    failed++;
    console.log(name + '=FAIL: ' + e.message);
  }
}

const approval = {
  approvalId: 'approval-chat1-test',
  status: 'approved',
  requestId: 'request-A',
  approvedScope: ['bug-hunter-repair'],
  commitmentTypes: ['contract_acceptance'],
  approverId: 'approver-test',
  approverRoles: ['contract_approver'],
  createdAt: new Date().toISOString(),
  revoked: false,
  used: false
};

check('SCOPE_MISMATCH_REJECTED', () => {
  assert.equal(validation.validateApproval({
    approval,
    requestId: 'request-A',
    requestedScope: ['different-scope'],
    commitmentTypes: ['contract_acceptance']
  }).valid, false);
});

check('REQUEST_ID_MISMATCH_REJECTED', () => {
  assert.equal(validation.validateApproval({
    approval,
    requestId: 'request-B',
    requestedScope: ['bug-hunter-repair'],
    commitmentTypes: ['contract_acceptance']
  }).valid, false);
});

check('MISSING_APPROVER_REJECTED', () => {
  assert.equal(provenance.validateApprovalProvenance({
    approval: {...approval, approverId: ''},
    nowMs: Date.now()
  }).valid, false);
});

check('FUTURE_TIMESTAMP_REJECTED', () => {
  assert.equal(provenance.validateApprovalProvenance({
    approval: {...approval, createdAt: '2999-01-01T00:00:00.000Z'},
    nowMs: Date.now()
  }).valid, false);
});

check('CALLER_SUPPLIED_ROLE_AUTHORITY_GAP', () => {
  const result = authority.validateApprovalAuthority({
    approval: {...approval, approverRoles: ['contract_approver']},
    commitmentTypes: ['contract_acceptance']
  });
  assert.equal(result.valid, true);
  return {review: true};
});

check('REPLAY_USED_ID_REJECTED', () => {
  assert.equal(replay.validateApprovalReplay({
    approval,
    usedApprovalIds: [approval.approvalId]
  }).valid, false);
});

check('REVOKED_APPROVAL_REJECTED', () => {
  assert.equal(replay.validateApprovalReplay({
    approval: {...approval, revoked: true}
  }).valid, false);
});

check('STATUS_ONLY_FORGED_GATE_IS_REJECTED', () => {
  const result = gate.aggregate([
    { id: 'forged-by-caller', mandatory: true, status: 'PASS' }
  ]);
  assert.notEqual(result.status, 'APPROVED');
  assert.equal(result.approved, false);
  assert.equal(result.mayApply, false);
});

check('ORCHESTRATOR_APPROVAL_IS_NOT_APPLY_AUTHORITY', () => {
  const source = fs.readFileSync(
    require.resolve('../services/engineering/bug-hunter-orchestrator'),
    'utf8'
  );
  assert.match(source, /mayApply:\s*false/);
});

check('REPAIR_ENGINE_APPLY_REMAINS_DISABLED', () => {
  const source = fs.readFileSync(
    require.resolve('../services/engineering/bug-hunter-repair-engine'),
    'utf8'
  );
  assert.match(source, /productionApplyAllowed:\s*false/);
});

console.log('ASSERTIONS_PASSED=' + passed);
console.log('ASSERTIONS_FAILED=' + failed);
console.log('KNOWN_GAPS_REPRODUCED=' + review);
console.log('ADVERSARIAL_TRUST_TEST=' + (failed === 0 ? 'PASS' : 'FAIL'));
console.log('SECURITY_DECISION=REVIEW_REQUIRED');
console.log('NOTE=PASS means the test reproduced the documented behavior; it does not mean the gap is fixed.');
if (failed) process.exitCode = 1;
