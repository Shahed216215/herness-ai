'use strict';

const {
  SCOPE_TYPES,
  COMMITMENT_TYPES,
  DECISIONS
} = require('../scope-commitment-schema');

const KNOWN_COMMITMENTS = Object.freeze([
  COMMITMENT_TYPES.NONE,
  COMMITMENT_TYPES.CONTRACT_ACCEPTANCE,
  COMMITMENT_TYPES.PRICE_COMMITMENT,
  COMMITMENT_TYPES.LEGAL_COMMITMENT,
  COMMITMENT_TYPES.IRREVERSIBLE_CLIENT_ACTION
]);

function normalizeArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);
}

function detectUnknownCommitments(commitmentTypes = []) {
  return normalizeArray(commitmentTypes)
    .filter(
      (type) => !KNOWN_COMMITMENTS.includes(type)
    );
}

function detectScopeConflict(input = {}) {
  const existingScope =
    normalizeArray(input.existingScope);

  const requestedScope =
    normalizeArray(input.requestedScope);

  const conflictingScope =
    normalizeArray(input.conflictingScope);

  if (conflictingScope.length === 0) {
    return false;
  }

  return conflictingScope.some(
    (item) =>
      existingScope.includes(item) &&
      !requestedScope.includes(item)
  );
}

function evaluateFailSafe(input = {}) {
  const scopeType = input.scopeType;
  const commitmentTypes =
    normalizeArray(input.commitmentTypes);

  const unknownCommitments =
    detectUnknownCommitments(commitmentTypes);

  const scopeConflict =
    detectScopeConflict(input);

  const requestMissing =
    typeof input.request !== 'string' ||
    input.request.trim() === '';

  const unclearScope =
    scopeType === SCOPE_TYPES.UNCLEAR_SCOPE;

  const unknownScopeType =
    typeof scopeType === 'string' &&
    !Object.values(SCOPE_TYPES).includes(scopeType);

  const failSafe =
    requestMissing ||
    unclearScope ||
    unknownScopeType ||
    unknownCommitments.length > 0 ||
    scopeConflict;

  if (failSafe) {
    const reasons = [];

    if (requestMissing) {
      reasons.push('Request is missing or empty');
    }

    if (unclearScope) {
      reasons.push('Scope is unclear');
    }

    if (unknownScopeType) {
      reasons.push('Scope type is unknown');
    }

    if (unknownCommitments.length > 0) {
      reasons.push(
        `Unknown commitment type: ${unknownCommitments.join(', ')}`
      );
    }

    if (scopeConflict) {
      reasons.push('Scope conflict detected');
    }

    return Object.freeze({
      safe: false,
      allowed: false,
      blocked: true,
      reviewRequired: true,
      decision: DECISIONS.REVIEW,
      reasons,
      unknownCommitments,
      scopeConflict
    });
  }

  return Object.freeze({
    safe: true,
    allowed: true,
    blocked: false,
    reviewRequired: false,
    decision: DECISIONS.CONTINUE,
    reasons: [
      'Request and scope are sufficiently clear'
    ],
    unknownCommitments: [],
    scopeConflict: false
  });
}

module.exports = Object.freeze({
  KNOWN_COMMITMENTS,
  normalizeArray,
  detectUnknownCommitments,
  detectScopeConflict,
  evaluateFailSafe
});
