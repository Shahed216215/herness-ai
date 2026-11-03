'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const storagePath = require('../mira-storage');
const jsonStateStore = require('./mira-json-state-store');

const KNOWLEDGE_FILE = storagePath('knowledge.json');
const BACKUP_FILE = storagePath('knowledge-backup.json');
const SAFETY_BACKUP_FILE = storagePath('knowledge-before-restore.json');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function entriesHash(entries) {
  return sha256(JSON.stringify(entries));
}

function safeReadRaw(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(label + ' is not a safe regular file.');
  }
  return fs.readFileSync(filePath, 'utf8');
}

function makeBackup(entries, source) {
  if (!Array.isArray(entries)) throw new Error('Knowledge backup source must be an array.');
  return {
    backupVersion: 2,
    createdAt: new Date().toISOString(),
    source,
    entryCount: entries.length,
    sha256: entriesHash(entries),
    entries
  };
}

function validateBackup(backup, options = {}) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    throw new Error('Invalid Knowledge backup format.');
  }
  if (!Array.isArray(backup.entries)) throw new Error('Knowledge backup entries must be an array.');
  if (backup.entryCount !== backup.entries.length) {
    throw new Error('Knowledge backup entry count mismatch.');
  }
  if (backup.backupVersion === 2) {
    if (typeof backup.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(backup.sha256) ||
        backup.sha256 !== entriesHash(backup.entries)) {
      throw new Error('Knowledge backup SHA-256 verification failed.');
    }
    return { entries: backup.entries, integrity: 'SHA256_VERIFIED' };
  }
  if (backup.backupVersion === 1 && options.allowLegacy === true) {
    return { entries: backup.entries, integrity: 'LEGACY_UNCHECKSUMMED' };
  }
  throw new Error('Unsupported or unverified Knowledge backup version.');
}

