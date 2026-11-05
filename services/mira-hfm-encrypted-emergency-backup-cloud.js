'use strict';

const crypto = require('node:crypto');
const {
  decryptAndVerifyBackup,
  previewEncryptedBackup,
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
  let bytes;
  if (Buffer.isBuffer(value)) {
    if (value.length < 1 || value.length > MAX_ENVELOPE_BYTES) {
      fail('Encrypted envelope is missing or exceeds the size limit.');
    }
    bytes = Buffer.from(value);
  } else if (typeof value === 'string') {
    const length = Buffer.byteLength(value, 'utf8');
    if (length < 1 || length > MAX_ENVELOPE_BYTES) {
      fail('Encrypted envelope is missing or exceeds the size limit.');
    }
    bytes = Buffer.from(value, 'utf8');
  } else {
    fail('Encrypted envelope must be a Buffer or UTF-8 string.');
  }
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
  const authenticatedProjectId = verified.metadata.projectId;
  const authenticatedPlaintextSha256 = verified.plaintextSha256;
  verified.payload.fill(0);
  if (authenticatedProjectId !== project) {
    fail('Authenticated backup metadata does not match the requested project.',
      'HFM_CLOUD_BACKUP_PROJECT_MISMATCH');
  }
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
  if (!result || (result.created !== true && !(result.reconciled === true && result.verified === true))) fail('Cloud backup object already exists or create-only status is uncertain.', 'HFM_CLOUD_BACKUP_CONFLICT');
  const readback = await adapter.get({ objectKey: keyPath, projectId: project });
  let stored;
  if (readback && Buffer.isBuffer(readback.bytes)) {
    if (readback.bytes.length < 1 || readback.bytes.length > MAX_ENVELOPE_BYTES) {
      fail('Cloud backup readback is outside the encrypted envelope size limit.',
        'HFM_CLOUD_BACKUP_READBACK_FAILED');
    }
    stored = readback.bytes;
  } else if (readback && typeof readback.bytes === 'string') {
    const readbackLength = Buffer.byteLength(readback.bytes, 'utf8');
    if (readbackLength < 1 || readbackLength > MAX_ENVELOPE_BYTES) {
      fail('Cloud backup readback is outside the encrypted envelope size limit.',
        'HFM_CLOUD_BACKUP_READBACK_FAILED');
    }
    stored = Buffer.from(readback.bytes, 'utf8');
  }
  if (!stored || !stored.equals(bytes) || sha256(stored) !== digest) {
    fail('Cloud backup read-after-write verification failed.', 'HFM_CLOUD_BACKUP_READBACK_FAILED');
  }
  // Re-authenticate the exact bytes read back from cloud storage.
  const checked = decryptAndVerifyBackup(stored, key);
  let readbackIdentityMatches;
  try {
    readbackIdentityMatches = checked.backupId === backupId &&
      checked.plaintextSha256 === authenticatedPlaintextSha256;
  } finally {
    checked.payload.fill(0);
  }
  if (!readbackIdentityMatches) {
    fail('Cloud backup readback identity verification failed.', 'HFM_CLOUD_BACKUP_IDENTITY_FAILED');
  }
  return { projectId: project, backupId, objectKey: keyPath, bytes: stored.length,
    ciphertextSha256: digest, status: 'ENCRYPTED_CLOUD_BACKUP_VERIFIED',
    rootKeyTransmitted: false, plaintextTransmitted: false };
}
async function previewEncryptedEmergencyBackupFromCloud({ adapter, projectId, backupId, key } = {}) {
  validateAdapter(adapter);
  const project = validId(projectId, 'projectId');
  const id = validId(backupId, 'backupId');
  const object = await adapter.get({ objectKey: objectKey(project, id), projectId: project });
  if (!object || object.projectId !== project || object.backupId !== id || !object.bytes) {
    fail('Cloud backup object is missing or its project/identity binding is invalid.', 'HFM_CLOUD_BACKUP_NOT_FOUND');
  }
  const { bytes, parsed } = envelopeBytes(object.bytes);
  if (parsed.backupId !== id) fail('Cloud object and encrypted envelope identities do not match.');
  const preview = previewEncryptedBackup({ envelope: bytes, key });
  if (!preview.metadata || preview.metadata.projectId !== project) {
    fail('Authenticated backup metadata does not match the requested project.',
      'HFM_CLOUD_BACKUP_PROJECT_MISMATCH');
  }
  return Object.freeze({
    ...preview,
    projectId: project,
    source: 'ENCRYPTED_CLOUD_OBJECT',
    restoreApplied: false,
    canonicalMemoryWrites: 0
  });
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
  const authenticatedProjectId = verified.metadata.projectId;
  verified.payload.fill(0);
  if (authenticatedProjectId !== project) {
    fail('Authenticated backup metadata does not match the requested project.',
      'HFM_CLOUD_BACKUP_PROJECT_MISMATCH');
  }
  return restoreToStaging({ envelope: bytes, key, directory: stagingDirectory,
    restoreId: restoreId || ('restore-' + id) });
}
const DEFAULT_BACKUP_BUDGET_BYTES = 5000000000;
const MAX_BACKUP_LIST_ITEMS = 10000;
const MAX_BACKUP_LIST_PAGES = 100;
const BACKUP_LIST_PAGE_SIZE = 500;

