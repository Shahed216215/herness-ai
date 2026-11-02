'use strict';

const assert = require('node:assert/strict');
const trust = require('../services/engineering/bug-hunter-trust-contract');

(async () => {
  let passed = 0;
  let failed = 0;
  let gaps = 0;

  async function check(name, fn) {
    try {
      const result = await fn();
      passed++;
      console.log(name + '=PASS' +
        (result && result.gap ? '_GAP_REPRODUCED' : ''));
      if (result && result.gap) gaps++;
    } catch (e) {
      failed++;
      console.log(name + '=FAIL: ' + e.message);
    }
  }

  const goodApproval = {
    planId: 'plan-A',
    approvalId: 'approval-A',
    actionHash: 'a'.repeat(64)
  };

  const goodGate = {
    id: 'unit-test',
    evidenceRef: 'run-A',
    expectedHash: 'b'.repeat(64)
  };

  await check('MISSING_APPROVAL_INPUT_FAILS_CLOSED', async () => {
    const r = await trust.validateApproval({});
    assert.equal(r.trusted, false);
  });

  await check('PROVIDER_EXCEPTION_FAILS_CLOSED', async () => {
    const r = await trust.validateApproval(goodApproval, {
      validateTrustedApproval: async () => { throw Error('provider-down'); }
    });
    assert.equal(r.trusted, false);
  });

  await check('PROVIDER_WRONG_PLAN_REJECTED', async () => {
    const r = await trust.validateApproval(goodApproval, {
      validateTrustedApproval: async () => ({
        valid: true, planId: 'plan-B', approvalId: 'approval-A',
        authorityVerified: true, provenanceVerified: true,
        replayChecked: true
      })
    });
    assert.equal(r.trusted, false);
  });

  await check('PROVIDER_WRONG_APPROVAL_ID_REJECTED', async () => {
    const r = await trust.validateApproval(goodApproval, {
      validateTrustedApproval: async () => ({
        valid: true, planId: 'plan-A', approvalId: 'approval-B',
        authorityVerified: true, provenanceVerified: true,
        replayChecked: true
      })
    });
    assert.equal(r.trusted, false);
  });

  await check('UNAUTHENTICATED_PROVIDER_RESPONSE_REJECTED', async () => {
    const r = await trust.validateApproval(goodApproval, {
      validateTrustedApproval: async () => ({
        valid: true, planId: 'plan-A', approvalId: 'approval-A',
        authorityVerified: true, provenanceVerified: true,
        replayChecked: true
      })
    });
    assert.equal(r.trusted, false);
    return { forgedResponseRejected: true };
  });

  await check('GATE_WRONG_REFERENCE_REJECTED', async () => {
    const r = await trust.evaluateGateEvidence(goodGate, {
      verifyGateEvidence: async () => ({
        verified: true, evidenceRef: 'run-B',
        assertionsPassed: true, coverageComplete: true,
        executed: true, exitCode: 0, evidenceHash: 'b'.repeat(64)
      })
    });
    assert.equal(r.trusted, false);
  });

  await check('GATE_HASH_MISMATCH_REJECTED', async () => {
    const r = await trust.evaluateGateEvidence(goodGate, {
      verifyGateEvidence: async () => ({
        verified: true, evidenceRef: 'run-A',
        assertionsPassed: true, coverageComplete: true,
        executed: true, exitCode: 0, evidenceHash: 'c'.repeat(64)
      })
    });
    assert.equal(r.trusted, false);
  });

  await check('MALFORMED_GATE_HASH_REJECTED', async () => {
    const r = await trust.evaluateGateEvidence(
      {id: 'unit-test', evidenceRef: 'run-A'},
      {verifyGateEvidence: async () => ({
        verified: true, evidenceRef: 'run-A',
        assertionsPassed: true, coverageComplete: true,
        executed: true, exitCode: 0, evidenceHash: 'not-a-hash'
      })}
    );
    assert.equal(r.trusted, false);
  });

  await check('GATE_VERIFIER_EXCEPTION_FAILS_CLOSED', async () => {
    const r = await trust.evaluateGateEvidence(goodGate, {
      verifyGateEvidence: async () => { throw Error('verifier-down'); }
    });
    assert.equal(r.trusted, false);
  });

  await check('REPLAY_IS_NOT_INTERNALLY_CONSUMED', async () => {
    const source = require('node:fs').readFileSync(
      require.resolve('../services/engineering/bug-hunter-trust-contract'),
      'utf8'
    );
    assert.doesNotMatch(source, /consumeApproval|markApprovalUsed|atomicReplayStore/);
    return {gap: true};
  });

  console.log('ASSERTIONS_PASSED=' + passed);
  console.log('ASSERTIONS_FAILED=' + failed);
  console.log('TRUST_GAPS_REPRODUCED=' + gaps);
  console.log('ADVERSARIAL_TEST=' + (failed === 0 ? 'PASS' : 'FAIL'));
  console.log('PRODUCTION_APPLY=NOT_ENABLED');
  console.log('SECURITY_DECISION=REVIEW_REQUIRED');
  if (failed) process.exitCode = 1;
})().catch(e => {
  console.error('UNEXPECTED_FAILURE=' + e.message);
  process.exitCode = 1;
});
