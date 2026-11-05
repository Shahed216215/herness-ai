'use strict';

const crypto = require('node:crypto');
const { encryptSnapshot } = require('./mira-hfm-emergency-backup');

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (!isPlainObject(value)) throw new Error('Snapshot contains an unsupported value.');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}';
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function fail(message, code) { const error = new Error(message); error.code = code; throw error; }
function unsignedAttestation(attestation) {
  const { signature, ...unsigned } = attestation;
  return unsigned;
}

/**
 * Source signature verification uses an independently configured trust store.
 * The source's own descriptor/public key is never trusted as its own anchor.
 * Signature authentication still does not replace authorization policy review.
 */
async function captureAuthorizedSnapshot({
  source, request, trustedSources, now = Date.now(),
  maxAttestationAgeMs = 300000, maxFutureSkewMs = 30000
}) {
  if (!isPlainObject(source) || !isPlainObject(source.descriptor) ||
      typeof source.readSnapshot !== 'function' || !isPlainObject(request) ||
      typeof request.projectId !== 'string' || !request.projectId.trim() ||
      typeof request.actorId !== 'string' || !request.actorId.trim() ||
      typeof request.requestId !== 'string' || !request.requestId.trim() ||
      typeof request.nonce !== 'string' || request.nonce.length < 16 ||
      request.scope !== 'backup:read' || !isPlainObject(trustedSources)) {
    fail('A read-only source, independent trust store, and explicit project/actor/request/nonce backup-read request are required.',
      'HFM_SNAPSHOT_SOURCE_CONTRACT_MISSING');
  }
  const descriptor = source.descriptor;
  if (descriptor.contractVersion !== '1' || typeof descriptor.sourceId !== 'string' ||
      !descriptor.sourceId.trim() || descriptor.mode !== 'read-only' ||
      !['test', 'staging', 'production'].includes(descriptor.environment)) {
    fail('Snapshot source descriptor is invalid or is not explicitly read-only.',
      'HFM_SNAPSHOT_SOURCE_CONTRACT_INVALID');
  }
  const trusted = trustedSources[descriptor.sourceId];
  if (!isPlainObject(trusted) || typeof trusted.publicKeyPem !== 'string' ||
      !trusted.publicKeyPem.includes('PUBLIC KEY') || typeof trusted.keyId !== 'string' ||
      !trusted.keyId.trim() || trusted.keyId !== descriptor.signingKeyId) {
    fail('Snapshot source is not present in the independent trust store or its signing key reference differs.',
      'HFM_SNAPSHOT_SOURCE_UNTRUSTED');
  }
  const publicKey = crypto.createPublicKey(trusted.publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    fail('Snapshot source trust anchor must be an Ed25519 public key.',
      'HFM_SNAPSHOT_TRUST_ANCHOR_INVALID');
  }
  const fingerprint = sha256(publicKey.export({ type: 'spki', format: 'der' }));
  if (trusted.publicKeySha256 !== fingerprint) {
    fail('Snapshot source trust-anchor fingerprint does not match the pinned value.',
      'HFM_SNAPSHOT_TRUST_ANCHOR_MISMATCH');
  }

  const result = await source.readSnapshot({
    projectId: request.projectId, actorId: request.actorId, scope: request.scope,
    requestId: request.requestId, nonce: request.nonce
  });
  if (!isPlainObject(result) || !isPlainObject(result.snapshot) ||
      !Array.isArray(result.snapshot.records) || !isPlainObject(result.attestation)) {
    fail('Snapshot source returned an invalid snapshot or attestation.',
      'HFM_SNAPSHOT_ATTESTATION_INVALID');
  }
  const a = result.attestation;
  const capturedAtMs = Date.parse(a.capturedAt);
  if (a.sourceId !== descriptor.sourceId || a.signingKeyId !== trusted.keyId ||
      a.projectId !== request.projectId || a.actorId !== request.actorId ||
      a.authorizationDecision !== 'ALLOW' || a.authorizationScope !== request.scope ||
      a.requestId !== request.requestId || a.nonce !== request.nonce ||
      typeof a.sourceRevision !== 'string' || !a.sourceRevision.trim() ||
      typeof a.schemaVersion !== 'string' || !a.schemaVersion.trim() ||
      !Number.isFinite(capturedAtMs) || capturedAtMs > now + maxFutureSkewMs ||
      now - capturedAtMs > maxAttestationAgeMs ||
      a.recordCount !== result.snapshot.records.length ||
      typeof a.payloadSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.payloadSha256) ||
      typeof a.authorizationIssuerId !== 'string' || !a.authorizationIssuerId.trim() ||
      typeof a.authorizationDecisionId !== 'string' || !a.authorizationDecisionId.trim() ||
      typeof a.authorizationPolicyVersion !== 'string' || !a.authorizationPolicyVersion.trim() ||
      !Number.isFinite(Date.parse(a.authorizationExpiresAt)) || Date.parse(a.authorizationExpiresAt) < capturedAtMs ||
      sha256(Buffer.from(canonicalize(result.snapshot), 'utf8')) !== a.payloadSha256 ||
      typeof a.signature !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(a.signature)) {
    fail('Snapshot source authorization, request binding, freshness, revision, count, or digest attestation failed.',
      'HFM_SNAPSHOT_ATTESTATION_MISMATCH');
  }
  let signatureValid = false;
  try {
    signatureValid = crypto.verify(null, Buffer.from(canonicalize(unsignedAttestation(a)), 'utf8'),
      publicKey, Buffer.from(a.signature, 'base64'));
  } catch { signatureValid = false; }
  if (!signatureValid) fail('Snapshot source signature verification failed.', 'HFM_SNAPSHOT_SIGNATURE_INVALID');

  return {
    status: 'SNAPSHOT_SOURCE_SIGNATURE_VERIFIED_AUTHORIZATION_CLAIM',
    snapshot: result.snapshot,
    metadata: {
      schemaVersion: a.schemaVersion, projectId: a.projectId,
      sourceRevision: a.sourceRevision, recordCount: a.recordCount
    },
    evidence: {
      sourceId: a.sourceId, signingKeyId: a.signingKeyId,
      trustAnchorSha256: fingerprint, actorId: a.actorId,
      authorizationScope: a.authorizationScope, requestId: a.requestId,
      capturedAt: a.capturedAt, payloadSha256: a.payloadSha256,
      signatureVerified: true, authorizationIndependentlyEnforced: false, authorizationDecisionAuthenticated: true,
      productionApproval: false
    }
  };
}

/**
 * Staging/test pipeline: authenticated source snapshot -> encrypted envelope.
 * It deliberately writes no local file, Drive object, or canonical Memory.
 */
async function createEncryptedBackupFromSource({
  source, request, trustedSources, keyProvider, now,
  maxAttestationAgeMs, maxFutureSkewMs
}) {
  const captured = await captureAuthorizedSnapshot({
    source, request, trustedSources, now, maxAttestationAgeMs, maxFutureSkewMs
  });
  const metadata = {
    ...captured.metadata,
    keyId: keyProvider && keyProvider.descriptor && keyProvider.descriptor.keyId,
    keyVersion: keyProvider && keyProvider.descriptor && keyProvider.descriptor.keyVersion
  };
  const encrypted = await encryptSnapshot({ snapshot: captured.snapshot, metadata, keyProvider });
  return {
    status: 'ENCRYPTED_BACKUP_PREPARED_NOT_PUBLISHED',
    backup: encrypted,
    metadata,
    sourceEvidence: captured.evidence,
    localFileWritten: false,
    driveObjectWritten: false,
    canonicalMemoryWritten: false,
    productionApproval: false
  };
}

module.exports = { captureAuthorizedSnapshot, createEncryptedBackupFromSource, canonicalize, sha256 };
