'use strict';

function normalizeId(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function isApprovalRevoked(approval = {}) {
  return approval.revoked === true ||
    approval.status === 'revoked';
}

function isApprovalUsed(approval = {}) {
  return approval.used === true ||
    approval.status === 'used';
}

function validateApprovalReplay(input = {}) {
  const approval = input.approval;

  if (!approval || typeof approval !== 'object') {
    return Object.freeze({
      valid: false,
      reason: 'Approval record is missing'
    });
  }

  const approvalId =
    normalizeId(approval.approvalId);

  if (!approvalId) {
    return Object.freeze({
      valid: false,
      reason: 'Approval ID is missing'
    });
  }

  if (isApprovalRevoked(approval)) {
    return Object.freeze({
      valid: false,
      reason: 'Approval has been revoked'
    });
  }

  if (isApprovalUsed(approval)) {
    return Object.freeze({
      valid: false,
      reason: 'Approval has already been used'
    });
  }

  const usedApprovalIds =
    Array.isArray(input.usedApprovalIds)
      ? input.usedApprovalIds
      : [];

  if (
    usedApprovalIds
      .map(normalizeId)
      .includes(approvalId)
  ) {
    return Object.freeze({
      valid: false,
      reason: 'Approval has already been used'
    });
  }

  const revokedApprovalIds =
    Array.isArray(input.revokedApprovalIds)
      ? input.revokedApprovalIds
      : [];

  if (
    revokedApprovalIds
      .map(normalizeId)
      .includes(approvalId)
  ) {
    return Object.freeze({
      valid: false,
      reason: 'Approval has been revoked'
    });
  }

  return Object.freeze({
    valid: true,
    reason: 'Approval has not been revoked or replayed'
  });
}

module.exports = Object.freeze({
  normalizeId,
  isApprovalRevoked,
  isApprovalUsed,
  validateApprovalReplay
});
