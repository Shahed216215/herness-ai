"use strict";
const assert = require("node:assert/strict");
const { authorizeWork, detectHardApprovalRequirement } =
  require("../services/mira-autonomous-work-authorization");
const {
  requestEmergencyStop,
  resetSafetyStateForTest
} = require("../autonomous-safety-state");

function makePlan(risk, description = "inspect tool health") {
  return { taskUnderstanding: { task: {
    title: "Tool health inspection", description,
    type: "inspection", risk
  } }, goal: "Inspect registered tool health" };
}

function diagnosticOf(result) {
  return {
    version: result.diagnosticVersion,
    decisionStage: result.decisionStage,
    reasonCode: result.reasonCode,
    category: result.category,
    risk: result.risk,
    operation: result.operation,
    approvalRequired: result.approvalRequired
  };
}

const unknown = authorizeWork({
  plan: makePlan(undefined), operation: "inspect", permissionGranted: true
});
assert.equal(unknown.allowed, false);
assert.equal(unknown.status, "approval_required");
assert.equal(unknown.reasonCode, "TASK_RISK_UNKNOWN");
assert.equal(unknown.category, "unknown_risk");

for (const risk of ["medium", "high", "critical"]) {
  const result = authorizeWork({
    plan: makePlan(risk), operation: "inspect", permissionGranted: true
  });
  assert.equal(result.allowed, false);
  assert.equal(result.status, "approval_required");
  assert.equal(result.reasonCode, "TASK_RISK_REQUIRES_APPROVAL");
  assert.equal(result.risk, risk);
  assert.equal(result.approvalRequired, true);
}

const hard = authorizeWork({
  plan: makePlan("low", "inspect security posture"),
  operation: "inspect", permissionGranted: true
});
assert.equal(hard.allowed, false);
assert.equal(hard.reasonCode, "HARD_APPROVAL_PATTERN_MATCHED");
assert.equal(hard.category, "high_impact_action");
assert.equal(detectHardApprovalRequirement(
  makePlan("low", "inspect security posture")
).required, true);

const unknownOperation = authorizeWork({
  plan: makePlan("low"), operation: "unregistered_operation",
  permissionGranted: true
});
assert.equal(unknownOperation.allowed, false);
assert.equal(unknownOperation.reasonCode, "OPERATION_POLICY_DENIED");
assert.equal(unknownOperation.category, "operation_policy");

const missingPermission = authorizeWork({
  plan: makePlan("low"), operation: "inspect",
  permissionGranted: false
});
assert.equal(missingPermission.allowed, false);
assert.equal(missingPermission.reasonCode, "OPERATION_POLICY_DENIED");
assert.equal(missingPermission.status, "permission_denied");

const permittedLowRisk = authorizeWork({
  plan: makePlan("low"), operation: "inspect", permissionGranted: true
});
assert.equal(permittedLowRisk.allowed, true);
assert.equal(permittedLowRisk.status, "autonomous_allowed");
assert.equal(permittedLowRisk.reasonCode, "LOW_RISK_PREAUTHORIZED");
assert.equal(permittedLowRisk.approvalRequired, false);
assert.equal(permittedLowRisk.governance.autonomousApplyAllowed, false);

try {
  requestEmergencyStop("regression-test");
  const stopped = authorizeWork({
    plan: makePlan("low"), operation: "inspect", permissionGranted: true
  });
  assert.equal(stopped.allowed, false);
  assert.equal(stopped.status, "execution_blocked");
  assert.equal(stopped.reasonCode, "SAFETY_STATE_BLOCKED");
  assert.equal(stopped.category, "safety_state");
} finally {
  resetSafetyStateForTest();
}

for (const result of [
  unknown, hard, unknownOperation, missingPermission, permittedLowRisk
]) {
  const diagnostic = JSON.stringify(diagnosticOf(result));
  assert.equal(diagnostic.includes("security posture"), false);
  assert.equal(diagnostic.includes("inspect tool health"), false);
  assert.equal(diagnostic.includes("Tool health inspection"), false);
  assert.equal(diagnostic.includes("Inspect registered tool health"), false);
  assert.equal(diagnostic.includes("regression-test"), false);
  assert.equal(diagnostic.includes("permissionGranted"), false);
}

for (const result of [unknown, hard, unknownOperation, missingPermission]) {
  const diagnostic = diagnosticOf(result);
  assert.equal(diagnostic.version, 1);
  assert.equal(diagnostic.decisionStage, "work_authorization");
  assert.equal(typeof diagnostic.reasonCode, "string");
  assert.equal(diagnostic.approvalRequired, true);
}

console.log("PASS tool-health-approval-diagnostic");
