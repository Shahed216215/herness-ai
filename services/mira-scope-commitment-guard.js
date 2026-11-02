'use strict';

const {
  SCOPE_TYPES,
  COMMITMENT_TYPES,
  APPROVAL_STATUSES,
  DECISIONS,
  createScopeComparison,
  requiresHumanApproval
} = require('../scope-commitment-schema');

const {
  compareScope
} = require('./mira-scope-comparison-engine');

const {
  detectCommitments,
  normalizeRequest
} = require('./mira-commitment-guard');

function mergeCommitments(...lists) {
  const merged = [];

  for (const list of lists) {
    if (!Array.isArray(list)) {
      continue;
    }

    for (const type of list) {
      if (
        type &&
        type !== COMMITMENT_TYPES.NONE &&
        !merged.includes(type)
      ) {
        merged.push(type);
      }
    }
  }

  return merged.length > 0
    ? merged
    : [COMMITMENT_TYPES.NONE];
}

function evaluateScopeAndCommitment(input = {}) {
  const request = normalizeRequest(
    input.request || input.clientRequest || ''
  );

  const scopeResult = compareScope({
    requestId: input.requestId || null,
    existingScope: input.existingScope || [],
    requestedScope: input.requestedScope || [],
    commitmentTypes: input.commitmentTypes || []
  });

  const detectedCommitments = detectCommitments(request);

  const commitmentTypes = mergeCommitments(
    scopeResult.commitmentTypes,
    detectedCommitments
  );

  const protectedCommitments = commitmentTypes.filter(
    (type) => type !== COMMITMENT_TYPES.NONE
  );

  const approvalRequired =
    scopeResult.scopeChanged ||
    requiresHumanApproval(protectedCommitments);

  let decision;
  let approvalStatus;

  if (approvalRequired) {
    decision = DECISIONS.REQUIRE_APPROVAL;
    approvalStatus = APPROVAL_STATUSES.REQUIRED;
  } else if (
    scopeResult.scopeType === SCOPE_TYPES.EXISTING_SCOPE
  ) {
    decision = DECISIONS.CONTINUE;
    approvalStatus = APPROVAL_STATUSES.NOT_REQUIRED;
  } else {
    decision = DECISIONS.REVIEW;
    approvalStatus = APPROVAL_STATUSES.PENDING;
  }

  const reasons = [];

  if (scopeResult.scopeChanged) {
    reasons.push(
      'Requested work contains items outside existing scope'
    );
  }

  if (protectedCommitments.length > 0) {
    reasons.push(
      'Protected commitment detected'
    );
  }

  if (
    !scopeResult.scopeChanged &&
    protectedCommitments.length === 0 &&
    scopeResult.scopeType === SCOPE_TYPES.EXISTING_SCOPE
  ) {
    reasons.push(
      'Request is within existing scope and contains no protected commitment'
    );
  }

  return createScopeComparison({
    requestId: input.requestId || null,
    existingScope: scopeResult.existingScope,
    requestedScope: scopeResult.requestedScope,
    scopeType: scopeResult.scopeType,
    scopeChanged: scopeResult.scopeChanged,
    commitmentTypes,
    approvalStatus,
    decision,
    reasons
  });
}

module.exports = Object.freeze({
  mergeCommitments,
  evaluateScopeAndCommitment
});
