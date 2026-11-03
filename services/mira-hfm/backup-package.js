'use strict';
const { canonicalize, sha256Canonical } = require('./core');
const { encryptPayload, decryptPayload, cryptoProviderReadiness } = require('./encryption-contract');
const { createBackupManifest, verifyBackupManifest } = require('./backup-manifest');
function signingProviderReadiness(provider, context) {
  if (!provider || provider.approvedProfile !== true || typeof provider.algorithmProfile !== 'string' || !provider.algorithmProfile.trim() || typeof provider.sign !== 'function' || typeof provider.verify !== 'function') return { ready: false, reason: 'APPROVED_BACKUP_SIGNING_PROVIDER_REQUIRED' };
  if (provider.testOnly === true && (!context || context.testOnly !== true)) return { ready: false, reason: 'TEST_ONLY_SIGNER_BLOCKED' };
  return { ready: true };
}
function manifestHashMatches(manifest) {
  if (!manifest || typeof manifest !== 'object') return false;
  const base = Object.assign({}, manifest); delete base.manifestHash; delete base.authenticity;
  try { return manifest.manifestHash === sha256Canonical(base); } catch (_) { return false; }
}
async function createEncryptedBackupPackage(input) {
  if (!input || !input.context || input.context.action !== 'backup' || input.backupCapabilityAvailable !== true || !Array.isArray(input.records) || !input.records.length) return { ok: false, status: 'NOT_APPROVED', reason: 'BACKUP_SCOPE_AND_CAPABILITY_REQUIRED' };
  const cryptoReady = cryptoProviderReadiness(input.cryptoProvider, input.context);
  if (!cryptoReady.ready) return { ok: false, status: cryptoReady.status, reason: cryptoReady.reason };
  const signerReady = signingProviderReadiness(input.signingProvider, input.context);
  if (!signerReady.ready) return { ok: false, status: 'NOT_APPROVED', reason: signerReady.reason };
  let plaintext;
  try { plaintext = canonicalize(input.records); } catch (_) { return { ok: false, status: 'VALIDATION_FAILED', reason: 'BACKUP_RECORDS_NOT_CANONICAL' }; }
  const encrypted = await encryptPayload(input.cryptoProvider, plaintext, input.context);
  if (!encrypted.ok) return encrypted;
  const envelope = encrypted.envelope;
  const manifestResult = createBackupManifest(Object.assign({}, input, { encryptionProfile: envelope.algorithm, keyId: envelope.keyId, keyVersion: envelope.keyVersion }));
  if (!manifestResult.ok) return manifestResult;
  let signature;
  try { signature = await input.signingProvider.sign(manifestResult.manifest.manifestHash, input.context); } catch (_) { return { ok: false, status: 'AUTHENTICITY_FAILED', reason: 'BACKUP_MANIFEST_SIGNING_FAILED' }; }
  if (!signature || typeof signature.algorithm !== 'string' || !signature.algorithm.trim() || typeof signature.keyId !== 'string' || !signature.keyId.trim() || typeof signature.proof !== 'string' || !signature.proof.trim()) return { ok: false, status: 'AUTHENTICITY_FAILED', reason: 'BACKUP_SIGNATURE_INVALID' };
  const manifest = Object.assign({}, manifestResult.manifest, { authenticity: { status: 'SIGNED', algorithm: signature.algorithm, keyId: signature.keyId, proof: signature.proof } });
  let proof;
  try { proof = await input.signingProvider.verify(manifest, input.context); } catch (_) { return { ok: false, status: 'AUTHENTICITY_FAILED', reason: 'BACKUP_SIGNATURE_VERIFICATION_FAILED' }; }
  const verified = verifyBackupManifest(manifest, input.records, () => proof);
  if (!verified.valid) return { ok: false, status: verified.status, reason: 'BACKUP_MANIFEST_AUTHENTICITY_NOT_VERIFIED' };
  return { ok: true, status: 'ENCRYPTED_BACKUP_PACKAGE_VERIFIED', manifest, encryptedPayload: envelope, plaintextPayloadReturned: false, persistencePerformed: false, restoreAuthorized: false };
}
async function verifyEncryptedBackupPackage(input) {
  if (!input || !input.package || !input.context || !input.package.manifest || !input.package.encryptedPayload) return { valid: false, status: 'VALIDATION_FAILED', reason: 'BACKUP_PACKAGE_INVALID' };
  const manifest = input.package.manifest, envelope = input.package.encryptedPayload;
  if (!manifestHashMatches(manifest) || manifest.encryptionProfile !== envelope.algorithm || manifest.keyId !== envelope.keyId || manifest.keyVersion !== envelope.keyVersion) return { valid: false, status: 'INTEGRITY_FAILED', reason: 'BACKUP_ENVELOPE_OR_MANIFEST_MISMATCH' };
  const cryptoReady = cryptoProviderReadiness(input.cryptoProvider, input.context);
  if (!cryptoReady.ready) return { valid: false, status: cryptoReady.status, reason: cryptoReady.reason };
  const signerReady = signingProviderReadiness(input.signingProvider, input.context);
  if (!signerReady.ready) return { valid: false, status: 'NOT_APPROVED', reason: signerReady.reason };
  let proof;
  try { proof = await input.signingProvider.verify(manifest, input.context); } catch (_) { return { valid: false, status: 'AUTHENTICITY_FAILED', reason: 'BACKUP_SIGNATURE_VERIFICATION_FAILED' }; }
  if (!proof || proof.verified !== true || proof.trustAnchorVerified !== true || proof.keyNotRevoked !== true || proof.manifestHash !== manifest.manifestHash || proof.algorithm !== manifest.authenticity.algorithm || proof.keyId !== manifest.authenticity.keyId) return { valid: false, status: 'AUTHENTICITY_FAILED', reason: 'BACKUP_SIGNATURE_NOT_TRUSTED' };
  const decrypted = await decryptPayload(input.cryptoProvider, envelope, input.context);
  if (!decrypted.ok) return { valid: false, status: decrypted.status, reason: decrypted.reason };
  let records;
  try { records = JSON.parse(decrypted.plaintext); if (!Array.isArray(records) || canonicalize(records) !== decrypted.plaintext) return { valid: false, status: 'INTEGRITY_FAILED', reason: 'BACKUP_PAYLOAD_CANONICALIZATION_FAILED' }; } catch (_) { return { valid: false, status: 'INTEGRITY_FAILED', reason: 'BACKUP_PAYLOAD_PARSE_FAILED' }; }
  const verification = verifyBackupManifest(manifest, records, () => proof);
  if (!verification.valid) return { valid: false, status: verification.status, reason: 'BACKUP_MANIFEST_VERIFICATION_FAILED' };
  if (input.context.projectId !== manifest.projectId) return { valid: false, status: 'NOT_APPROVED', reason: 'BACKUP_PROJECT_SCOPE_MISMATCH' };
  return { valid: true, status: 'VERIFIED', projectId: manifest.projectId, backupId: manifest.backupId, recordCount: manifest.recordCount, payloadHash: manifest.payloadHash, manifestHash: manifest.manifestHash, plaintextRecordsReturned: false, restoreAuthorized: false };
}
module.exports = { signingProviderReadiness, createEncryptedBackupPackage, verifyEncryptedBackupPackage };
