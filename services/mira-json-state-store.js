'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isSafeRegularFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} is not a safe regular file.`);
  }
  return stat;
}

function readJsonArray(filePath, label, options = {}) {
  try {
    isSafeRegularFile(filePath, label);
  } catch (error) {
    if (error.code === 'ENOENT' && options.missing === 'empty') return [];
    if (error.code === 'ENOENT') throw new Error(`${label} is missing.`);
    throw error;
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`${label} cannot be read: ${error.code || 'IO_ERROR'}`);
  }
  if (!raw.trim()) throw new Error(`${label} is empty and may be corrupted.`);

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
  if (!Array.isArray(value)) throw new Error(`${label} must contain a JSON array.`);
  return value;
}

function atomicWriteJson(filePath, value, label = 'State') {
  const directory = path.dirname(filePath);
  const payload = JSON.stringify(value, null, 2) + '\n';
  const expectedHash = sha256(JSON.stringify(value));
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`
  );
  let fd;

  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      isSafeRegularFile(filePath, label);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    fd = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, filePath);

    try {
      const dirFd = fs.openSync(directory, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error.code)) throw error;
    }

    const readback = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (sha256(JSON.stringify(readback)) !== expectedHash) {
      throw new Error(`${label} integrity readback mismatch.`);
    }
    return { sha256: expectedHash, bytes: Buffer.byteLength(payload) };
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function recordStateAudit(action, status, filePath, details = {}) {
  const { recordAudit } = require('../audit-log');
  return recordAudit({
    actorRole: 'system',
    action,
    resource: 'mira_hybrid_memory_state',
    resourceId: path.basename(filePath),
    status,
    details
  });
}

function writeArrayState(filePath, entries, label = 'State') {
  if (!Array.isArray(entries)) throw new Error(`${label} must be an array.`);

  // Existing state must be readable before replacement; corruption never becomes [].
  let previous = null;
  try {
    previous = readJsonArray(filePath, label);
  } catch (error) {
    if (!/ is missing\.$/.test(error.message)) throw error;
  }

  const expectedStateHash = sha256(JSON.stringify(entries));
  recordStateAudit('memory_state_write_intent', 'pending', filePath, {
    stateHash: expectedStateHash,
    entryCount: entries.length,
    label
  });

  let version = null;
  let versionFile = null;
  if (previous !== null) {
    const versionDir = `${filePath}.versions`;
    fs.mkdirSync(versionDir, { recursive: true, mode: 0o700 });
    const versionName = `${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`;
    versionFile = path.join(versionDir, versionName);
    version = {
      version: 1,
      createdAt: new Date().toISOString(),
      source: path.basename(filePath),
      sha256: sha256(JSON.stringify(previous)),
      entries: previous
    };
    atomicWriteJson(versionFile, version, `${label} version snapshot`);
  }

  const result = atomicWriteJson(filePath, entries, label);
  try {
    recordStateAudit('memory_state_write_committed', 'success', filePath, {
      stateHash: result.sha256,
      entryCount: entries.length,
      versionFile: versionFile ? path.basename(versionFile) : null,
      label
    });
  } catch (error) {
    error.code = 'STATE_COMMITTED_AUDIT_FAILED';
    error.stateCommitted = true;
    throw error;
  }
  return { ...result, versionFile: version ? versionFile : null };
}

function quarantineConflict(directory, name, payload, metadata = {}) {
  const quarantineDir = path.join(directory, 'memory-conflicts');
  fs.mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
  const safeName = String(name || 'conflict').replace(/[^a-z0-9._-]/gi, '_').slice(0, 80);
  const filePath = path.join(
    quarantineDir,
    `${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}-${safeName}.json`
  );
  const envelope = {
    quarantineVersion: 1,
    quarantinedAt: new Date().toISOString(),
    reason: 'SOURCE_CONFLICT_REQUIRES_REVIEW',
    metadata,
    payload
  };
  const result = atomicWriteJson(filePath, envelope, 'Conflict quarantine');
  try {
    recordStateAudit('memory_conflict_quarantined', 'conflict', filePath, {
      conflictFile: path.basename(filePath),
      stateHash: result.sha256,
      metadata
    });
  } catch (error) {
    error.code = 'CONFLICT_QUARANTINED_AUDIT_FAILED';
    error.stateCommitted = true;
    throw error;
  }
  return { file: filePath, sha256: result.sha256 };
}

module.exports = {
  sha256,
  recordStateAudit,
  readJsonArray,
  atomicWriteJson,
  writeArrayState,
  quarantineConflict
};
