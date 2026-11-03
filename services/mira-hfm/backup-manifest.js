'use strict';

const { sha256Canonical, validateCanonicalRecord, evaluateAccess } = require('./core');

function manifestPayload(manifest) {
  const copy = Object.assign({}, manifest);
  delete copy.manifestHash;
  delete copy.authenticity;
  return copy;
}

function createBackupManifest(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.records) ||
      typeof input.projectId !== 'string' || !input.projectId.trim() ||
      typeof input.backupId !== 'string' || !input.backupId.trim() ||
      typeof input.createdAt !== 'string' || Number.isNaN(Date.parse(input.createdAt)) ||
      input.backupCapabilityAvailable !== true || !input.context ||
      input.context.projectId !== input.projectId ||
      !(typeof input.sourceRevision === 'string' && input.sourceRevision.trim()) &&
      !Number.isSafeInteger(input.sourceRevision)) {
    return { ok: false, status: 'VALIDATION_FAILED', reason: 'BACKUP_INPUT_INVALID' };
  }
  for (const record of input.records) {
    const validation = validateCanonicalRecord(record);
    const access = evaluateAccess(record, Object.assign({}, input.context, { action: 'backup' }));
    if (!validation.valid || record.projectId !== input.projectId ||
        record.integrity.status !== 'VERIFIED' || !access.allowed) {
      return { ok: false, status: 'VALIDATION_FAILED', reason: 'BACKUP_RECORD_OR_PROJECT_INVALID', errors: validation.errors || [] };
    }
  }
  const base = {
    manifestVersion: '1.0.0',
    backupId: input.backupId,
    formatVersion: 1,
    schemaVersion: '1.0.0',
    projectId: input.projectId,
    recordCount: input.records.length,
    payloadHash: sha256Canonical(input.records),
    createdAt: new Date(input.createdAt).toISOString(),
    sourceRevision: input.sourceRevision,
    encryptionProfile: input.encryptionProfile || 'UNSPECIFIED',
    keyId: input.keyId || null,
    keyVersion: input.keyVersion || null
  };
  const manifest = Object.assign({}, base, {
    manifestHash: sha256Canonical(base),
    authenticity: {
      status: 'UNVERIFIED',
      algorithm: 'UNSET',
      keyId: input.keyId || null,
      proof: null
    }
  });
  return {
    ok: true,
    status: 'MANIFEST_ONLY_NOT_ENCRYPTED_NOT_AUTHENTICATED',
    manifest,
    restoreAuthorized: false,
    backupPayloadCreated: false
  };
}

function verifyBackupManifest(manifest, records, authenticityVerifier) {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(records) ||
      !(typeof manifest.sourceRevision === 'string' && manifest.sourceRevision) &&
      !Number.isSafeInteger(manifest.sourceRevision) ||
      typeof manifest.backupId !== 'string' || !manifest.backupId ||
      typeof manifest.projectId !== 'string' || !manifest.projectId ||
      manifest.manifestVersion !== '1.0.0' || manifest.formatVersion !== 1 ||
      manifest.schemaVersion !== '1.0.0' ||
      manifest.recordCount !== records.length ||
      manifest.payloadHash !== sha256Canonical(records) ||
      manifest.manifestHash !== sha256Canonical(manifestPayload(manifest)) ||
      records.some(record => {
        const validation = validateCanonicalRecord(record);
        return !validation.valid || record.projectId !== manifest.projectId ||
          record.integrity.status !== 'VERIFIED';
      })) {
    return { valid: false, status: 'INTEGRITY_FAILED' };
  }
  if (typeof authenticityVerifier !== 'function') {
    return { valid: false, status: 'AUTHENTICITY_UNVERIFIED' };
  }
  let proof;
  try {
    proof = authenticityVerifier(manifest);
  } catch (_) {
    return { valid: false, status: 'AUTHENTICITY_UNVERIFIED' };
  }
  if (!manifest.authenticity || manifest.authenticity.status !== 'SIGNED' ||
      typeof manifest.authenticity.algorithm !== 'string' || !manifest.authenticity.algorithm ||
      typeof manifest.authenticity.keyId !== 'string' || !manifest.authenticity.keyId ||
      typeof manifest.authenticity.proof !== 'string' || !manifest.authenticity.proof ||
      !proof || proof.verified !== true || proof.trustAnchorVerified !== true ||
      proof.keyNotRevoked !== true || proof.manifestHash !== manifest.manifestHash ||
      proof.algorithm !== manifest.authenticity.algorithm ||
      proof.keyId !== manifest.authenticity.keyId) {
    return { valid: false, status: 'AUTHENTICITY_FAILED' };
  }
  return {
    valid: true, status: 'VERIFIED', authenticity: 'VERIFIED',
    projectId: manifest.projectId, manifestHash: manifest.manifestHash
  };
}

function authorizeRestore(input) {
  if (!input || input.explicitApproval !== true ||
      input.targetCapabilityAvailable !== true ||
      input.accessPolicyAllowed !== true ||
      input.encryptionVerified !== true ||
      !input.manifestVerification || input.manifestVerification.valid !== true ||
      input.manifestVerification.status !== 'VERIFIED' ||
      input.manifestVerification.authenticity !== 'VERIFIED' ||
      input.manifestVerification.projectId !== input.sourceProjectId ||
      typeof input.sourceProjectId !== 'string' || typeof input.targetProjectId !== 'string' ||
      !input.sourceProjectId || !input.targetProjectId ||
      (input.sourceProjectId !== input.targetProjectId && input.crossProjectApproval !== true)) {
    return { allowed: false, status: 'NOT_APPROVED', reason: 'RESTORE_GATES_NOT_SATISFIED' };
  }
  return {
    allowed: true,
    status: 'AUTHORIZED_FOR_SEPARATELY_CONTROLLED_RESTORE',
    productionWritePerformed: false
  };
}

module.exports = { createBackupManifest, verifyBackupManifest, authorizeRestore };
