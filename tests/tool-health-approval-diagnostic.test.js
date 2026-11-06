"use strict";
const assert = require("node:assert/strict");
const { authorizeWork, detectHardApprovalRequirement } =
  require("../services/mira-autonomous-work-authorization");

function makePlan(risk, description = "inspect tool health") {
  return { taskUnderstanding: { task: {
    title: "Tool health inspection", description,
    type: "inspection", risk
  } }, goal: "Inspect registered tool health" };
}

const unknown = authorizeWork({
  plan: makePlan(undefined), operation: "inspect", permissionGranted: true
});
assert.equal(unknown.allowed, false);
assert.equal(unknown.status, "approval_required");
assert.equal(unknown.reasonCode, "TASK_RISK_UNKNOWN");

for (const risk of ["medium", "high", "critical"]) {
  const result = authorizeWork({
    plan: makePlan(risk), operation: "inspect", permissionGranted: true
  });
  assert.equal(result.allowed, false);
  assert.equal(result.status, "approval_required");
  assert.equal(result.reasonCode, "TASK_RISK_REQUIRES_APPROVAL");
  assert.equal(result.risk, risk);
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

for (const result of [unknown, hard]) {
  const diagnostic = JSON.stringify({
    reasonCode: result.reasonCode, category: result.category,
    risk: result.risk, operation: result.operation,
    approvalRequired: result.approvalRequired
  });
  assert.equal(diagnostic.includes("security posture"), false);
  assert.equal(diagnostic.includes("inspect tool health"), false);
}
console.log("PASS tool-health-approval-diagnostic");
