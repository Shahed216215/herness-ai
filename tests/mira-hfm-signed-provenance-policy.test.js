'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifySignedProvenancePolicy, canonicalizeProvenancePolicy } =
  require('../services/mira-hfm-signed-provenance-policy');
const { REQUIRED_FIELDS } = require('../services/mira-hfm-source-provenance-contract');

const now = Date.parse('2026-11-05T12:00:00.000Z');
function keyRecord() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const publicKeySha256 = crypto.createHash('sha256')
    .update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  return { ...pair, publicKeyPem, publicKeySha256 };
}
const policyKey = keyRecord();
const reviewerAKey = keyRecord();
const reviewerBKey = keyRecord();
const issuerId = 'synthetic-policy-issuer';
const sourceIds = ['baseline-synthetic', 'backup-synthetic'];

function profile(suffix) {
  return Object.fromEntries(REQUIRED_FIELDS.map(field => [field, field + '-' + suffix]));
}
function evidence(sourceId) {
  return Object.fromEntries(REQUIRED_FIELDS.map(field => [field, {
    evidenceId: 'evidence-' + sourceId + '-' + field,
    sha256: crypto.createHash('sha256').update(sourceId + ':' + field).digest('hex'),
    issuerId: 'independent-evidence-authority',
    reviewerIds: ['reviewer-a', 'reviewer-b']
  }]));
}
function basePayload() {
  return {
    contractVersion: '1',
    policyId: 'synthetic-policy-001',
    policyVersion: 'synthetic-v1',
    sequence: 1,
    issuedAt: '2026-11-05T11:59:00.000Z',
    notBefore: '2026-11-05T11:59:00.000Z',
    expiresAt: '2026-11-05T13:00:00.000Z',
    scope: { environment: 'test', projectId: 'mira-hfm-v02' },
    signer: { issuerId, keyId: 'policy-key-1', keyVersion: '1' },
    sources: {
      [sourceIds[0]]: profile('a'),
      [sourceIds[1]]: profile('b')
    },
    evidence: {
      [sourceIds[0]]: evidence(sourceIds[0]),
      [sourceIds[1]]: evidence(sourceIds[1])
    },
    approvals: []
  };
}
function signed(p = basePayload()) {
  const unsignedForReview = { ...p };
  delete unsignedForReview.approvals;
  const reviewMessage = Buffer.from(canonicalizeProvenancePolicy(unsignedForReview));
  p.approvals = [
    { reviewerId: 'reviewer-a', keyId: 'review-key-a', role: 'security-reviewer',
      signature: crypto.sign(null, reviewMessage, reviewerAKey.privateKey).toString('base64') },
    { reviewerId: 'reviewer-b', keyId: 'review-key-b', role: 'policy-owner',
      signature: crypto.sign(null, reviewMessage, reviewerBKey.privateKey).toString('base64') }
  ];
  return {
    payload: p,
    signature: crypto.sign(null, Buffer.from(canonicalizeProvenancePolicy(p)), policyKey.privateKey).toString('base64')
  };
}
function trust() {
  return {
    [issuerId]: {
      keyId: 'policy-key-1', keyVersion: '1',
      publicKeyPem: policyKey.publicKeyPem,
      publicKeySha256: policyKey.publicKeySha256
    }
  };
}
function reviewers() {
  return {
    'reviewer-a': { keyId: 'review-key-a', role: 'security-reviewer',
      publicKeyPem: reviewerAKey.publicKeyPem, publicKeySha256: reviewerAKey.publicKeySha256 },
    'reviewer-b': { keyId: 'review-key-b', role: 'policy-owner',
      publicKeyPem: reviewerBKey.publicKeyPem, publicKeySha256: reviewerBKey.publicKeySha256 }
  };
}
function state(overrides = {}) {
  return {
    authorityId: 'independent-policy-state-authority',
    trustAnchorSha256: 'f'.repeat(64),
    authenticated: true,
    durable: true,
    atomic: true,
    statusAvailable: true,
    statusValidUntil: '2026-11-05T12:30:00.000Z',
    highestAcceptedSequence: 0,
    revokedPolicyIds: [],
    ...overrides
  };
}
function verify(envelope = signed(), opts = {}) {
  return verifySignedProvenancePolicy({
    envelope,
    trustedPolicyIssuers: opts.trustedPolicyIssuers || trust(),
    trustedPolicyReviewers: opts.trustedPolicyReviewers || reviewers(),
    acceptedPolicyState: opts.acceptedPolicyState || state(),
    expectedEnvironment: opts.expectedEnvironment || 'test',
    expectedProjectId: opts.expectedProjectId || 'mira-hfm-v02',
    operationalIssuerIds: opts.operationalIssuerIds || [],
    now: opts.now === undefined ? now : opts.now,
    maxFutureSkewMs: opts.maxFutureSkewMs === undefined ? 30000 : opts.maxFutureSkewMs
  });
}
function rejects(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

rejects(() => verify(signed(), { now: NaN }), 'HFM_PROVENANCE_POLICY_CONFIG_INVALID');
rejects(() => verify(signed(), { maxFutureSkewMs: Infinity }), 'HFM_PROVENANCE_POLICY_CONFIG_INVALID');
rejects(() => verify(signed(), { maxFutureSkewMs: 30001 }), 'HFM_PROVENANCE_POLICY_CONFIG_INVALID');

const result = verify();
assert.equal(result.status, 'PROVENANCE_POLICY_SIGNATURE_AND_STATE_VERIFIED_NOT_INFRASTRUCTURE_CERTIFIED');
assert.equal(result.infrastructureIndependentlyCertified, false);
assert.equal(result.productionApproval, false);
assert.equal(result.nextAcceptedState.highestAcceptedSequence, 1);
assert.equal(result.policyStatePersistenceRequired, true);
assert.equal(Object.keys(result.provenancePolicy.sources).length, 2);

const badSignature = signed();
badSignature.signature = Buffer.alloc(64, 7).toString('base64');
rejects(() => verify(badSignature), 'HFM_PROVENANCE_POLICY_SIGNATURE_INVALID');
rejects(() => verify(signed(), { trustedPolicyIssuers: {} }), 'HFM_PROVENANCE_POLICY_ISSUER_UNTRUSTED');

const wrongFingerprint = trust();
wrongFingerprint[issuerId].publicKeySha256 = '0'.repeat(64);
rejects(() => verify(signed(), { trustedPolicyIssuers: wrongFingerprint }), 'HFM_PROVENANCE_POLICY_KEY_MISMATCH');
rejects(() => verify(signed(), { operationalIssuerIds: [issuerId] }), 'HFM_PROVENANCE_POLICY_ISSUER_COLLISION');
rejects(() => verify(signed(), {
  acceptedPolicyState: state({ authorityId: issuerId })
}), 'HFM_PROVENANCE_POLICY_ISSUER_COLLISION');
rejects(() => verify(signed(), {
  acceptedPolicyState: state({ trustAnchorSha256: policyKey.publicKeySha256 })
}), 'HFM_PROVENANCE_POLICY_ISSUER_COLLISION');

rejects(() => verify(signed(), { acceptedPolicyState: state({ highestAcceptedSequence: 1 }) }),
  'HFM_PROVENANCE_POLICY_ROLLBACK');
rejects(() => verify(signed(), { acceptedPolicyState: state({ revokedPolicyIds: ['synthetic-policy-001'] }) }),
  'HFM_PROVENANCE_POLICY_REVOKED');
rejects(() => verify(signed(), { acceptedPolicyState: state({ statusAvailable: false }) }),
  'HFM_PROVENANCE_POLICY_STATUS_UNAVAILABLE');
rejects(() => verify(signed(), { acceptedPolicyState: state({ authenticated: false }) }),
  'HFM_PROVENANCE_POLICY_STATUS_UNAVAILABLE');
rejects(() => verify(signed(), { expectedProjectId: 'another-project' }),
  'HFM_PROVENANCE_POLICY_SCOPE_INVALID');

const expired = basePayload();
expired.expiresAt = '2026-11-05T11:59:59.000Z';
rejects(() => verify(signed(expired)), 'HFM_PROVENANCE_POLICY_EXPIRED_OR_INVALID');

const shared = basePayload();
shared.sources[sourceIds[1]].storageInstanceId = shared.sources[sourceIds[0]].storageInstanceId;
rejects(() => verify(signed(shared)), 'HFM_PROVENANCE_NOT_INDEPENDENT');

const missingEvidence = basePayload();
delete missingEvidence.evidence[sourceIds[1]].snapshotIssuerId;
rejects(() => verify(signed(missingEvidence)), 'HFM_PROVENANCE_EVIDENCE_INVALID');

const selfEvidence = basePayload();
selfEvidence.evidence[sourceIds[0]].storageSystemId.issuerId = sourceIds[0];
rejects(() => verify(signed(selfEvidence)), 'HFM_PROVENANCE_EVIDENCE_INVALID');

const forgedApproval = signed();
forgedApproval.payload.approvals[0].signature = Buffer.alloc(64, 9).toString('base64');
forgedApproval.signature = crypto.sign(null, Buffer.from(canonicalizeProvenancePolicy(forgedApproval.payload)),
  policyKey.privateKey).toString('base64');
rejects(() => verify(forgedApproval), 'HFM_PROVENANCE_POLICY_REVIEWER_SIGNATURE_INVALID');

const wrongPinnedRole = signed();
wrongPinnedRole.payload.approvals[0].role = 'policy-owner';
wrongPinnedRole.signature = crypto.sign(null,
  Buffer.from(canonicalizeProvenancePolicy(wrongPinnedRole.payload)), policyKey.privateKey).toString('base64');
rejects(() => verify(wrongPinnedRole), 'HFM_PROVENANCE_POLICY_REVIEWER_UNTRUSTED');

const duplicateRole = signed();
duplicateRole.payload.approvals[1].role = 'security-reviewer';
duplicateRole.signature = crypto.sign(null,
  Buffer.from(canonicalizeProvenancePolicy(duplicateRole.payload)), policyKey.privateKey).toString('base64');
rejects(() => verify(duplicateRole), 'HFM_PROVENANCE_POLICY_APPROVAL_QUORUM_INVALID');

const aliasedReviewers = reviewers();
aliasedReviewers['reviewer-b'] = {
  ...aliasedReviewers['reviewer-b'],
  publicKeyPem: reviewerAKey.publicKeyPem,
  publicKeySha256: reviewerAKey.publicKeySha256
};
rejects(() => verify(signed(), { trustedPolicyReviewers: aliasedReviewers }),
  'HFM_PROVENANCE_POLICY_REVIEWER_INVALID');

const unknownReviewer = signed();
rejects(() => verify(unknownReviewer, { trustedPolicyReviewers: { 'reviewer-a': reviewers()['reviewer-a'] } }),
  'HFM_PROVENANCE_POLICY_REVIEWER_UNTRUSTED');

const issuerAsReviewer = basePayload();
issuerAsReviewer.approvals = [
  { reviewerId: issuerId, keyId: 'policy-key-1', role: 'reviewer', signature: 'AA==' },
  { reviewerId: 'reviewer-b', keyId: 'review-key-b', role: 'reviewer', signature: 'AA==' }
];
const issuerAsReviewerEnvelope = {
  payload: issuerAsReviewer,
  signature: crypto.sign(null, Buffer.from(canonicalizeProvenancePolicy(issuerAsReviewer)),
    policyKey.privateKey).toString('base64')
};
rejects(() => verify(issuerAsReviewerEnvelope), 'HFM_PROVENANCE_POLICY_APPROVAL_QUORUM_INVALID');

process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_VALID_SIGNATURE_PASS\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_ISSUER_PINNING_PASS\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_SCOPE_AND_TIME_PASS\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_ANTI_ROLLBACK_AND_REVOCATION_PASS\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_EVIDENCE_BINDING_PASS\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_REVIEW_SIGNATURES_PASS\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_FAIL_CLOSED_PASS\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_NOT_INFRASTRUCTURE_CERTIFIED_PASS\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_CONTRACT_COMPLETE\n');
