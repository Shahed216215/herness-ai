'use strict';

const crypto = require('node:crypto');
const { canonicalizeProvenancePolicy } = require('./mira-hfm-signed-provenance-policy');
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
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function verifyEvidenceEnvelope({
  envelope, reference, sourceId, dimension, expectedValue, trustedEvidenceIssuers,
  expectedEnvironment, expectedProjectId, operationalIssuerIds = [],
  excludedKeyFingerprints = [], now = Date.now()
}) {
  if (!Number.isSafeInteger(now)) {
    fail('Provenance evidence verifier clock configuration is invalid.',
      'HFM_PROVENANCE_EVIDENCE_CONFIG_INVALID');
  }
  if (!Array.isArray(excludedKeyFingerprints) ||
      excludedKeyFingerprints.some(value => !/^[a-f0-9]{64}$/.test(value))) {
    fail('Excluded evidence trust-role fingerprints are invalid.',
      'HFM_PROVENANCE_EVIDENCE_CONFIG_INVALID');
  }
  if (!isPlainObject(envelope) || !isPlainObject(envelope.payload) ||
      typeof envelope.signature !== 'string' || !isPlainObject(reference)) {
    fail('Independent provenance evidence envelope or policy reference is missing.',
      'HFM_PROVENANCE_EVIDENCE_ENVELOPE_INVALID');
  }
  const p = envelope.payload;
  if (p.contractVersion !== '1' || p.evidenceId !== reference.evidenceId ||
      p.sourceId !== sourceId || p.dimension !== dimension ||
      p.issuerId !== reference.issuerId || p.issuerId === sourceId ||
      operationalIssuerIds.includes(p.issuerId) ||
      !isPlainObject(p.scope) || p.scope.environment !== expectedEnvironment ||
      p.scope.projectId !== expectedProjectId ||
      !Array.isArray(p.reviewerIds) || p.reviewerIds.length < 1 ||
      p.reviewerIds.some(id => typeof id !== 'string' || !id.trim() || operationalIssuerIds.includes(id)) ||
      new Set(p.reviewerIds).size !== p.reviewerIds.length ||
      !Array.isArray(reference.reviewerIds) ||
      reference.reviewerIds.length !== p.reviewerIds.length ||
      reference.reviewerIds.some(id => !p.reviewerIds.includes(id)) ||
      !isPlainObject(p.record) || p.record.sourceId !== sourceId ||
      p.record.dimension !== dimension || p.record.observedValue !== expectedValue ||
      p.record.environment !== expectedEnvironment || p.record.projectId !== expectedProjectId) {
    fail('Independent evidence identity, scope, issuer or reviewer binding is invalid.',
      'HFM_PROVENANCE_EVIDENCE_BINDING_MISMATCH');
  }
  const issuedAt = Date.parse(p.issuedAt);
  const expiresAt = Date.parse(p.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      issuedAt > now + 30000 || expiresAt <= now || expiresAt <= issuedAt) {
    fail('Independent provenance evidence is stale or has invalid validity dates.',
      'HFM_PROVENANCE_EVIDENCE_STALE');
  }
  const anchor = isPlainObject(trustedEvidenceIssuers) ? trustedEvidenceIssuers[p.issuerId] : null;
  if (!isPlainObject(anchor) || anchor.keyId !== p.signerKeyId ||
      anchor.keyVersion !== p.signerKeyVersion ||
      typeof anchor.publicKeyPem !== 'string' ||
      !/^[a-f0-9]{64}$/.test(anchor.publicKeySha256 || '')) {
    fail('Evidence issuer is not independently pinned.', 'HFM_PROVENANCE_EVIDENCE_ISSUER_UNTRUSTED');
  }
  let key;
  try { key = crypto.createPublicKey(anchor.publicKeyPem); }
  catch { fail('Evidence issuer public key is invalid.', 'HFM_PROVENANCE_EVIDENCE_KEY_INVALID'); }
  const keyFingerprint = sha256(key.export({ type: 'spki', format: 'der' }));
  if (key.asymmetricKeyType !== 'ed25519' || keyFingerprint !== anchor.publicKeySha256) {
    fail('Evidence issuer key type or fingerprint is invalid.', 'HFM_PROVENANCE_EVIDENCE_KEY_INVALID');
  }
  if (excludedKeyFingerprints.includes(keyFingerprint)) {
    fail('Evidence issuer key material overlaps a policy, state, or reviewer trust role.',
      'HFM_PROVENANCE_EVIDENCE_KEY_ROLE_COLLISION');
  }
  let signature;
  try {
    signature = Buffer.from(envelope.signature, 'base64');
    if (!signature.length || signature.toString('base64') !== envelope.signature) throw new Error('bad base64');
  } catch {
    fail('Evidence signature encoding is invalid.', 'HFM_PROVENANCE_EVIDENCE_SIGNATURE_INVALID');
  }
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(canonicalizeProvenancePolicy(p), 'utf8'), key, signature);
  } catch { valid = false; }
  if (!valid) fail('Independent evidence signature verification failed.',
    'HFM_PROVENANCE_EVIDENCE_SIGNATURE_INVALID');
  const digest = sha256(Buffer.from(canonicalizeProvenancePolicy(p.record), 'utf8'));
  if (digest !== reference.sha256) {
    fail('Evidence record digest does not match the signed policy reference.',
      'HFM_PROVENANCE_EVIDENCE_DIGEST_MISMATCH');
  }
  return Object.freeze({
    evidenceId: p.evidenceId,
    sourceId,
    dimension,
    issuerId: p.issuerId,
    keyFingerprint,
    digest,
    reviewerIds: Object.freeze(p.reviewerIds.slice()),
    verified: true
  });
}

