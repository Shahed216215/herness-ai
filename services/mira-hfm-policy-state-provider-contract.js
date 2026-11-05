'use strict';

const crypto = require('node:crypto');
const { verifySignedProvenancePolicy, canonicalizeProvenancePolicy } =
  require('./mira-hfm-signed-provenance-policy');
const { verifyAllPolicyEvidence } = require('./mira-hfm-provenance-evidence-verifier');

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function verifySignedRecord(envelope, trust, expectedAuthorityId, now, codePrefix) {
  if (!Number.isSafeInteger(now)) {
    fail('Policy-state verifier clock configuration is invalid.', codePrefix + '_CONFIG_INVALID');
  }
  if (!isPlainObject(envelope) || !isPlainObject(envelope.payload) ||
      typeof envelope.signature !== 'string' || !isPlainObject(envelope.payload.signer)) {
    fail('Signed policy-state record is missing or malformed.', codePrefix + '_INVALID');
  }
  const p = envelope.payload;
  const signer = p.signer;
  if (p.authorityId !== expectedAuthorityId || signer.authorityId !== expectedAuthorityId ||
      !isPlainObject(trust) || !isPlainObject(trust[expectedAuthorityId])) {
    fail('Policy-state authority is not independently pinned.', codePrefix + '_AUTHORITY_UNTRUSTED');
  }
  const anchor = trust[expectedAuthorityId];
  if (anchor.keyId !== signer.keyId || anchor.keyVersion !== signer.keyVersion ||
      typeof anchor.publicKeyPem !== 'string' ||
      !/^[a-f0-9]{64}$/.test(anchor.publicKeySha256 || '')) {
    fail('Policy-state signing key does not match its pinned trust anchor.', codePrefix + '_KEY_UNTRUSTED');
  }
  let key;
  try { key = crypto.createPublicKey(anchor.publicKeyPem); }
  catch { fail('Policy-state public key is invalid.', codePrefix + '_KEY_INVALID'); }
  if (key.asymmetricKeyType !== 'ed25519' ||
      sha256(key.export({ type: 'spki', format: 'der' })) !== anchor.publicKeySha256) {
    fail('Policy-state public-key type or fingerprint is invalid.', codePrefix + '_KEY_INVALID');
  }
  let signature;
  try {
    signature = Buffer.from(envelope.signature, 'base64');
    if (!signature.length || signature.toString('base64') !== envelope.signature) throw new Error('bad base64');
  } catch {
    fail('Policy-state signature encoding is invalid.', codePrefix + '_SIGNATURE_INVALID');
  }
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(canonicalizeProvenancePolicy(p), 'utf8'), key, signature);
  } catch { valid = false; }
  if (!valid) fail('Policy-state signature verification failed.', codePrefix + '_SIGNATURE_INVALID');
  if (!Number.isFinite(Date.parse(p.issuedAt)) || !Number.isFinite(Date.parse(p.expiresAt)) ||
      Date.parse(p.issuedAt) > now + 30000 || Date.parse(p.expiresAt) <= now ||
      Date.parse(p.expiresAt) <= Date.parse(p.issuedAt)) {
    fail('Policy-state record is expired or has an invalid validity interval.', codePrefix + '_STALE');
  }
  return p;
}

function verifyPolicyStateEnvelope({
  envelope, trustedStateAuthorities, expectedAuthorityId, operationalIssuerIds = [], now = Date.now()
}) {
  const p = verifySignedRecord(envelope, trustedStateAuthorities, expectedAuthorityId, now,
    'HFM_POLICY_STATE');
  if (operationalIssuerIds.includes(expectedAuthorityId) ||
      p.contractVersion !== '1' || p.statusAvailable !== true ||
      p.durable !== true || p.atomic !== true ||
      !Number.isSafeInteger(p.highestAcceptedSequence) || p.highestAcceptedSequence < 0 ||
      !Array.isArray(p.revokedPolicyIds) ||
      p.revokedPolicyIds.some(id => typeof id !== 'string' || !id.trim()) ||
      new Set(p.revokedPolicyIds).size !== p.revokedPolicyIds.length ||
      (p.highestAcceptedSequence === 0 &&
        (p.lastAcceptedPolicyId !== null || p.lastAcceptedPolicyDigest !== null)) ||
      (p.highestAcceptedSequence > 0 &&
        (typeof p.lastAcceptedPolicyId !== 'string' || !p.lastAcceptedPolicyId.trim() ||
         !/^[a-f0-9]{64}$/.test(p.lastAcceptedPolicyDigest || '')))) {
    fail('Signed policy-state contents or provider guarantees are invalid.', 'HFM_POLICY_STATE_CONTENT_INVALID');
  }
  return Object.freeze({
    authorityId: expectedAuthorityId,
    authenticated: true,
    durable: p.durable,
    atomic: p.atomic,
    statusAvailable: p.statusAvailable,
    statusValidUntil: p.expiresAt,
    highestAcceptedSequence: p.highestAcceptedSequence,
    lastAcceptedPolicyId: p.lastAcceptedPolicyId,
    lastAcceptedPolicyDigest: p.lastAcceptedPolicyDigest,
    revokedPolicyIds: Object.freeze(p.revokedPolicyIds.slice())
  });
}

