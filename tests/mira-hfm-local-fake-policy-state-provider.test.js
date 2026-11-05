'use strict';

const assert = require('node:assert/strict');
const { createLocalFakePolicyStateProvider } = require('../services/mira-hfm-local-fake-policy-state-provider');

const authorityId = 'fake-state-authority';
const digest1 = '1'.repeat(64);
const digest2 = '2'.repeat(64);
function request({ sequence = 0, previousDigest = null, id = 'policy-1', policyDigest = digest1, key = 'request-1' } = {}) {
  return {
    authorityId,
    expectedSequence: sequence,
    expectedDigest: previousDigest,
    idempotencyKey: key,
    nextState: {
      highestAcceptedSequence: sequence + 1,
      lastAcceptedPolicyId: id,
      lastAcceptedPolicyDigest: policyDigest
    }
  };
}
async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => error && error.code === code);
}

(async () => {
  // Read initial state and one successful CAS.
  let provider = createLocalFakePolicyStateProvider({ authorityId });
  const initial = await provider.readState();
  assert.equal(initial.highestAcceptedSequence, 0);
  const first = request();
  const receipt = await provider.compareAndSwap(first);
  assert.equal(receipt.nextSequence, 1);
  assert.equal((await provider.readState()).lastAcceptedPolicyId, 'policy-1');

  // A stale expected sequence/digest must conflict.
  await rejectsCode(provider.compareAndSwap(request({ key: 'stale-new-request' })), 'HFM_POLICY_STATE_CAS_CONFLICT');

  // Two writers from the same baseline: exactly one wins.
  provider = createLocalFakePolicyStateProvider({ authorityId });
  const competing = await Promise.allSettled([
    provider.compareAndSwap(request({ id: 'writer-a', policyDigest: digest1, key: 'writer-a' })),
    provider.compareAndSwap(request({ id: 'writer-b', policyDigest: digest2, key: 'writer-b' }))
  ]);
  assert.equal(competing.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(competing.filter(x => x.status === 'rejected' && x.reason.code === 'HFM_POLICY_STATE_CAS_CONFLICT').length, 1);
  assert.equal((await provider.readState()).highestAcceptedSequence, 1);

  // Same idempotency key + same request returns the same logical receipt.
  provider = createLocalFakePolicyStateProvider({ authorityId });
  const idemRequest = request({ key: 'same-key' });
  const firstReceipt = await provider.compareAndSwap(idemRequest);
  const retryReceipt = await provider.compareAndSwap(idemRequest);
  assert.deepEqual(retryReceipt, firstReceipt);

  // Reusing the key for different content is rejected.
  await rejectsCode(provider.compareAndSwap(request({
    sequence: 1, previousDigest: digest1, id: 'different-policy',
    policyDigest: digest2, key: 'same-key'
  })), 'HFM_POLICY_STATE_IDEMPOTENCY_MISMATCH');

  // Snapshot export + re-instantiation simulates process restart only.
  const snapshot = provider.exportSnapshot();
  const restarted = createLocalFakePolicyStateProvider({ snapshot, authorityId });
  assert.deepEqual(await restarted.readState(), await provider.readState());
  assert.deepEqual(await restarted.compareAndSwap(idemRequest), firstReceipt);

  // Provider outage / unavailable quorum fails closed.
  restarted.setUnavailable(true);
  await rejectsCode(restarted.readState(), 'HFM_POLICY_STATE_UNAVAILABLE');
  await rejectsCode(restarted.compareAndSwap(request({
    sequence: 1, previousDigest: digest1, id: 'policy-2',
    policyDigest: digest2, key: 'during-outage'
  })), 'HFM_POLICY_STATE_UNAVAILABLE');
  restarted.setUnavailable(false);

  // Commit succeeds but response is lost; same-key retry reconciles receipt without duplicate commit.
  const ambiguous = createLocalFakePolicyStateProvider({ authorityId });
  ambiguous.loseNextCommitResponse();
  const ambiguousRequest = request({ key: 'lost-response-key' });
  await rejectsCode(ambiguous.compareAndSwap(ambiguousRequest), 'HFM_POLICY_STATE_AMBIGUOUS_COMMIT');
  const committedState = await ambiguous.readState();
  assert.equal(committedState.highestAcceptedSequence, 1);
  const reconciledReceipt = await ambiguous.compareAndSwap(ambiguousRequest);
  assert.equal(reconciledReceipt.nextSequence, 1);
  assert.equal((await ambiguous.readState()).highestAcceptedSequence, 1);

  console.log('LOCAL_FAKE_PROVIDER_TESTS=PASS');
  console.log('CASES=read_state,cas_conflict,concurrent_writers,idempotent_retry,key_reuse_rejection,restart_snapshot,outage_fail_closed,ambiguous_commit_reconciliation');
  console.log('REAL_DURABILITY=NOT_PROVEN');
  console.log('DISTRIBUTED_ATOMICITY=NOT_PROVEN');
  console.log('INFRASTRUCTURE_INDEPENDENCE=NOT_PROVEN');
})().catch(error => {
  console.error('LOCAL_FAKE_PROVIDER_TESTS=FAIL');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
