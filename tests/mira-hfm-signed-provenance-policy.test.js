'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifySignedProvenancePolicy, canonicalizeProvenancePolicy } =
  require('../services/mira-hfm-signed-provenance-policy');
const { REQUIRED_FIELDS } = require('../services/mira-hfm-source-provenance-contract');

const now = Date.parse('2026-11-05T12:00:00.000Z');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const fingerprint = crypto.createHash('sha256')
  .update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
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
function payload() {
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
    approvals: [
      { reviewerId: 'reviewer-a', role: 'security-reviewer' },
      { reviewerId: 'reviewer-b', role: 'policy-owner' }
    ]
  };
}
function signed(p = payload()) {
  return {
    payload: p,
    signature: crypto.sign(null, Buffer.from(canonicalizeProvenancePolicy(p)), privateKey).toString('base64')
  };
}
function trust() {
  return {
    [issuerId]: {
      keyId: 'policy-key-1',
      keyVersion: '1',
      publicKeyPem,
      publicKeySha256: fingerprint
    }
  };
}
function state(overrides = {}) {
  return {
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
    acceptedPolicyState: opts.acceptedPolicyState || state(),
    expectedEnvironment: opts.expectedEnvironment || 'test',
    expectedProjectId: opts.expectedProjectId || 'mira-hfm-v02',
    operationalIssuerIds: opts.operationalIssuerIds || [],
    now
  });
}
function rejects(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

const result = verify();
assert.equal(result.status, 'PROVENANCE_POLICY_SIGNATURE_AND_STATE_VERIFIED_NOT_INFRASTRUCTURE_CERTIFIED');
assert.equal(result.infrastructureIndependentlyCertified, false);
assert.equal(result.productionApproval, false);
assert.equal(result.nextAcceptedState.highestAcceptedSequence, 1);
assert.equal(Object.keys(result.provenancePolicy.sources).length, 2);

const badSignature = signed();
badSignature.signature = Buffer.alloc(64, 7).toString('base64');
rejects(() => verify(badSignature), 'HFM_PROVENANCE_POLICY_SIGNATURE_INVALID');

rejects(() => verify(signed(), { trustedPolicyIssuers: {} }),
  'HFM_PROVENANCE_POLICY_ISSUER_UNTRUSTED');

const wrongFingerprint = trust();
wrongFingerprint[issuerId].publicKeySha256 = '0'.repeat(64);
rejects(() => verify(signed(), { trustedPolicyIssuers: wrongFingerprint }),
  'HFM_PROVENANCE_POLICY_KEY_MISMATCH');

rejects(() => verify(signed(), { operationalIssuerIds: [issuerId] }),
  'HFM_PROVENANCE_POLICY_ISSUER_COLLISION');

rejects(() => verify(signed(), { acceptedPolicyState: state({ highestAcceptedSequence: 1 }) }),
  'HFM_PROVENANCE_POLICY_ROLLBACK');

rejects(() => verify(signed(), { acceptedPolicyState: state({ revokedPolicyIds: ['synthetic-policy-001'] }) }),
  'HFM_PROVENANCE_POLICY_REVOKED');

rejects(() => verify(signed(), { acceptedPolicyState: state({ statusAvailable: false }) }),
  'HFM_PROVENANCE_POLICY_STATUS_UNAVAILABLE');

rejects(() => verify(signed(), { expectedProjectId: 'another-project' }),
  'HFM_PROVENANCE_POLICY_SCOPE_INVALID');

const expired = payload();
expired.expiresAt = '2026-11-05T11:59:59.000Z';
rejects(() => verify(signed(expired)), 'HFM_PROVENANCE_POLICY_EXPIRED_OR_INVALID');

const shared = payload();
shared.sources[sourceIds[1]].storageInstanceId = shared.sources[sourceIds[0]].storageInstanceId;
rejects(() => verify(signed(shared)), 'HFM_PROVENANCE_NOT_INDEPENDENT');

const missingEvidence = payload();
delete missingEvidence.evidence[sourceIds[1]].snapshotIssuerId;
rejects(() => verify(signed(missingEvidence)), 'HFM_PROVENANCE_EVIDENCE_INVALID');

const selfEvidence = payload();
selfEvidence.evidence[sourceIds[0]].storageSystemId.issuerId = sourceIds[0];
rejects(() => verify(signed(selfEvidence)), 'HFM_PROVENANCE_EVIDENCE_INVALID');

const insufficientApprovals = payload();
insufficientApprovals.approvals = [{ reviewerId: 'reviewer-a', role: 'security-reviewer' }];
rejects(() => verify(signed(insufficientApprovals)), 'HFM_PROVENANCE_POLICY_APPROVAL_QUORUM_INVALID');

const duplicateApprovals = payload();
duplicateApprovals.approvals[1].reviewerId = duplicateApprovals.approvals[0].reviewerId;
rejects(() => verify(signed(duplicateApprovals)), 'HFM_PROVENANCE_POLICY_APPROVAL_QUORUM_INVALID');

process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_VALID_SIGNATURE_PASS\\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_ISSUER_PINNING_PASS\\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_SCOPE_AND_TIME_PASS\\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_ANTI_ROLLBACK_AND_REVOCATION_PASS\\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_EVIDENCE_BINDING_PASS\\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_REVIEW_QUORUM_PASS\\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_FAIL_CLOSED_PASS\\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_NOT_INFRASTRUCTURE_CERTIFIED_PASS\\n');
process.stdout.write('MIRA_HFM_SIGNED_PROVENANCE_POLICY_CONTRACT_COMPLETE\\n');
