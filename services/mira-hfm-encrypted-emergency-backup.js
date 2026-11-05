'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCHEMA = 'MIRA_HFM_ENCRYPTED_EMERGENCY_BACKUP';
const VERSION = '1.0.0';
const ALGORITHM = 'aes-256-gcm';
const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 36 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
const ENVELOPE_KEYS = ['schema','version','algorithm','backupId','createdAt','payloadBytes',
  'plaintextSha256','metadata','kdf','salt','iv','tag','ciphertext','ciphertextSha256'].sort();

function fail(message, code = 'HFM_BACKUP_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function validateId(value, label = 'backupId') {
  if (typeof value !== 'string' || !ID_RE.test(value)) fail(label + ' must be a bounded safe identifier.');
  return value;
}
function validateKey(value) {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    fail('A 32-byte encryption key must be supplied by an external key provider.', 'HFM_BACKUP_KEY_REQUIRED');
  }
  return value;
}
function safeMetadata(value = {}) {
  if (!isObject(value)) fail('metadata must be an object.');
  const allowed = ['projectId', 'source', 'memorySnapshotId', 'keyVersionId'];
  const result = {};
  for (const key of allowed) {
    if (value[key] === undefined || value[key] === null) continue;
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 128 ||
        /[\r\n\u0000-\u001f]/.test(value[key])) fail('metadata.' + key + ' is invalid.');
    result[key] = value[key].trim();
  }
  return result;
}
function aadFor(header) {
  return Buffer.from(JSON.stringify({
    schema: header.schema,
    version: header.version,
    algorithm: header.algorithm,
    backupId: header.backupId,
    createdAt: header.createdAt,
    payloadBytes: header.payloadBytes,
    plaintextSha256: header.plaintextSha256,
    metadata: header.metadata
  }), 'utf8');
}
function deriveKey(rootKey, salt) {
  return Buffer.from(crypto.hkdfSync('sha256', validateKey(rootKey), salt,
    Buffer.from('MIRA-HFM-v0.2-EMERGENCY-BACKUP-v1', 'utf8'), 32));
}
function createEncryptedBackup({ payload, key, backupId, createdAt = new Date().toISOString(), metadata = {} } = {}) {
  validateId(backupId);
  validateKey(key);
  let plain;
  if (Buffer.isBuffer(payload)) {
    if (payload.length < 1 || payload.length > MAX_PAYLOAD_BYTES) {
      fail('payload must be non-empty bytes/string within the size limit.');
    }
    plain = Buffer.from(payload);
  } else if (typeof payload === 'string') {
    const payloadBytes = Buffer.byteLength(payload, 'utf8');
    if (payloadBytes < 1 || payloadBytes > MAX_PAYLOAD_BYTES) {
      fail('payload must be non-empty bytes/string within the size limit.');
    }
    plain = Buffer.from(payload, 'utf8');
  } else {
    fail('payload must be non-empty bytes/string within the size limit.');
  }
  const timestamp = new Date(createdAt);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== createdAt) fail('createdAt must be a canonical ISO timestamp.');
  const header = {
    schema: SCHEMA, version: VERSION, algorithm: ALGORITHM, backupId,
    createdAt, payloadBytes: plain.length, plaintextSha256: sha256(plain),
    metadata: safeMetadata(metadata)
  };
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const derivedKey = deriveKey(key, salt);
  let ciphertext;
  let authenticationTag;
  try {
    const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);
    cipher.setAAD(aadFor(header));
    ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    authenticationTag = cipher.getAuthTag();
  } finally {
    derivedKey.fill(0);
    plain.fill(0);
  }
  const envelope = {
    ...header,
    kdf: 'HKDF-SHA256',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: authenticationTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    ciphertextSha256: sha256(ciphertext)
  };
  return Buffer.from(JSON.stringify(envelope) + '\n', 'utf8');
}
function decodeBase64(value, length, label) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail(label + ' is invalid base64.');
  const out = Buffer.from(value, 'base64');
  if (out.length !== length || out.toString('base64') !== value) fail(label + ' has an invalid length/encoding.');
  return out;
}
function decryptAndVerifyBackup(envelopeBytes, key) {
  validateKey(key);
  let bytes;
  if (Buffer.isBuffer(envelopeBytes)) {
    if (envelopeBytes.length < 1 || envelopeBytes.length > MAX_ENVELOPE_BYTES) {
      fail('Backup envelope exceeds the size limit.');
    }
    bytes = envelopeBytes;
  } else if (typeof envelopeBytes === 'string') {
    const envelopeLength = Buffer.byteLength(envelopeBytes, 'utf8');
    if (envelopeLength < 1 || envelopeLength > MAX_ENVELOPE_BYTES) {
      fail('Backup envelope exceeds the size limit.');
    }
    bytes = Buffer.from(envelopeBytes, 'utf8');
  } else {
    fail('Backup envelope must be a Buffer or UTF-8 string.');
  }
  let env;
  const serialized = bytes.toString('utf8');
  try { env = JSON.parse(serialized); } catch { fail('Backup envelope is not valid JSON.'); }
  if (!isObject(env) || Object.keys(env).sort().length !== ENVELOPE_KEYS.length ||
      Object.keys(env).sort().some((key, index) => key !== ENVELOPE_KEYS[index]) ||
      JSON.stringify(env) + '\n' !== serialized) {
    fail('Backup envelope contains unknown fields or is not canonical JSON.');
  }
  if (env.schema !== SCHEMA || env.version !== VERSION || env.algorithm !== ALGORITHM ||
      env.kdf !== 'HKDF-SHA256' || !ID_RE.test(env.backupId || '') || !Number.isInteger(env.payloadBytes) ||
      env.payloadBytes < 1 || env.payloadBytes > MAX_PAYLOAD_BYTES || !/^[a-f0-9]{64}$/.test(env.plaintextSha256 || '') ||
      !/^[a-f0-9]{64}$/.test(env.ciphertextSha256 || '') || !isObject(env.metadata)) fail('Backup envelope schema is invalid.');
  const created = new Date(env.createdAt);
  if (!Number.isFinite(created.getTime()) || created.toISOString() !== env.createdAt) fail('Backup timestamp is invalid.');
  const metadata = safeMetadata(env.metadata);
  if (JSON.stringify(metadata) !== JSON.stringify(env.metadata)) fail('Backup metadata is not canonical.');
  const salt = decodeBase64(env.salt, 16, 'salt');
  const iv = decodeBase64(env.iv, 12, 'iv');
  const tag = decodeBase64(env.tag, 16, 'tag');
  if (typeof env.ciphertext !== 'string' || env.ciphertext.length > Math.ceil(MAX_PAYLOAD_BYTES * 4 / 3) + 8) fail('Ciphertext exceeds the size limit.');
  const ciphertext = Buffer.from(env.ciphertext, 'base64');
  if (ciphertext.toString('base64') !== env.ciphertext || ciphertext.length !== env.payloadBytes ||
      sha256(ciphertext) !== env.ciphertextSha256) fail('Ciphertext integrity check failed.');
  const header = {
    schema: env.schema, version: env.version, algorithm: env.algorithm, backupId: env.backupId,
    createdAt: env.createdAt, payloadBytes: env.payloadBytes,
    plaintextSha256: env.plaintextSha256, metadata
  };
  let plain;
  const derivedKey = deriveKey(key, salt);
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAAD(aadFor(header));
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    fail('Backup authentication failed; key or backup data is incorrect.', 'HFM_BACKUP_AUTH_FAILED');
  } finally {
    derivedKey.fill(0);
  }
  if (plain.length !== env.payloadBytes || sha256(plain) !== env.plaintextSha256) {
    plain.fill(0);
    fail('Decrypted payload integrity check failed.');
  }
  return { backupId: env.backupId, createdAt: env.createdAt, metadata, payload: plain, plaintextSha256: env.plaintextSha256 };
}
function safeDirectory(directory) {
  const resolved = path.resolve(directory || path.join(os.homedir(), '.mira', 'hfm-emergency-backups'));
  if (resolved === path.parse(resolved).root) fail('Filesystem root cannot be a backup directory.');
  let current = path.parse(resolved).root;
  const segments = resolved.slice(current.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const isFinal = index === segments.length - 1;
    try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('Backup directory path must not contain symlinks or non-directory components.');
    // Parent directories such as /tmp and /home need not be private; only the
    // directory that directly contains backup artifacts must be owner-only.
    if (isFinal && (stat.mode & 0o077) !== 0) fail('Backup directory must be owner-only (0700).');
  }
  return resolved;
}
function writeImmutableBackup({ envelope, key, directory, backupId } = {}) {
  validateId(backupId);
  let bytes;
  if (Buffer.isBuffer(envelope)) {
    if (envelope.length < 1 || envelope.length > MAX_ENVELOPE_BYTES) {
      fail('Backup envelope exceeds the size limit.');
    }
    bytes = envelope;
  } else if (typeof envelope === 'string') {
    const envelopeLength = Buffer.byteLength(envelope, 'utf8');
    if (envelopeLength < 1 || envelopeLength > MAX_ENVELOPE_BYTES) {
      fail('Backup envelope exceeds the size limit.');
    }
    bytes = Buffer.from(envelope, 'utf8');
  } else {
    fail('Backup envelope must be a Buffer or UTF-8 string.');
  }
  const verified = decryptAndVerifyBackup(bytes, key);
  const authenticatedBackupId = verified.backupId;
  verified.payload.fill(0);
  if (authenticatedBackupId !== backupId) fail('Backup ID does not match the authenticated envelope.');
  const dir = safeDirectory(directory);
  const target = path.join(dir, 'mira-hfm-emergency-' + backupId + '.mhe');
  const temp = path.join(dir, '.mira-hfm-tmp-' + crypto.randomBytes(12).toString('hex'));
  let fd;
  let linked = false;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.linkSync(temp, target); linked = true;
    fs.unlinkSync(temp);
    const dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    const stored = fs.readFileSync(target);
    if (!stored.equals(bytes)) fail('Backup read-after-write verification failed.', 'HFM_BACKUP_READBACK_FAILED');
    return { path: target, bytes: stored.length, sha256: sha256(stored), immutableCreateOnly: true };
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { fs.unlinkSync(temp); } catch {}
    if (linked) { error.stateCommitted = true; }
    throw error;
  }
}
function previewEncryptedBackup({ envelope, key } = {}) {
  const verified = decryptAndVerifyBackup(envelope, key);
  try {
    return Object.freeze({
      status: 'VERIFIED_RESTORE_PREVIEW',
      backupId: verified.backupId,
      createdAt: verified.createdAt,
      metadata: Object.freeze({ ...verified.metadata }),
      payloadBytes: verified.payload.length,
      plaintextSha256: verified.plaintextSha256,
      integrityVerified: true,
      restoreApplied: false,
      canonicalMemoryWrites: 0,
      productionRestore: false
    });
  } finally {
    verified.payload.fill(0);
  }
}
function restoreToStaging({ envelope, key, directory, restoreId } = {}) {
  validateId(restoreId, 'restoreId');
  const verified = decryptAndVerifyBackup(envelope, key);
  try {
    const dir = safeDirectory(directory || path.join(os.homedir(), '.mira', 'hfm-restore-staging'));
    const target = path.join(dir, 'restore-' + restoreId + '.verified-stage');
    const temp = path.join(dir, '.mira-restore-tmp-' + crypto.randomBytes(12).toString('hex'));
    let fd;
    let linked = false;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, verified.payload);
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.linkSync(temp, target); linked = true;
      fs.unlinkSync(temp);
      const dirFd = fs.openSync(dir, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
      const staged = fs.readFileSync(target);
      const stagedBytes = staged.length;
      let stagedReadbackValid;
      try {
        stagedReadbackValid = staged.equals(verified.payload) &&
          sha256(staged) === verified.plaintextSha256;
      } finally {
        staged.fill(0);
      }
      if (!stagedReadbackValid) {
        fail('Restore staging readback failed.', 'HFM_RESTORE_READBACK_FAILED');
      }
      return { restoreId, path: target, bytes: stagedBytes, sha256: verified.plaintextSha256,
        status: 'VERIFIED_STAGING_ONLY', canonicalMemoryWrites: 0, productionRestore: false };
    } catch (error) {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
      try { fs.unlinkSync(temp); } catch {}
      if (linked) error.stateCommitted = true;
      throw error;
    }
  } finally {
    verified.payload.fill(0);
  }
}
module.exports = { createEncryptedBackup, decryptAndVerifyBackup, previewEncryptedBackup, writeImmutableBackup, restoreToStaging,
  MAX_PAYLOAD_BYTES, MAX_ENVELOPE_BYTES };
