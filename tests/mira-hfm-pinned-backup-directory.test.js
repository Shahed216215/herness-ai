'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {openPinnedDirectory,assertPrivateDirectory}=require('../services/mira-hfm-pinned-directory');
const {writeBackupAtomicAt}=require('../services/mira-hfm-emergency-backup');
function run(){
 if(process.platform!=='linux'||!fs.existsSync('/proc/self/fd')||!fs.constants.O_DIRECTORY||!fs.constants.O_NOFOLLOW){process.stdout.write('MIRA_HFM_PINNED_BACKUP_RACE_TEST=SKIPPED_UNSUPPORTED_PLATFORM\n');return;}
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'mira-hfm-pinned-race-')),root=path.join(parent,'root'),moved=path.join(parent,'moved'),replacement=path.join(parent,'replacement');
 fs.mkdirSync(root,{mode:0o700});fs.mkdirSync(replacement,{mode:0o700});
 const bytes=Buffer.from('synthetic-encrypted-backup:'+crypto.randomBytes(8).toString('hex'));
 let pinned;
 try{
  pinned=openPinnedDirectory(root);const identity={...pinned.identity};fs.renameSync(root,moved);fs.mkdirSync(root,{mode:0o700});
  const result=writeBackupAtomicAt(pinned,'rename-race.mira-hfm.enc.json',bytes);
  assert.equal(result.status,'LOCAL_WRITE_VERIFIED');assert(result.readbackBytes.equals(bytes));
  assert(fs.readFileSync(path.join(moved,'rename-race.mira-hfm.enc.json')).equals(bytes));assert.deepEqual(fs.readdirSync(root),[]);
  assert.deepEqual(pinned.identity,identity);process.stdout.write('MIRA_HFM_PINNED_BACKUP_DIRECTORY_RENAME_RACE_BLOCK_PASS\n');
 }finally{if(pinned)pinned.close();}
 const root2=path.join(parent,'root2'),moved2=path.join(parent,'moved2');fs.mkdirSync(root2,{mode:0o700});const pinned2=openPinnedDirectory(root2);
 try{fs.renameSync(root2,moved2);fs.symlinkSync(replacement,root2);const result=writeBackupAtomicAt(pinned2,'symlink-race.mira-hfm.enc.json',bytes);
  assert(result.readbackBytes.equals(bytes));assert(fs.readFileSync(path.join(moved2,'symlink-race.mira-hfm.enc.json')).equals(bytes));assert.deepEqual(fs.readdirSync(replacement),[]);
  process.stdout.write('MIRA_HFM_PINNED_BACKUP_SYMLINK_REPLACEMENT_BLOCK_PASS\n');
 }finally{pinned2.close();fs.rmSync(parent,{recursive:true,force:true});}
 const policyDir=path.join(parent,'policy-dir');fs.mkdirSync(policyDir,{mode:0o700});
 const policyPinned=openPinnedDirectory(policyDir);
 try {
  assertPrivateDirectory(policyPinned);
  fs.chmodSync(policyDir,0o750);
  assert.throws(()=>assertPrivateDirectory(policyPinned),e=>e.code==='HFM_BACKUP_DIRECTORY_MODE_UNSAFE');
  assert.throws(()=>writeBackupAtomicAt(policyPinned,'permissive.mira-hfm.enc.json',bytes),e=>e.code==='HFM_BACKUP_DIRECTORY_MODE_UNSAFE');
  fs.chmodSync(policyDir,0o700);
  const uid=typeof process.geteuid==='function'?process.geteuid():process.getuid();
  const gid=typeof process.getegid==='function'?process.getegid():process.getgid();
  assert.throws(()=>assertPrivateDirectory(policyPinned,{expectedUid:uid+1,expectedGid:gid}),e=>e.code==='HFM_BACKUP_DIRECTORY_OWNER_MISMATCH');
  assert.throws(()=>assertPrivateDirectory(policyPinned,{expectedUid:uid,expectedGid:gid+1}),e=>e.code==='HFM_BACKUP_DIRECTORY_OWNER_MISMATCH');
  fs.chmodSync(policyDir,0o600);
  assert.throws(()=>writeBackupAtomicAt(policyPinned,'owner-mode.mira-hfm.enc.json',bytes),e=>e.code==='HFM_BACKUP_DIRECTORY_MODE_UNSAFE');
  process.stdout.write('MIRA_HFM_BACKUP_DIRECTORY_OWNER_MODE_POLICY_BLOCK_PASS\\n');
 } finally { policyPinned.close(); }
 process.stdout.write('MIRA_HFM_PINNED_BACKUP_DIRECTORY_RACE_TEST_COMPLETE\n');
}
try{run();}catch(e){process.stderr.write((e.stack||e.message)+'\n');process.exitCode=1;}
