'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const storagePath = require('../mira-storage');
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
function validId(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) fail('HFM_LEARNING_INVALID_ID', label + ' is invalid.');
  return value;
}
function hash(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function ensureSafeDirectory(directory) {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('HFM_LEARNING_STORE_PATH_UNSAFE', 'Proposal store path contains a non-directory or symlink.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  const stat = fs.lstatSync(absolute);
  if ((stat.mode & 0o077) !== 0) fail('HFM_LEARNING_STORE_PERMISSIONS_UNSAFE', 'Proposal store directory must not be accessible by group or others.');
}
function createPersistentProposalStore(options = {}) {
  const baseDirectory = path.resolve(options.baseDirectory || storagePath('data/mira-hfm-learning-proposals'));
  ensureSafeDirectory(baseDirectory);
  function projectDirectory(projectId) {
    validId(projectId, 'projectId');
    const directory = path.join(baseDirectory, hash(projectId));
    ensureSafeDirectory(directory);
    return directory;
  }
  function filePath(projectId, proposalId) {
    validId(proposalId, 'proposalId');
    return path.join(projectDirectory(projectId), hash(proposalId) + '.json');
  }
  return Object.freeze({
    projectIsolated: true, createOnly: true, immutableVersions: true, readAfterWrite: true,
    async putIfAbsent(projectId, proposalId, proposal) {
      if (!proposal || proposal.projectId !== projectId || proposal.proposalId !== proposalId) {
        fail('HFM_LEARNING_PROJECT_MISMATCH', 'Proposal identity does not match its storage key.');
      }
      const target = filePath(projectId, proposalId);
      let fd;
      try {
        fd = fs.openSync(target, 'wx', 0o600);
      } catch (error) {
        if (error.code === 'EEXIST') return { created: false };
        throw error;
      }
      try {
        fs.writeFileSync(fd, JSON.stringify(proposal) + '\n', 'utf8');
        fs.fsyncSync(fd);
      } catch (error) {
        try { fs.closeSync(fd); } catch {}
        throw error;
      }
      fs.closeSync(fd);
      try {
        const dirFd = fs.openSync(path.dirname(target), 'r');
        try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
      } catch (error) {
        error.code = 'HFM_LEARNING_DIRECTORY_SYNC_FAILED';
        error.stateCommitted = true;
        throw error;
      }
      return { created: true };
    },
    async get(projectId, proposalId) {
      const target = filePath(projectId, proposalId);
      let stat;
      try { stat = fs.lstatSync(target); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) {
        fail('HFM_LEARNING_STORE_ARTIFACT_UNSAFE', 'Proposal artifact is not a bounded regular file.');
      }
      let value;
      try { value = JSON.parse(fs.readFileSync(target, 'utf8')); }
      catch { fail('HFM_LEARNING_STORE_CORRUPT', 'Stored proposal is not valid JSON.'); }
      if (!value || value.projectId !== projectId || value.proposalId !== proposalId ||
          typeof value.proposalDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.proposalDigest)) {
        fail('HFM_LEARNING_STORE_IDENTITY_MISMATCH', 'Stored proposal identity or digest is invalid.');
      }
      return value;
    }
  });
}
module.exports = { createPersistentProposalStore };