function preservePreviousBackup() {
  let raw;
  try {
    raw = safeReadRaw(BACKUP_FILE, 'Existing Knowledge backup');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let previous;
  try {
    previous = JSON.parse(raw);
  } catch {
    const quarantineDir = path.join(path.dirname(BACKUP_FILE), 'memory-conflicts');
    fs.mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
    const quarantineFile = path.join(
      quarantineDir,
      'corrupt-knowledge-backup-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.json'
    );
    jsonStateStore.atomicWriteJson(quarantineFile, {
      quarantineVersion: 1,
      quarantinedAt: new Date().toISOString(),
      reason: 'CORRUPT_KNOWLEDGE_BACKUP_PRESERVED',
      sha256: sha256(raw),
      rawContent: raw
    }, 'Corrupt Knowledge backup quarantine');
    const error = new Error('Existing Knowledge backup is corrupt; preserved it and refused overwrite.');
    error.code = 'KNOWLEDGE_BACKUP_CORRUPT_PRESERVED';
    error.quarantineFile = quarantineFile;
    throw error;
  }
  const versionsDir = BACKUP_FILE + '.versions';
  fs.mkdirSync(versionsDir, { recursive: true, mode: 0o700 });
  const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' +
    crypto.randomBytes(4).toString('hex') + '.json';
  const versionFile = path.join(versionsDir, name);
  jsonStateStore.atomicWriteJson(versionFile, previous, 'Knowledge backup version');
  return path.basename(versionFile);
}

function createKnowledgeBackup() {
  const entries = jsonStateStore.readJsonArray(KNOWLEDGE_FILE, 'Mira Knowledge', { missing: 'empty' });
  const backup = makeBackup(entries, 'Mira local Knowledge backup');
  const preservedPrevious = preservePreviousBackup();
  const result = jsonStateStore.atomicWriteJson(BACKUP_FILE, backup, 'Knowledge backup');
  jsonStateStore.recordStateAudit('knowledge_backup_created', 'success', BACKUP_FILE, {
    stateHash: backup.sha256,
    entryCount: entries.length,
    preservedPreviousBackup: preservedPrevious
  });
  return {
    success: true,
    backupVersion: 2,
    integrity: 'SHA256_VERIFIED',
    entryCount: entries.length,
    sha256: backup.sha256,
    file: path.basename(BACKUP_FILE),
    preservedPreviousBackup: preservedPrevious
  };
}

function restoreKnowledge(options = {}) {
  if (options.confirm !== true) {
    return { success: false, restored: false, dataModified: false, message: 'Explicit confirmation is required.' };
  }

  const backupRaw = safeReadRaw(BACKUP_FILE, 'Knowledge backup');
  let backup;
  try { backup = JSON.parse(backupRaw); }
  catch { throw new Error('Knowledge backup contains invalid JSON.'); }
  const validated = validateBackup(backup, { allowLegacy: options.allowLegacy === true });

  let safetyBackup = null;
  let corruptPrimaryPreserved = false;
  try {
    const current = jsonStateStore.readJsonArray(KNOWLEDGE_FILE, 'Mira Knowledge');
    const safety = makeBackup(current, 'Automatic safety backup before Knowledge restore');
    const result = jsonStateStore.atomicWriteJson(SAFETY_BACKUP_FILE, safety, 'Knowledge safety backup');
    safetyBackup = { file: path.basename(SAFETY_BACKUP_FILE), sha256: result.sha256 };
  } catch (error) {
    if (!/Mira Knowledge is missing\.$/.test(error.message)) {
      let raw;
      try { raw = safeReadRaw(KNOWLEDGE_FILE, 'Corrupt Knowledge primary'); }
      catch (readError) { throw new Error('Cannot establish safe pre-restore state: ' + readError.message); }
      const quarantineDir = path.join(path.dirname(KNOWLEDGE_FILE), 'memory-conflicts');
      fs.mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
      const quarantineFile = path.join(
        quarantineDir,
        'corrupt-knowledge-primary-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.json'
      );
      const preserved = {
        quarantineVersion: 1,
        quarantinedAt: new Date().toISOString(),
        reason: 'CORRUPT_KNOWLEDGE_PRIMARY_PRESERVED_BEFORE_EXPLICIT_RESTORE',
        source: path.basename(KNOWLEDGE_FILE),
        sha256: sha256(raw),
        rawContent: raw,
        readError: error.message
      };
      jsonStateStore.atomicWriteJson(quarantineFile, preserved, 'Corrupt Knowledge primary quarantine');
      safetyBackup = { file: path.basename(quarantineFile), sha256: preserved.sha256 };
      corruptPrimaryPreserved = true;
    }
  }

  jsonStateStore.recordStateAudit('knowledge_restore_intent', 'pending', KNOWLEDGE_FILE, {
    backupHash: entriesHash(validated.entries),
    backupIntegrity: validated.integrity,
    entryCount: validated.entries.length,
    corruptPrimaryPreserved
  });

  const result = corruptPrimaryPreserved
    ? jsonStateStore.atomicWriteJson(KNOWLEDGE_FILE, validated.entries, 'Knowledge restore')
    : jsonStateStore.writeArrayState(KNOWLEDGE_FILE, validated.entries, 'Mira Knowledge');

  try {
    jsonStateStore.recordStateAudit('knowledge_restore_committed', 'success', KNOWLEDGE_FILE, {
      stateHash: result.sha256,
      entryCount: validated.entries.length,
      backupIntegrity: validated.integrity,
      corruptPrimaryPreserved
    });
  } catch (error) {
    error.code = 'KNOWLEDGE_RESTORE_COMMITTED_AUDIT_FAILED';
    error.stateCommitted = true;
    throw error;
  }

  const readback = jsonStateStore.readJsonArray(KNOWLEDGE_FILE, 'Mira Knowledge restore readback');
  if (entriesHash(readback) !== entriesHash(validated.entries)) {
    const error = new Error('Knowledge restore readback verification failed.');
    error.code = 'KNOWLEDGE_RESTORE_READBACK_FAILED';
    error.stateCommitted = true;
    throw error;
  }

  return {
    success: true,
    restored: true,
    restoredEntries: readback.length,
    integrity: validated.integrity,
    sha256: entriesHash(readback),
    source: path.basename(BACKUP_FILE),
    safetyBackup
  };
}

module.exports = {
  KNOWLEDGE_FILE,
  BACKUP_FILE,
  SAFETY_BACKUP_FILE,
  entriesHash,
  makeBackup,
  validateBackup,
  createKnowledgeBackup,
  restoreKnowledge
};
