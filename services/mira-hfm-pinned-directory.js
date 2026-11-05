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
function assertPrivateDirectory(pinned, policy = {}) {
  if (!pinned || !Number.isInteger(pinned.fd)) fail('A live pinned directory descriptor is required.', 'HFM_BACKUP_DIRECTORY_POLICY_REJECTED');
  const effectiveUid = typeof process.geteuid === 'function' ? process.geteuid() :
    (typeof process.getuid === 'function' ? process.getuid() : null);
  const effectiveGid = typeof process.getegid === 'function' ? process.getegid() :
    (typeof process.getgid === 'function' ? process.getgid() : null);
  const expectedUid = policy.expectedUid === undefined ? effectiveUid : policy.expectedUid;
  const expectedGid = policy.expectedGid === undefined ? effectiveGid : policy.expectedGid;
  if (!Number.isSafeInteger(expectedUid) || expectedUid < 0 ||
      !Number.isSafeInteger(expectedGid) || expectedGid < 0) {
    fail('Expected effective owner UID and group GID must be available and valid.', 'HFM_BACKUP_DIRECTORY_IDENTITY_UNAVAILABLE');
  }
  const stat = fs.fstatSync(pinned.fd);
  if (!stat.isDirectory() || stat.uid !== expectedUid || stat.gid !== expectedGid) {
    fail('Backup directory owner/group does not match the expected effective workload identity.', 'HFM_BACKUP_DIRECTORY_OWNER_MISMATCH');
  }
  const mode = stat.mode & 0o777;
  if (mode !== 0o700) {
    fail('Backup directory permissions must be exactly 0700; group/other access and missing owner access are rejected.', 'HFM_BACKUP_DIRECTORY_MODE_UNSAFE');
  }
  return Object.freeze({ uid: stat.uid, gid: stat.gid, mode, dev: stat.dev, ino: stat.ino });
}
function pinnedChildPath(pinned, name) {
  if (!pinned || !Number.isInteger(pinned.fd) || typeof pinned.path !== 'string' || !path.isAbsolute(pinned.path) ||
      typeof name !== 'string' || !name || name==='.' || name==='..' || path.basename(name)!==name || name.includes('/') || name.includes('\\'))
    fail('Pinned child must be a single filename.', 'HFM_PINNED_DIRECTORY_CHILD_REQUIRED');
  return path.join(pinned.path,name);
}
function readPinnedChildFile(pinned,name,maxBytes=256*1024*1024) {
  let fd;
  try {
    fd=fs.openSync(pinnedChildPath(pinned,name),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  } catch {
    fail('Pinned child could not be opened without following links.','HFM_PINNED_FILE_UNSAFE');
  }
  try {
    const before=fs.fstatSync(fd,{bigint:true});
    if(!before.isFile()||before.size>BigInt(maxBytes)||before.nlink!==1n)
      fail('Pinned child must be a bounded regular file with exactly one link.','HFM_PINNED_FILE_UNSAFE');
    const bytes=fs.readFileSync(fd);
    const after=fs.fstatSync(fd,{bigint:true});
    if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||
       before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||
       after.nlink!==1n||BigInt(bytes.length)!==after.size)
      fail('Pinned child changed while being read.','HFM_PINNED_FILE_CHANGED_DURING_READ');
    return {bytes,stat:fs.fstatSync(fd)};
  } finally { fs.closeSync(fd); }
}
function assertDirectChild(directory,filePath,label='File') {
  if(typeof filePath!=='string'||!path.isAbsolute(filePath)||path.dirname(path.resolve(filePath))!==path.resolve(directory)||path.basename(filePath)==='.'||path.basename(filePath)==='..')
    fail(label+' must be a direct child of the pinned directory.','HFM_PINNED_DIRECTORY_CHILD_REQUIRED');
  return path.basename(filePath);
}
module.exports={openPinnedDirectory,assertPrivateDirectory,assertDirectChild,pinnedChildPath,readPinnedChildFile};