function verifyPolicyStateCommitReceipt({
  receipt, trustedStateAuthorities, expectedAuthorityId, expectedPreviousSequence,
  expectedNextState, now = Date.now()
}) {
  const p = verifySignedRecord(receipt, trustedStateAuthorities, expectedAuthorityId, now,
    'HFM_POLICY_STATE_COMMIT');
  if (p.contractVersion !== '1' ||
      p.previousSequence !== expectedPreviousSequence ||
      p.nextSequence !== expectedNextState.highestAcceptedSequence ||
      p.policyId !== expectedNextState.lastAcceptedPolicyId ||
      p.policyDigest !== expectedNextState.lastAcceptedPolicyDigest ||
      p.nextSequence !== p.previousSequence + 1) {
    fail('Policy-state commit receipt does not match the exact compare-and-swap request.',
      'HFM_POLICY_STATE_COMMIT_MISMATCH');
  }
  return Object.freeze({
    committed: true,
    authorityId: expectedAuthorityId,
    previousSequence: p.previousSequence,
    nextSequence: p.nextSequence,
    policyId: p.policyId,
    policyDigest: p.policyDigest
  });
}

/**
 * The provider must implement authenticated readState and durable atomic
 * compareAndSwap. A caller-provided capability flag is never sufficient:
 * both the signed state envelope and signed commit receipt are verified.
 */
async function verifyAndAcceptSignedProvenancePolicy({
  envelope, provider, trustedStateAuthorities, expectedStateAuthorityId,
  trustedPolicyIssuers, trustedPolicyReviewers, evidenceProvider, trustedEvidenceIssuers,
  expectedEnvironment, expectedProjectId, operationalIssuerIds = [], now = Date.now()
}) {
  if (!Number.isSafeInteger(now)) {
    fail('Policy acceptance clock configuration is invalid.', 'HFM_POLICY_STATE_CONFIG_INVALID');
  }
  if (!isPlainObject(provider) || typeof provider.readState !== 'function' ||
      typeof provider.compareAndSwap !== 'function') {
    fail('An authenticated policy-state provider with read and atomic compare-and-swap is required.',
      'HFM_POLICY_STATE_PROVIDER_REQUIRED');
  }
  if (!isPlainObject(trustedStateAuthorities) ||
      operationalIssuerIds.includes(expectedStateAuthorityId)) {
    fail('A separately pinned policy-state authority is required.',
      'HFM_POLICY_STATE_AUTHORITY_UNTRUSTED');
  }
  let stateEnvelope;
  try {
    stateEnvelope = await provider.readState({ authorityId: expectedStateAuthorityId });
  } catch (error) {
    if (error && error.code === 'HFM_POLICY_STATE_UNAVAILABLE') throw error;
    fail('Policy-state authority could not be read; signed policy acceptance is denied.',
      'HFM_POLICY_STATE_UNAVAILABLE');
  }
  const acceptedPolicyState = verifyPolicyStateEnvelope({
    envelope: stateEnvelope,
    trustedStateAuthorities,
    expectedAuthorityId: expectedStateAuthorityId,
    operationalIssuerIds,
    now
  });
  const verified = verifySignedProvenancePolicy({
    envelope,
    trustedPolicyIssuers,
    trustedPolicyReviewers,
    acceptedPolicyState,
    expectedEnvironment,
    expectedProjectId,
    operationalIssuerIds,
    now
  });
  const policySignerId = envelope.payload && envelope.payload.signer &&
    envelope.payload.signer.issuerId;
  const policyReviewerIds = Array.isArray(envelope.payload && envelope.payload.approvals)
    ? envelope.payload.approvals.map(approval => approval && approval.reviewerId).filter(Boolean)
    : [];
  const evidenceIssuerExclusions = [...new Set([
    ...operationalIssuerIds,
    expectedStateAuthorityId,
    policySignerId,
    ...policyReviewerIds
  ].filter(Boolean))];
  const evidenceVerification = await verifyAllPolicyEvidence({
    policyPayload: envelope.payload,
    evidenceProvider,
    trustedEvidenceIssuers,
    expectedEnvironment,
    expectedProjectId,
    operationalIssuerIds: evidenceIssuerExclusions,
    now
  });
  let receipt;
  try {
    receipt = await provider.compareAndSwap({
      authorityId: expectedStateAuthorityId,
      expectedSequence: acceptedPolicyState.highestAcceptedSequence,
      expectedDigest: acceptedPolicyState.lastAcceptedPolicyDigest,
      nextState: verified.nextAcceptedState
    });
  } catch (error) {
    if (error && (error.code === 'HFM_POLICY_STATE_CAS_CONFLICT' ||
        error.code === 'HFM_POLICY_STATE_UNAVAILABLE')) throw error;
    fail('Policy-state compare-and-swap did not complete; policy remains unaccepted.',
      'HFM_POLICY_STATE_COMMIT_FAILED');
  }
  const commit = verifyPolicyStateCommitReceipt({
    receipt,
    trustedStateAuthorities,
    expectedAuthorityId: expectedStateAuthorityId,
    expectedPreviousSequence: acceptedPolicyState.highestAcceptedSequence,
    expectedNextState: verified.nextAcceptedState,
    now
  });
  return Object.freeze({
    status: 'SIGNED_PROVENANCE_POLICY_VERIFIED_AND_STATE_COMMIT_RECEIPT_VERIFIED_NOT_INFRASTRUCTURE_CERTIFIED',
    policyId: verified.policyId,
    policyVersion: verified.policyVersion,
    policyDigest: verified.policyDigest,
    stateCommit: commit,
    evidenceVerification: Object.freeze({ status: evidenceVerification.status, verifiedCount: evidenceVerification.verifiedCount }),
    provenancePolicy: verified.provenancePolicy,
    infrastructureIndependentlyCertified: false,
    productionApproval: false
  });
}

module.exports = {
  verifyPolicyStateEnvelope,
  verifyPolicyStateCommitReceipt,
  verifyAndAcceptSignedProvenancePolicy
};
