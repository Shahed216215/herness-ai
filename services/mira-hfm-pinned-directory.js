'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/**
 * Linux procfs-backed directory descriptor. All child paths are resolved
 * through the retained descriptor, not the mutable original pathname.
 * Fail closed when the platform cannot provide this mechanism.
 */
function openPinnedDirectory(directory, options = {}) {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    fail('Pinned directory-handle operations require Linux procfs support.',
      'HFM_PINNED_DIRECTORY_UNSUPPORTED');
  }
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    fail('Pinned directory must be an absolute path.', 'HFM_PINNED_DIRECTORY_INVALID');
  }
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const directoryFlag = fs.constants.O_DIRECTORY || 0;
  if (!directoryFlag || !noFollow) {
    fail('Required no-follow directory open flags are unavailable.',
      'HFM_PINNED_DIRECTORY_UNSUPPORTED');
  }
  const before = fs.lstatSync(directory, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) {
    fail('Pinned path is not a real directory.', 'HFM_PINNED_DIRECTORY_UNSAFE');
  }
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | directoryFlag | noFollow);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    const after = fs.lstatSync(directory, { bigint: true });
    if (!opened.isDirectory() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.dev !== after.dev || opened.ino !== after.ino) {
      fail('Directory identity changed while its descriptor was opened.',
        'HFM_PINNED_DIRECTORY_CHANGED');
    }
    const procPath = '/proc/self/fd/' + fd;
    const resolved = fs.realpathSync(procPath);
    if (!resolved || !path.isAbsolute(resolved)) {
      fail('Pinned directory descriptor could not be resolved through procfs.',
        'HFM_PINNED_DIRECTORY_UNSUPPORTED');
    }
    return Object.freeze({
      fd,
      path: procPath,
      identity: Object.freeze({ dev: opened.dev.toString(), ino: opened.ino.toString() }),
      close() { try { fs.closeSync(fd); } catch {} }
    });
  } catch (error) {
    try { fs.closeSync(fd); } catch {}
    throw error;
  }
}

function assertDirectChild(directory, filePath, label = 'File') {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) ||
      path.dirname(path.resolve(filePath)) !== path.resolve(directory) ||
      path.basename(filePath) === '.' || path.basename(filePath) === '..') {
    fail(label + ' must be a direct child of the pinned directory.',
      'HFM_PINNED_DIRECTORY_CHILD_REQUIRED');
  }
  return path.basename(filePath);
}

module.exports = { openPinnedDirectory, assertDirectChild };
