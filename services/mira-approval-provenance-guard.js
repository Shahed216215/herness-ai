'use strict';

const {
  APPROVAL_STATUSES
} = require('../scope-commitment-schema');

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function validateApprovalProvenance(input = {}) {
  const approval = input.approval;

  if (!approval || typeof approval !== 'object') {
    return Object.freeze({
      valid: false,
      reason: 'Approval record is missing'
    });
  }

  if (approval.status !== APPROVAL_STATUSES.APPROVED) {
    return Object.freeze({
      valid: false,
      reason: 'Approval is not approved'
    });
  }

  if (
    typeof approval.approverId !== 'string' ||
    approval.approverId.trim() === ''
  ) {
    return Object.freeze({
      valid: false,
      reason: 'Approver identity is missing'
    });
  }

  if (
    typeof approval.createdAt !== 'string' ||
    approval.createdAt.trim() === ''
  ) {
    return Object.freeze({
      valid: false,
      reason: 'Approval timestamp is missing'
    });
  }

  const createdAtMs = Date.parse(approval.createdAt);

  if (!Number.isFinite(createdAtMs)) {
    return Object.freeze({
      valid: false,
      reason: 'Approval timestamp is invalid'
    });
  }

  const nowMs =
    Number.isFinite(input.nowMs)
      ? input.nowMs
      : Date.now();

  if (createdAtMs > nowMs) {
    return Object.freeze({
      valid: false,
      reason: 'Approval timestamp is in the future'
    });
  }

  const maxAgeMs =
    Number.isFinite(input.maxAgeMs) &&
    input.maxAgeMs >= 0
      ? input.maxAgeMs
      : DEFAULT_MAX_AGE_MS;

  if (nowMs - createdAtMs > maxAgeMs) {
    return Object.freeze({
      valid: false,
      reason: 'Approval has expired'
    });
  }

  return Object.freeze({
    valid: true,
    reason: 'Approval provenance and timestamp are valid'
  });
}

module.exports = Object.freeze({
  DEFAULT_MAX_AGE_MS,
  validateApprovalProvenance
});
