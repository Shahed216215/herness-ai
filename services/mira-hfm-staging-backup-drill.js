'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { captureAuthorizedSnapshot, canonicalize, sha256 } = require('./mira-hfm-authoritative-snapshot');
const { encryptSnapshot, writeBackupAtomicAt } = require('./mira-hfm-emergency-backup');
const { verifyRecoveryCandidate } = require('./mira-hfm-recovery-verification');
const { openPinnedDirectory, assertPrivateDirectory, pinnedChildPath } = require('./mira-hfm-pinned-directory');
const { verifyIndependentSourceProvenancePair } = require('./mira-hfm-source-provenance-contract');
const { verifyAndAcceptSignedProvenancePolicy } = require('./mira-hfm-policy-state-provider-contract');

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validateStagingDirectory(directory, directoryPolicy = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    fail('An explicit absolute staging backup directory is required.', 'HFM_STAGING_BACKUP_DIRECTORY_REQUIRED');
  }
  let stat;
  try { stat = fs.lstatSync(directory); }
  catch { fail('Staging backup directory must already exist.', 'HFM_STAGING_BACKUP_DIRECTORY_MISSING'); }
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(directory) !== path.resolve(directory)) {
    fail('Staging backup directory must be a real, non-symlink directory.', 'HFM_STAGING_BACKUP_DIRECTORY_UNSAFE');
  }
  try {
    const pinned = openPinnedDirectory(directory);
    try {
      assertPrivateDirectory(pinned, directoryPolicy);
      return pinned;
    } catch (error) {
      pinned.close();
      throw error;
    }
  } catch (error) {
    if (error.code === 'HFM_PINNED_DIRECTORY_UNSUPPORTED' ||
        (typeof error.code === 'string' && error.code.startsWith('HFM_BACKUP_DIRECTORY_'))) throw error;
    fail('Staging backup directory could not be pinned safely.', 'HFM_STAGING_BACKUP_DIRECTORY_UNSAFE');
  }
}

