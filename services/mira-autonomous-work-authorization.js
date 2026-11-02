"use strict";

const {
  checkPolicyGate
} = require("../autonomous-policy-gate");

const {
  auditDecision
} = require("../autonomous-approval-audit");

const APPROVAL_REQUIRED_RISKS = new Set([
  "medium",
  "high",
  "critical"
]);

/*
 * Stage 6.3 system pre-authorization policy.
 *
 * This policy is owned by the authorization service.
 * Callers and models cannot grant themselves autonomous authority.
 *
 * Only low-risk work is eligible for autonomous pre-authorization.
 * Medium/high/critical work remains approval-required.
 */
const SYSTEM_PREAUTHORIZED_RISKS = new Set([
  "low"
]);

const HARD_APPROVAL_PATTERNS = Object.freeze([
  /\bpayment\b/i,
  /\bpay\b/i,
  /\bfinancial\b/i,
  /\bmoney\b/i,
  /\bbank\b/i,
  /\btransfer\b/i,
  /\blegal\b/i,
  /\bcontract\b/i,
  /\bcredential\b/i,
  /\bpassword\b/i,
  /\bsecret\b/i,
  /\bprivate\s+data\b/i,
  /\bpersonal\s+data\b/i,
  /\bsecurity\b/i,
  /\bpenetration\s+test\b/i,
  /\bpentest\b/i,
  /\bvulnerability\b/i,
  /\bfirewall\b/i,
  /\birreversible\b/i,
  /\bdelete\b/i,
  /\bdestroy\b/i,
  /\bproduction\b/i,
  /\bdeploy\b/i,
  /\bpublish\b/i,
  /\bsend\s+(an?\s+)?email\b/i,
  /\bsend\s+(an?\s+)?message\b/i,
  /\bexternal\s+communication\b/i,
  /\bcontractual\b/i
]);

const CORE_MIRA_PATTERNS = Object.freeze([
  /\bchange\s+mira\b/i,
  /\bmodify\s+mira\b/i,
  /\bmodify\s+core\b/i,
  /\bchange\s+governance\b/i,
  /\bchange\s+autonomy\b/i,
  /\bmodify\s+policy\b/i,
  /\bchange\s+security\b/i,
  /\bmodify\s+security\b/i,
  /\bself[-\s]?modify\b/i,
  /\bself[-\s]?improv(e|ement)\b/i,
  /change-management\.js/i,
  /artifact-apply-engine\.js/i,
  /autonomous-policy-gate\.js/i,
  /autonomous-operations-policy\.js/i
]);

function normalizeRisk(value) {
  const risk = String(value || "").trim().toLowerCase();

  if (
    risk === "low" ||
    risk === "medium" ||
    risk === "high" ||
    risk === "critical"
  ) {
    return risk;
  }

  return "unknown";
}

function extractTaskText(plan = {}) {
  const understanding = plan.taskUnderstanding || {};
  const task = understanding.task || plan.task || {};

  return [
    task.title,
    task.description,
    task.type,
    ...(Array.isArray(task.requirements) ? task.requirements : []),
    ...(Array.isArray(task.deliverables) ? task.deliverables : []),
    plan.goal
  ]
    .filter(Boolean)
    .map(value => String(value))
    .join(" ");
}

function detectHardApprovalRequirement(plan = {}) {
  const text = extractTaskText(plan);

  if (CORE_MIRA_PATTERNS.some(pattern => pattern.test(text))) {
    return {
      required: true,
      category: "mira_core_or_governance_change",
      reason: "Mira core, governance, autonomy, or security changes require 4.17 governance."
    };
  }

  if (HARD_APPROVAL_PATTERNS.some(pattern => pattern.test(text))) {
    return {
      required: true,
      category: "high_impact_action",
      reason: "Task contains a high-impact or sensitive action."
    };
  }

  return {
    required: false,
    category: "",
    reason: ""
  };
}

function getTaskRisk(plan = {}) {
  const understanding = plan.taskUnderstanding || {};
  const task = understanding.task || plan.task || {};

  return normalizeRisk(
    task.risk ||
    understanding.risk ||
    plan.risk
  );
}

function isSystemPreAuthorized(risk) {
  return SYSTEM_PREAUTHORIZED_RISKS.has(
    normalizeRisk(risk)
  );
}

