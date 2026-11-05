'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyAllPolicyEvidence } = require('../services/mira-hfm-provenance-evidence-verifier');
const { canonicalizeProvenancePolicy } = require('../services/mira-hfm-signed-provenance-policy');
const { REQUIRED_FIELDS } = require('../services/mira-hfm-source-provenance-contract');

const now = Date.parse('2026-11-05T12:00:00.000Z');
const pair = crypto.generateKeyPairSync('ed25519');
const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const publicKeySha256 = crypto.createHash('sha256')
  .update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const issuerId = 'synthetic-evidence-issuer';
const trustedEvidenceIssuers = {
  [issuerId]: { keyId: 'evidence-key', keyVersion: '1', publicKeyPem, publicKeySha256 }
};
function sign(payload) {
  return {
    payload,
    signature: crypto.sign(null, Buffer.from(canonicalizeProvenancePolicy(payload)), pair.privateKey).toString('base64')
  };
}
function fixture() {
  const sources = { baseline: {}, backup: {} };
  const evidence = { baseline: {}, backup: {} };
  const records = new Map();
  for (const sourceId of Object.keys(sources)) {
    for (const dimension of REQUIRED_FIELDS) {
      const evidenceId = sourceId + '-' + dimension;
      const record = { resourceId: evidenceId, dimension, project: 'mira-hfm-v02' };
      const digest = crypto.createHash('sha256')
        .update(canonicalizeProvenancePolicy(record)).digest('hex');
      const payload = {
        contractVersion: '1', evidenceId, sourceId, dimension, issuerId,
        signerKeyId: 'evidence-key', signerKeyVersion: '1',
        issuedAt: '2026-11-05T11:59:00.000Z', expiresAt: '2026-11-05T12:30:00.000Z',
        scope: { environment: 'test', projectId: 'mira-hfm-v02' },
        reviewerIds: ['reviewer-a', 'reviewer-b'], record
      };
      records.set(evidenceId, sign(payload));
      evidence[sourceId][dimension] = {
        evidenceId, sha256: digest, issuerId,
        reviewerIds: ['reviewer-a', 'reviewer-b']
      };
    }
  }
  return {
    policyPayload: { sources, evidence },
    evidenceProvider: { async resolve({ evidenceId }) { return records.get(evidenceId); } },
    records
  };
}
async function rejects(promise, code) {
  await assert.rejects(promise, error => error && error.code === code);
}
(async () => {
  const f = fixture();
  const valid = await verifyAllPolicyEvidence({
    ...f, trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', now
  });
  assert.equal(valid.verifiedCount, 12);

  const duplicate = fixture();
  duplicate.policyPayload.evidence.backup.storageInstanceId.evidenceId =
    duplicate.policyPayload.evidence.baseline.storageSystemId.evidenceId;
  await rejects(verifyAllPolicyEvidence({
    ...duplicate, trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', now
  }), 'HFM_PROVENANCE_EVIDENCE_DUPLICATE_ID');

  await rejects(verifyAllPolicyEvidence({
    ...fixture(), trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', operationalIssuerIds: [issuerId], now
  }), 'HFM_PROVENANCE_EVIDENCE_BINDING_MISMATCH');

  const badDigest = fixture();
  badDigest.policyPayload.evidence.baseline.storageSystemId.sha256 = '0'.repeat(64);
  await rejects(verifyAllPolicyEvidence({
    ...badDigest, trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', now
  }), 'HFM_PROVENANCE_EVIDENCE_DIGEST_MISMATCH');

  const forged = fixture();
  const forgedEnvelope = forged.records.get('baseline-storageSystemId');
  forgedEnvelope.signature = Buffer.alloc(64, 8).toString('base64');
  await rejects(verifyAllPolicyEvidence({
    ...forged, trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', now
  }), 'HFM_PROVENANCE_EVIDENCE_SIGNATURE_INVALID');

  const untrusted = fixture();
  await rejects(verifyAllPolicyEvidence({
    ...untrusted, trustedEvidenceIssuers: {}, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', now
  }), 'HFM_PROVENANCE_EVIDENCE_ISSUER_UNTRUSTED');

  const wrongScope = fixture();
  await rejects(verifyAllPolicyEvidence({
    ...wrongScope, trustedEvidenceIssuers, expectedEnvironment: 'staging',
    expectedProjectId: 'mira-hfm-v02', now
  }), 'HFM_PROVENANCE_EVIDENCE_BINDING_MISMATCH');

  const stale = fixture();
  const staleEnvelope = stale.records.get('baseline-storageSystemId');
  staleEnvelope.payload.expiresAt = '2026-11-05T11:59:59.000Z';
  staleEnvelope.signature = crypto.sign(null,
    Buffer.from(canonicalizeProvenancePolicy(staleEnvelope.payload)), pair.privateKey).toString('base64');
  await rejects(verifyAllPolicyEvidence({
    ...stale, trustedEvidenceIssuers, expectedEnvironment: 'test',
    expectedProjectId: 'mira-hfm-v02', now
  }), 'HFM_PROVENANCE_EVIDENCE_STALE');

  process.stdout.write('MIRA_HFM_PROVENANCE_EVIDENCE_SIGNED_ISSUER_PASS\n');
  process.stdout.write('MIRA_HFM_PROVENANCE_EVIDENCE_SCOPE_BINDING_PASS\n');
  process.stdout.write('MIRA_HFM_PROVENANCE_EVIDENCE_DIGEST_BINDING_PASS\n');
  process.stdout.write('MIRA_HFM_PROVENANCE_EVIDENCE_FRESHNESS_PASS\n');
  process.stdout.write('MIRA_HFM_PROVENANCE_EVIDENCE_FAIL_CLOSED_PASS\n');
  process.stdout.write('MIRA_HFM_PROVENANCE_EVIDENCE_CONTRACT_COMPLETE\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
