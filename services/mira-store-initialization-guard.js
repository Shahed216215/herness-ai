'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function createStoreInitializationGuard({ primaryFile, storeId, evidenceFiles = [] } = {}) {
  if (typeof primaryFile !== 'string' || !primaryFile.trim() ||
      typeof storeId !== 'string' || !storeId.trim() ||
      !Array.isArray(evidenceFiles) || evidenceFiles.some(file => typeof file !== 'string' || !file.trim())) {
    throw new Error('A primary file, storeId and evidenceFiles array are required.');
  }

  const target = path.resolve(primaryFile);
  const directory = path.dirname(target);
  const markerFile = target + '.hfm-initialized.json';

  function validateMarker(marker) {
    const required = ['schemaVersion', 'storeId', 'primaryFile', 'initializedAt', 'sha256'];
    if (!marker || typeof marker !== 'object' || Array.isArray(marker) ||
        Object.keys(marker).length !== required.length ||
        required.some(key => !Object.prototype.hasOwnProperty.call(marker, key)) ||
        marker.schemaVersion !== '1.0.0' ||
        marker.storeId !== storeId ||
        marker.primaryFile !== path.basename(target) ||
        typeof marker.initializedAt !== 'string' ||
        !Number.isFinite(Date.parse(marker.initializedAt)) ||
        typeof marker.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(marker.sha256)) {
      throw new Error(storeId + ' initialization marker is malformed.');
    }
    const body = {
      schemaVersion: marker.schemaVersion,
      storeId: marker.storeId,
      primaryFile: marker.primaryFile,
      initializedAt: marker.initializedAt
    };
    if (sha256(JSON.stringify(body)) !== marker.sha256) {
      throw new Error(storeId + ' initialization marker integrity verification failed.');
    }
    return marker;
  }

  function readMarker() {
    let stat;
    try {
      stat = fs.lstatSync(markerFile);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error(storeId + ' initialization marker cannot be inspected: ' + (error.code || 'IO_ERROR'));
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(storeId + ' initialization marker is not a safe regular file.');
    }
    let marker;
    try {
      marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    } catch {
      throw new Error(storeId + ' initialization marker contains invalid JSON.');
    }
    return validateMarker(marker);
  }

  function ensureMarker() {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const directoryStat = fs.lstatSync(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new Error(storeId + ' storage directory is unsafe.');
    }
    const existing = readMarker();
    if (existing) return existing;

    const body = {
      schemaVersion: '1.0.0',
      storeId,
      primaryFile: path.basename(target),
      initializedAt: new Date().toISOString()
    };
    const marker = { ...body, sha256: sha256(JSON.stringify(body)) };
    const tempFile = markerFile + '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
    let fd;
    let linked = false;
    try {
      fd = fs.openSync(tempFile, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(marker, null, 2) + '\n', 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.linkSync(tempFile, markerFile);
      linked = true;
      fs.unlinkSync(tempFile);
      const dirFd = fs.openSync(directory, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
      return readMarker();
    } catch (error) {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
      try { fs.unlinkSync(tempFile); } catch {}
      if (linked) error.stateCommitted = true;
      if (error.code === 'EEXIST') return readMarker();
      throw error;
    }
  }

  function primaryExists() {
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(storeId + ' primary is not a safe regular file.');
      }
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  function hasVersionSnapshots() {
    const versionsDirectory = target + '.versions';
    let stat;
    try {
      stat = fs.lstatSync(versionsDirectory);
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(storeId + ' version directory is unsafe.');
    }
    return fs.readdirSync(versionsDirectory).some(name => /^[a-zA-Z0-9._-]+\.json$/.test(name));
  }

  function hasEvidence() {
    if (hasVersionSnapshots()) return true;
    for (const file of evidenceFiles) {
      try {
        const stat = fs.lstatSync(path.resolve(file));
        if (stat.isSymbolicLink() || !stat.isFile()) {
          throw new Error(storeId + ' recovery evidence is not a safe regular file.');
        }
        return true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return false;
  }

  function missingPrimaryDecision() {
    const marker = readMarker();
    const evidence = hasEvidence();
    if (marker || evidence) {
      if (!marker) ensureMarker();
      return 'PREVIOUSLY_INITIALIZED';
    }
    return 'FIRST_RUN';
  }

  function assertWritable() {
    const exists = primaryExists();
    const marker = readMarker();
    if (!exists && (marker || hasEvidence())) {
      if (!marker) ensureMarker();
      const error = new Error(storeId + ' primary is missing after initialization; explicit verified restore is required before writing.');
      error.code = 'STORE_PRIMARY_MISSING_RESTORE_REQUIRED';
      throw error;
    }
    ensureMarker();
    return { primaryExists: exists, markerFile };
  }

  return Object.freeze({
    markerFile,
    readMarker,
    ensureMarker,
    primaryExists,
    hasEvidence,
    missingPrimaryDecision,
    assertWritable
  });
}

module.exports = { createStoreInitializationGuard };
