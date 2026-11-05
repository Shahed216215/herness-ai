'use strict';
const fs = require('node:fs');
const path = require('node:path');
function fail(message, code) { const e = new Error(message); e.code = code; throw e; }
function openPinnedDirectory(directory) {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) fail('Pinned directory operations require Linux procfs.', 'HFM_PINNED_DIRECTORY_UNSUPPORTED');
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('Pinned directory must be absolute.', 'HFM_PINNED_DIRECTORY_INVALID');
  const noFollow = fs.constants.O_NOFOLLOW || 0, directoryFlag = fs.constants.O_DIRECTORY || 0;
  if (!noFollow || !directoryFlag) fail('Required directory flags unavailable.', 'HFM_PINNED_DIRECTORY_UNSUPPORTED');
  const before = fs.lstatSync(directory, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) fail('Pinned path is not a real directory.', 'HFM_PINNED_DIRECTORY_UNSAFE');
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | directoryFlag | noFollow);
  try {
    const opened = fs.fstatSync(fd, { bigint: true }), after = fs.lstatSync(directory, { bigint: true });
    if (!opened.isDirectory() || opened.dev !== before.dev || opened.ino !== before.ino || opened.dev !== after.dev || opened.ino !== after.ino)
      fail('Directory identity changed while opening.', 'HFM_PINNED_DIRECTORY_CHANGED');
    const procPath = '/proc/self/fd/' + fd, resolved = fs.realpathSync(procPath);
    if (!resolved || !path.isAbsolute(resolved)) fail('Pinned descriptor procfs resolution failed.', 'HFM_PINNED_DIRECTORY_UNSUPPORTED');
    return Object.freeze({ fd, path: procPath, identity: Object.freeze({dev:opened.dev.toString(),ino:opened.ino.toString()}), close(){try{fs.closeSync(fd);}catch{}} });
  } catch(e) { try{fs.closeSync(fd);}catch{} throw e; }
}
function pinnedChildPath(pinned, name) {
  if (!pinned || !Number.isInteger(pinned.fd) || typeof pinned.path !== 'string' || !path.isAbsolute(pinned.path) ||
      typeof name !== 'string' || !name || name==='.' || name==='..' || path.basename(name)!==name || name.includes('/') || name.includes('\\'))
    fail('Pinned child must be a single filename.', 'HFM_PINNED_DIRECTORY_CHILD_REQUIRED');
  return path.join(pinned.path,name);
}
function readPinnedChildFile(pinned,name,maxBytes=256*1024*1024) {
  const fd=fs.openSync(pinnedChildPath(pinned,name),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try { const stat=fs.fstatSync(fd); if(!stat.isFile()||stat.size>maxBytes) fail('Pinned child is not a bounded regular file.','HFM_PINNED_FILE_UNSAFE'); return {bytes:fs.readFileSync(fd),stat}; }
  finally { fs.closeSync(fd); }
}
function assertDirectChild(directory,filePath,label='File') {
  if(typeof filePath!=='string'||!path.isAbsolute(filePath)||path.dirname(path.resolve(filePath))!==path.resolve(directory)||path.basename(filePath)==='.'||path.basename(filePath)==='..')
    fail(label+' must be a direct child of the pinned directory.','HFM_PINNED_DIRECTORY_CHILD_REQUIRED');
  return path.basename(filePath);
}
module.exports={openPinnedDirectory,assertDirectChild,pinnedChildPath,readPinnedChildFile};