function checkSafetyState() {
  try {
    const {
      getSafetyState
    } = require("../autonomous-safety-state");

    if (typeof getSafetyState !== "function") {
      return {
        ok: true,
        state: "RUNNING"
      };
    }

    const state = getSafetyState();

    if (
      typeof state === "string" &&
      state.toUpperCase() !== "RUNNING"
    ) {
      return {
        ok: false,
        state,
        reason: `Autonomous execution is blocked by safety state: ${state}.`
      };
    }

    if (
      state &&
      typeof state === "object" &&
      state.state &&
      String(state.state).toUpperCase() !== "RUNNING"
    ) {
      return {
        ok: false,
        state: state.state,
        reason:
          `Autonomous execution is blocked by safety state: ${state.state}.`
      };
    }
  } catch (error) {
    return {
      ok: false,
      state: "UNKNOWN",
      reason: "Safety state could not be verified."
    };
  }

  return {
    ok: true,
    state: "RUNNING"
  };
}

function authorizeWork({
  plan = {},
  operation = "test",
  permissionGranted = false,
  now
} = {}) {
  const risk = getTaskRisk(plan);
  const hardApproval = detectHardApprovalRequirement(plan);

  const base = {
    allowed: false,
    status: "approval_required",
    autonomousApproval: false,
    approvalRequired: true,
    risk,
    operation,
    reason: "",
    category: "",
    safetyState: "",
    governance: {
      stage417Authoritative: true,
      humanApprovalRequired: true,
      autonomousApprovalAllowed: false,
      autonomousApplyAllowed: false
    }
  };

  if (risk === "unknown") {
    base.reason = "Task risk is unknown; fail closed.";
    base.category = "unknown_risk";
    return base;
  }

  if (APPROVAL_REQUIRED_RISKS.has(risk)) {
    base.reason =
      `Task risk '${risk}' requires approval.`;
    base.category = `${risk}_risk`;
    return base;
  }

  if (hardApproval.required) {
    base.reason = hardApproval.reason;
    base.category = hardApproval.category;
    return base;
  }

  /*
   * Stage 6.3:
   *
   * Autonomous pre-authorization is determined exclusively
   * by the internal system policy.
   *
   * Callers and models cannot grant themselves authority.
   * There is no caller-controlled trusted-preauthorization flag.
   */
  if (!isSystemPreAuthorized(risk)) {
    base.reason =
      "Task risk is not covered by the system autonomous pre-authorization policy.";
    base.category = "preauthorization_policy_denied";
    return base;
  }

  const safety = checkSafetyState();

  if (!safety.ok) {
    base.status = "execution_blocked";
    base.reason = safety.reason;
    base.category = "safety_state";
    base.safetyState = String(safety.state || "");
    return base;
  }

  const policy = checkPolicyGate(
    operation,
    {
      permissionGranted,
      approved: false,
      now
    }
  );

  if (!policy.allowed) {
    base.status = policy.status || "operation_denied";
    base.reason =
      policy.reason ||
      "Operation is not permitted by autonomous policy.";
    base.category = "operation_policy";
    base.safetyState = String(
      policy.safetyState ||
      policy.state ||
      safety.state ||
      ""
    );

    return base;
  }

  base.allowed = true;
  base.status = "autonomous_allowed";
  base.autonomousApproval = true;
  base.approvalRequired = false;
  base.reason =
    "Low-risk task is trusted, pre-authorized, safe, and policy-compliant.";
  base.category = "low_risk_pre_authorized";
  base.safetyState = String(
    policy.safetyState ||
    policy.state ||
    safety.state ||
    "RUNNING"
  );
  base.governance = {
    stage417Authoritative: true,
    humanApprovalRequired: false,
    autonomousApprovalAllowed: true,
    autonomousApplyAllowed: false
  };

  return base;
}

function authorizeAndAuditWork(input = {}) {
  const result = authorizeWork(input);

  const audit = auditDecision({
    actorRole: "system",
    operation: input.operation || "test",
    result: {
      ...result,
      status:
        result.status === "autonomous_allowed"
          ? "success"
          : result.status
    },
    resource: "work_task",
    resourceId:
      input.plan?.taskId ||
      input.plan?.taskUnderstanding?.task?.id ||
      ""
  });

  return {
    result,
    audit
  };
}

module.exports = {
  APPROVAL_REQUIRED_RISKS,
  SYSTEM_PREAUTHORIZED_RISKS,
  HARD_APPROVAL_PATTERNS,
  CORE_MIRA_PATTERNS,
  normalizeRisk,
  getTaskRisk,
  detectHardApprovalRequirement,
  isSystemPreAuthorized,
  checkSafetyState,
  authorizeWork,
  authorizeAndAuditWork
};