function validateBackupFileName(name) {
  if (typeof name !== 'string' ||
      !/^mira-hfm-staging-[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\\.mira-hfm\\.enc\\.json$/.test(name)) {
    fail('Backup filename must use the restricted Mira staging-backup format.', 'HFM_STAGING_BACKUP_FILENAME_INVALID');
  }
  return name;
}

function assertBackupDestinationAbsent(pinnedDirectory, fileName) {
  const target = pinnedChildPath(pinnedDirectory, fileName);
  try {
    const existing = fs.lstatSync(target);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      fail('Backup destination exists but is not a regular immutable backup file.', 'BACKUP_DESTINATION_UNSAFE');
    }
    fail('Immutable backup already exists; refusing policy acceptance and overwrite.', 'BACKUP_ALREADY_EXISTS');
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
}

function collectOperationalIssuerIds(source, baselineSource, keyProvider) {
  const ids = [];
  for (const candidate of [source, baselineSource]) {
    const descriptor = candidate.descriptor || {};
    ids.push(descriptor.sourceId, descriptor.signingProviderId,
      ...(Array.isArray(descriptor.authorizationIssuerIds) ? descriptor.authorizationIssuerIds : []),
      descriptor.provenance && descriptor.provenance.snapshotIssuerId);
  }
  ids.push(keyProvider && keyProvider.descriptor && keyProvider.descriptor.providerId);
  return [...new Set(ids.filter(value => typeof value === 'string' && value.trim()))];
}

/**
 * Staging-only drill. The signed provenance policy, independent evidence,
 * and accepted policy-state CAS receipt are verified before either source is
 * read. The injected provider remains an adapter boundary; its real durability
 * and atomicity are not certified by this orchestrator.
 */
async function runStagingBackupDrill({
  source, baselineSource, request, baselineRequest, trustedSources, keyProvider,
  backupDirectory, backupFileName, backupDirectoryExpectedUid, backupDirectoryExpectedGid,
  supportedSchemaVersions = [], policyEnvelope, policyStateProvider,
  trustedStateAuthorities, expectedStateAuthorityId, trustedPolicyIssuers,
  trustedPolicyReviewers, evidenceProvider, trustedEvidenceIssuers, now
}) {
  if (!source || !source.descriptor || source.descriptor.environment !== 'staging' ||
      !baselineSource || !baselineSource.descriptor || baselineSource.descriptor.environment !== 'staging' ||
      source.descriptor.sourceId === baselineSource.descriptor.sourceId) {
    fail('Two distinct, explicitly staging-only snapshot source identities are required.',
      'HFM_STAGING_INDEPENDENT_SOURCES_REQUIRED');
  }
  if (!request || !baselineRequest || request.projectId !== baselineRequest.projectId ||
      request.scope !== 'backup:read' || baselineRequest.scope !== 'backup:read') {
    fail('Backup and baseline requests must target the same project and backup:read scope.',
      'HFM_STAGING_BASELINE_REQUEST_INVALID');
  }
  if (!policyEnvelope || !policyStateProvider || !trustedStateAuthorities ||
      !expectedStateAuthorityId || !trustedPolicyIssuers || !trustedPolicyReviewers ||
      !evidenceProvider || !trustedEvidenceIssuers) {
    fail('A signed provenance policy, independent trust maps, evidence resolver and policy-state provider are required.',
      'HFM_STAGING_POLICY_ACCEPTANCE_REQUIRED');
  }
  const policySources = policyEnvelope.payload && policyEnvelope.payload.sources;
  const expectedSourceIds = [source.descriptor.sourceId, baselineSource.descriptor.sourceId].sort();
  const policySourceIds = policySources && typeof policySources === 'object' && !Array.isArray(policySources)
    ? Object.keys(policySources).sort() : [];
  if (policySourceIds.length !== 2 ||
      policySourceIds.some((sourceId, index) => sourceId !== expectedSourceIds[index])) {
    fail('Signed provenance policy must bind exactly the backup and independent baseline source identities before policy-state acceptance.',
      'HFM_STAGING_POLICY_SOURCE_BINDING_MISMATCH');
  }

  const directoryPolicy = {
    expectedUid: backupDirectoryExpectedUid,
    expectedGid: backupDirectoryExpectedGid
  };
  const pinned = validateStagingDirectory(backupDirectory, directoryPolicy);
  try {
    const fileName = validateBackupFileName(backupFileName);
    assertBackupDestinationAbsent(pinned, fileName);

    const policyAcceptance = await verifyAndAcceptSignedProvenancePolicy({
      envelope: policyEnvelope,
      provider: policyStateProvider,
      trustedStateAuthorities,
      expectedStateAuthorityId,
      trustedPolicyIssuers,
      trustedPolicyReviewers,
      evidenceProvider,
      trustedEvidenceIssuers,
      expectedEnvironment: 'staging',
      expectedProjectId: request.projectId,
      operationalIssuerIds: collectOperationalIssuerIds(source, baselineSource, keyProvider),
      now
    });

    const baseline = await captureAuthorizedSnapshot({
      source: baselineSource, request: baselineRequest, trustedSources, now
    });
    const captured = await captureAuthorizedSnapshot({
      source, request, trustedSources, now
    });
    const provenance = verifyIndependentSourceProvenancePair({
      baselineEvidence: baseline.evidence,
      backupEvidence: captured.evidence,
      provenancePolicy: policyAcceptance.provenancePolicy
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
    const encrypted = await encryptSnapshot({ snapshot: captured.snapshot, metadata, keyProvider });
    const publication = writeBackupAtomicAt(pinned, fileName, encrypted.bytes, directoryPolicy);
    const readback = publication.readbackBytes;
    if (!Buffer.isBuffer(readback) || !readback.equals(encrypted.bytes) ||
        crypto.createHash('sha256').update(readback).digest('hex') !== encrypted.sha256) {
      fail('Pinned staging backup readback verification failed.', 'HFM_STAGING_BACKUP_READBACK_MISMATCH');
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
      error.backupPath = path.join(backupDirectory, fileName);
      error.backupRetained = true;
      throw error;
    }

    return {
      status: 'STAGING_BACKUP_AND_RECOVERY_PREVIEW_VERIFIED',
      backupPath: path.join(backupDirectory, fileName),
      backupSha256: encrypted.sha256,
      backupSizeBytes: publication.sizeBytes,
      publicationStatus: publication.status,
      policyAcceptance: {
        status: policyAcceptance.status,
        policyId: policyAcceptance.policyId,
        policyVersion: policyAcceptance.policyVersion,
        policyDigest: policyAcceptance.policyDigest,
        stateCommit: policyAcceptance.stateCommit,
        evidenceVerification: policyAcceptance.evidenceVerification
      },
      baselineSourceId: baseline.evidence.sourceId,
      backupSourceId: captured.evidence.sourceId,
      provenance,
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
  } finally {
    pinned.close();
  }
}

module.exports = { runStagingBackupDrill };
