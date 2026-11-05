'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { canonicalizeProvenancePolicy } = require('../services/mira-hfm-signed-provenance-policy');
const {
  verifyPolicyStateEnvelope,
  verifyAndAcceptSignedProvenancePolicy
} = require('../services/mira-hfm-policy-state-provider-contract');
const { REQUIRED_FIELDS } = require('../services/mira-hfm-source-provenance-contract');

const now = Date.parse('2026-11-05T12:00:00.000Z');
function makeKey() {
  const pair = crypto.generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey,
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    publicKeySha256: crypto.createHash('sha256')
      .update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
  };
}
const policyKey = makeKey();
const stateKey = makeKey();
const reviewerA = makeKey();
const reviewerB = makeKey();
const evidenceKey = makeKey();
const evidenceIssuer = 'synthetic-evidence-issuer';
const evidenceRecords = new Map();
const trustedEvidenceIssuers = { [evidenceIssuer]: trust(evidenceKey, 'evidence-key') };
const policyIssuer = 'synthetic-policy-issuer';
const stateAuthority = 'synthetic-policy-state-authority';
const sourceIds = ['baseline-source', 'backup-source'];

function signed(payload, key) {
  return {
    payload,
    signature: crypto.sign(null, Buffer.from(canonicalizeProvenancePolicy(payload)), key.privateKey).toString('base64')
  };
}
function trust(key, keyId, keyVersion = '1') {
  return { keyId, keyVersion, publicKeyPem: key.publicKeyPem, publicKeySha256: key.publicKeySha256 };
}
const trustedStateAuthorities = { [stateAuthority]: trust(stateKey, 'state-key') };
const trustedPolicyIssuers = { [policyIssuer]: trust(policyKey, 'policy-key') };
const trustedPolicyReviewers = {
  'reviewer-a': trust(reviewerA, 'review-a'),
  'reviewer-b': trust(reviewerB, 'review-b')
};
function statePayload(overrides = {}) {
  return {
    contractVersion: '1',
    authorityId: stateAuthority,
    signer: { authorityId: stateAuthority, keyId: 'state-key', keyVersion: '1' },
    issuedAt: '2026-11-05T11:59:00.000Z',
    expiresAt: '2026-11-05T12:30:00.000Z',
    statusAvailable: true,
    durable: true,
    atomic: true,
    highestAcceptedSequence: 0,
    lastAcceptedPolicyId: null,
    lastAcceptedPolicyDigest: null,
    revokedPolicyIds: [],
    ...overrides
  };
}
function profile(suffix) {
  return Object.fromEntries(REQUIRED_FIELDS.map(field => [field, field + '-' + suffix]));
}
function evidence(sourceId) {
  return Object.fromEntries(REQUIRED_FIELDS.map(field => {
    const evidenceId = sourceId + '-' + field;
    const record = { resourceId: sourceId + '-' + field, dimension: field, environment: 'test' };
    const digest = crypto.createHash('sha256')
      .update(canonicalizeProvenancePolicy(record)).digest('hex');
    const payload = {
      contractVersion: '1', evidenceId, sourceId, dimension: field,
      issuerId: evidenceIssuer, signerKeyId: 'evidence-key', signerKeyVersion: '1',
      issuedAt: '2026-11-05T11:59:00.000Z', expiresAt: '2026-11-05T12:30:00.000Z',
      scope: { environment: 'test', projectId: 'mira-hfm-v02' },
      reviewerIds: ['reviewer-a', 'reviewer-b'], record
    };
    evidenceRecords.set(evidenceId, signed(payload, evidenceKey));
    return [field, { evidenceId, sha256: digest, issuerId: evidenceIssuer,
      reviewerIds: ['reviewer-a', 'reviewer-b'] }];
  }));
}
function policyEnvelope() {
  const p = {
    contractVersion: '1',
    policyId: 'synthetic-policy-01',
    policyVersion: 'v1',
    sequence: 1,
    issuedAt: '2026-11-05T11:59:00.000Z',
    notBefore: '2026-11-05T11:59:00.000Z',
    expiresAt: '2026-11-05T12:30:00.000Z',
    scope: { environment: 'test', projectId: 'mira-hfm-v02' },
    signer: { issuerId: policyIssuer, keyId: 'policy-key', keyVersion: '1' },
    sources: {
      [sourceIds[0]]: profile('baseline'),
      [sourceIds[1]]: profile('backup')
    },
    evidence: {
      [sourceIds[0]]: evidence(sourceIds[0]),
      [sourceIds[1]]: evidence(sourceIds[1])
    },
    approvals: []
  };
  const reviewPayload = { ...p };
  delete reviewPayload.approvals;
  const reviewMessage = Buffer.from(canonicalizeProvenancePolicy(reviewPayload));
  p.approvals = [
    { reviewerId: 'reviewer-a', keyId: 'review-a', role: 'security-reviewer',
      signature: crypto.sign(null, reviewMessage, reviewerA.privateKey).toString('base64') },
    { reviewerId: 'reviewer-b', keyId: 'review-b', role: 'policy-owner',
      signature: crypto.sign(null, reviewMessage, reviewerB.privateKey).toString('base64') }
  ];
  return signed(p, policyKey);
}
function makeProvider(options = {}) {
  let current = signed(statePayload(), stateKey);
  const receipts = new Map();
  function requestDigest(request) {
    return crypto.createHash('sha256').update(canonicalizeProvenancePolicy({
      authorityId: request.authorityId,
      expectedSequence: request.expectedSequence,
      expectedDigest: request.expectedDigest,
      nextState: request.nextState
    })).digest('hex');
  }
  return {
    async readState() {
      if (options.readError) throw new Error(typeof options.readError === 'string' ? options.readError : 'synthetic state read failure');
      return options.badState ? options.badState : current;
    },
    async getCommitReceipt({ authorityId, idempotencyKey, requestDigest: expectedDigest }) {
      if (options.receiptLookupError) throw new Error('synthetic receipt lookup outage');
      if (options.missingReceipt) return null;
      if (authorityId !== stateAuthority || typeof idempotencyKey !== 'string') {
        throw new Error('invalid receipt lookup');
      }
      const prior = receipts.get(idempotencyKey);
      if (!prior) return null;
      if (prior.requestDigest !== expectedDigest) throw new Error('receipt digest mismatch');
      return prior.receipt;
    },
    async compareAndSwap(request) {
      if (options.casError) {
        const error = new Error(options.casErrorMessage || 'synthetic CAS conflict');
        error.code = options.casError;
        throw error;
      }
      if (!request.idempotencyKey) {
        const error = new Error('idempotency key required');
        error.code = 'HFM_POLICY_STATE_IDEMPOTENCY_REQUIRED';
        throw error;
      }
      const digest = requestDigest(request);
      const prior = receipts.get(request.idempotencyKey);
      if (prior) {
        if (prior.requestDigest !== digest) {
          const error = new Error('idempotency mismatch');
          error.code = 'HFM_POLICY_STATE_IDEMPOTENCY_MISMATCH';
          throw error;
        }
        return prior.receipt;
      }
      if (request.expectedSequence !== current.payload.highestAcceptedSequence ||
          request.expectedDigest !== current.payload.lastAcceptedPolicyDigest) {
        const error = new Error('CAS conflict');
        error.code = 'HFM_POLICY_STATE_CAS_CONFLICT';
        throw error;
      }
      if (options.failBeforeCommit && !options.preCommitFailureUsed) {
        options.preCommitFailureUsed = true;
        const error = new Error('synthetic request lost before commit');
        error.code = 'HFM_POLICY_STATE_REQUEST_NOT_COMMITTED';
        throw error;
      }
      const next = statePayload({
        highestAcceptedSequence: request.nextState.highestAcceptedSequence,
        lastAcceptedPolicyId: request.nextState.lastAcceptedPolicyId,
        lastAcceptedPolicyDigest: request.nextState.lastAcceptedPolicyDigest
      });
      const receiptPayload = {
        contractVersion: '1',
        authorityId: stateAuthority,
        signer: { authorityId: stateAuthority, keyId: 'state-key', keyVersion: '1' },
        issuedAt: '2026-11-05T11:59:00.000Z',
        expiresAt: '2026-11-05T12:30:00.000Z',
        previousSequence: request.expectedSequence,
        nextSequence: request.nextState.highestAcceptedSequence,
        policyId: request.nextState.lastAcceptedPolicyId,
        policyDigest: request.nextState.lastAcceptedPolicyDigest,
        idempotencyKey: request.idempotencyKey,
        requestDigest: digest
      };
      if (options.badReceipt) receiptPayload.policyDigest = '0'.repeat(64);
      if (options.badRequestDigest) receiptPayload.requestDigest = '0'.repeat(64);
      const receipt = signed(receiptPayload, stateKey);
      current = signed(next, stateKey);
      receipts.set(request.idempotencyKey, { requestDigest: digest, receipt });
      if (options.ambiguousResponse && !options.ambiguousResponseUsed) {
        options.ambiguousResponseUsed = true;
        const error = new Error('synthetic response lost after commit');
        error.code = 'HFM_POLICY_STATE_AMBIGUOUS_COMMIT';
        throw error;
      }
      return receipt;
    }
  };
}
async function rejects(promise, code) {
  await assert.rejects(promise, error => error && error.code === code);
}
const operationalIssuerIds = ['snapshot-issuer', 'authorization-issuer', 'backup-key-provider'];

