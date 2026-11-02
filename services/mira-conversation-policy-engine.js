"use strict";

const POLICY_DECISIONS = Object.freeze([
  "allowed",
  "restricted",
  "approval_required",
  "blocked"
]);

function cleanText(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function evaluateConversationPolicy(input = {}) {
  const plan = input.plan;

  if (!plan || typeof plan !== "object") {
    throw new Error("plan is required.");
  }

  const text =
    cleanText(input.content || "");

  if (!text) {
    throw new Error("content is required.");
  }

  const lower =
    text.toLowerCase();

  const irreversible =
    /\b(delete|destroy|terminate|close account|irreversible)\b/i.test(lower);

  const financial =
    /\b(payment|pay|refund|invoice|money|price|fee|bank|transfer)\b/i.test(lower);

  const legal =
    /\b(contract|legal|lawyer|lawsuit|legal agreement)\b/i.test(lower);

  const credential =
    /\b(password|otp|one-time password|secret key|private key|credential)\b/i.test(lower);

  const externalSend =
    plan.externalSendAllowed === true;

  if (credential) {
    return {
      decision: "blocked",
      reason: "Credential or secret handling requires a protected workflow.",
      externalSendAllowed: false,
      approvalRequired: true
    };
  }

  if (irreversible || financial || legal) {
    return {
      decision: "approval_required",
      reason: "Potentially consequential client action requires approval.",
      externalSendAllowed: false,
      approvalRequired: true
    };
  }

  if (externalSend) {
    return {
      decision: "approval_required",
      reason: "External client communication requires explicit approval.",
      externalSendAllowed: false,
      approvalRequired: true
    };
  }

  return {
    decision: "allowed",
    reason: "Response planning is within the controlled conversation boundary.",
    externalSendAllowed: false,
    approvalRequired: false
  };
}

function applyPolicyToPlan(plan, policy) {
  if (!plan || typeof plan !== "object") {
    throw new Error("plan is required.");
  }

  if (!policy || typeof policy !== "object") {
    throw new Error("policy is required.");
  }

  return {
    ...plan,

    policyDecision:
      policy.decision,

    policyReason:
      policy.reason,

    approvalRequired:
      Boolean(policy.approvalRequired),

    externalSendAllowed:
      Boolean(policy.externalSendAllowed)
  };
}

module.exports = {
  POLICY_DECISIONS,
  evaluateConversationPolicy,
  applyPolicyToPlan
};
