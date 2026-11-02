"use strict";

/**
 * Mira AI Agent
 * Stage 9.1.6
 *
 * Work Acceptance Validation + Policy Gate
 *
 * Boundary:
 * - This gate decides whether acceptance may proceed.
 * - It does NOT execute work.
 * - It does NOT authorize payment.
 * - It does NOT transfer money.
 * - It does NOT sign contracts.
 * - It does NOT perform external actions.
 */

const POLICY_DECISIONS = [
  "allowed",
  "restricted",
  "approval_required",
  "blocked"
];

const ACCEPTANCE_GATE_DECISIONS = [
  "allow",
  "block",
  "approval_required",
  "clarification_required"
];

function normalize(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .trim()
    .toLowerCase();
}

function buildGovernance() {
  return Object.freeze({
    acceptanceAllowed: false,
    workExecutionAllowed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false,
    externalActionPerformed: false
  });
}

function buildGateResult(
  decision,
  reason,
  checks = {}
) {
  if (
    !ACCEPTANCE_GATE_DECISIONS.includes(
      decision
    )
  ) {
    throw new Error(
      `Unsupported acceptance gate decision: ${decision}`
    );
  }

  return Object.freeze({
    decision,
    allowed: decision === "allow",
    reason,
    checks: Object.freeze({
      policyChecked:
        checks.policyChecked === true,
      policyAllowed:
        checks.policyAllowed === true,
      humanApprovalRequired:
        checks.humanApprovalRequired === true,
      humanApprovalGranted:
        checks.humanApprovalGranted === true,
      acceptanceDecisionFinal:
        checks.acceptanceDecisionFinal === true
    }),
    governance: buildGovernance(),
    evaluatedAt: new Date().toISOString()
  });
}

function evaluateWorkAcceptancePolicyGate(
  input = {}
) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new Error(
      "Policy gate input must be an object"
    );
  }

  const opportunity =
    input.opportunity || null;

  const policy =
    input.policy ||
    opportunity?.policy ||
    null;

  const acceptanceDecision =
    input.acceptanceDecision || null;

  const humanApprovalGranted =
    input.humanApprovalGranted === true;

  if (!opportunity) {
    return buildGateResult(
      "clarification_required",
      "Opportunity is required for policy-gated acceptance.",
      {
        policyChecked: false
      }
    );
  }

  if (!policy) {
    return buildGateResult(
      "clarification_required",
      "Opportunity policy result is required before acceptance.",
      {
        policyChecked: false
      }
    );
  }

  const policyDecision =
    normalize(policy.decision);

  if (
    !POLICY_DECISIONS.includes(
      policyDecision
    )
  ) {
    return buildGateResult(
      "clarification_required",
      "Policy decision is missing or unsupported.",
      {
        policyChecked:
          policy.policyChecked === true
      }
    );
  }

  if (policy.policyChecked !== true) {
    return buildGateResult(
      "clarification_required",
      "Policy must be checked before work acceptance.",
      {
        policyChecked: false
      }
    );
  }

  if (policyDecision === "blocked") {
    return buildGateResult(
      "block",
      "Opportunity policy blocks work acceptance.",
      {
        policyChecked: true,
        policyAllowed: false
      }
    );
  }

  if (policyDecision === "restricted") {
    return buildGateResult(
      "block",
      "Opportunity policy restricts work acceptance.",
      {
        policyChecked: true,
        policyAllowed: false
      }
    );
  }

  if (
    policyDecision === "approval_required" &&
    !humanApprovalGranted
  ) {
    return buildGateResult(
      "approval_required",
      "Human approval is required before accepting this work.",
      {
        policyChecked: true,
        policyAllowed: false,
        humanApprovalRequired: true,
        humanApprovalGranted: false
      }
    );
  }

  if (
    policyDecision === "approval_required" &&
    humanApprovalGranted !== true
  ) {
    return buildGateResult(
      "approval_required",
      "Required human approval has not been granted.",
      {
        policyChecked: true,
        policyAllowed: false,
        humanApprovalRequired: true,
        humanApprovalGranted: false
      }
    );
  }

  if (
    acceptanceDecision &&
    acceptanceDecision.decision === "reject"
  ) {
    return buildGateResult(
      "block",
      "Acceptance decision rejected the work.",
      {
        policyChecked: true,
        policyAllowed: true,
        acceptanceDecisionFinal: true
      }
    );
  }

  if (
    acceptanceDecision &&
    acceptanceDecision.decision ===
      "request_clarification"
  ) {
    return buildGateResult(
      "clarification_required",
      "Acceptance decision requires clarification.",
      {
        policyChecked: true,
        policyAllowed: true,
        acceptanceDecisionFinal: false
      }
    );
  }

  if (
    acceptanceDecision &&
    acceptanceDecision.decision !== "accept"
  ) {
    return buildGateResult(
      "clarification_required",
      "Acceptance decision is not final.",
      {
        policyChecked: true,
        policyAllowed: true,
        acceptanceDecisionFinal: false
      }
    );
  }

  return buildGateResult(
    "allow",
    "Policy and acceptance checks allow work acceptance.",
    {
      policyChecked: true,
      policyAllowed: true,
      humanApprovalRequired:
        policyDecision === "approval_required",
      humanApprovalGranted,
      acceptanceDecisionFinal:
        acceptanceDecision?.decision === "accept"
    }
  );
}

function isPolicyGateAllowed(result) {
  return Boolean(
    result &&
    result.decision === "allow" &&
    result.allowed === true &&
    result.governance &&
    result.governance.acceptanceAllowed === false &&
    result.governance.workExecutionAllowed === false &&
    result.governance.paymentAllowed === false &&
    result.governance.paymentTransferAuthorized === false &&
    result.governance.contractSigningAllowed === false &&
    result.governance.externalActionPerformed === false
  );
}

function validatePolicyGateResult(result) {
  if (
    !result ||
    typeof result !== "object"
  ) {
    throw new Error(
      "Policy gate result is required"
    );
  }

  if (
    !ACCEPTANCE_GATE_DECISIONS.includes(
      result.decision
    )
  ) {
    throw new Error(
      `Invalid policy gate decision: ${result.decision}`
    );
  }

  if (
    result.governance?.workExecutionAllowed !== false
  ) {
    throw new Error(
      "Work execution must remain disabled"
    );
  }

  if (
    result.governance?.paymentAllowed !== false
  ) {
    throw new Error(
      "Payment must remain disabled"
    );
  }

  if (
    result.governance?.paymentTransferAuthorized !== false
  ) {
    throw new Error(
      "Payment transfer authorization must remain disabled"
    );
  }

  if (
    result.governance?.contractSigningAllowed !== false
  ) {
    throw new Error(
      "Contract signing must remain disabled"
    );
  }

  if (
    result.governance?.externalActionPerformed !== false
  ) {
    throw new Error(
      "External action must remain disabled"
    );
  }

  return true;
}

module.exports = {
  POLICY_DECISIONS,
  ACCEPTANCE_GATE_DECISIONS,
  normalize,
  buildGovernance,
  buildGateResult,
  evaluateWorkAcceptancePolicyGate,
  isPolicyGateAllowed,
  validatePolicyGateResult
};
