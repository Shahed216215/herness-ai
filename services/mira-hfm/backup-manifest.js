'use strict';

const { sha256Canonical } = require('./core');

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
      typeof input.createdAt !== 'string' || Number.isNaN(Date.parse(input.createdAt))) {
    return { ok: false, status: 'VALIDATION_FAILED', reason: 'BACKUP_INPUT_INVALID' };
  }
  for (const record of input.records) {
    if (!record || record.projectId !== input.projectId) {
      return { ok: false, status: 'VALIDATION_FAILED', reason: 'BACKUP_PROJECT_SCOPE_MISMATCH' };
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
    status: 'MANIFEST_CREATED_UNAUTHENTICATED',
    manifest,
    payload: input.records,
    restoreAuthorized: false
  };
}

function verifyBackupManifest(manifest, records, authenticityVerifier) {
  if (!manifest || !Array.isArray(records) ||
      manifest.recordCount !== records.length ||
      manifest.payloadHash !== sha256Canonical(records) ||
      manifest.manifestHash !== sha256Canonical(manifestPayload(manifest)) ||
      records.some(record => !record || record.projectId !== manifest.projectId)) {
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
  if (!proof || proof.verified !== true || proof.trustAnchorVerified !== true) {
    return { valid: false, status: 'AUTHENTICITY_FAILED' };
  }
  return { valid: true, status: 'VERIFIED', authenticity: 'VERIFIED' };
}

function authorizeRestore(input) {
  if (!input || input.explicitApproval !== true ||
      input.targetCapabilityAvailable !== true ||
      input.accessPolicyAllowed !== true ||
      input.encryptionVerified !== true ||
      !input.manifestVerification || input.manifestVerification.valid !== true) {
    return { allowed: false, status: 'NOT_APPROVED', reason: 'RESTORE_GATES_NOT_SATISFIED' };
  }
  return {
    allowed: true,
    status: 'AUTHORIZED_FOR_SEPARATELY_CONTROLLED_RESTORE',
    productionWritePerformed: false
  };
}

module.exports = { createBackupManifest, verifyBackupManifest, authorizeRestore };
