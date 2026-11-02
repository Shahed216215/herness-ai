'use strict';

const {
  COMMITMENT_TYPES
} = require('../scope-commitment-schema');

const DEFAULT_AUTHORITY_RULES = Object.freeze({
  [COMMITMENT_TYPES.CONTRACT_ACCEPTANCE]: 'contract_approver',
  [COMMITMENT_TYPES.PRICE_COMMITMENT]: 'price_approver',
  [COMMITMENT_TYPES.LEGAL_COMMITMENT]: 'legal_approver',
  [COMMITMENT_TYPES.IRREVERSIBLE_CLIENT_ACTION]: 'senior_approver'
});

function normalizeRoles(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((role) => String(role).trim().toLowerCase())
    .filter(Boolean);
}

function isApproverAuthorized(input = {}) {
  const approval = input.approval;

  if (!approval || typeof approval !== 'object') {
    return false;
  }

  const roles = normalizeRoles(
    input.approverRoles || approval.approverRoles
  );

  const commitmentTypes = Array.isArray(input.commitmentTypes)
    ? input.commitmentTypes
    : [];

  const authorityRules = {
    ...DEFAULT_AUTHORITY_RULES,
    ...(input.authorityRules || {})
  };

  const protectedCommitments = commitmentTypes.filter(
    (type) => type !== COMMITMENT_TYPES.NONE
  );

  if (protectedCommitments.length === 0) {
    return true;
  }

  return protectedCommitments.every((type) => {
    const requiredRole = authorityRules[type];

    if (!requiredRole) {
      return false;
    }

    return roles.includes(
      String(requiredRole).trim().toLowerCase()
    );
  });
}

function validateApprovalAuthority(input = {}) {
  const approval = input.approval;

  if (!approval || typeof approval !== 'object') {
    return Object.freeze({
      valid: false,
      reason: 'Approval record is missing'
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
    !isApproverAuthorized(input)
  ) {
    return Object.freeze({
      valid: false,
      reason: 'Approver is not authorized for the requested commitment'
    });
  }

  return Object.freeze({
    valid: true,
    reason: 'Approver is authorized for the requested commitment'
  });
}

module.exports = Object.freeze({
  DEFAULT_AUTHORITY_RULES,
  normalizeRoles,
  isApproverAuthorized,
  validateApprovalAuthority
});
