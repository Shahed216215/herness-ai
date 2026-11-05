'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  captureAuthorizedSnapshot,
  canonicalize,
  sha256
} = require('./mira-hfm-authoritative-snapshot');
const {
  encryptSnapshot,
  writeBackupAtomic
} = require('./mira-hfm-emergency-backup');
const { verifyRecoveryCandidate } = require('./mira-hfm-recovery-verification');

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validateStagingDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    fail('An explicit absolute staging backup directory is required.', 'HFM_STAGING_BACKUP_DIRECTORY_REQUIRED');
  }
  let stat;
  try { stat = fs.lstatSync(directory); }
  catch { fail('Staging backup directory must already exist.', 'HFM_STAGING_BACKUP_DIRECTORY_MISSING'); }
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(directory) !== path.resolve(directory)) {
    fail('Staging backup directory must be a real, non-symlink directory.', 'HFM_STAGING_BACKUP_DIRECTORY_UNSAFE');
  }
  return directory;
}

function validateBackupFileName(name) {
  if (typeof name !== 'string' ||
      !/^mira-hfm-staging-[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.mira-hfm\.enc\.json$/.test(name)) {
    fail('Backup filename must use the restricted Mira staging-backup format.', 'HFM_STAGING_BACKUP_FILENAME_INVALID');
  }
  return name;
}

/**
 * Runs a staging-only end-to-end backup drill.
 *
 * The backup source and baseline source must be distinct, independently
 * pinned staging source identities. The baseline is captured first; the
 * backup source is captured separately and must match it before publication.
 * The published file is then read back and passed through the non-mutating
 * recovery verifier. No canonical store is written and no file is deleted.
 */
async function runStagingBackupDrill({
  source,
  baselineSource,
  request,
  baselineRequest,
  trustedSources,
  keyProvider,
  backupDirectory,
  backupFileName,
  supportedSchemaVersions = [],
  now
}) {
  if (!source || !source.descriptor || source.descriptor.environment !== 'staging' ||
      !baselineSource || !baselineSource.descriptor ||
      baselineSource.descriptor.environment !== 'staging' ||
      source.descriptor.sourceId === baselineSource.descriptor.sourceId) {
    fail('Two distinct, explicitly staging-only snapshot source identities are required.',
      'HFM_STAGING_INDEPENDENT_SOURCES_REQUIRED');
  }
  if (!request || !baselineRequest || request.projectId !== baselineRequest.projectId ||
      request.scope !== 'backup:read' || baselineRequest.scope !== 'backup:read') {
    fail('Backup and baseline requests must target the same project and backup:read scope.',
      'HFM_STAGING_BASELINE_REQUEST_INVALID');
  }
  const directory = validateStagingDirectory(backupDirectory);
  const fileName = validateBackupFileName(backupFileName);
  const backupPath = path.join(directory, fileName);

  const baseline = await captureAuthorizedSnapshot({
    source: baselineSource, request: baselineRequest, trustedSources, now
  });
  const captured = await captureAuthorizedSnapshot({
    source, request, trustedSources, now
  });
  const baselineDigest = sha256(Buffer.from(canonicalize(baseline.snapshot), 'utf8'));
  const capturedDigest = sha256(Buffer.from(canonicalize(captured.snapshot), 'utf8'));
  if (baseline.metadata.sourceRevision !== captured.metadata.sourceRevision ||
      baseline.metadata.recordCount !== captured.metadata.recordCount ||
      baselineDigest !== capturedDigest) {
    fail('Independent staging baseline and backup source differ; no backup was published.',
      'HFM_STAGING_BASELINE_MISMATCH');
  }

  const metadata = {
    ...captured.metadata,
    keyId: keyProvider && keyProvider.descriptor && keyProvider.descriptor.keyId,
    keyVersion: keyProvider && keyProvider.descriptor && keyProvider.descriptor.keyVersion
  };
  const encrypted = await encryptSnapshot({
    snapshot: captured.snapshot,
    metadata,
    keyProvider
  });
  const publication = writeBackupAtomic(backupPath, encrypted.bytes);
  const publishedStat = fs.lstatSync(backupPath);
  if (publishedStat.isSymbolicLink() || !publishedStat.isFile() || (publishedStat.mode & 0o077) !== 0) {
    fail('Published staging backup failed file-type or permission verification.',
      'HFM_STAGING_BACKUP_PUBLICATION_INVALID');
  }
  const readback = fs.readFileSync(backupPath);
  if (!readback.equals(encrypted.bytes) ||
      crypto.createHash('sha256').update(readback).digest('hex') !== encrypted.sha256) {
    fail('Published staging backup failed byte-for-byte readback verification.',
      'HFM_STAGING_BACKUP_READBACK_MISMATCH');
  }

  let recovery;
  try {
    recovery = await verifyRecoveryCandidate({
      backup: readback,
      keyProvider,
      expectedProjectId: request.projectId,
      supportedSchemaVersions,
      expectedSourceRevision: baseline.metadata.sourceRevision,
      expectedRecordCount: baseline.metadata.recordCount,
      expectedPayloadSha256: baselineDigest
    });
  } catch (error) {
    error.backupPublished = true;
    error.backupPath = backupPath;
    error.backupRetained = true;
    throw error;
  }

  return {
    status: 'STAGING_BACKUP_AND_RECOVERY_PREVIEW_VERIFIED',
    backupPath,
    backupSha256: encrypted.sha256,
    backupSizeBytes: publication.sizeBytes,
    publicationStatus: publication.status,
    baselineSourceId: baseline.evidence.sourceId,
    backupSourceId: captured.evidence.sourceId,
    sourceRevision: captured.metadata.sourceRevision,
    recordCount: captured.metadata.recordCount,
    payloadSha256: capturedDigest,
    recovery,
    canonicalMemoryWritten: false,
    canonicalKnowledgeWritten: false,
    restoreExecuted: false,
    backupDeletionExecuted: false,
    liveDriveApiCalled: false,
    productionApproval: false
  };
}

module.exports = { runStagingBackupDrill };
