"use strict";

/**
 * Stage 9.1 — Work Acceptance System
 *
 * Acceptance flow:
 * Opportunity
 *   -> Qualification
 *   -> Proposal
 *   -> Client Response
 *   -> Requirements
 *   -> Acceptance Decision
 *   -> Work/Scope Record
 *
 * Payment is metadata-only.
 * This schema MUST NOT represent or authorize money transfer.
 */

const ACCEPTANCE_STATUSES = Object.freeze([
  "pending",
  "accepted",
  "rejected",
  "needs_clarification"
]);

const ACCEPTANCE_DECISIONS = Object.freeze([
  "accept",
  "reject",
  "request_clarification",
  "pending"
]);

const PAYMENT_METADATA_STATUSES = Object.freeze([
  "not_specified",
  "pending",
  "agreed",
  "paid",
  "cancelled"
]);

function assertString(value, field) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertOptionalString(value, field) {
  if (
    value !== undefined &&
    value !== null &&
    (
      typeof value !== "string" ||
      value.trim().length === 0
    )
  ) {
    throw new Error(`${field} must be a non-empty string when provided`);
  }
}

function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new Error(
      `${field} must be one of: ${allowed.join(", ")}`
    );
  }
}

function assertObject(value, field) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${field} must be an object`);
  }
}

function createPaymentMetadata(input = {}) {
  assertObject(input, "paymentMetadata");

  if (
    input.amount !== undefined &&
    input.amount !== null &&
    (
      typeof input.amount !== "number" ||
      !Number.isFinite(input.amount) ||
      input.amount < 0
    )
  ) {
    throw new Error(
      "paymentMetadata.amount must be a non-negative finite number"
    );
  }

  assertOptionalString(
    input.currency,
    "paymentMetadata.currency"
  );

  if (input.status !== undefined) {
    assertEnum(
      input.status,
      PAYMENT_METADATA_STATUSES,
      "paymentMetadata.status"
    );
  }

  assertOptionalString(
    input.terms,
    "paymentMetadata.terms"
  );

  assertOptionalString(
    input.reference,
    "paymentMetadata.reference"
  );

  return Object.freeze({
    amount:
      input.amount !== undefined
        ? input.amount
        : null,

    currency:
      input.currency || null,

    status:
      input.status || "not_specified",

    terms:
      input.terms || null,

    reference:
      input.reference || null,

    metadataOnly: true,

    transferAuthorized: false
  });
}

function createWorkScopeRecord(input = {}) {
  assertObject(input, "workScope");

  assertString(
    input.scopeId,
    "workScope.scopeId"
  );

  assertString(
    input.summary,
    "workScope.summary"
  );

  return Object.freeze({
    scopeId: input.scopeId,
    summary: input.summary,

    deliverables:
      Array.isArray(input.deliverables)
        ? [...input.deliverables]
        : [],

    exclusions:
      Array.isArray(input.exclusions)
        ? [...input.exclusions]
        : [],

    createdAt:
      input.createdAt ||
      new Date().toISOString()
  });
}

function createAcceptanceDecision(input = {}) {
  assertObject(input, "acceptanceDecision");

  assertEnum(
    input.decision,
    ACCEPTANCE_DECISIONS,
    "acceptanceDecision.decision"
  );

  assertString(
    input.reason,
    "acceptanceDecision.reason"
  );

  return Object.freeze({
    decision: input.decision,
    reason: input.reason,

    decidedBy:
      input.decidedBy || "system",

    decidedAt:
      input.decidedAt ||
      new Date().toISOString()
  });
}

function createWorkAcceptance(input = {}) {
  assertObject(input, "workAcceptance");

  assertString(
    input.acceptanceId,
    "acceptanceId"
  );

  assertString(
    input.opportunityId,
    "opportunityId"
  );

  assertOptionalString(
    input.qualificationId,
    "qualificationId"
  );

  assertOptionalString(
    input.proposalId,
    "proposalId"
  );

  assertOptionalString(
    input.clientResponseId,
    "clientResponseId"
  );

  assertOptionalString(
    input.requirementsId,
    "requirementsId"
  );

  assertEnum(
    input.status || "pending",
    ACCEPTANCE_STATUSES,
    "status"
  );

  const acceptanceDecision =
    createAcceptanceDecision(
      input.acceptanceDecision || {
        decision: "pending",
        reason: "Acceptance decision is pending."
      }
    );

  let workScope = null;

  if (input.workScope !== undefined && input.workScope !== null) {
    workScope =
      createWorkScopeRecord(
        input.workScope
      );
  }

  const paymentMetadata =
    createPaymentMetadata(
      input.paymentMetadata || {}
    );

  const createdAt =
    input.createdAt ||
    new Date().toISOString();

  return Object.freeze({
    acceptanceId:
      input.acceptanceId,

    opportunityId:
      input.opportunityId,

    qualificationId:
      input.qualificationId || null,

    proposalId:
      input.proposalId || null,

    clientResponseId:
      input.clientResponseId || null,

    requirementsId:
      input.requirementsId || null,

    status:
      input.status || "pending",

    acceptanceDecision,

    workScope,

    paymentMetadata,

    createdAt,

    updatedAt:
      input.updatedAt || createdAt
  });
}

function validateWorkAcceptance(input) {
  const errors = [];
  const warnings = [];

  try {
    const record =
      createWorkAcceptance(input);

    if (
      record.status === "accepted" &&
      record.acceptanceDecision.decision !== "accept"
    ) {
      errors.push(
        "Accepted work must have an accept decision."
      );
    }

    if (
      record.status === "rejected" &&
      record.acceptanceDecision.decision !== "reject"
    ) {
      errors.push(
        "Rejected work must have a reject decision."
      );
    }

    if (
      record.status === "accepted" &&
      !record.workScope
    ) {
      errors.push(
        "Accepted work must contain a work scope record."
      );
    }

    if (
      record.paymentMetadata.transferAuthorized !== false
    ) {
      errors.push(
        "Payment transfer authorization must remain disabled."
      );
    }

    if (
      record.paymentMetadata.metadataOnly !== true
    ) {
      errors.push(
        "Payment information must remain metadata-only."
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      record
    };
  } catch (error) {
    errors.push(error.message);

    return {
      valid: false,
      errors,
      warnings
    };
  }
}

module.exports = {
  ACCEPTANCE_STATUSES,
  ACCEPTANCE_DECISIONS,
  PAYMENT_METADATA_STATUSES,

  createPaymentMetadata,
  createWorkScopeRecord,
  createAcceptanceDecision,
  createWorkAcceptance,
  validateWorkAcceptance
};
