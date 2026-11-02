"use strict";

const {
  recordAudit
} = require("../audit-log");

const AUDIT_ACTIONS = Object.freeze({
  EVALUATED:
    "WORK_ACCEPTANCE_EVALUATED",

  POLICY_GATED:
    "WORK_ACCEPTANCE_POLICY_GATED",

  APPROVAL_REQUIRED:
    "WORK_ACCEPTANCE_APPROVAL_REQUIRED",

  BLOCKED:
    "WORK_ACCEPTANCE_BLOCKED",

  CREATED:
    "WORK_ACCEPTANCE_CREATED",

  UPDATED:
    "WORK_ACCEPTANCE_UPDATED"
});

function normalizeId(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function sanitizeString(
  value,
  maxLength = 120
) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeDecision(value) {
  return sanitizeString(
    value,
    40
  );
}

function normalizeStatus(value) {
  return sanitizeString(
    value,
    40
  );
}

function buildResourceId(
  acceptanceId,
  fallback = "evaluation"
) {
  return (
    normalizeId(acceptanceId) ||
    `work-acceptance-${fallback}`
  );
}

function buildDetails(input = {}) {
  return {
    acceptanceId:
      normalizeId(input.acceptanceId),

    opportunityId:
      normalizeId(input.opportunityId),

    proposalId:
      normalizeId(input.proposalId),

    clientResponseId:
      normalizeId(input.clientResponseId),

    requirementsId:
      normalizeId(input.requirementsId),

    decision:
      normalizeDecision(input.decision),

    decisionStatus:
      normalizeStatus(input.decisionStatus),

    policyDecision:
      normalizeDecision(
        input.policyDecision
      ),

    policyChecked:
      input.policyChecked === true,

    policyAllowed:
      input.policyAllowed === true,

    policyGateDecision:
      normalizeDecision(
        input.policyGateDecision
      ),

    humanApprovalRequired:
      input.humanApprovalRequired === true,

    humanApprovalGranted:
      input.humanApprovalGranted === true,

    acceptanceFinal:
      input.acceptanceFinal === true,

    allowed:
      input.allowed === true,

    blocked:
      input.blocked === true,

    approvalRequired:
      input.approvalRequired === true,

    clarificationRequired:
      input.clarificationRequired === true,

    workExecutionAllowed:
      input.workExecutionAllowed === true,

    paymentAllowed:
      input.paymentAllowed === true,

    paymentTransferAuthorized:
      input.paymentTransferAuthorized === true,

    contractSigningAllowed:
      input.contractSigningAllowed === true,

    externalActionPerformed:
      input.externalActionPerformed === true
  };
}

function recordWorkAcceptanceAudit(
  action,
  input = {}
) {
  if (
    !Object.values(
      AUDIT_ACTIONS
    ).includes(action)
  ) {
    throw new Error(
      `Unsupported work acceptance audit action: ${action}`
    );
  }

  const details =
    buildDetails(input);

  const status =
    input.blocked === true
      ? "blocked"
      : input.approvalRequired === true
        ? "approval_required"
        : input.clarificationRequired === true
          ? "clarification_required"
          : "success";

  return recordAudit({
    actorRole:
      sanitizeString(
        input.actorRole || "mira",
        40
      ),

    action,

    resource:
      "work_acceptance",

    resourceId:
      buildResourceId(
        input.acceptanceId,
        action.toLowerCase()
      ),

    status,

    details
  });
}

function recordAcceptanceEvaluated(
  input = {}
) {
  return recordWorkAcceptanceAudit(
    AUDIT_ACTIONS.EVALUATED,
    input
  );
}

function recordPolicyGated(
  input = {}
) {
  return recordWorkAcceptanceAudit(
    AUDIT_ACTIONS.POLICY_GATED,
    input
  );
}

function recordApprovalRequired(
  input = {}
) {
  return recordWorkAcceptanceAudit(
    AUDIT_ACTIONS.APPROVAL_REQUIRED,
    {
      ...input,
      approvalRequired: true
    }
  );
}

function recordAcceptanceBlocked(
  input = {}
) {
  return recordWorkAcceptanceAudit(
    AUDIT_ACTIONS.BLOCKED,
    {
      ...input,
      blocked: true
    }
  );
}

function recordAcceptanceCreated(
  input = {}
) {
  return recordWorkAcceptanceAudit(
    AUDIT_ACTIONS.CREATED,
    input
  );
}

function recordAcceptanceUpdated(
  input = {}
) {
  return recordWorkAcceptanceAudit(
    AUDIT_ACTIONS.UPDATED,
    input
  );
}

module.exports = Object.freeze({
  AUDIT_ACTIONS,
  normalizeId,
  sanitizeString,
  normalizeDecision,
  normalizeStatus,
  buildResourceId,
  buildDetails,
  recordWorkAcceptanceAudit,
  recordAcceptanceEvaluated,
  recordPolicyGated,
  recordApprovalRequired,
  recordAcceptanceBlocked,
  recordAcceptanceCreated,
  recordAcceptanceUpdated
});
