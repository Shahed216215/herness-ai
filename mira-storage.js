'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname);
const configuredRoot = process.env.MIRA_STORAGE_DIR;
const STORAGE_ROOT = configuredRoot
  ? path.resolve(configuredRoot)
  : PROJECT_ROOT;
const ENABLED = Boolean(configuredRoot);
const EXCLUDED_SEED_FILES = /(?:^|\/)(?:client_secret[^/]*\.json|google-token\.json)$/i;

function ensureDirectory(dir) {
  if (!ENABLED) return;
  const relative = path.relative(STORAGE_ROOT, dir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('MIRA_STORAGE_PATH_OUTSIDE_ROOT');
  }
  let current = STORAGE_ROOT;
  fs.mkdirSync(current, { recursive: true, mode: 0o700 });
  const rootStat = fs.lstatSync(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('MIRA_STORAGE_ROOT_UNSAFE');
  }
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const st = fs.lstatSync(current);
      if (!st.isDirectory() || st.isSymbolicLink()) {
        throw new Error('MIRA_STORAGE_DIRECTORY_UNSAFE');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
}

function storagePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim() ||
      path.isAbsolute(relativePath)) {
    throw new Error('MIRA_STORAGE_RELATIVE_PATH_REQUIRED');
  }
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith('..' + path.sep)) {
    throw new Error('MIRA_STORAGE_PATH_TRAVERSAL_BLOCKED');
  }
  const target = path.resolve(STORAGE_ROOT, normalized);
  const relative = path.relative(STORAGE_ROOT, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('MIRA_STORAGE_PATH_OUTSIDE_ROOT');
  }
  if (!ENABLED) return target;

  ensureDirectory(path.dirname(target));
  try {
    fs.lstatSync(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const source = path.resolve(PROJECT_ROOT, normalized);
    const sourceRelative = path.relative(PROJECT_ROOT, source);
    if (sourceRelative.startsWith('..') || path.isAbsolute(sourceRelative) ||
        EXCLUDED_SEED_FILES.test(normalized)) return target;
    try {
      const st = fs.lstatSync(source);
      if (!st.isFile() || st.isSymbolicLink() || st.size > 25 * 1024 * 1024) return target;
      const temp = `${target}.seed-${process.pid}-${Date.now()}`;
      fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(temp, 0o600);
      fs.renameSync(temp, target);
    } catch (seedError) {
      if (seedError.code !== 'ENOENT' && seedError.code !== 'EEXIST') throw seedError;
    }
  }
  try {
    const targetStat = fs.lstatSync(target);
    if (targetStat.isSymbolicLink() || (!targetStat.isFile() && !targetStat.isDirectory())) {
      throw new Error('MIRA_STORAGE_TARGET_UNSAFE');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return target;
}

storagePath.isEnabled = () => ENABLED;
storagePath.root = STORAGE_ROOT;
module.exports = storagePath;