(async () => {
  const result = await verifyAndAcceptSignedProvenancePolicy({
    envelope: policyEnvelope(),
    provider: makeProvider(),
    trustedStateAuthorities,
    expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers,
    trustedPolicyReviewers,
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers,
    expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02',
    operationalIssuerIds,
    now
  });
  assert.equal(result.stateCommit.committed, true);
  assert.equal(result.evidenceVerification.verifiedCount, 12);
  assert.equal(result.stateCommit.nextSequence, 1);
  assert.equal(result.infrastructureIndependentlyCertified, false);
  assert.equal(result.productionApproval, false);

  await rejects(verifyAndAcceptSignedProvenancePolicy({
    envelope: policyEnvelope(),
    provider: makeProvider(),
    trustedStateAuthorities,
    expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers,
    trustedPolicyReviewers,
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers,
    expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02',
    operationalIssuerIds: [...operationalIssuerIds, evidenceIssuer],
    now
  }), 'HFM_PROVENANCE_EVIDENCE_BINDING_MISMATCH');

  const forgedState = signed(statePayload(), stateKey);
  forgedState.signature = Buffer.alloc(64, 3).toString('base64');
  assert.throws(() => verifyPolicyStateEnvelope({
    envelope: forgedState, trustedStateAuthorities, expectedAuthorityId: stateAuthority, now
  }), error => error.code === 'HFM_POLICY_STATE_SIGNATURE_INVALID');

  const staleState = signed(statePayload({ expiresAt: '2026-11-05T11:59:59.000Z' }), stateKey);
  assert.throws(() => verifyPolicyStateEnvelope({
    envelope: staleState, trustedStateAuthorities, expectedAuthorityId: stateAuthority, now
  }), error => error.code === 'HFM_POLICY_STATE_STALE');

  const nonAtomicState = signed(statePayload({ atomic: false }), stateKey);
  assert.throws(() => verifyPolicyStateEnvelope({
    envelope: nonAtomicState, trustedStateAuthorities, expectedAuthorityId: stateAuthority, now
  }), error => error.code === 'HFM_POLICY_STATE_CONTENT_INVALID');

  const revokedState = signed(statePayload({ revokedPolicyIds: ['synthetic-policy-01'] }), stateKey);
  const revokedProvider = {
    async readState() { return revokedState; },
    async compareAndSwap() { throw new Error('must not commit revoked policy'); },
    async getCommitReceipt() { return null; }
  };
  await rejects(verifyAndAcceptSignedProvenancePolicy({
    envelope: policyEnvelope(), provider: revokedProvider,
    trustedStateAuthorities, expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers, trustedPolicyReviewers,
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', operationalIssuerIds, now
  }), 'HFM_PROVENANCE_POLICY_REVOKED');

  await rejects(verifyAndAcceptSignedProvenancePolicy({
    envelope: policyEnvelope(), provider: makeProvider({ casError: 'HFM_POLICY_STATE_CAS_CONFLICT' }),
    trustedStateAuthorities, expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers, trustedPolicyReviewers,
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', operationalIssuerIds, now
  }), 'HFM_POLICY_STATE_CAS_CONFLICT');

  await assert.rejects(
    verifyAndAcceptSignedProvenancePolicy({
      envelope: policyEnvelope(), provider: makeProvider({ readError: 'PRIVATE_PROVIDER_READ_DETAIL' }),
      trustedStateAuthorities, expectedStateAuthorityId: stateAuthority,
      trustedPolicyIssuers, trustedPolicyReviewers,
      evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
      trustedEvidenceIssuers, expectedEnvironment: 'test',
      expectedProjectId: 'mira-hfm-v02', operationalIssuerIds, now
    }),
    error => error.code === 'HFM_POLICY_STATE_UNAVAILABLE' &&
      !error.message.includes('PRIVATE_PROVIDER_READ_DETAIL')
  );

  await assert.rejects(
    verifyAndAcceptSignedProvenancePolicy({
      envelope: policyEnvelope(),
      provider: makeProvider({
        casError: 'HFM_POLICY_STATE_CAS_CONFLICT',
        casErrorMessage: 'PRIVATE_PROVIDER_CAS_DETAIL'
      }),
      trustedStateAuthorities, expectedStateAuthorityId: stateAuthority,
      trustedPolicyIssuers, trustedPolicyReviewers,
      evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
      trustedEvidenceIssuers, expectedEnvironment: 'test',
      expectedProjectId: 'mira-hfm-v02', operationalIssuerIds, now
    }),
    error => error.code === 'HFM_POLICY_STATE_CAS_CONFLICT' &&
      !error.message.includes('PRIVATE_PROVIDER_CAS_DETAIL')
  );

  await rejects(verifyAndAcceptSignedProvenancePolicy({
    envelope: policyEnvelope(),
    provider: {
      async readState() { throw new Error('synthetic policy-state read outage'); },
      async compareAndSwap() { throw new Error('must not commit when state cannot be read'); },
      async getCommitReceipt() { return null; }
    },
    trustedStateAuthorities, expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers, trustedPolicyReviewers,
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', operationalIssuerIds, now
  }), 'HFM_POLICY_STATE_UNAVAILABLE');

  const reconciled = await verifyAndAcceptSignedProvenancePolicy({
    envelope: policyEnvelope(), provider: makeProvider({ ambiguousResponse: true }),
    trustedStateAuthorities, expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers, trustedPolicyReviewers,
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', operationalIssuerIds, now
  });
  assert.equal(reconciled.stateCommit.committed, true);
  assert.equal(typeof reconciled.stateCommit.idempotencyKey, 'string');

  const retriedBeforeCommit = await verifyAndAcceptSignedProvenancePolicy({
    envelope: policyEnvelope(), provider: makeProvider({ failBeforeCommit: true }),
    trustedStateAuthorities, expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers, trustedPolicyReviewers,
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', operationalIssuerIds, now
  });
  assert.equal(retriedBeforeCommit.stateCommit.committed, true);

  await rejects(verifyAndAcceptSignedProvenancePolicy({
    envelope: policyEnvelope(), provider: makeProvider({ badRequestDigest: true }),
    trustedStateAuthorities, expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers, trustedPolicyReviewers,
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', operationalIssuerIds, now
  }), 'HFM_POLICY_STATE_COMMIT_MISMATCH');

  await rejects(verifyAndAcceptSignedProvenancePolicy({
    envelope: policyEnvelope(), provider: makeProvider({ ambiguousResponse: true, missingReceipt: true }),
    trustedStateAuthorities, expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers, trustedPolicyReviewers,
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', operationalIssuerIds, now
  }), 'HFM_POLICY_STATE_COMMIT_UNRESOLVED');

  await rejects(verifyAndAcceptSignedProvenancePolicy({
    envelope: policyEnvelope(), provider: makeProvider({ ambiguousResponse: true, receiptLookupError: true }),
    trustedStateAuthorities, expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers, trustedPolicyReviewers,
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', operationalIssuerIds, now
  }), 'HFM_POLICY_STATE_COMMIT_UNRESOLVED');

  await rejects(verifyAndAcceptSignedProvenancePolicy({
    envelope: policyEnvelope(), provider: makeProvider({ badReceipt: true }),
    trustedStateAuthorities, expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers, trustedPolicyReviewers,
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', operationalIssuerIds, now
  }), 'HFM_POLICY_STATE_COMMIT_MISMATCH');

  let invalidClockProviderReads = 0;
  await rejects(verifyAndAcceptSignedProvenancePolicy({
    envelope: policyEnvelope(),
    provider: {
      async readState() { invalidClockProviderReads += 1; return signed(statePayload(), stateKey); },
      async compareAndSwap() { throw new Error('must not commit with invalid clock'); }
    },
    trustedStateAuthorities, expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers, trustedPolicyReviewers,
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', operationalIssuerIds, now: NaN
  }), 'HFM_POLICY_STATE_CONFIG_INVALID');
  assert.equal(invalidClockProviderReads, 0);

  await rejects(verifyAndAcceptSignedProvenancePolicy({
    envelope: policyEnvelope(), provider: {},
    trustedStateAuthorities, expectedStateAuthorityId: stateAuthority,
    trustedPolicyIssuers, trustedPolicyReviewers,
    evidenceProvider: { async resolve({ evidenceId }) { return evidenceRecords.get(evidenceId); } },
    trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', operationalIssuerIds, now
  }), 'HFM_POLICY_STATE_PROVIDER_REQUIRED');

  process.stdout.write('MIRA_HFM_POLICY_STATE_SIGNED_AUTHORITY_PASS\n');
  process.stdout.write('MIRA_HFM_POLICY_STATE_FRESHNESS_AND_REVOCATION_PASS\n');
  process.stdout.write('MIRA_HFM_POLICY_STATE_DURABLE_ATOMIC_CAPABILITY_CLAIMS_PASS\n');
  process.stdout.write('MIRA_HFM_POLICY_STATE_COMPARE_AND_SWAP_PASS\n');
  process.stdout.write('MIRA_HFM_POLICY_STATE_COMMIT_RECEIPT_BINDING_PASS\n');
  process.stdout.write('MIRA_HFM_POLICY_STATE_IDEMPOTENCY_AND_RECEIPT_BINDING_PASS\n');
  process.stdout.write('MIRA_HFM_POLICY_STATE_PRECOMMIT_RETRY_PASS\n');
  process.stdout.write('MIRA_HFM_POLICY_STATE_AMBIGUOUS_COMMIT_RECONCILIATION_PASS\n');
  process.stdout.write('MIRA_HFM_POLICY_STATE_AMBIGUOUS_UNRESOLVED_FAIL_CLOSED_PASS\n');

  process.stdout.write('MIRA_HFM_POLICY_STATE_CONFLICT_FAIL_CLOSED_PASS\n');
  process.stdout.write('MIRA_HFM_POLICY_STATE_NOT_INFRASTRUCTURE_CERTIFIED_PASS\n');
  process.stdout.write('MIRA_HFM_POLICY_STATE_PROVIDER_CONTRACT_COMPLETE\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
