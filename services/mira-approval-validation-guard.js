'use strict';

const {
  APPROVAL_STATUSES
} = require('../scope-commitment-schema');

function normalizeArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

function arraysEqual(left, right) {
  const a = normalizeArray(left);
  const b = normalizeArray(right);

  if (a.length !== b.length) {
    return false;
  }

  return a.every((value, index) => value === b[index]);
}

function validateApproval(input = {}) {
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
      reason: 'Approval is not in approved status'
    });
  }

  if (!approval.approvalId) {
    return Object.freeze({
      valid: false,
      reason: 'Approval ID is missing'
    });
  }

  if (!input.requestId || approval.requestId !== input.requestId) {
    return Object.freeze({
      valid: false,
      reason: 'Approval request ID does not match'
    });
  }

  if (
    !arraysEqual(
      approval.approvedScope,
      input.requestedScope
    )
  ) {
    return Object.freeze({
      valid: false,
      reason: 'Approved scope does not match requested scope'
    });
  }

  if (
    !arraysEqual(
      approval.commitmentTypes,
      input.commitmentTypes
    )
  ) {
    return Object.freeze({
      valid: false,
      reason: 'Approved commitments do not match request commitments'
    });
  }

  return Object.freeze({
    valid: true,
    reason: 'Approval matches request, scope, and commitments'
  });
}

module.exports = Object.freeze({
  normalizeArray,
  arraysEqual,
  validateApproval
});
