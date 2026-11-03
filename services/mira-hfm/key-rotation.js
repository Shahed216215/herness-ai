'use strict';

const { sha256Canonical } = require('./core');
const { cryptoProviderReadiness, validateEnvelope, decryptPayload } = require('./encryption-contract');

async function prepareKeyRotation(input) {
  if (!input || !input.envelope || !input.provider || !input.context ||
      input.context.action !== 'rotate_key') {
    return { ok: false, status: 'VALIDATION_FAILED', reason: 'KEY_ROTATION_INPUT_INVALID' };
  }
  const approval = input.approval;
  const recovery = input.recoveryPoint;
  if (!approval || approval.approved !== true ||
      typeof approval.approver !== 'string' || !approval.approver.trim() ||
      approval.approver !== input.context.actor ||
      typeof approval.policyDecisionId !== 'string' || !approval.policyDecisionId.trim() ||
      approval.policyDecisionId !== input.context.policyDecisionId ||
      typeof approval.evidenceReference !== 'string' || !approval.evidenceReference.trim()) {
    return { ok: false, status: 'NOT_APPROVED', reason: 'HUMAN_KEY_ROTATION_APPROVAL_REQUIRED' };
  }
  if (!recovery || recovery.status !== 'VERIFIED' || recovery.verified !== true ||
      recovery.projectId !== input.context.projectId ||
      recovery.payloadHash !== sha256Canonical(input.envelope) ||
      typeof recovery.evidenceReference !== 'string' || !recovery.evidenceReference.trim()) {
    return { ok: false, status: 'RECOVERY_REQUIRED', reason: 'VERIFIED_RECOVERY_POINT_REQUIRED' };
  }

  const readiness = cryptoProviderReadiness(input.provider, input.context);
  if (!readiness.ready) return { ok: false, status: readiness.status, reason: readiness.reason };
  if (typeof input.provider.rewrap !== 'function' || !validateEnvelope(input.envelope, input.provider)) {
    return { ok: false, status: 'NOT_SUPPORTED', reason: 'APPROVED_REWRAP_CAPABILITY_REQUIRED' };
  }

  const original = await decryptPayload(input.provider, input.envelope, input.context);
  if (!original.ok) return { ok: false, status: original.status, reason: 'OLD_KEY_DECRYPTION_FAILED' };

  let nextEnvelope;
  try {
    nextEnvelope = await input.provider.rewrap(input.envelope, input.context);
  } catch (_) {
    return { ok: false, status: 'ENCRYPTION_FAILED', reason: 'KEY_REWRAP_FAILED' };
  }
  if (!validateEnvelope(nextEnvelope, input.provider) ||
      nextEnvelope.keyVersion === input.envelope.keyVersion) {
    return { ok: false, status: 'INTEGRITY_FAILED', reason: 'NEW_KEY_VERSION_INVALID' };
  }

  const rotated = await decryptPayload(input.provider, nextEnvelope, input.context);
  if (!rotated.ok || sha256Canonical(rotated.plaintext) !== sha256Canonical(original.plaintext)) {
    return { ok: false, status: 'INTEGRITY_FAILED', reason: 'ROTATED_KEY_READBACK_MISMATCH' };
  }

  return {
    ok: true,
    status: 'ROTATION_PREPARED_NOT_PERSISTED',
    oldKeyId: input.envelope.keyId,
    oldKeyVersion: input.envelope.keyVersion,
    newKeyId: nextEnvelope.keyId,
    newKeyVersion: nextEnvelope.keyVersion,
    newEnvelope: nextEnvelope,
    contentVerified: true,
    recoveryEvidenceReference: recovery.evidenceReference,
    approvalEvidenceReference: approval.evidenceReference,
    persistencePerformed: false,
    oldKeyRetired: false,
    productionKeyChanged: false
  };
}

module.exports = { prepareKeyRotation };
