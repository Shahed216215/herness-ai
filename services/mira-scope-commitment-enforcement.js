'use strict';

const {
  COMMITMENT_TYPES,
  APPROVAL_STATUSES,
  DECISIONS
} = require('../scope-commitment-schema');

const PROTECTED_COMMITMENTS = Object.freeze([
  COMMITMENT_TYPES.CONTRACT_ACCEPTANCE,
  COMMITMENT_TYPES.PRICE_COMMITMENT,
  COMMITMENT_TYPES.LEGAL_COMMITMENT,
  COMMITMENT_TYPES.IRREVERSIBLE_CLIENT_ACTION
]);

function normalizeApproval(value) {
  return value === true;
}

function hasProtectedCommitment(commitmentTypes = []) {
  if (!Array.isArray(commitmentTypes)) {
    return false;
  }

  return commitmentTypes.some(
    (type) => PROTECTED_COMMITMENTS.includes(type)
  );
}

function enforceApprovalBoundary(input = {}) {
  const scopeChanged = input.scopeChanged === true;

  const commitmentTypes = Array.isArray(input.commitmentTypes)
    ? input.commitmentTypes
    : [];

  const approvalGranted =
    normalizeApproval(input.approvalGranted);

  const protectedCommitment =
    hasProtectedCommitment(commitmentTypes);

  const approvalRequired =
    scopeChanged || protectedCommitment;

  if (approvalRequired && !approvalGranted) {
    return Object.freeze({
      allowed: false,
      blocked: true,
      approvalRequired: true,
      approvalStatus: APPROVAL_STATUSES.REQUIRED,
      decision: DECISIONS.BLOCK,
      commitmentTypes: [...commitmentTypes],
      reasons: [
        'Protected action cannot proceed without human approval'
      ]
    });
  }

  if (approvalRequired && approvalGranted) {
    return Object.freeze({
      allowed: true,
      blocked: false,
      approvalRequired: true,
      approvalStatus: APPROVAL_STATUSES.APPROVED,
      decision: DECISIONS.CONTINUE,
      commitmentTypes: [...commitmentTypes],
      reasons: [
        'Human approval is present for protected action'
      ]
    });
  }

  return Object.freeze({
    allowed: true,
    blocked: false,
    approvalRequired: false,
    approvalStatus: APPROVAL_STATUSES.NOT_REQUIRED,
    decision: DECISIONS.CONTINUE,
    commitmentTypes:
      commitmentTypes.length > 0
        ? [...commitmentTypes]
        : [COMMITMENT_TYPES.NONE],
    reasons: [
      'No protected approval boundary detected'
    ]
  });
}

module.exports = Object.freeze({
  PROTECTED_COMMITMENTS,
  hasProtectedCommitment,
  enforceApprovalBoundary
});
