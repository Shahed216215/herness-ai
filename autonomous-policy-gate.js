"use strict";

const {
  getOperationPolicy
} = require("./autonomous-operations-policy");

const {
  checkOperationLimit,
  recordOperation
} = require("./autonomous-operations-limits");

const {
  checkSafetyState
} = require("./autonomous-safety-state");

function deny(
  status,
  operation,
  details = {}
) {
  return {
    ok: true,
    allowed: false,
    status,
    operation,
    ...details
  };
}

function checkPolicyGate(
  operation,
  options = {}
) {
  const normalizedOperation =
    String(operation || "")
      .trim()
      .toLowerCase();

  /*
   * 1. Operation policy
   */
  const policy =
    getOperationPolicy(
      normalizedOperation
    );

  if (!policy.ok) {
    return deny(
      "operation_policy_denied",
      normalizedOperation || null,
      {
        reason: "operation_policy_missing"
      }
    );
  }

  if (!policy.allowed) {
    return deny(
      "operation_denied",
      normalizedOperation,
      {
        class: policy.class,
        reason: "operation_not_allowed"
      }
    );
  }

  /*
   * 2. Permission
   *
   * Permission must be explicitly supplied.
   * Missing permission fails closed.
   */
  if (
    options.permissionGranted !== true
  ) {
    return deny(
      "permission_denied",
      normalizedOperation,
      {
        reason: "permission_not_granted"
      }
    );
  }

  /*
   * 3. Approval
   *
   * Approval-required operations cannot
   * proceed without explicit approval.
   */
  if (
    policy.approvalRequired === true &&
    options.approved !== true
  ) {
    return deny(
      "approval_required",
      normalizedOperation,
      {
        reason: "explicit_approval_missing"
      }
    );
  }

  /*
   * 4. Rate / quantity limit
   */
  const limit =
    checkOperationLimit(
      normalizedOperation,
      options.now
    );

  if (!limit.ok) {
    return deny(
      "limit_check_failed",
      normalizedOperation,
      {
        reason: limit.status
      }
    );
  }

  if (!limit.allowed) {
    return deny(
      "rate_limit_denied",
      normalizedOperation,
      {
        reason: limit.status,
        count: limit.count,
        maxPerWindow:
          limit.maxPerWindow,
        remaining: limit.remaining
      }
    );
  }

  /*
   * 5. Global safety state
   */
  const safety =
    checkSafetyState();

  if (!safety.ok) {
    return deny(
      "safety_state_denied",
      normalizedOperation,
      {
        reason: safety.status,
        state: safety.state
      }
    );
  }

  if (!safety.executionAllowed) {
    return deny(
      "execution_blocked",
      normalizedOperation,
      {
        reason: safety.status,
        state: safety.state
      }
    );
  }

  /*
   * All policy gates passed.
   */
  return {
    ok: true,
    allowed: true,
    status: "policy_gate_passed",
    operation: normalizedOperation,
    class: policy.class,
    approvalRequired:
      policy.approvalRequired,
    permissionGranted: true,
    approved:
      policy.approvalRequired
        ? true
        : false,
    limit: {
      count: limit.count,
      maxPerWindow:
        limit.maxPerWindow,
      remaining:
        limit.remaining,
      windowMs:
        limit.windowMs
    },
    safetyState:
      safety.state
  };
}

function authorizeOperation(
  operation,
  options = {}
) {
  const result =
    checkPolicyGate(
      operation,
      options
    );

  if (!result.allowed) {
    return result;
  }

  /*
   * Record only after every gate passes.
   * A denied request must never consume
   * an operation quota.
   */
  const recorded =
    recordOperation(
      operation,
      options.now
    );

  if (!recorded.ok) {
    return deny(
      "operation_record_failed",
      result.operation,
      {
        reason: recorded.status
      }
    );
  }

  if (!recorded.allowed) {
    return deny(
      "rate_limit_denied",
      result.operation,
      {
        reason: recorded.status
      }
    );
  }

  return {
    ...result,
    status: "operation_authorized",
    recorded: true,
    count: recorded.count,
    remaining:
      recorded.remaining
  };
}

module.exports = {
  checkPolicyGate,
  authorizeOperation
};
