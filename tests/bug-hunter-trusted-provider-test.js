'use strict';
const assert = require('node:assert/strict');
const provider = require('../services/engineering/bug-hunter-trusted-provider');

(async () => {
  const approval = await provider.validateTrustedApproval({
    planId: 'plan-test',
    approvalId: 'approval-test',
    approval: { planId: 'plan-test', approvalId: 'approval-test' }
  });
  assert.equal(approval.valid, false);
  assert.equal(approval.authorityVerified, false);
  assert.equal(approval.provenanceVerified, false);
  assert.equal(approval.replayChecked, false);
  assert.equal(approval.issuerAuthenticated, false);
  assert.equal(approval.approverIdentityVerified, false);

  const gate = await provider.verifyGateEvidence({
    id: 'untrusted-gate',
    evidenceRef: 'untrusted-path.js',
    gate: { id: 'untrusted-gate', testPath: 'untrusted-path.js' }
  });
  assert.equal(gate.verified, false);
  assert.equal(gate.executed, false);
  assert.equal(gate.coverageComplete, false);
  assert.equal(gate.exitCode, null);
  console.log('TRUSTED_PROVIDER_FAIL_CLOSED_TEST=PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
