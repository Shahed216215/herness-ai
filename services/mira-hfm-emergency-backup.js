'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateKeyProviderContract } = require('./mira-hfm-key-provider-contract');
const { openPinnedDirectory, pinnedChildPath, readPinnedChildFile } = require('./mira-hfm-pinned-directory');

const BACKUP_FORMAT_VERSION = 1;
const ENCRYPTION_PROFILE = 'MIRA_HFM_ENVELOPE_AES_256_GCM_V1';
const ALGORITHM = 'aes-256-gcm';
const MAX_BACKUP_BYTES = 256 * 1024 * 1024;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (!isPlainObject(value)) throw new Error('Payload contains an unsupported value.');
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function validateMetadata(metadata) {
  if (!isPlainObject(metadata)) throw new Error('Backup metadata must be an object.');
  for (const field of ['schemaVersion', 'projectId', 'sourceRevision', 'keyId', 'keyVersion']) {
    if (typeof metadata[field] !== 'string' || !metadata[field].trim() || metadata[field].length > 256) {
      throw new Error('Invalid backup metadata field: ' + field);
    }
  }
  if (!Number.isSafeInteger(metadata.recordCount) || metadata.recordCount < 0) {
    throw new Error('recordCount must be a non-negative safe integer.');
  }
}
function assertKeyProvider(provider, method, metadata) {
  if (!isPlainObject(provider) || typeof provider[method] !== 'function') {
    const error = new Error('An external key provider with ' + method + ' is required.');
    error.code = 'BACKUP_KEY_PROVIDER_UNAVAILABLE';
    throw error;
  }
  validateKeyProviderContract(provider, metadata, method);
}
function makeManifest(snapshot, metadata, nonce, wrappedDataKey) {
  if (!isPlainObject(snapshot) || !Array.isArray(snapshot.records)) throw new Error('Snapshot must contain a records array.');
  validateMetadata(metadata);
  if (metadata.recordCount !== snapshot.records.length) throw new Error('Snapshot record count does not match metadata.');
  const payload = Buffer.from(canonicalize(snapshot), 'utf8');
  const base = {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: metadata.schemaVersion,
    createdAt: new Date().toISOString(),
    projectId: metadata.projectId,
    recordCount: metadata.recordCount,
    payloadHash: sha256(payload),
    sourceRevision: metadata.sourceRevision,
    encryptionProfile: ENCRYPTION_PROFILE,
    keyId: metadata.keyId,
    keyVersion: metadata.keyVersion,
    algorithm: ALGORITHM,
    nonce: nonce.toString('base64'),
    wrappedDataKey
  };
  return { manifest: { ...base, manifestHash: sha256(canonicalize(base)) }, payload };
}
async function encryptSnapshot({ snapshot, metadata, keyProvider }) {
  assertKeyProvider(keyProvider, 'wrapDataKey', metadata);
  validateMetadata(metadata);
  const dataKey = crypto.randomBytes(32);
  try {
    const providerKeyCopy = Buffer.from(dataKey);
    let wrappedDataKey;
    try {
      wrappedDataKey = await keyProvider.wrapDataKey({
        dataKey: providerKeyCopy, keyId: metadata.keyId, keyVersion: metadata.keyVersion
      });
    } finally { providerKeyCopy.fill(0); }
    if (typeof wrappedDataKey !== 'string' || !wrappedDataKey || wrappedDataKey.length > 16384) {
      throw new Error('Key provider returned an invalid wrapped data key.');
    }
    const nonce = crypto.randomBytes(12);
    const { manifest, payload } = makeManifest(snapshot, metadata, nonce, wrappedDataKey);
    const cipher = crypto.createCipheriv(ALGORITHM, dataKey, nonce);
    cipher.setAAD(Buffer.from(canonicalize(manifest), 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    const envelope = {
      envelopeType: 'MIRA_HFM_ENCRYPTED_BACKUP',
      manifest,
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64')
    };
    const bytes = Buffer.from(JSON.stringify(envelope) + '\n', 'utf8');
    if (bytes.length > MAX_BACKUP_BYTES) throw new Error('Encrypted backup exceeds the configured size limit.');
    return { bytes, envelope, sha256: sha256(bytes) };
  } finally {
    dataKey.fill(0);
  }
}
function validateManifest(manifest) {
  const requiredText = ['schemaVersion', 'projectId', 'sourceRevision', 'keyId', 'keyVersion', 'createdAt', 'wrappedDataKey'];
  if (!isPlainObject(manifest) || manifest.backupFormatVersion !== BACKUP_FORMAT_VERSION ||
      manifest.encryptionProfile !== ENCRYPTION_PROFILE || manifest.algorithm !== ALGORITHM ||
      typeof manifest.nonce !== 'string' || Buffer.from(manifest.nonce, 'base64').length !== 12 ||
      typeof manifest.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.payloadHash) ||
      typeof manifest.manifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.manifestHash) ||
      !Number.isSafeInteger(manifest.recordCount) || manifest.recordCount < 0 ||
      requiredText.some(field => typeof manifest[field] !== 'string' || !manifest[field]) ||
      !Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new Error('Backup manifest is malformed or unsupported.');
  }
  const { manifestHash, ...base } = manifest;
  if (sha256(canonicalize(base)) !== manifestHash) {
    const error = new Error('Backup manifest integrity verification failed.');
    error.code = 'BACKUP_MANIFEST_INTEGRITY_FAILED';
    throw error;
  }
}
function parseEnvelope(input) {
  if ((Buffer.isBuffer(input) && input.length > MAX_BACKUP_BYTES) ||
      (typeof input === 'string' && Buffer.byteLength(input) > MAX_BACKUP_BYTES)) {
    throw new Error('Backup envelope exceeds the configured size limit.');
  }
  let envelope;
  try { envelope = Buffer.isBuffer(input) || typeof input === 'string'
    ? JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input) : input; }
  catch { throw new Error('Backup envelope contains invalid JSON.'); }
  if (!isPlainObject(envelope) || envelope.envelopeType !== 'MIRA_HFM_ENCRYPTED_BACKUP' ||
      typeof envelope.ciphertext !== 'string' || typeof envelope.authTag !== 'string' ||
      Buffer.from(envelope.authTag, 'base64').length !== 16 ||
      Buffer.from(envelope.ciphertext, 'base64').length > MAX_BACKUP_BYTES) {
    throw new Error('Encrypted backup envelope is malformed.');
  }
  validateManifest(envelope.manifest);
  return envelope;
}
async function decryptBackup({ backup, keyProvider, expectedProjectId, supportedSchemaVersions = [] }) {
  assertKeyProvider(keyProvider, 'unwrapDataKey', parseEnvelope(backup).manifest);
  const envelope = parseEnvelope(backup);
  const manifest = envelope.manifest;
  if (expectedProjectId && manifest.projectId !== expectedProjectId) {
    const error = new Error('Backup project scope does not match the requested project.');
    error.code = 'BACKUP_PROJECT_SCOPE_MISMATCH';
    throw error;
  }
  if (supportedSchemaVersions.length && !supportedSchemaVersions.includes(manifest.schemaVersion)) {
    const error = new Error('Backup schema version requires a reviewed migration.');
    error.code = 'BACKUP_SCHEMA_UNSUPPORTED';
    throw error;
  }
  let dataKey;
  try {
    dataKey = await keyProvider.unwrapDataKey({
      wrappedDataKey: manifest.wrappedDataKey, keyId: manifest.keyId, keyVersion: manifest.keyVersion
    });
    if (!Buffer.isBuffer(dataKey) || dataKey.length !== 32) throw new Error('Invalid unwrapped data key.');
    const decipher = crypto.createDecipheriv(ALGORITHM, dataKey, Buffer.from(manifest.nonce, 'base64'));
    decipher.setAAD(Buffer.from(canonicalize(manifest), 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()
    ]);
    if (sha256(plaintext) !== manifest.payloadHash) {
      const error = new Error('Decrypted backup payload integrity verification failed.');
      error.code = 'BACKUP_PAYLOAD_INTEGRITY_FAILED';
      throw error;
    }
    let snapshot;
    try { snapshot = JSON.parse(plaintext.toString('utf8')); }
    catch { throw new Error('Decrypted backup payload is not valid JSON.'); }
    if (!isPlainObject(snapshot) || !Array.isArray(snapshot.records) || snapshot.records.length !== manifest.recordCount) {
      const error = new Error('Decrypted backup record count or payload shape is invalid.');
      error.code = 'BACKUP_RECORD_COUNT_MISMATCH';
      throw error;
    }
    return { status: 'VERIFIED', integrity: 'AES_256_GCM_AND_SHA256_VERIFIED', manifest, snapshot };
  } catch (error) {
    if (error && error.code) throw error;
    const failure = new Error('Backup authentication/decryption or key recovery failed.');
    failure.code = 'BACKUP_DECRYPTION_FAILED';
    throw failure;
  } finally {
    if (Buffer.isBuffer(dataKey)) dataKey.fill(0);
  }
}
function writeBackupAtomicAt(pinnedDirectory,fileName,bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>MAX_BACKUP_BYTES) throw new Error('Backup bytes are invalid or exceed the size limit.');
  const target=pinnedChildPath(pinnedDirectory,fileName), temp=pinnedChildPath(pinnedDirectory,'.'+fileName+'.tmp-'+process.pid+'-'+crypto.randomBytes(8).toString('hex'));
  try {
    try { const existing=fs.lstatSync(target); if(existing.isSymbolicLink()||!existing.isFile()) throw new Error('Backup destination is unsafe.'); const e=new Error('Immutable backup already exists; refusing overwrite.'); e.code='BACKUP_ALREADY_EXISTS'; throw e; }
    catch(e){if(e.code!=='ENOENT')throw e;}
    let fd;
    try { fd=fs.openSync(temp,'wx',0o600); fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd=undefined; fs.linkSync(temp,target); fs.unlinkSync(temp); fs.fsyncSync(pinnedDirectory.fd); }
    finally {if(fd!==undefined){try{fs.closeSync(fd);}catch{}}}
    const readback=readPinnedChildFile(pinnedDirectory,fileName,MAX_BACKUP_BYTES);
    if((readback.stat.mode&0o077)!==0||!readback.bytes.equals(bytes)) throw new Error('Pinned backup byte-for-byte or permission verification failed.');
    return {status:'LOCAL_WRITE_VERIFIED',sizeBytes:readback.stat.size,sha256:sha256(readback.bytes),readbackBytes:readback.bytes};
  } catch(e) {try{fs.unlinkSync(temp);}catch{} throw e;}
}
function writeBackupAtomic(filePath,bytes) {
  if(typeof filePath!=='string'||!path.isAbsolute(filePath)) throw new Error('Backup destination must be an absolute path.');
  const directory=path.dirname(filePath); fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const pinned=openPinnedDirectory(directory);
  try{return writeBackupAtomicAt(pinned,path.basename(filePath),bytes);}finally{pinned.close();}
}
function inspectBackupDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Backup inventory path is unsafe.');
  return fs.readdirSync(directory).filter(name => name.endsWith('.mira-hfm.enc.json')).map(name => {
    const filePath = path.join(directory, name);
    const fileStat = fs.lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return { name, status: 'REVIEW_REQUIRED', sizeBytes: fileStat.size || 0 };
    try {
      const raw = fs.readFileSync(filePath);
      const envelope = parseEnvelope(raw);
      return { name, status: 'MANIFEST_VALID_ENCRYPTED_CONTENT_NOT_DECRYPTED', projectId: envelope.manifest.projectId,
        createdAt: envelope.manifest.createdAt, sizeBytes: fileStat.size, sha256: sha256(raw) };
    } catch { return { name, status: 'REVIEW_REQUIRED', sizeBytes: fileStat.size }; }
  });
}
function buildRetentionPlan(items, policy = {}) {
  if (!Array.isArray(items)) throw new Error('Retention inventory must be an array.');
  const maxBackups = Number.isSafeInteger(policy.maxBackups) && policy.maxBackups > 0 ? policy.maxBackups : 30;
  const maxAgeDays = Number.isSafeInteger(policy.maxAgeDays) && policy.maxAgeDays > 0 ? policy.maxAgeDays : 180;
  const maxBytes = Number.isSafeInteger(policy.maxBytes) && policy.maxBytes > 0 ? policy.maxBytes : 5 * 1024 ** 3;
  const eligible = items.filter(item => item && item.status === 'MANIFEST_VALID_ENCRYPTED_CONTENT_NOT_DECRYPTED' &&
    Number.isFinite(Date.parse(item.createdAt)) && Number.isSafeInteger(item.sizeBytes) && item.sizeBytes >= 0);
  const sorted = eligible.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const keep = [], proposedDelete = [];
  let keptBytes = 0;
  const cutoff = Date.now() - maxAgeDays * 86400000;
  for (const item of sorted) {
    if (keep.length < maxBackups && Date.parse(item.createdAt) >= cutoff && keptBytes + item.sizeBytes <= maxBytes) {
      keep.push(item.name); keptBytes += item.sizeBytes;
    } else proposedDelete.push(item.name);
  }
  const reviewRequired = items.filter(item => !eligible.includes(item)).map(item => item.name);
  return { status: 'PLAN_ONLY_NO_DELETION', policy: { maxBackups, maxAgeDays, maxBytes },
    keep, proposedDelete, reviewRequired, keptBytes, deletionExecuted: false };
}
function assessDriveQuota(quota, allocatedLimitBytes = 5 * 1024 ** 3) {
  if (!isPlainObject(quota) || !Number.isSafeInteger(quota.usageBytes) || quota.usageBytes < 0 ||
      !Number.isSafeInteger(allocatedLimitBytes) || allocatedLimitBytes <= 0) throw new Error('Drive quota snapshot is invalid.');
  const providerLimit = Number.isSafeInteger(quota.limitBytes) && quota.limitBytes >= 0 ? quota.limitBytes : null;
  const effectiveLimit = providerLimit === null ? allocatedLimitBytes : Math.min(allocatedLimitBytes, providerLimit);
  return { status: quota.verified === true ? 'QUOTA_SNAPSHOT_VERIFIED' : 'QUOTA_SNAPSHOT_UNVERIFIED',
    usageBytes: quota.usageBytes, allocatedLimitBytes, providerLimitBytes: providerLimit,
    effectiveLimitBytes: effectiveLimit, remainingBytes: Math.max(0, effectiveLimit - quota.usageBytes),
    overLimit: quota.usageBytes > effectiveLimit };
}
module.exports = { BACKUP_FORMAT_VERSION, ENCRYPTION_PROFILE, MAX_BACKUP_BYTES, encryptSnapshot,
  decryptBackup, writeBackupAtomic, writeBackupAtomicAt, inspectBackupDirectory, buildRetentionPlan, assessDriveQuota, parseEnvelope };
