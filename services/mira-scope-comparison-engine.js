'use strict';

const {
  SCOPE_TYPES,
  COMMITMENT_TYPES,
  APPROVAL_STATUSES,
  DECISIONS,
  createScopeComparison,
  requiresHumanApproval
} = require('../scope-commitment-schema');

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeItems(value) {
  if (Array.isArray(value)) {
    return value
      .map(normalizeText)
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(normalizeText)
      .filter(Boolean);
  }

  return [];
}

function compareScope(input = {}) {
  const existingScope = normalizeItems(input.existingScope);
  const requestedScope = normalizeItems(input.requestedScope);

  const existingSet = new Set(existingScope);

  const newItems = requestedScope.filter(
    (item) => !existingSet.has(item)
  );

  const scopeChanged = newItems.length > 0;

  let scopeType;

  if (!requestedScope.length) {
    scopeType = SCOPE_TYPES.UNCLEAR_SCOPE;
  } else if (scopeChanged) {
    scopeType = SCOPE_TYPES.NEW_SCOPE;
  } else {
    scopeType = SCOPE_TYPES.EXISTING_SCOPE;
  }

  const commitmentTypes = Array.isArray(input.commitmentTypes)
    ? input.commitmentTypes.filter(Boolean)
    : [];

  const approvalRequired =
    scopeChanged ||
    requiresHumanApproval(commitmentTypes);

  let approvalStatus;
  let decision;

  if (approvalRequired) {
    approvalStatus = APPROVAL_STATUSES.REQUIRED;
    decision = DECISIONS.REQUIRE_APPROVAL;
  } else if (scopeType === SCOPE_TYPES.EXISTING_SCOPE) {
    approvalStatus = APPROVAL_STATUSES.NOT_REQUIRED;
    decision = DECISIONS.CONTINUE;
  } else {
    approvalStatus = APPROVAL_STATUSES.PENDING;
    decision = DECISIONS.REVIEW;
  }

  const reasons = [];

  if (scopeChanged) {
    reasons.push('Requested work contains items outside existing scope');
  }

  if (requiresHumanApproval(commitmentTypes)) {
    reasons.push('Commitment type requires human approval');
  }

  if (
    !scopeChanged &&
    !requiresHumanApproval(commitmentTypes) &&
    scopeType === SCOPE_TYPES.EXISTING_SCOPE
  ) {
    reasons.push('Requested work is within existing scope');
  }

  return createScopeComparison({
    requestId: input.requestId || null,
    existingScope,
    requestedScope,
    scopeType,
    scopeChanged,
    commitmentTypes,
    approvalStatus,
    decision,
    reasons
  });
}

module.exports = Object.freeze({
  normalizeText,
  normalizeItems,
  compareScope
});
