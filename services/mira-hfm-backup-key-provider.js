'use strict';

const {
  createEncryptedBackup,
  decryptAndVerifyBackup,
  MAX_ENVELOPE_BYTES
} = require('./mira-hfm-encrypted-emergency-backup');

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
const PROVIDER_ERROR_CODES = new Set([
  'KEY_NOT_FOUND',
  'KEY_ACCESS_DENIED',
  'KEY_VERSION_RETIRED',
  'PROVIDER_UNAVAILABLE',
  'INVALID_KEY_MATERIAL'
]);

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validateKeyId(keyId) {
  if (typeof keyId !== 'string' || !ID_RE.test(keyId)) {
    fail('Opaque key version identifier is invalid.', 'HFM_KEY_ID_INVALID');
  }
  return keyId;
}

function normalizeProviderError(error) {
  const code = error && PROVIDER_ERROR_CODES.has(error.code)
    ? error.code
    : 'PROVIDER_UNAVAILABLE';
  const messages = {
    KEY_NOT_FOUND: 'Requested backup key version was not found.',
    KEY_ACCESS_DENIED: 'Access to the requested backup key version was denied.',
    KEY_VERSION_RETIRED: 'Requested backup key version is retired.',
    PROVIDER_UNAVAILABLE: 'Backup key provider is unavailable.',
    INVALID_KEY_MATERIAL: 'Backup key provider returned invalid key material.'
  };
  const normalized = new Error(messages[code]);
  normalized.code = 'HFM_' + code;
  return normalized;
}

async function withBackupKey({ provider, keyId, operation } = {}) {
  validateKeyId(keyId);
  if (!provider || typeof provider !== 'object' ||
      typeof provider.getKey !== 'function' || typeof operation !== 'function') {
    fail('A key provider getKey contract and operation callback are required.',
      'HFM_KEY_PROVIDER_CONTRACT_INVALID');
  }

  let supplied;
  try {
    supplied = await provider.getKey({ keyId });
  } catch (error) {
    throw normalizeProviderError(error);
  }

  if (!supplied || typeof supplied !== 'object' ||
      supplied.keyId !== keyId || !Buffer.isBuffer(supplied.key) ||
      supplied.key.length !== 32) {
    fail('Key provider must return the requested key ID and exactly 32 key bytes.',
      'HFM_INVALID_KEY_MATERIAL');
  }

  // Never mutate provider-owned memory. Only this short-lived copy is zeroed.
  const ephemeralKey = Buffer.from(supplied.key);
  try {
    return await operation(ephemeralKey, keyId);
  } finally {
    ephemeralKey.fill(0);
  }
}

async function createEncryptedBackupWithKeyProvider({
  provider, keyId, payload, backupId, createdAt, metadata = {}
} = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
      (metadata.keyVersionId !== undefined && metadata.keyVersionId !== keyId)) {
    fail('Caller metadata cannot override the selected key version.',
      'HFM_KEY_VERSION_METADATA_CONFLICT');
  }
  return withBackupKey({ provider, keyId, operation: key =>
    createEncryptedBackup({
      payload, key, backupId, createdAt,
      metadata: { ...metadata, keyVersionId: keyId }
    })
  });
}

async function decryptBackupWithKeyProvider({ provider, envelope } = {}) {
  const bytes = Buffer.isBuffer(envelope) ? Buffer.from(envelope) :
    (typeof envelope === 'string' ? Buffer.from(envelope, 'utf8') : null);
  if (!bytes || bytes.length < 1 || bytes.length > MAX_ENVELOPE_BYTES) {
    fail('Encrypted backup envelope is missing or exceeds the size limit.',
      'HFM_BACKUP_INVALID');
  }
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch {
    fail('Encrypted backup envelope is invalid JSON.', 'HFM_BACKUP_INVALID');
  }
  if (!parsed || !parsed.metadata || typeof parsed.metadata !== 'object') {
    fail('Encrypted backup envelope metadata is missing.', 'HFM_BACKUP_INVALID');
  }
  const keyId = validateKeyId(parsed.metadata.keyVersionId);
  return withBackupKey({ provider, keyId, operation: key =>
    decryptAndVerifyBackup(bytes, key)
  });
}

function assertKeyVersionRetirementAllowed({
  referencedBackupCount, migrationVerified = false, recoveryVerified = false
} = {}) {
  if (!Number.isSafeInteger(referencedBackupCount) || referencedBackupCount < 0 ||
      typeof migrationVerified !== 'boolean' || typeof recoveryVerified !== 'boolean') {
    fail('Key retirement evidence is invalid.', 'HFM_KEY_RETIREMENT_EVIDENCE_INVALID');
  }
  if (referencedBackupCount > 0 && !(migrationVerified && recoveryVerified)) {
    fail('Key version is still referenced; verified migration and recovery evidence are required before retirement.',
      'HFM_KEY_VERSION_IN_USE');
  }
  return Object.freeze({
    allowed: true,
    referencedBackupCount,
    migrationVerified,
    recoveryVerified
  });
}

module.exports = {
  withBackupKey,
  createEncryptedBackupWithKeyProvider,
  decryptBackupWithKeyProvider,
  assertKeyVersionRetirementAllowed
};
