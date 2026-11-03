'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const storagePath = require('../mira-storage');
const jsonStateStore = require('./mira-json-state-store');

const MEMORY_FILE = process.env.MIRA_MEMORY_FILE
  ? path.resolve(process.env.MIRA_MEMORY_FILE)
  : storagePath('memory.json');

const MEMORY_DIR = path.dirname(MEMORY_FILE);
const BACKUP_FILE = path.join(MEMORY_DIR, 'memory-backup.json');
const SAFETY_BACKUP_FILE = path.join(
  MEMORY_DIR,
  'memory-before-restore.json'
);
const SAFETY_QUARANTINE_FILE = path.join(
  MEMORY_DIR,
  'memory-corrupt-before-restore.json'
);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function entriesHash(entries) {
  return sha256(JSON.stringify(entries));
}

function readArray(filePath, label, missingIsEmpty = false) {
  let stat;

  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT' && missingIsEmpty) return [];
    if (error.code === 'ENOENT') {
      throw new Error(`${label} is missing.`);
    }
    throw new Error(`${label} cannot be inspected: ${error.code || 'IO_ERROR'}`);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} is not a safe regular file.`);
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`${label} cannot be read: ${error.code || 'IO_ERROR'}`);
  }

  if (!raw.trim()) {
    throw new Error(`${label} is empty and may be corrupted.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON array.`);
  }

  return parsed;
}

function atomicWriteJson(filePath, value, label = 'Memory') {
  const directory = path.dirname(filePath);
  const payload = JSON.stringify(value, null, 2);
  const expectedHash = sha256(JSON.stringify(value));
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`
  );

  let fd;

  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

    try {
      const existing = fs.lstatSync(filePath);
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new Error(`${label} target is not a safe regular file.`);
      }
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
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error.code)) {
        throw error;
      }
    }

    const readbackRaw = fs.readFileSync(filePath, 'utf8');
    let readback;

    try {
      readback = JSON.parse(readbackRaw);
    } catch {
      throw new Error(`${label} readback contains invalid JSON.`);
    }

    if (sha256(JSON.stringify(readback)) !== expectedHash) {
      throw new Error(`${label} integrity readback mismatch.`);
    }

    return {
      sha256: expectedHash,
      entries: Array.isArray(readback) ? readback.length : null
    };
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function readMemory() {
  try {
    return readArray(MEMORY_FILE, 'Mira Memory', false);
  } catch (error) {
    if (!/Mira Memory is missing\.$/.test(error.message)) throw error;

    // If the primary file disappeared but a verified backup exists, expose
    // that data read-only. Never turn this condition into an empty write.
    try {
      fs.lstatSync(BACKUP_FILE);
      return readBackupFile().entries;
    } catch (backupError) {
      if (backupError.code === 'ENOENT' || /Memory backup not found/.test(backupError.message)) {
        return [];
      }
      throw new Error(`Mira Memory primary is missing and backup recovery failed: ${backupError.message}`);
    }
  }
}

function writeMemory(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('Memory must be an array.');
  }
  const result = jsonStateStore.writeArrayState(MEMORY_FILE, entries, 'Mira Memory');
  return {
    ...result,
    entries: entries.length
  };
}

function makeBackup(entries, source) {
  if (!Array.isArray(entries)) {
    throw new Error('Backup source must be an array.');
  }

  return {
    backupVersion: 2,
    createdAt: new Date().toISOString(),
    source,
    entryCount: entries.length,
    sha256: entriesHash(entries),
    entries
  };
}

function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    throw new Error('Invalid Memory backup format.');
  }

  if (![1, 2].includes(backup.backupVersion)) {
    throw new Error('Unsupported Memory backup version.');
  }

  if (!Array.isArray(backup.entries)) {
    throw new Error('Backup entries are not a valid array.');
  }

  if (backup.entryCount !== backup.entries.length) {
    throw new Error('Backup entry count does not match.');
  }

  if (
    backup.backupVersion === 2 &&
    (
      typeof backup.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(backup.sha256) ||
      backup.sha256 !== entriesHash(backup.entries)
    )
  ) {
    throw new Error('Backup SHA-256 integrity verification failed.');
  }

  return {
    entries: backup.entries,
    integrity: backup.backupVersion === 2
      ? 'SHA256_VERIFIED'
      : 'LEGACY_UNCHECKSUMMED'
  };
}

function readBackupFile() {
  let backup;

  try {
    const stat = fs.lstatSync(BACKUP_FILE);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('Memory backup is not a safe regular file.');
    }
    backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Memory backup not found.');
    }
    if (error instanceof SyntaxError) {
      throw new Error('Memory backup contains invalid JSON.');
    }
    throw error;
  }

  return validateBackup(backup);
}

function createBackup() {
  const entries = readMemory();
  const backup = makeBackup(entries, 'Mira local Memory backup');
  const result = atomicWriteJson(BACKUP_FILE, backup, 'Memory backup');

  return {
    success: true,
    backupVersion: 2,
    entryCount: entries.length,
    sha256: result.sha256,
    file: path.basename(BACKUP_FILE)
  };
}

function restoreMemory() {
  const backup = readBackupFile();
  let safetyBackupPath = SAFETY_BACKUP_FILE;

  // Preserve the current primary before restore. Valid state gets a verified
  // structured backup; corrupt bytes are preserved separately and verbatim.
  try {
    const currentEntries = readMemory();
    const safetyBackup = makeBackup(
      currentEntries,
      'Automatic safety backup before Memory restore'
    );
    atomicWriteJson(
      SAFETY_BACKUP_FILE,
      safetyBackup,
      'Memory safety backup'
    );
  } catch (error) {
    let stat;
    try {
      stat = fs.lstatSync(MEMORY_FILE);
    } catch (statError) {
      throw new Error(
        `Cannot establish a safe pre-restore state: ${statError.message}`
      );
    }

    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('Cannot restore over an unsafe Memory primary file.');
    }

    const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
    const quarantine = {
      quarantineVersion: 1,
      createdAt: new Date().toISOString(),
      source: path.basename(MEMORY_FILE),
      reason: 'CORRUPT_PRIMARY_PRESERVED_BEFORE_EXPLICIT_RESTORE',
      sha256: sha256(raw),
      rawContent: raw,
      readError: error.message
    };
    atomicWriteJson(
      SAFETY_QUARANTINE_FILE,
      quarantine,
      'Corrupt Memory pre-restore quarantine'
    );
    safetyBackupPath = SAFETY_QUARANTINE_FILE;
  }

  // Atomic replacement followed by independent readback verification.
  const result = writeMemory(backup.entries);

  return {
    success: true,
    restored: true,
    restoredEntries: result.entries,
    integrity: backup.integrity,
    sha256: result.sha256,
    source: path.basename(BACKUP_FILE),
    safetyBackup: path.basename(safetyBackupPath)
  };
}

module.exports = {
  MEMORY_FILE,
  BACKUP_FILE,
  SAFETY_BACKUP_FILE,
  SAFETY_QUARANTINE_FILE,
  sha256,
  entriesHash,
  readMemory,
  writeMemory,
  makeBackup,
  validateBackup,
  createBackup,
  restoreMemory
};
