'use strict';

const fs = require('node:fs');
const path = require('node:path');
const storagePath = require('../mira-storage');
const jsonStateStore = require('./mira-json-state-store');
const localMemoryStore = require('./mira-local-memory-store');

function resolveTarget(target) {
  if (target === 'memory') return localMemoryStore.MEMORY_FILE;
  if (target === 'knowledge') return storagePath('knowledge.json');
  throw new Error('Target must be memory or knowledge.');
}

function versionDirectory(filePath) {
  return filePath + '.versions';
}

function verifyVersionFile(filePath, versionFile) {
  if (typeof versionFile !== 'string' || path.basename(versionFile) !== versionFile ||
      !/^[a-zA-Z0-9._-]+\.json$/.test(versionFile)) {
    throw new Error('A safe version filename is required.');
  }
  const directory = versionDirectory(filePath);
  const directoryStat = fs.lstatSync(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error('Version snapshot directory is not a safe directory.');
  }
  const fullPath = path.join(directory, versionFile);
  const stat = fs.lstatSync(fullPath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Version snapshot is not a safe regular file.');

  let snapshot;
  try { snapshot = JSON.parse(fs.readFileSync(fullPath, 'utf8')); }
  catch { throw new Error('Version snapshot contains invalid JSON.'); }

  if (!snapshot || snapshot.version !== 1 || snapshot.source !== path.basename(filePath) ||
      !Array.isArray(snapshot.entries) || typeof snapshot.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(snapshot.sha256) ||
      snapshot.sha256 !== jsonStateStore.sha256(JSON.stringify(snapshot.entries))) {
    throw new Error('Version snapshot metadata or SHA-256 integrity is invalid.');
  }
  return {
    file: versionFile,
    createdAt: snapshot.createdAt || null,
    entryCount: snapshot.entries.length,
    sha256: snapshot.sha256,
    entries: snapshot.entries
  };
}

function listVersions(target) {
  const filePath = resolveTarget(target);
  const directory = versionDirectory(filePath);
  let names;
  try { names = fs.readdirSync(directory); }
  catch (error) {
    if (error.code === 'ENOENT') return { target, versions: [], retentionPolicy: 'PRESERVE_ALL_NO_AUTOMATIC_DELETION' };
    throw error;
  }

  const versions = [];
  const invalid = [];
  for (const name of names.sort().reverse()) {
    if (!/^[a-zA-Z0-9._-]+\.json$/.test(name)) continue;
    try {
      const item = verifyVersionFile(filePath, name);
      versions.push({
        file: item.file,
        createdAt: item.createdAt,
        entryCount: item.entryCount,
        sha256: item.sha256,
        status: 'VERIFIED'
      });
    } catch (error) {
      invalid.push({ file: name, status: 'INTEGRITY_FAILED', reason: error.message });
    }
  }
  return {
    target,
    versions,
    invalid,
    retentionPolicy: 'PRESERVE_ALL_NO_AUTOMATIC_DELETION'
  };
}

function restoreVersion(options = {}) {
  const { target, versionFile, confirm } = options;
  if (confirm !== true) return { success: false, restored: false, dataModified: false, message: 'Explicit confirmation is required.' };

  const filePath = resolveTarget(target);
  const snapshot = verifyVersionFile(filePath, versionFile);

  // Never use a historical snapshot to overwrite an unreadable current state.
  // The dedicated backup-restore path must first preserve and validate corruption.
  const current = jsonStateStore.readJsonArray(filePath, path.basename(filePath), { missing: 'empty' });
  const currentHash = jsonStateStore.sha256(JSON.stringify(current));

  jsonStateStore.recordStateAudit('memory_version_restore_intent', 'pending', filePath, {
    target,
    versionFile,
    snapshotHash: snapshot.sha256,
    currentHash,
    entryCount: snapshot.entryCount
  });

  const result = jsonStateStore.writeArrayState(filePath, snapshot.entries, path.basename(filePath));
  try {
    jsonStateStore.recordStateAudit('memory_version_restore_committed', 'success', filePath, {
      target,
      versionFile,
      stateHash: result.sha256,
      entryCount: snapshot.entryCount
    });
  } catch (error) {
    error.code = 'VERSION_RESTORE_COMMITTED_AUDIT_FAILED';
    error.stateCommitted = true;
    throw error;
  }

  const readback = jsonStateStore.readJsonArray(filePath, path.basename(filePath));
  if (jsonStateStore.sha256(JSON.stringify(readback)) !== snapshot.sha256) {
    const error = new Error('Version restore readback hash mismatch.');
    error.code = 'VERSION_RESTORE_READBACK_FAILED';
    error.stateCommitted = true;
    throw error;
  }
  return {
    success: true,
    restored: true,
    target,
    versionFile,
    entryCount: readback.length,
    sha256: snapshot.sha256,
    previousStateSnapshotted: Boolean(result.versionFile)
  };
}

function verifyVersion(target, versionFile) {
  const item = verifyVersionFile(resolveTarget(target), versionFile);
  return {
    target,
    file: item.file,
    createdAt: item.createdAt,
    entryCount: item.entryCount,
    sha256: item.sha256,
    status: 'VERIFIED'
  };
}

module.exports = { resolveTarget, listVersions, verifyVersion, restoreVersion };
