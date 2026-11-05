'use strict';

// Deterministic in-memory test double only. It does not provide real durability,
// distributed atomicity, infrastructure independence, or production guarantees.
const crypto = require('node:crypto');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function createLocalFakePolicyStateProvider({ snapshot, authorityId = 'fake-state-authority' } = {}) {
  let state = snapshot && snapshot.state
    ? clone(snapshot.state)
    : { authorityId, highestAcceptedSequence: 0, lastAcceptedPolicyId: null, lastAcceptedPolicyDigest: null, revokedPolicyIds: [] };
  let idempotency = new Map(snapshot && Array.isArray(snapshot.idempotency) ? clone(snapshot.idempotency) : []);
  let unavailable = false;
  let loseNextCommitResponse = false;
  let failNextRequestBeforeCommit = false;

  function assertAvailable() {
    if (unavailable) throw codedError('Fake provider unavailable or quorum absent.', 'HFM_POLICY_STATE_UNAVAILABLE');
  }
  return Object.freeze({
    async readState() {
      assertAvailable();
      return Object.freeze(clone(state));
    },
    async getCommitReceipt({ authorityId: requestedAuthorityId, idempotencyKey, requestDigest }) {
      assertAvailable();
      if (requestedAuthorityId !== state.authorityId ||
          typeof idempotencyKey !== 'string' || !idempotencyKey.trim() ||
          !/^[a-f0-9]{64}$/.test(requestDigest || '')) {
        throw codedError('Commit receipt lookup scope is invalid.', 'HFM_POLICY_STATE_RECEIPT_LOOKUP_INVALID');
      }
      const previous = idempotency.get(idempotencyKey);
      if (!previous) return null;
      if (previous.requestDigest !== requestDigest) {
        throw codedError('Commit receipt lookup digest does not match the original request.',
          'HFM_POLICY_STATE_IDEMPOTENCY_MISMATCH');
      }
      return Object.freeze(clone(previous.receipt));
    },
    async compareAndSwap(request) {
      assertAvailable();
      if (!request || typeof request.idempotencyKey !== 'string' || !request.idempotencyKey.trim()) {
        throw codedError('An idempotency key is required.', 'HFM_POLICY_STATE_IDEMPOTENCY_REQUIRED');
      }
      const requestDigest = digest({
        authorityId: request.authorityId,
        expectedSequence: request.expectedSequence,
        expectedDigest: request.expectedDigest,
        nextState: request.nextState
      });
      const previous = idempotency.get(request.idempotencyKey);
      if (previous) {
        if (previous.requestDigest !== requestDigest) {
          throw codedError('Idempotency key was reused for a different request.', 'HFM_POLICY_STATE_IDEMPOTENCY_MISMATCH');
        }
        return Object.freeze(clone(previous.receipt));
      }
      if (request.authorityId !== state.authorityId ||
          request.expectedSequence !== state.highestAcceptedSequence ||
          request.expectedDigest !== state.lastAcceptedPolicyDigest) {
        throw codedError('Compare-and-swap conflict.', 'HFM_POLICY_STATE_CAS_CONFLICT');
      }
      if (!request.nextState ||
          request.nextState.highestAcceptedSequence !== state.highestAcceptedSequence + 1 ||
          typeof request.nextState.lastAcceptedPolicyId !== 'string' ||
          !/^[a-f0-9]{64}$/.test(request.nextState.lastAcceptedPolicyDigest || '')) {
        throw codedError('Invalid next state.', 'HFM_POLICY_STATE_NEXT_STATE_INVALID');
      }

      if (failNextRequestBeforeCommit) {
        failNextRequestBeforeCommit = false;
        throw codedError('Synthetic request loss before commit; retry the same idempotency key.', 'HFM_POLICY_STATE_REQUEST_NOT_COMMITTED');
      }

      const receipt = Object.freeze({
        authorityId: state.authorityId,
        previousSequence: state.highestAcceptedSequence,
        nextSequence: request.nextState.highestAcceptedSequence,
        policyId: request.nextState.lastAcceptedPolicyId,
        policyDigest: request.nextState.lastAcceptedPolicyDigest,
        idempotencyKey: request.idempotencyKey,
        requestDigest
      });
      // No await between compare and mutation: atomic only within this single JS process.
      state = {
        ...state,
        highestAcceptedSequence: request.nextState.highestAcceptedSequence,
        lastAcceptedPolicyId: request.nextState.lastAcceptedPolicyId,
        lastAcceptedPolicyDigest: request.nextState.lastAcceptedPolicyDigest
      };
      idempotency.set(request.idempotencyKey, { requestDigest, receipt: clone(receipt) });
      if (loseNextCommitResponse) {
        loseNextCommitResponse = false;
        throw codedError('Synthetic response loss after commit; reconcile using the same idempotency key.', 'HFM_POLICY_STATE_AMBIGUOUS_COMMIT');
      }
      return receipt;
    },
    setUnavailable(value) { unavailable = value === true; },
    loseNextCommitResponse() { loseNextCommitResponse = true; },
    failNextRequestBeforeCommit() { failNextRequestBeforeCommit = true; },
    exportSnapshot() {
      return clone({ state, idempotency: Array.from(idempotency.entries()) });
    }
  });
}
module.exports = { createLocalFakePolicyStateProvider };
