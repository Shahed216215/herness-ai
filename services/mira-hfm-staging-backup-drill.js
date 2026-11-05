'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {captureAuthorizedSnapshot,canonicalize,sha256}=require('./mira-hfm-authoritative-snapshot');
const {encryptSnapshot,writeBackupAtomicAt}=require('./mira-hfm-emergency-backup');
const {verifyRecoveryCandidate}=require('./mira-hfm-recovery-verification');
const {openPinnedDirectory,assertPrivateDirectory}=require('./mira-hfm-pinned-directory');
const {verifyIndependentSourceProvenancePair}=require('./mira-hfm-source-provenance-contract');
function fail(message,code){const e=new Error(message);e.code=code;throw e;}
function validateStagingDirectory(directory,directoryPolicy={}){
 if(typeof directory!=='string'||!path.isAbsolute(directory))fail('An explicit absolute staging backup directory is required.','HFM_STAGING_BACKUP_DIRECTORY_REQUIRED');
 let stat;try{stat=fs.lstatSync(directory);}catch{fail('Staging backup directory must already exist.','HFM_STAGING_BACKUP_DIRECTORY_MISSING');}
 if(stat.isSymbolicLink()||!stat.isDirectory()||fs.realpathSync(directory)!==path.resolve(directory))fail('Staging backup directory must be a real, non-symlink directory.','HFM_STAGING_BACKUP_DIRECTORY_UNSAFE');
 try{const pinned=openPinnedDirectory(directory);try{assertPrivateDirectory(pinned,directoryPolicy);return pinned;}catch(e){pinned.close();throw e;}}catch(e){if(e.code==='HFM_PINNED_DIRECTORY_UNSUPPORTED'||(typeof e.code==='string'&&e.code.startsWith('HFM_BACKUP_DIRECTORY_')))throw e;fail('Staging backup directory could not be pinned safely.','HFM_STAGING_BACKUP_DIRECTORY_UNSAFE');}
}
function validateBackupFileName(name){
 if(typeof name!=='string'||!/^mira-hfm-staging-[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.mira-hfm\.enc\.json$/.test(name))
  fail('Backup filename must use the restricted Mira staging-backup format.','HFM_STAGING_BACKUP_FILENAME_INVALID');
 return name;
}
async function runStagingBackupDrill({source,baselineSource,request,baselineRequest,trustedSources,keyProvider,backupDirectory,backupFileName,backupDirectoryExpectedUid,backupDirectoryExpectedGid,supportedSchemaVersions=[],provenancePolicy,now}){
 if(!source||!source.descriptor||source.descriptor.environment!=='staging'||!baselineSource||!baselineSource.descriptor||baselineSource.descriptor.environment!=='staging'||source.descriptor.sourceId===baselineSource.descriptor.sourceId)
  fail('Two distinct, explicitly staging-only snapshot source identities are required.','HFM_STAGING_INDEPENDENT_SOURCES_REQUIRED');
 if(!request||!baselineRequest||request.projectId!==baselineRequest.projectId||request.scope!=='backup:read'||baselineRequest.scope!=='backup:read')
  fail('Backup and baseline requests must target the same project and backup:read scope.','HFM_STAGING_BASELINE_REQUEST_INVALID');
 const directoryPolicy={expectedUid:backupDirectoryExpectedUid,expectedGid:backupDirectoryExpectedGid};
 const pinned=validateStagingDirectory(backupDirectory,directoryPolicy);
 try{
  const fileName=validateBackupFileName(backupFileName);
  const baseline=await captureAuthorizedSnapshot({source:baselineSource,request:baselineRequest,trustedSources,now});
  const captured=await captureAuthorizedSnapshot({source,request,trustedSources,now});
  const provenance=verifyIndependentSourceProvenancePair({baselineEvidence:baseline.evidence,backupEvidence:captured.evidence,provenancePolicy});
  const baselineDigest=sha256(Buffer.from(canonicalize(baseline.snapshot),'utf8'));
  const capturedDigest=sha256(Buffer.from(canonicalize(captured.snapshot),'utf8'));
  if(baseline.metadata.sourceRevision!==captured.metadata.sourceRevision||baseline.metadata.recordCount!==captured.metadata.recordCount||baselineDigest!==capturedDigest)
   fail('Independent staging baseline and backup source differ; no backup was published.','HFM_STAGING_BASELINE_MISMATCH');
  const metadata={...captured.metadata,keyId:keyProvider&&keyProvider.descriptor&&keyProvider.descriptor.keyId,keyVersion:keyProvider&&keyProvider.descriptor&&keyProvider.descriptor.keyVersion};
  const encrypted=await encryptSnapshot({snapshot:captured.snapshot,metadata,keyProvider});
  const publication=writeBackupAtomicAt(pinned,fileName,encrypted.bytes,directoryPolicy),readback=publication.readbackBytes;
  if(!Buffer.isBuffer(readback)||!readback.equals(encrypted.bytes)||crypto.createHash('sha256').update(readback).digest('hex')!==encrypted.sha256)
   fail('Pinned staging backup readback verification failed.','HFM_STAGING_BACKUP_READBACK_MISMATCH');
  let recovery;
  try{recovery=await verifyRecoveryCandidate({backup:readback,keyProvider,expectedProjectId:request.projectId,supportedSchemaVersions,expectedSourceRevision:baseline.metadata.sourceRevision,expectedRecordCount:baseline.metadata.recordCount,expectedPayloadSha256:baselineDigest});}
  catch(e){e.backupPublished=true;e.backupPath=path.join(backupDirectory,fileName);e.backupRetained=true;throw e;}
  return {status:'STAGING_BACKUP_AND_RECOVERY_PREVIEW_VERIFIED',backupPath:path.join(backupDirectory,fileName),backupSha256:encrypted.sha256,backupSizeBytes:publication.sizeBytes,publicationStatus:publication.status,baselineSourceId:baseline.evidence.sourceId,backupSourceId:captured.evidence.sourceId,provenance,sourceRevision:captured.metadata.sourceRevision,recordCount:captured.metadata.recordCount,payloadSha256:capturedDigest,recovery,canonicalMemoryWritten:false,canonicalKnowledgeWritten:false,restoreExecuted:false,backupDeletionExecuted:false,liveDriveApiCalled:false,productionApproval:false};
 }finally{pinned.close();}
}
module.exports={runStagingBackupDrill};