async function verifyAllPolicyEvidence({
  policyPayload, evidenceProvider, trustedEvidenceIssuers,
  expectedEnvironment, expectedProjectId, operationalIssuerIds = [],
  excludedKeyFingerprints = [], now = Date.now()
}) {
  if (!Number.isSafeInteger(now)) {
    fail('Provenance evidence collection clock configuration is invalid.',
      'HFM_PROVENANCE_EVIDENCE_CONFIG_INVALID');
  }
  if (!Array.isArray(excludedKeyFingerprints) ||
      excludedKeyFingerprints.some(value => !/^[a-f0-9]{64}$/.test(value))) {
    fail('Excluded evidence trust-role fingerprints are invalid.',
      'HFM_PROVENANCE_EVIDENCE_CONFIG_INVALID');
  }
  if (!isPlainObject(policyPayload) || !isPlainObject(policyPayload.sources) ||
      !isPlainObject(policyPayload.evidence) || !isPlainObject(trustedEvidenceIssuers) ||
      !isPlainObject(evidenceProvider) || typeof evidenceProvider.resolve !== 'function' ||
      !Array.isArray(operationalIssuerIds) ||
      operationalIssuerIds.some(id => typeof id !== 'string' || !id.trim())) {
    fail('Policy payload, pinned evidence trust and independent evidence resolver are required.',
      'HFM_PROVENANCE_EVIDENCE_PROVIDER_REQUIRED');
  }
  // Snapshot mutable caller inputs before the first asynchronous evidence lookup.
  let stablePayload, stableEvidenceTrust;
  try {
    stablePayload = JSON.parse(canonicalizeProvenancePolicy({
      sources: policyPayload.sources, evidence: policyPayload.evidence
    }));
    stableEvidenceTrust = JSON.parse(canonicalizeProvenancePolicy(trustedEvidenceIssuers));
  } catch {
    fail('Policy evidence references or trust anchors cannot be snapshotted as canonical JSON.',
      'HFM_PROVENANCE_EVIDENCE_CONFIG_INVALID');
  }
  const stableOperationalIssuerIds = Object.freeze(operationalIssuerIds.slice());
  const stableExcludedKeyFingerprints = Object.freeze(excludedKeyFingerprints.slice());
  const sourceIds = Object.keys(stablePayload.sources);
  const evidenceSourceIds = Object.keys(stablePayload.evidence);
  if (evidenceSourceIds.length !== sourceIds.length ||
      sourceIds.some(sourceId => !Object.prototype.hasOwnProperty.call(stablePayload.evidence, sourceId))) {
    fail('Evidence register source keys must exactly match the signed source profiles.',
      'HFM_PROVENANCE_EVIDENCE_REFERENCE_MISSING');
  }
  for (const sourceId of sourceIds) {
    const profile = stablePayload.sources[sourceId];
    const refs = stablePayload.evidence[sourceId];
    if (!isPlainObject(profile) || REQUIRED_FIELDS.some(field =>
        typeof profile[field] !== 'string' || !profile[field].trim()) ||
        !isPlainObject(refs) || Object.keys(refs).length !== REQUIRED_FIELDS.length ||
        Object.keys(refs).some(field => !REQUIRED_FIELDS.includes(field))) {
      fail('Evidence register must bind exactly six complete provenance values for each source.',
        'HFM_PROVENANCE_EVIDENCE_REFERENCE_MISSING');
    }
  }
  const verified = [];
  const seenEvidenceIds = new Set();
  const issuerFingerprintById = new Map();
  const issuerIdByFingerprint = new Map();
  for (const sourceId of Object.keys(stablePayload.sources)) {
    const refs = stablePayload.evidence[sourceId];
    if (!isPlainObject(refs)) fail('Policy evidence references are incomplete.',
      'HFM_PROVENANCE_EVIDENCE_REFERENCE_MISSING');
    for (const dimension of REQUIRED_FIELDS) {
      const reference = refs[dimension];
      if (!isPlainObject(reference) || typeof reference.evidenceId !== 'string' ||
          typeof reference.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(reference.sha256)) {
        fail('Policy evidence reference is missing or malformed: ' + sourceId + '/' + dimension,
          'HFM_PROVENANCE_EVIDENCE_REFERENCE_MISSING');
      }
      if (seenEvidenceIds.has(reference.evidenceId)) {
        fail('An evidence ID must be unique across every source and provenance dimension.',
          'HFM_PROVENANCE_EVIDENCE_DUPLICATE_ID');
      }
      seenEvidenceIds.add(reference.evidenceId);
      let envelope;
      try { envelope = await evidenceProvider.resolve({ evidenceId: reference.evidenceId }); }
      catch {
        fail('Independent evidence could not be resolved: ' + reference.evidenceId,
          'HFM_PROVENANCE_EVIDENCE_UNAVAILABLE');
      }
      const verifiedEvidence = verifyEvidenceEnvelope({
        envelope, reference, sourceId, dimension,
        expectedValue: stablePayload.sources[sourceId][dimension], trustedEvidenceIssuers: stableEvidenceTrust,
        expectedEnvironment, expectedProjectId, operationalIssuerIds: stableOperationalIssuerIds,
        excludedKeyFingerprints: stableExcludedKeyFingerprints, now
      });
      const priorFingerprint = issuerFingerprintById.get(verifiedEvidence.issuerId);
      const priorIssuer = issuerIdByFingerprint.get(verifiedEvidence.keyFingerprint);
      if ((priorFingerprint && priorFingerprint !== verifiedEvidence.keyFingerprint) ||
          (priorIssuer && priorIssuer !== verifiedEvidence.issuerId)) {
        fail('Evidence issuer identities must not alias or rotate key material within one policy evidence set.',
          'HFM_PROVENANCE_EVIDENCE_ISSUER_KEY_COLLISION');
      }
      issuerFingerprintById.set(verifiedEvidence.issuerId, verifiedEvidence.keyFingerprint);
      issuerIdByFingerprint.set(verifiedEvidence.keyFingerprint, verifiedEvidence.issuerId);
      verified.push(verifiedEvidence);
    }
  }
  return Object.freeze({
    status: 'ALL_POLICY_EVIDENCE_SIGNATURES_AND_DIGESTS_VERIFIED',
    verifiedCount: verified.length,
    evidence: Object.freeze(verified)
  });
}

module.exports = { verifyEvidenceEnvelope, verifyAllPolicyEvidence };
