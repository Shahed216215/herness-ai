"use strict";

/**
 * Stage 9.1.4
 * Work / Scope Record Service
 *
 * Creates and validates the scope attached to an accepted
 * work-acceptance record.
 *
 * Boundary:
 * - Does NOT execute work.
 * - Does NOT authorize payment.
 * - Does NOT transfer money.
 * - Does NOT sign contracts.
 * - Does NOT silently approve scope changes.
 */

const {
  createWorkScopeRecord
} = require("../work-acceptance-schema");

function normalize(value) {
  return String(value || "").trim();
}

function buildWorkScopeRecord(input = {}) {
  if (!input || typeof input !== "object") {
    throw new Error(
      "Work scope input must be an object."
    );
  }

  const scopeId =
    normalize(input.scopeId);

  const summary =
    normalize(input.summary);

  if (!scopeId) {
    throw new Error(
      "Work scope requires scopeId."
    );
  }

  if (!summary) {
    throw new Error(
      "Work scope requires summary."
    );
  }

  return createWorkScopeRecord({
    scopeId,
    summary,
    deliverables:
      Array.isArray(input.deliverables)
        ? input.deliverables
        : [],
    exclusions:
      Array.isArray(input.exclusions)
        ? input.exclusions
        : [],
    createdAt:
      input.createdAt ||
      new Date().toISOString()
  });
}

function validateScopeConsistency(
  workScope,
  expectedScope = {}
) {
  const errors = [];

  if (!workScope) {
    errors.push(
      "Work scope record is missing."
    );

    return {
      valid: false,
      errors
    };
  }

  if (
    expectedScope.scopeId !== undefined &&
    normalize(workScope.scopeId) !==
      normalize(expectedScope.scopeId)
  ) {
    errors.push(
      "Work scope scopeId does not match the expected scopeId."
    );
  }

  if (
    expectedScope.summary !== undefined &&
    normalize(workScope.summary) !==
      normalize(expectedScope.summary)
  ) {
    errors.push(
      "Work scope summary does not match the expected summary."
    );
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function buildAcceptedWorkScope(input = {}) {
  const acceptanceStatus =
    normalize(input.status);

  if (acceptanceStatus !== "accepted") {
    return {
      valid: false,
      errors: [
        "A work scope record can only be finalized for accepted work."
      ],
      workScope: null
    };
  }

  if (!input.workScope) {
    return {
      valid: false,
      errors: [
        "Accepted work requires a work scope record."
      ],
      workScope: null
    };
  }

  let workScope;

  try {
    workScope =
      buildWorkScopeRecord(
        input.workScope
      );
  } catch (error) {
    return {
      valid: false,
      errors: [error.message],
      workScope: null
    };
  }

  const consistency =
    validateScopeConsistency(
      workScope,
      input.expectedScope || {}
    );

  if (!consistency.valid) {
    return {
      valid: false,
      errors: consistency.errors,
      workScope: null
    };
  }

  return {
    valid: true,
    errors: [],
    workScope
  };
}

function isScopeChange(
  existingScope,
  requestedScope
) {
  const existing =
    Array.isArray(existingScope)
      ? existingScope.map(normalize)
      : [];

  const requested =
    Array.isArray(requestedScope)
      ? requestedScope.map(normalize)
      : [];

  if (
    existing.length !== requested.length
  ) {
    return true;
  }

  const existingSet =
    new Set(existing);

  return requested.some(
    (item) =>
      !existingSet.has(item)
  );
}

function buildScopeRecordGovernance() {
  return Object.freeze({
    workExecutionAllowed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false,
    externalActionPerformed: false,
    scopeChangeAutoApproved: false
  });
}

module.exports = {
  normalize,
  buildWorkScopeRecord,
  validateScopeConsistency,
  buildAcceptedWorkScope,
  isScopeChange,
  buildScopeRecordGovernance
};
