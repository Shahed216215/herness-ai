'use strict';

const crypto = require('node:crypto');
const { REQUIRED_FIELDS } = require('./mira-hfm-source-provenance-contract');

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
function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (!isPlainObject(value)) fail('Policy contains an unsupported value.', 'HFM_PROVENANCE_POLICY_VALUE_INVALID');
  return '{' + Object.keys(value).sort().map(key => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      fail('Policy contains a prohibited object key.', 'HFM_PROVENANCE_POLICY_VALUE_INVALID');
    }
    return JSON.stringify(key) + ':' + canonicalize(value[key]);
  }).join(',') + '}';
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function validText(value, max = 256) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function validateProfile(profile, label) {
  if (!isPlainObject(profile) || REQUIRED_FIELDS.some(field => !validText(profile[field]))) {
    fail(label + ' provenance profile is incomplete.', 'HFM_PROVENANCE_PROFILE_INVALID');
  }
  return Object.fromEntries(REQUIRED_FIELDS.map(field => [field, profile[field]]));
}
function validateEvidence(evidence, sourceId, label) {
  if (!isPlainObject(evidence)) fail(label + ' evidence register is missing.', 'HFM_PROVENANCE_EVIDENCE_INVALID');
  for (const field of REQUIRED_FIELDS) {
    const item = evidence[field];
    if (!isPlainObject(item) || !validText(item.evidenceId) ||
        !/^[a-f0-9]{64}$/.test(item.sha256 || '') ||
        !validText(item.issuerId) || item.issuerId === sourceId ||
        !Array.isArray(item.reviewerIds) || item.reviewerIds.length < 1 ||
        item.reviewerIds.some(id => !validText(id)) ||
        new Set(item.reviewerIds).size !== item.reviewerIds.length) {
      fail(label + ' evidence for ' + field + ' is invalid or self-authenticated.', 'HFM_PROVENANCE_EVIDENCE_INVALID');
    }
  }
}
function verifySignedProvenancePolicy({
  envelope, trustedPolicyIssuers, acceptedPolicyState, expectedEnvironment,
  expectedProjectId, operationalIssuerIds = [], now = Date.now(), maxFutureSkewMs = 30000
}) {
  if (!isPlainObject(envelope) || !isPlainObject(envelope.payload) ||
      !validText(envelope.signature, 2048) ||
      !isPlainObject(trustedPolicyIssuers) || !isPlainObject(acceptedPolicyState)) {
    fail('Signed policy envelope, separately pinned issuer trust and accepted policy state are required.',
      'HFM_PROVENANCE_POLICY_TRUST_INPUT_REQUIRED');
  }
  const p = envelope.payload;
  if (p.contractVersion !== '1' || !validText(p.policyId) ||
      !validText(p.policyVersion) || !Number.isSafeInteger(p.sequence) || p.sequence < 1 ||
      !isPlainObject(p.scope) || p.scope.environment !== expectedEnvironment ||
      p.scope.projectId !== expectedProjectId ||
      !['test', 'staging'].includes(p.scope.environment)) {
    fail('Policy version, sequence, project or environment scope is invalid.',
      'HFM_PROVENANCE_POLICY_SCOPE_INVALID');
  }
  if (!Number.isFinite(Date.parse(p.issuedAt)) || !Number.isFinite(Date.parse(p.notBefore)) ||
      !Number.isFinite(Date.parse(p.expiresAt)) ||
      Date.parse(p.issuedAt) > now + maxFutureSkewMs || Date.parse(p.notBefore) > now + maxFutureSkewMs ||
      Date.parse(p.expiresAt) <= now || Date.parse(p.expiresAt) <= Date.parse(p.notBefore)) {
    fail('Policy is not currently valid or has an invalid validity interval.',
      'HFM_PROVENANCE_POLICY_EXPIRED_OR_INVALID');
  }
  if (acceptedPolicyState.statusAvailable !== true ||
      !Number.isFinite(Date.parse(acceptedPolicyState.statusValidUntil)) ||
      Date.parse(acceptedPolicyState.statusValidUntil) <= now ||
      !Number.isSafeInteger(acceptedPolicyState.highestAcceptedSequence) ||
      acceptedPolicyState.highestAcceptedSequence < 0 ||
      !Array.isArray(acceptedPolicyState.revokedPolicyIds)) {
    fail('Trusted policy status or anti-rollback state is unavailable or stale.',
      'HFM_PROVENANCE_POLICY_STATUS_UNAVAILABLE');
  }
  if (acceptedPolicyState.revokedPolicyIds.includes(p.policyId)) {
    fail('Provenance policy has been revoked.', 'HFM_PROVENANCE_POLICY_REVOKED');
  }
  if (p.sequence <= acceptedPolicyState.highestAcceptedSequence) {
    fail('Provenance policy sequence is a rollback or replay.', 'HFM_PROVENANCE_POLICY_ROLLBACK');
  }
  if (!isPlainObject(p.signer) || !validText(p.signer.issuerId) ||
      !validText(p.signer.keyId) || !validText(p.signer.keyVersion)) {
    fail('Policy signer identity is incomplete.', 'HFM_PROVENANCE_POLICY_SIGNER_INVALID');
  }
  const trusted = trustedPolicyIssuers[p.signer.issuerId];
  if (!isPlainObject(trusted) || trusted.keyId !== p.signer.keyId ||
      trusted.keyVersion !== p.signer.keyVersion ||
      typeof trusted.publicKeyPem !== 'string' || !trusted.publicKeyPem.includes('PUBLIC KEY') ||
      !/^[a-f0-9]{64}$/.test(trusted.publicKeySha256 || '')) {
    fail('Policy issuer is not present in the separately pinned trust configuration.',
      'HFM_PROVENANCE_POLICY_ISSUER_UNTRUSTED');
  }
  if (operationalIssuerIds.includes(p.signer.issuerId)) {
    fail('Policy issuer overlaps a source or operational issuer trust role.',
      'HFM_PROVENANCE_POLICY_ISSUER_COLLISION');
  }
  let publicKey;
  try { publicKey = crypto.createPublicKey(trusted.publicKeyPem); }
  catch { fail('Policy issuer public key is invalid.', 'HFM_PROVENANCE_POLICY_KEY_INVALID'); }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    fail('Policy issuer key must use Ed25519.', 'HFM_PROVENANCE_POLICY_KEY_INVALID');
  }
  const fingerprint = sha256(publicKey.export({ type: 'spki', format: 'der' }));
  if (fingerprint !== trusted.publicKeySha256) {
    fail('Policy issuer public-key fingerprint mismatch.', 'HFM_PROVENANCE_POLICY_KEY_MISMATCH');
  }
  let signatureBytes;
  try {
    signatureBytes = Buffer.from(envelope.signature, 'base64');
    if (signatureBytes.toString('base64') !== envelope.signature) throw new Error('bad base64');
  } catch {
    fail('Policy signature encoding is invalid.', 'HFM_PROVENANCE_POLICY_SIGNATURE_INVALID');
  }
  let signatureValid = false;
  try {
    signatureValid = crypto.verify(null, Buffer.from(canonicalize(p), 'utf8'), publicKey, signatureBytes);
  } catch { signatureValid = false; }
  if (!signatureValid) fail('Policy signature verification failed.', 'HFM_PROVENANCE_POLICY_SIGNATURE_INVALID');

  if (!isPlainObject(p.sources) || !isPlainObject(p.evidence)) {
    fail('Policy source profiles and evidence registers are required.', 'HFM_PROVENANCE_POLICY_CONTENT_INVALID');
  }
  const sourceIds = Object.keys(p.sources);
  if (sourceIds.length !== 2 || sourceIds[0] === sourceIds[1]) {
    fail('Policy must define exactly two distinct source profiles.', 'HFM_PROVENANCE_POLICY_SOURCES_INVALID');
  }
  const profiles = {};
  for (const sourceId of sourceIds) {
    if (!validText(sourceId)) fail('Policy source ID is invalid.', 'HFM_PROVENANCE_POLICY_SOURCES_INVALID');
    profiles[sourceId] = validateProfile(p.sources[sourceId], sourceId);
    validateEvidence(p.evidence[sourceId], sourceId, sourceId);
  }
  for (const field of REQUIRED_FIELDS) {
    if (profiles[sourceIds[0]][field] === profiles[sourceIds[1]][field]) {
      fail('Policy sources share a provenance boundary: ' + field, 'HFM_PROVENANCE_NOT_INDEPENDENT');
    }
  }
  if (!Array.isArray(p.approvals) || p.approvals.length < 2 ||
      p.approvals.some(a => !isPlainObject(a) || !validText(a.reviewerId) ||
        !validText(a.role) || a.reviewerId === p.signer.issuerId) ||
      new Set(p.approvals.map(a => a.reviewerId)).size !== p.approvals.length) {
    fail('Policy requires two distinct reviewers separate from the policy issuer.',
      'HFM_PROVENANCE_POLICY_APPROVAL_QUORUM_INVALID');
  }
  const digest = sha256(Buffer.from(canonicalize(p), 'utf8'));
  return Object.freeze({
    status: 'PROVENANCE_POLICY_SIGNATURE_AND_STATE_VERIFIED_NOT_INFRASTRUCTURE_CERTIFIED',
    policyId: p.policyId,
    policyVersion: p.policyVersion,
    sequence: p.sequence,
    policyDigest: digest,
    policyIssuerId: p.signer.issuerId,
    policyIssuerKeyId: p.signer.keyId,
    policyIssuerKeyFingerprint: fingerprint,
    provenancePolicy: Object.freeze({
      contractVersion: '1',
      policyVersion: p.policyVersion,
      sources: Object.freeze(profiles)
    }),
    nextAcceptedState: Object.freeze({
      highestAcceptedSequence: p.sequence,
      lastAcceptedPolicyId: p.policyId,
      lastAcceptedPolicyDigest: digest
    }),
    infrastructureIndependentlyCertified: false,
    productionApproval: false
  });
}

module.exports = { verifySignedProvenancePolicy, canonicalizeProvenancePolicy: canonicalize };