function planBackupRetention({ backups, projectId, keepLast, maxAgeDays, now = new Date().toISOString() } = {}) {
  const project = validId(projectId, 'projectId');
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
    if (item.projectId !== project) fail('Retention preview cannot mix project scopes.');
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
      projectId: project, backupId: item.backupId,
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
  const nowMs = Date.parse(now);
  if (typeof now !== 'string' || !Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== now) {
    fail('Capacity measurement time must be a canonical ISO timestamp.', 'HFM_CLOUD_CAPACITY_TIME_INVALID');
  }
  const providerQuota = typeof adapter.getProviderQuota === 'function'
    ? await adapter.getProviderQuota()
    : { status: 'NOT_REPORTED', providerQuotaAvailable: false };
  if (!providerQuota || !['REPORTED', 'NOT_REPORTED'].includes(providerQuota.status)) {
    fail('Provider quota report is invalid; capacity status is INCONCLUSIVE.',
      'HFM_CLOUD_PROVIDER_QUOTA_INVALID');
  }
  if (providerQuota.status === 'NOT_REPORTED') {
    if (providerQuota.providerQuotaAvailable !== false) {
      fail('Unavailable provider quota must be explicitly marked NOT_REPORTED.',
        'HFM_CLOUD_PROVIDER_QUOTA_INVALID');
    }
  } else {
    const quotaTime = typeof providerQuota.measuredAt === 'string' ? Date.parse(providerQuota.measuredAt) : NaN;
    const quotaTimeValid = Number.isFinite(quotaTime) &&
      new Date(quotaTime).toISOString() === providerQuota.measuredAt && quotaTime <= nowMs;
    if (providerQuota.providerQuotaAvailable !== true ||
        typeof providerQuota.providerId !== 'string' ||
        !/^[A-Za-z0-9._-]{2,80}$/.test(providerQuota.providerId) ||
        !['account', 'project'].includes(providerQuota.scope) ||
        (providerQuota.scope === 'project' && providerQuota.projectId !== project) ||
        (providerQuota.scope === 'account' && providerQuota.projectId !== null) ||
        !quotaTimeValid ||
        !Number.isSafeInteger(providerQuota.quotaBytes) || providerQuota.quotaBytes < 1 ||
        !Number.isSafeInteger(providerQuota.usedBytes) || providerQuota.usedBytes < 0 ||
        providerQuota.usedBytes > providerQuota.quotaBytes ||
        providerQuota.availableBytes !== providerQuota.quotaBytes - providerQuota.usedBytes) {
      fail('Provider quota report is malformed, future-dated, or outside the requested scope.',
        'HFM_CLOUD_PROVIDER_QUOTA_INVALID');
    }
  }
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 1 || budgetBytes > 1000000000000) {
    fail('Backup budget must be a bounded positive byte count.');
  }
  const prefix = 'mira-hfm-emergency/v1/' + project + '/';
  const listing = [];
  const cursors = new Set();
  let cursor = null;
  let pageCount = 0;
  while (true) {
    pageCount += 1;
    if (pageCount > MAX_BACKUP_LIST_PAGES) {
      fail('Cloud backup listing exceeded the bounded page limit; capacity is INCONCLUSIVE.',
        'HFM_CLOUD_LIST_INCOMPLETE');
    }
    const page = await adapter.list({
      projectId: project, prefix, cursor, limit: BACKUP_LIST_PAGE_SIZE
    });
    if (!page || typeof page !== 'object' || Array.isArray(page) ||
        !Array.isArray(page.items) || typeof page.complete !== 'boolean') {
      fail('Cloud adapter must return an explicit paginated listing page.',
        'HFM_CLOUD_LIST_INVALID');
    }
    if (listing.length + page.items.length > MAX_BACKUP_LIST_ITEMS) {
      fail('Cloud backup listing exceeds the item limit; capacity is INCONCLUSIVE.',
        'HFM_CLOUD_LIST_INCOMPLETE');
    }
    listing.push(...page.items);
    if (page.complete) {
      if (page.nextCursor !== undefined && page.nextCursor !== null) {
        fail('A completed listing page must not provide a next cursor.', 'HFM_CLOUD_LIST_INVALID');
      }
      break;
    }
    if (typeof page.nextCursor !== 'string' || !page.nextCursor ||
        page.nextCursor === cursor || cursors.has(page.nextCursor)) {
      fail('Cloud backup listing pagination is incomplete or repeated a cursor.',
        'HFM_CLOUD_LIST_INCOMPLETE');
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
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
    const createdMs = Date.parse(item.createdAt);
    if (!Number.isFinite(createdMs) || new Date(createdMs).toISOString() !== item.createdAt ||
        createdMs > nowMs) {
      fail('Cloud backup listing contains a non-canonical or future creation timestamp.',
        'HFM_CLOUD_LIST_TIMESTAMP_INVALID');
    }
    if (seen.has(item.backupId)) fail('Cloud backup listing contains duplicate IDs.', 'HFM_CLOUD_LIST_DUPLICATE');
    seen.add(item.backupId);
    usedBytes += item.bytes;
    if (!Number.isSafeInteger(usedBytes)) fail('Cloud backup usage total overflowed.');
    return { projectId: project, backupId: item.backupId, createdAt: item.createdAt, bytes: item.bytes };
  });
  let retention = { status: 'NOT_REQUESTED', deletionPerformed: false };
  if (retentionPolicy !== undefined) {
    if (!retentionPolicy || typeof retentionPolicy !== 'object' || Array.isArray(retentionPolicy)) {
      fail('retentionPolicy must be an object.');
    }
    retention = planBackupRetention({
      projectId: project,
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
    budgetSource: 'HFM_CONFIGURED_PROJECT_EMERGENCY_BUDGET',
    providerQuota,
    deletionPerformed: false,
    routineDriveSyncChanged: false
  });
}

module.exports = { uploadEncryptedEmergencyBackup, previewEncryptedEmergencyBackupFromCloud, restoreEncryptedEmergencyBackupFromCloud, inspectEncryptedEmergencyBackupCapacity, planBackupRetention, DEFAULT_BACKUP_BUDGET_BYTES, objectKey };
