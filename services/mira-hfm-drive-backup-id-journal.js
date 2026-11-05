'use strict';

// Durable, local-only operation journal for a future pre-generated Drive file ID.
// This module performs no OAuth, network, provider, or canonical-memory operation.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCHEMA = 'MIRA_HFM_DRIVE_BACKUP_ID_JOURNAL';
const VERSION = '1.0.0';
const MAX_RECORD_BYTES = 16 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{10,256}$/;
const DIGEST_RE = /^[a-f0-9]{64}$/;

function reject(message, code = 'HFM_DRIVE_JOURNAL_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function validId(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) reject(label + ' is invalid.');
  return value;
}
function validAccountBinding(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 160 ||
      !/^[A-Za-z0-9._:@-]+$/.test(value)) {
    reject('accountBinding must be a bounded non-secret provider account subject identifier.');
  }
  return value;
}
function validFileId(value) {
  if (typeof value !== 'string' || !DRIVE_FILE_ID_RE.test(value)) {
    reject('generatedFileId is invalid.');
  }
  return value;
}
function validSpace(value) {
  if (!['drive', 'appDataFolder'].includes(value)) reject('driveSpace is unsupported.');
  return value;
}
function canonicalTimestamp(value) {
  const date = new Date(value);
  if (typeof value !== 'string' || !Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    reject('createdAt must be a canonical ISO timestamp.');
  }
  return value;
}
function normalizeRecord(input = {}) {
  const bytes = input.bytes;
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 64 * 1024 * 1024) {
    reject('bytes must be a bounded positive safe integer.');
  }
  if (typeof input.ciphertextSha256 !== 'string' || !DIGEST_RE.test(input.ciphertextSha256)) {
    reject('ciphertextSha256 must be a lowercase SHA-256 digest.');
  }
  return {
    schema: SCHEMA,
    version: VERSION,
    operationId: validId(input.operationId, 'operationId'),
    accountBinding: validAccountBinding(input.accountBinding),
    driveSpace: validSpace(input.driveSpace),
    projectId: validId(input.projectId, 'projectId'),
    backupId: validId(input.backupId, 'backupId'),
    generatedFileId: validFileId(input.generatedFileId),
    ciphertextSha256: input.ciphertextSha256,
    bytes,
    createdAt: canonicalTimestamp(input.createdAt || new Date().toISOString())
  };
}
function safeDirectory(directory) {
  const resolved = path.resolve(directory || path.join(os.homedir(), '.mira', 'hfm-drive-id-journal'));
  if (resolved === path.parse(resolved).root) reject('Filesystem root cannot be a journal directory.');
  let current = path.parse(resolved).root;
  const segments = resolved.slice(current.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const final = index === segments.length - 1;
    try { fs.mkdirSync(current, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      reject('Journal directory path must not contain symlinks or non-directory components.');
    }
    if (final && (stat.mode & 0o077) !== 0) {
      reject('Journal directory must be owner-only (0700).', 'HFM_DRIVE_JOURNAL_PERMISSIONS');
    }
  }
  return resolved;
}
function recordPath(directory, operationId) {
  return path.join(directory, 'drive-backup-operation-' + validId(operationId, 'operationId') + '.json');
}
function parseRecord(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > MAX_RECORD_BYTES) {
    reject('Journal record size is invalid.', 'HFM_DRIVE_JOURNAL_CORRUPT');
  }
  let raw;
  try { raw = JSON.parse(bytes.toString('utf8')); }
  catch { reject('Journal record is not valid JSON.', 'HFM_DRIVE_JOURNAL_CORRUPT'); }
  let normalized;
  try { normalized = normalizeRecord(raw); }
  catch { reject('Journal record failed schema validation.', 'HFM_DRIVE_JOURNAL_CORRUPT'); }
  if (JSON.stringify(normalized) + '\n' !== bytes.toString('utf8')) {
    reject('Journal record is not canonical or contains unsupported fields.', 'HFM_DRIVE_JOURNAL_CORRUPT');
  }
  return Object.freeze(normalized);
}
function readBackupIdJournal({ directory, operationId, expected = {} } = {}) {
  const dir = safeDirectory(directory);
  const file = recordPath(dir, operationId);
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') reject('Journal record is missing; provider operation must not proceed.',
      'HFM_DRIVE_JOURNAL_MISSING');
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    reject('Journal record must be a regular owner-only file.', 'HFM_DRIVE_JOURNAL_PERMISSIONS');
  }
  const record = parseRecord(fs.readFileSync(file));
  if (record.operationId !== operationId) reject('Journal operation identity mismatch.', 'HFM_DRIVE_JOURNAL_CORRUPT');
  for (const field of ['accountBinding', 'driveSpace', 'projectId', 'backupId',
    'generatedFileId', 'ciphertextSha256', 'bytes']) {
    if (expected[field] !== undefined && record[field] !== expected[field]) {
      reject('Journal binding mismatch: ' + field + '.', 'HFM_DRIVE_JOURNAL_BINDING_MISMATCH');
    }
  }
  return Object.freeze({ ...record, journalPath: file });
}
function createBackupIdJournal({ directory, ...input } = {}) {
  const record = normalizeRecord(input);
  const dir = safeDirectory(directory);
  const target = recordPath(dir, record.operationId);
  const bytes = Buffer.from(JSON.stringify(record) + '\n', 'utf8');
  let temp;
  let fd;
  try {
    temp = path.join(dir, '.drive-journal-tmp-' + crypto.randomBytes(12).toString('hex'));
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    try {
      fs.linkSync(temp, target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = readBackupIdJournal({ directory: dir, operationId: record.operationId });
      const existingBytes = fs.readFileSync(target);
      if (!existingBytes.equals(bytes)) {
        reject('Operation ID is already bound to a different immutable Drive file ID or backup.',
          'HFM_DRIVE_JOURNAL_CONFLICT');
      }
      fs.unlinkSync(temp); temp = undefined;
      const existingDirFd = fs.openSync(dir, 'r');
      try { fs.fsyncSync(existingDirFd); } finally { fs.closeSync(existingDirFd); }
      return Object.freeze({ created: false, ...existing });
    }
    fs.unlinkSync(temp); temp = undefined;
    const dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    const stored = fs.readFileSync(target);
    if (!stored.equals(bytes)) reject('Journal readback mismatch.', 'HFM_DRIVE_JOURNAL_READBACK_FAILED');
    return Object.freeze({ created: true, ...readBackupIdJournal({
      directory: dir, operationId: record.operationId
    }) });
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    if (temp) { try { fs.unlinkSync(temp); } catch {} }
    throw error;
  }
}
function reconcileBackupIdJournal({ directory, operationId, expected } = {}) {
  const record = readBackupIdJournal({ directory, operationId, expected });
  return Object.freeze({
    status: 'JOURNAL_VERIFIED_PROVIDER_RECONCILIATION_REQUIRED',
    operationId: record.operationId,
    accountBinding: record.accountBinding,
    driveSpace: record.driveSpace,
    projectId: record.projectId,
    backupId: record.backupId,
    generatedFileId: record.generatedFileId,
    ciphertextSha256: record.ciphertextSha256,
    bytes: record.bytes,
    providerRetryAllowedOnlyWithSameFileId: true,
    providerObjectVerified: false,
    uploadConfirmed: false,
    canonicalMemoryWrites: 0
  });
}
module.exports = {
  createBackupIdJournal,
  readBackupIdJournal,
  reconcileBackupIdJournal,
  MAX_RECORD_BYTES
};
