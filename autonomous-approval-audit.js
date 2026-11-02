"use strict";

const {
  recordAudit
} = require("./audit-log");

const {
  checkPolicyGate,
  authorizeOperation
} = require("./autonomous-policy-gate");

function auditDecision({
  actorRole = "system",
  operation,
  result,
  resource = "autonomous_operation",
  resourceId = ""
}) {
  if (!result) {
    throw new Error(
      "Audit result is required."
    );
  }

  let status = "failed";

  if (result.allowed === true) {
    status = "success";
  } else if (
    result.status ===
      "approval_required"
  ) {
    status = "blocked";
  } else if (
    result.status ===
      "execution_blocked"
  ) {
    status = "blocked";
  } else if (
    result.status ===
      "permission_denied"
  ) {
    status = "blocked";
  } else if (
    result.status ===
      "operation_denied"
  ) {
    status = "blocked";
  } else if (
    result.status ===
      "operation_policy_denied"
  ) {
    status = "blocked";
  } else if (
    result.status ===
      "rate_limit_denied"
  ) {
    status = "blocked";
  }

  return recordAudit({
    actorRole,
    action:
      "autonomous_operation_policy",
    resource,
    resourceId,
    status,
    details: {
      operation:
        String(operation || ""),
      decision:
        result.allowed === true
          ? "allow"
          : "deny",
      gateStatus:
        String(result.status || ""),
      reason:
        String(
          result.reason || ""
        ),
      policyClass:
        String(
          result.class || ""
        ),
      approvalRequired:
        result.approvalRequired === true,
      permissionGranted:
        result.permissionGranted === true,
      approved:
        result.approved === true,
      safetyState:
        String(
          result.safetyState ||
            result.state ||
            ""
        )
    }
  });
}

function checkAndAuditOperation({
  actorRole = "system",
  operation,
  permissionGranted = false,
  approved = false,
  now,
  resource = "autonomous_operation",
  resourceId = ""
}) {
  const result =
    checkPolicyGate(
      operation,
      {
        permissionGranted,
        approved,
        now
      }
    );

  const audit =
    auditDecision({
      actorRole,
      operation,
      result,
      resource,
      resourceId
    });

  return {
    result,
    audit
  };
}

function authorizeAndAuditOperation({
  actorRole = "system",
  operation,
  permissionGranted = false,
  approved = false,
  now,
  resource = "autonomous_operation",
  resourceId = ""
}) {
  const result =
    authorizeOperation(
      operation,
      {
        permissionGranted,
        approved,
        now
      }
    );

  const audit =
    auditDecision({
      actorRole,
      operation,
      result,
      resource,
      resourceId
    });

  return {
    result,
    audit
  };
}

module.exports = {
  auditDecision,
  checkAndAuditOperation,
  authorizeAndAuditOperation
};
