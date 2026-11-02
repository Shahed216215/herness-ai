'use strict';

const crypto = require('node:crypto');

function deny(reason) {
  return Object.freeze({ trusted: false, status: 'REVIEW_REQUIRED', reason });
}

/*
 * Fail-closed contract:
 * - Never trusts caller-supplied role names.
 * - Never trusts caller-supplied gate status labels.
 * - Requires a trusted provider to validate approvals.
 * - Requires a trusted evidence verifier to validate gate evidence.
 *
 * Providers must be wired to an authenticated, project-owned authority/evidence
 * source before their positive results can be treated as authorization.
 */
async function validateApproval(input = {}, providers = {}) {
  if (typeof providers.validateTrustedApproval !== 'function') {
    return deny('Trusted approval provider is not configured');
  }

  if (!input.planId || !input.approvalId) {
    return deny('Plan ID and approval ID are required');
  }

  let result;
  try {
    result = await providers.validateTrustedApproval(Object.freeze({
      planId: String(input.planId),
      approvalId: String(input.approvalId),
      approval: input.approval,
      actionHash: typeof input.actionHash === 'string' ? input.actionHash : ''
    }));
  } catch {
    return deny('Trusted approval provider failed');
  }

  if (!result || result.valid !== true ||
      result.planId !== String(input.planId) ||
      result.approvalId !== String(input.approvalId) ||
      result.authorityVerified !== true ||
      result.provenanceVerified !== true ||
      result.replayChecked !== true ||
      result.issuerAuthenticated !== true ||
      result.approverIdentityVerified !== true) {
    return deny('Approval identity, authority, provenance, or replay is unverified');
  }

  return Object.freeze({
    trusted: true,
    status: 'APPROVAL_VERIFIED',
    planId: result.planId,
    approvalId: result.approvalId
  });
}

async function evaluateGateEvidence(gate = {}, providers = {}) {
  if (typeof providers.verifyGateEvidence !== 'function') {
    return deny('Trusted gate evidence verifier is not configured');
  }

  if (typeof gate.id !== 'string' || !gate.id.trim() ||
      typeof gate.evidenceRef !== 'string' || !gate.evidenceRef.trim()) {
    return deny('Gate ID and evidence reference are required');
  }

  let result;
  try {
    result = await providers.verifyGateEvidence(Object.freeze({
      id: gate.id,
      evidenceRef: gate.evidenceRef,
      expectedHash: typeof gate.expectedHash === 'string' ? gate.expectedHash : ''
    }));
  } catch {
    return deny('Gate evidence verifier failed');
  }

  if (!result || result.verified !== true ||
      result.evidenceRef !== gate.evidenceRef ||
      result.assertionsPassed !== true ||
      result.coverageComplete !== true ||
      result.executed !== true ||
      result.exitCode !== 0 ||
      typeof result.evidenceHash !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(result.evidenceHash) ||
      (gate.expectedHash && result.evidenceHash !== gate.expectedHash)) {
    return deny('Gate evidence is missing, incomplete, or unverifiable');
  }

  return Object.freeze({
    trusted: true,
    status: 'PASS',
    id: gate.id,
    evidenceHash: result.evidenceHash
  });
}

function fingerprintEvidence(value) {
  return crypto.createHash('sha256')
    .update(String(value))
    .digest('hex');
}

module.exports = Object.freeze({
  validateApproval,
  evaluateGateEvidence,
  fingerprintEvidence
});
