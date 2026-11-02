'use strict';

const assert = require('node:assert/strict');
const trust = require('../services/engineering/bug-hunter-trust-contract');

(async () => {
  let passed = 0;
  let failed = 0;

  async function check(name, fn) {
    try {
      await fn();
      passed++;
      console.log(name + '=PASS');
    } catch (e) {
      failed++;
      console.log(name + '=FAIL: ' + e.message);
    }
  }

  await check('APPROVAL_NO_PROVIDER_FAILS_CLOSED', async () => {
    const r = await trust.validateApproval({
      planId: 'plan-1', approvalId: 'approval-1',
      approverRoles: ['contract_approver']
    });
    assert.equal(r.trusted, false);
  });

  await check('GATE_STATUS_ONLY_FAILS_CLOSED', async () => {
    const r = await trust.evaluateGateEvidence({
      id: 'syntax', status: 'PASS'
    });
    assert.equal(r.trusted, false);
  });

  await check('APPROVAL_PROVIDER_EXCEPTION_FAILS_CLOSED', async () => {
    const r = await trust.validateApproval(
      {planId: 'p', approvalId: 'a'},
      {validateTrustedApproval: async () => { throw Error('offline'); }}
    );
    assert.equal(r.trusted, false);
  });

  await check('APPROVAL_MISMATCH_FAILS_CLOSED', async () => {
    const r = await trust.validateApproval(
      {planId: 'p1', approvalId: 'a1'},
      {validateTrustedApproval: async () => ({
        valid: true, planId: 'p2', approvalId: 'a1',
        authorityVerified: true, provenanceVerified: true, replayChecked: true, issuerAuthenticated: true, approverIdentityVerified: true
      })}
    );
    assert.equal(r.trusted, false);
  });

  await check('APPROVAL_MISSING_AUTHORITY_FAILS_CLOSED', async () => {
    const r = await trust.validateApproval(
      {planId: 'p', approvalId: 'a'},
      {validateTrustedApproval: async () => ({
        valid: true, planId: 'p', approvalId: 'a',
        authorityVerified: false, provenanceVerified: true,
        replayChecked: true
      })}
    );
    assert.equal(r.trusted, false);
  });

  await check('UNVERIFIED_GATE_EVIDENCE_FAILS_CLOSED', async () => {
    const r = await trust.evaluateGateEvidence(
      {id: 'test', evidenceRef: 'run-1'},
      {verifyGateEvidence: async () => ({verified: false})}
    );
    assert.equal(r.trusted, false);
  });

  await check('INCOMPLETE_GATE_COVERAGE_FAILS_CLOSED', async () => {
    const r = await trust.evaluateGateEvidence(
      {id: 'test', evidenceRef: 'run-1'},
      {verifyGateEvidence: async () => ({
        verified: true, evidenceRef: 'run-1',
        assertionsPassed: true, coverageComplete: false,
        executed: true, exitCode: 0, evidenceHash: 'a'.repeat(64)
      })}
    );
    assert.equal(r.trusted, false);
  });

  await check('VERIFIED_GATE_EVIDENCE_ACCEPTED', async () => {
    const hash = 'a'.repeat(64);
    const r = await trust.evaluateGateEvidence(
      {id: 'test', evidenceRef: 'run-1', expectedHash: hash},
      {verifyGateEvidence: async () => ({
        verified: true, evidenceRef: 'run-1',
        assertionsPassed: true, coverageComplete: true,
        executed: true, exitCode: 0, evidenceHash: hash
      })}
    );
    assert.equal(r.trusted, true);
    assert.equal(r.status, 'PASS');
  });

  await check('FINGERPRINT_STABLE', async () => {
    assert.equal(
      trust.fingerprintEvidence('same-evidence'),
      trust.fingerprintEvidence('same-evidence')
    );
  });

  console.log('ASSERTIONS_PASSED=' + passed);
  console.log('ASSERTIONS_FAILED=' + failed);
  console.log('TRUST_CONTRACT_TEST=' + (failed === 0 ? 'PASS' : 'FAIL'));
  console.log('PRODUCTION_APPLY=NOT_ENABLED');
  console.log('NOTE=Passing unit tests do not establish that a real trusted provider exists.');
  if (failed) process.exitCode = 1;
})().catch(e => {
  console.error('UNEXPECTED_FAILURE=' + e.message);
  process.exitCode = 1;
});
