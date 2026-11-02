"use strict";

/**
 * Stage 9.1.3
 * Work Acceptance Decision Engine
 *
 * Boundary:
 * - Decides whether proposed work can be accepted.
 * - Does NOT execute work.
 * - Does NOT transfer or authorize payment.
 * - Does NOT sign contracts.
 * - Does NOT perform external actions.
 *
 * Decisions:
 *   accept
 *   reject
 *   request_clarification
 *   pending
 */

const {
  ACCEPTANCE_DECISIONS,
  ACCEPTANCE_STATUSES
} = require("../work-acceptance-schema");

const DECISION_PRIORITY = Object.freeze({
  reject: 4,
  request_clarification: 3,
  accept: 2,
  pending: 1
});

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function buildDecisionResult(
  decision,
  reason,
  checks = {}
) {
  const normalizedDecision =
    normalize(decision);

  if (
    !ACCEPTANCE_DECISIONS.includes(
      normalizedDecision
    )
  ) {
    throw new Error(
      `Unsupported acceptance decision: ${decision}`
    );
  }

  return Object.freeze({
    decision: normalizedDecision,
    status:
      normalizedDecision === "accept"
        ? "accepted"
        : normalizedDecision === "reject"
          ? "rejected"
          : normalizedDecision ===
              "request_clarification"
            ? "needs_clarification"
            : "pending",
    reason,
    checks: Object.freeze({
      opportunityPresent:
        checks.opportunityPresent === true,
      proposalPresent:
        checks.proposalPresent === true,
      requirementsPresent:
        checks.requirementsPresent === true,
      clientResponsePresent:
        checks.clientResponsePresent === true,
      scopePresent:
        checks.scopePresent === true,
      policyAllowed:
        checks.policyAllowed !== false
    }),
    governance: Object.freeze({
      acceptanceDecisionMade: true,
      workExecutionAllowed: false,
      paymentAllowed: false,
      paymentTransferAuthorized: false,
      contractSigningAllowed: false,
      externalActionPerformed: false
    })
  });
}

function evaluateAcceptanceDecision(
  input = {}
) {
  const opportunity =
    input.opportunity || null;

  const proposal =
    input.proposal || null;

  const requirements =
    input.requirements || null;

  const clientResponse =
    input.clientResponse || null;

  const scope =
    input.workScope || null;

  const policyDecision =
    normalize(
      input.policyDecision ||
      input.policy?.decision ||
      "allowed"
    );

  const checks = {
    opportunityPresent:
      Boolean(opportunity),
    proposalPresent:
      Boolean(proposal),
    requirementsPresent:
      Boolean(requirements),
    clientResponsePresent:
      Boolean(clientResponse),
    scopePresent:
      Boolean(scope),
    policyAllowed:
      ![
        "blocked",
        "restricted"
      ].includes(policyDecision)
  };

  if (!checks.opportunityPresent) {
    return buildDecisionResult(
      "pending",
      "Opportunity is required before work acceptance.",
      checks
    );
  }

  if (!checks.proposalPresent) {
    return buildDecisionResult(
      "pending",
      "Proposal is required before work acceptance.",
      checks
    );
  }

  if (!checks.clientResponsePresent) {
    return buildDecisionResult(
      "pending",
      "Client response is required before work acceptance.",
      checks
    );
  }

  if (!checks.requirementsPresent) {
    return buildDecisionResult(
      "request_clarification",
      "Requirements are incomplete or missing.",
      checks
    );
  }

  if (!checks.policyAllowed) {
    return buildDecisionResult(
      "reject",
      "Work acceptance is blocked by the applicable policy decision.",
      checks
    );
  }

  if (!checks.scopePresent) {
    return buildDecisionResult(
      "request_clarification",
      "A finalized work scope is required before acceptance.",
      checks
    );
  }

  return buildDecisionResult(
    "accept",
    "Required acceptance inputs are present and policy allows work acceptance.",
    checks
  );
}

function decisionRequiresScope(decision) {
  return normalize(decision) === "accept";
}

function isAcceptanceDecisionFinal(decision) {
  const normalized =
    normalize(decision);

  return [
    "accept",
    "reject"
  ].includes(normalized);
}

function getAcceptanceStatusForDecision(
  decision
) {
  const normalized =
    normalize(decision);

  const mapping = {
    accept: "accepted",
    reject: "rejected",
    request_clarification:
      "needs_clarification",
    pending: "pending"
  };

  if (
    !ACCEPTANCE_DECISIONS.includes(
      normalized
    )
  ) {
    throw new Error(
      `Unsupported acceptance decision: ${decision}`
    );
  }

  return mapping[normalized];
}

function validateDecisionStatus(
  decision,
  status
) {
  const expected =
    getAcceptanceStatusForDecision(
      decision
    );

  const normalizedStatus =
    normalize(status);

  if (
    !ACCEPTANCE_STATUSES.includes(
      normalizedStatus
    )
  ) {
    throw new Error(
      `Unsupported acceptance status: ${status}`
    );
  }

  return expected === normalizedStatus;
}

module.exports = {
  DECISION_PRIORITY,
  normalize,
  buildDecisionResult,
  evaluateAcceptanceDecision,
  decisionRequiresScope,
  isAcceptanceDecisionFinal,
  getAcceptanceStatusForDecision,
  validateDecisionStatus
};
