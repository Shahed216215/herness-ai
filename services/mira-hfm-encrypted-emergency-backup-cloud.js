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
const DEFAULT_BACKUP_BUDGET_BYTES = 5000000000;
const MAX_BACKUP_LIST_ITEMS = 10000;

function planBackupRetention({ backups, keepLast, maxAgeDays, now = new Date().toISOString() } = {}) {
  if (!Array.isArray(backups) || backups.length > MAX_BACKUP_LIST_ITEMS ||
      !Number.isInteger(keepLast) || keepLast < 1 || keepLast > MAX_BACKUP_LIST_ITEMS ||
      !Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 3650) {
    fail('Retention preview requires a bounded backup list, keepLast, and maxAgeDays.');
  }
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== now) fail('Retention preview timestamp must be canonical ISO.');
  const seen = new Set();
  const sorted = backups.map(item => {
    if (!item || typeof item !== 'object' || item.projectId == null ||
        typeof item.backupId !== 'string' || typeof item.createdAt !== 'string' ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 1) {
      fail('Retention backup metadata is invalid.');
    }
    validId(item.projectId, 'projectId');
    validId(item.backupId, 'backupId');
    const createdMs = Date.parse(item.createdAt);
    if (!Number.isFinite(createdMs) || new Date(createdMs).toISOString() !== item.createdAt || createdMs > nowMs) {
      fail('Retention backup timestamp is invalid or in the future.');
    }
    if (seen.has(item.backupId)) fail('Retention backup IDs must be unique.');
    seen.add(item.backupId);
    return { projectId: item.projectId, backupId: item.backupId, createdAt: item.createdAt, bytes: item.bytes, createdMs };
  }).sort((a, b) => b.createdMs - a.createdMs || a.backupId.localeCompare(b.backupId));
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const retained = [], candidates = [];
  sorted.forEach((item, index) => {
    const keep = index < keepLast || (nowMs - item.createdMs) <= maxAgeMs;
    (keep ? retained : candidates).push({
      projectId: item.projectId, backupId: item.backupId,
      createdAt: item.createdAt, bytes: item.bytes
    });
  });
  return Object.freeze({
    status: 'RETENTION_PREVIEW_ONLY',
    keepLast, maxAgeDays,
    retained: Object.freeze(retained),
    candidates: Object.freeze(candidates),
    deletionPerformed: false,
    deletionRequiresSeparateApproval: true
  });
}

async function inspectEncryptedEmergencyBackupCapacity({
  adapter, projectId, budgetBytes = DEFAULT_BACKUP_BUDGET_BYTES,
  retentionPolicy, now = new Date().toISOString()
} = {}) {
  if (!adapter || !adapter.capabilities || adapter.capabilities.list !== true ||
      typeof adapter.list !== 'function') {
    fail('Capacity monitoring requires an adapter with verified project-scoped listing capability.',
      'HFM_CLOUD_LIST_CAPABILITY_MISSING');
  }
  const project = validId(projectId, 'projectId');
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 1 || budgetBytes > 1000000000000) {
    fail('Backup budget must be a bounded positive byte count.');
  }
  const prefix = 'mira-hfm-emergency/v1/' + project + '/';
  const listing = await adapter.list({ projectId: project, prefix });
  if (!Array.isArray(listing) || listing.length > MAX_BACKUP_LIST_ITEMS) {
    fail('Cloud backup listing is invalid or exceeds the item limit.', 'HFM_CLOUD_LIST_INVALID');
  }
  const seen = new Set();
  let usedBytes = 0;
  const backups = listing.map(item => {
    if (!item || item.projectId !== project ||
        typeof item.backupId !== 'string' ||
        item.objectKey !== objectKey(project, item.backupId) ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 1 ||
        typeof item.createdAt !== 'string') {
      fail('Cloud backup listing contains an invalid or cross-project item.', 'HFM_CLOUD_LIST_SCOPE_INVALID');
    }
    if (seen.has(item.backupId)) fail('Cloud backup listing contains duplicate IDs.', 'HFM_CLOUD_LIST_DUPLICATE');
    seen.add(item.backupId);
    usedBytes += item.bytes;
    if (!Number.isSafeInteger(usedBytes)) fail('Cloud backup usage total overflowed.');
    return { projectId: project, backupId: item.backupId, createdAt: item.createdAt, bytes: item.bytes };
  });
  let retention = { status: 'NOT_REQUESTED', deletionPerformed: false };
  if (retentionPolicy !== undefined) {
    retention = planBackupRetention({
      backups, keepLast: retentionPolicy.keepLast,
      maxAgeDays: retentionPolicy.maxAgeDays, now
    });
  }
  const utilizationPercent = Math.round((usedBytes / budgetBytes) * 10000) / 100;
  return Object.freeze({
    status: usedBytes > budgetBytes ? 'OVER_BUDGET' :
      usedBytes >= budgetBytes * 0.9 ? 'NEAR_BUDGET_LIMIT' : 'WITHIN_BUDGET',
    projectId: project, backupCount: backups.length,
    budgetBytes, usedBytes, availableBytes: Math.max(0, budgetBytes - usedBytes),
    utilizationPercent, retention,
    deletionPerformed: false,
    routineDriveSyncChanged: false
  });
}

module.exports = { uploadEncryptedEmergencyBackup, restoreEncryptedEmergencyBackupFromCloud, inspectEncryptedEmergencyBackupCapacity, planBackupRetention, DEFAULT_BACKUP_BUDGET_BYTES, objectKey };
