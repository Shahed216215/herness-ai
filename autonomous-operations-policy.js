"use strict";

/*
 * Mira Autonomous Operations Safety Policy
 *
 * Stage 4.14
 *
 * Principle:
 * Autonomous != unrestricted.
 *
 * This module defines:
 * - operation classification
 * - approval requirements
 * - rate / quantity limits
 * - fail-closed validation
 *
 * IMPORTANT:
 * - This module does NOT execute operations.
 * - This module does NOT modify files.
 * - This module does NOT read secrets.
 * - Unknown operations are denied by default.
 */

const OPERATION_CLASSES = Object.freeze({
  ALLOWED: "allowed",
  RESTRICTED: "restricted",
  APPROVAL_REQUIRED: "approval_required",
  DENIED: "denied"
});

const OPERATIONS = Object.freeze({
  READ: "read",
  INSPECT: "inspect",
  TEST: "test",
  PROPOSAL_CREATE: "proposal_create",

  CONTROLLED_APPLY: "controlled_apply",
  FILE_MODIFY: "file_modify",
  PROVIDER_CHANGE: "provider_change",
  CONFIG_CHANGE: "config_change",

  DESTRUCTIVE: "destructive",
  EMERGENCY_STOP: "emergency_stop",
  RECOVERY: "recovery"
});

/*
 * Conservative initial limits.
 *
 * These are policy values only.
 * Enforcement will be added in a later step.
 */
const OPERATION_LIMITS = Object.freeze({
  read: Object.freeze({
    maxPerWindow: 60,
    windowMs: 60 * 1000
  }),

  inspect: Object.freeze({
    maxPerWindow: 30,
    windowMs: 60 * 1000
  }),

  test: Object.freeze({
    maxPerWindow: 20,
    windowMs: 60 * 1000
  }),

  proposal_create: Object.freeze({
    maxPerWindow: 10,
    windowMs: 60 * 60 * 1000
  }),

  controlled_apply: Object.freeze({
    maxPerWindow: 3,
    windowMs: 60 * 60 * 1000
  }),

  file_modify: Object.freeze({
    maxPerWindow: 3,
    windowMs: 60 * 60 * 1000
  }),

  provider_change: Object.freeze({
    maxPerWindow: 1,
    windowMs: 24 * 60 * 60 * 1000
  }),

  config_change: Object.freeze({
    maxPerWindow: 2,
    windowMs: 60 * 60 * 1000
  }),

  destructive: Object.freeze({
    maxPerWindow: 0,
    windowMs: 60 * 60 * 1000
  }),

  emergency_stop: Object.freeze({
    maxPerWindow: 10,
    windowMs: 60 * 1000
  }),

  recovery: Object.freeze({
    maxPerWindow: 10,
    windowMs: 60 * 60 * 1000
  })
});

/*
 * Default operation classification.
 *
 * Unknown operations are intentionally absent.
 * That makes the policy fail closed.
 */
const OPERATION_POLICY = Object.freeze({
  [OPERATIONS.READ]: Object.freeze({
    class: OPERATION_CLASSES.ALLOWED,
    approvalRequired: false
  }),

  [OPERATIONS.INSPECT]: Object.freeze({
    class: OPERATION_CLASSES.ALLOWED,
    approvalRequired: false
  }),

  [OPERATIONS.TEST]: Object.freeze({
    class: OPERATION_CLASSES.ALLOWED,
    approvalRequired: false
  }),

  [OPERATIONS.PROPOSAL_CREATE]: Object.freeze({
    class: OPERATION_CLASSES.RESTRICTED,
    approvalRequired: false
  }),

  [OPERATIONS.CONTROLLED_APPLY]: Object.freeze({
    class: OPERATION_CLASSES.APPROVAL_REQUIRED,
    approvalRequired: true
  }),

  [OPERATIONS.FILE_MODIFY]: Object.freeze({
    class: OPERATION_CLASSES.APPROVAL_REQUIRED,
    approvalRequired: true
  }),

  [OPERATIONS.PROVIDER_CHANGE]: Object.freeze({
    class: OPERATION_CLASSES.APPROVAL_REQUIRED,
    approvalRequired: true
  }),

  [OPERATIONS.CONFIG_CHANGE]: Object.freeze({
    class: OPERATION_CLASSES.APPROVAL_REQUIRED,
    approvalRequired: true
  }),

  [OPERATIONS.DESTRUCTIVE]: Object.freeze({
    class: OPERATION_CLASSES.DENIED,
    approvalRequired: true
  }),

  [OPERATIONS.EMERGENCY_STOP]: Object.freeze({
    class: OPERATION_CLASSES.ALLOWED,
    approvalRequired: false
  }),

  [OPERATIONS.RECOVERY]: Object.freeze({
    class: OPERATION_CLASSES.RESTRICTED,
    approvalRequired: false
  })
});

function normalizeOperation(operation) {
  if (typeof operation !== "string") {
    return "";
  }

  return operation
    .trim()
    .toLowerCase();
}

function getOperationPolicy(operation) {
  const normalized =
    normalizeOperation(operation);

  const policy =
    OPERATION_POLICY[normalized];

  if (!policy) {
    return {
      ok: false,
      allowed: false,
      status: "operation_policy_missing",
      operation: normalized || null,
      class: OPERATION_CLASSES.DENIED,
      approvalRequired: true,
      limit: null
    };
  }

  return {
    ok: true,
    allowed:
      policy.class !==
      OPERATION_CLASSES.DENIED,
    status: "operation_policy_found",
    operation: normalized,
    class: policy.class,
    approvalRequired:
      policy.approvalRequired,
    limit:
      OPERATION_LIMITS[normalized] || null
  };
}

function isOperationKnown(operation) {
  return getOperationPolicy(
    operation
  ).ok;
}

function isApprovalRequired(operation) {
  return getOperationPolicy(
    operation
  ).approvalRequired;
}

function isOperationAllowed(operation) {
  const policy =
    getOperationPolicy(operation);

  return (
    policy.ok &&
    policy.allowed
  );
}

function getAllOperationPolicies() {
  const result = {};

  for (
    const operation of Object.values(
      OPERATIONS
    )
  ) {
    result[operation] =
      getOperationPolicy(operation);
  }

  return result;
}

function getPolicyStatus() {
  const policies =
    Object.values(
      OPERATION_POLICY
    );

  return {
    ok: true,
    policy:
      "autonomous_operations_safety",
    mode: "default_deny",
    operations:
      Object.keys(
        OPERATION_POLICY
      ).length,
    allowed:
      policies.filter(
        (item) =>
          item.class ===
          OPERATION_CLASSES.ALLOWED
      ).length,
    restricted:
      policies.filter(
        (item) =>
          item.class ===
          OPERATION_CLASSES.RESTRICTED
      ).length,
    approvalRequired:
      policies.filter(
        (item) =>
          item.class ===
          OPERATION_CLASSES.APPROVAL_REQUIRED
      ).length,
    denied:
      policies.filter(
        (item) =>
          item.class ===
          OPERATION_CLASSES.DENIED
      ).length
  };
}

module.exports = {
  OPERATION_CLASSES,
  OPERATIONS,
  OPERATION_LIMITS,
  OPERATION_POLICY,
  normalizeOperation,
  getOperationPolicy,
  isOperationKnown,
  isApprovalRequired,
  isOperationAllowed,
  getAllOperationPolicies,
  getPolicyStatus
};
