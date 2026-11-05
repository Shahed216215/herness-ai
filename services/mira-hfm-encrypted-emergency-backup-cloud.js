'use strict';

const crypto = require('node:crypto');
const {
  decryptAndVerifyBackup,
  restoreToStaging,
  MAX_ENVELOPE_BYTES
} = require('./mira-hfm-encrypted-emergency-backup');

const REQUIRED = ['encryptedOnly', 'projectIsolated', 'createOnly', 'readAfterWrite'];
function fail(message, code = 'HFM_CLOUD_BACKUP_REJECTED') {
  const error = new Error(message); error.code = code; throw error;
}
function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function validId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/.test(value)) fail(label + ' is invalid.');
  return value;
}
function envelopeBytes(value) {
  const bytes = Buffer.isBuffer(value) ? Buffer.from(value) : (typeof value === 'string' ? Buffer.from(value, 'utf8') : null);
  if (!bytes || bytes.length < 1 || bytes.length > MAX_ENVELOPE_BYTES) fail('Encrypted envelope is missing or exceeds the size limit.');
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { fail('Encrypted envelope is not valid JSON.'); }
  if (!parsed || parsed.schema !== 'MIRA_HFM_ENCRYPTED_EMERGENCY_BACKUP' ||
      parsed.version !== '1.0.0' || parsed.algorithm !== 'aes-256-gcm' ||
      typeof parsed.ciphertext !== 'string' || typeof parsed.tag !== 'string' ||
      typeof parsed.salt !== 'string' || typeof parsed.iv !== 'string') {
    fail('Cloud transport accepts encrypted HFM emergency backup envelopes only.');
  }
  return { bytes, parsed };
}
function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object' || !adapter.capabilities ||
      REQUIRED.some(name => adapter.capabilities[name] !== true) ||
      typeof adapter.putIfAbsent !== 'function' || typeof adapter.get !== 'function') {
    fail('Cloud adapter must guarantee encrypted-only, project-isolated, create-only storage and read-after-write verification.',
      'HFM_CLOUD_ADAPTER_CAPABILITY_MISSING');
  }
}
function objectKey(projectId, backupId) {
  validId(projectId, 'projectId'); validId(backupId, 'backupId');
  return 'mira-hfm-emergency/v1/' + projectId + '/' + backupId + '.mhe';
}
async function uploadEncryptedEmergencyBackup({ adapter, projectId, envelope, key, expectedBackupId } = {}) {
  validateAdapter(adapter);
  const project = validId(projectId, 'projectId');
  const { bytes, parsed } = envelopeBytes(envelope);
  const backupId = validId(parsed.backupId, 'backupId');
  if (expectedBackupId !== undefined && backupId !== expectedBackupId) fail('Backup ID mismatch.');
  // Authenticate before sending. The root key is used locally and is never passed to the adapter.
  const verified = decryptAndVerifyBackup(bytes, key);
  const digest = sha256(bytes);
  const keyPath = objectKey(project, backupId);
  const result = await adapter.putIfAbsent({
    objectKey: keyPath,
    projectId: project,
    backupId,
    bytes: Buffer.from(bytes),
    contentType: 'application/vnd.mira.hfm-encrypted-backup',
    ciphertextSha256: digest,
    encryption: 'AES-256-GCM'
  });
  if (!result || result.created !== true) fail('Cloud backup object already exists or create-only status is uncertain.', 'HFM_CLOUD_BACKUP_CONFLICT');
  const readback = await adapter.get({ objectKey: keyPath, projectId: project });
  const stored = readback && (Buffer.isBuffer(readback.bytes) ? readback.bytes : Buffer.from(readback.bytes || ''));
  if (!stored || !stored.equals(bytes) || sha256(stored) !== digest) {
    fail('Cloud backup read-after-write verification failed.', 'HFM_CLOUD_BACKUP_READBACK_FAILED');
  }
  // Re-authenticate the exact bytes read back from cloud storage.
  const checked = decryptAndVerifyBackup(stored, key);
  if (checked.backupId !== backupId || checked.plaintextSha256 !== verified.plaintextSha256) {
    fail('Cloud backup readback identity verification failed.', 'HFM_CLOUD_BACKUP_IDENTITY_FAILED');
  }
  return { projectId: project, backupId, objectKey: keyPath, bytes: stored.length,
    ciphertextSha256: digest, status: 'ENCRYPTED_CLOUD_BACKUP_VERIFIED',
    rootKeyTransmitted: false, plaintextTransmitted: false };
}
async function restoreEncryptedEmergencyBackupFromCloud({ adapter, projectId, backupId, key, stagingDirectory, restoreId } = {}) {
  validateAdapter(adapter);
  const project = validId(projectId, 'projectId');
  const id = validId(backupId, 'backupId');
  const object = await adapter.get({ objectKey: objectKey(project, id), projectId: project });
  if (!object || object.projectId !== project || object.backupId !== id || !object.bytes) {
    fail('Cloud backup object is missing or its project/identity binding is invalid.', 'HFM_CLOUD_BACKUP_NOT_FOUND');
  }
  const { bytes, parsed } = envelopeBytes(object.bytes);
  if (parsed.backupId !== id) fail('Cloud object and encrypted envelope identities do not match.');
  const verified = decryptAndVerifyBackup(bytes, key);
  return restoreToStaging({ envelope: bytes, key, directory: stagingDirectory,
    restoreId: restoreId || ('restore-' + id) });
}
module.exports = { uploadEncryptedEmergencyBackup, restoreEncryptedEmergencyBackupFromCloud, objectKey };
