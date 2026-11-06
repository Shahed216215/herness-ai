"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const isolatedDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-work-auth-integration-")
);
process.env.MIRA_AUDIT_FILE = path.join(isolatedDir, "audit-log.json");

async function main() {
  try {
    const { executeWork } = require("../services/mira-work-execution-engine");
    const sensitiveMarker = "PRIVATE_TASK_TEXT_MUST_NOT_LEAK_71";

    const plan = {
      taskId: "tool-health-authorization-integration",
      goal: "Inspect registered tool health",
      status: "validated",
      feasibility: "feasible",
      subtasks: [
        { id: "subtask-1", dependencies: [] }
      ],
      executionPlan: [
        {
          step: 1,
          subtaskId: "subtask-1",
          action: "Inspect tool health",
          expectedOutput: "Tool health inspection result"
        }
      ],
      deliverable: {
        description: "Tool health inspection result",
        acceptanceCriteria: ["Authorization is enforced before execution."]
      },
      verificationPlan: [
        { checkId: "check-1", required: true }
      ],
      executionAllowed: false,
      planningOnly: true
    };

    const result = await executeWork(
      "Inspect registered tool health",
      {
        plan,
        taskUnderstanding: {
          task: {
            title: "Tool health approval integration test",
            description: sensitiveMarker,
            type: "inspection",
            risk: "medium"
          }
        },
        toolCalls: [
          { name: "tool_health", args: {} }
        ],
        permissionGranted: true
      }
    );

    assert.equal(result.success, false);
    assert.equal(result.status, "approval_required");
    assert.equal(result.executionStarted, false);
    assert.equal(result.tool, "tool_health");

    assert.equal(result.authorization?.diagnostic?.version, 1);
    assert.equal(
      result.authorization?.diagnostic?.decisionStage,
      "work_authorization"
    );
    assert.equal(
      result.authorization?.diagnostic?.reasonCode,
      "TASK_RISK_REQUIRES_APPROVAL"
    );
    assert.equal(result.authorization?.diagnostic?.risk, "medium");
    assert.equal(result.authorization?.diagnostic?.approvalRequired, true);

    assert.equal(result.failureAudit?.status, "blocked");
    assert.equal(
      result.failureAudit?.details?.workAuthDiagnostic?.reasonCode,
      "TASK_RISK_REQUIRES_APPROVAL"
    );

    const persistedAudit = fs.readFileSync(
      process.env.MIRA_AUDIT_FILE,
      "utf8"
    );
    assert.equal(persistedAudit.includes(sensitiveMarker), false);
    assert.equal(
      JSON.stringify(result.authorization.diagnostic).includes(sensitiveMarker),
      false
    );
    assert.equal(
      JSON.stringify(result.failureAudit).includes(sensitiveMarker),
      false
    );

    console.log("PASS tool-health-authorization-engine-integration");
  } finally {
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
