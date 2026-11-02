"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const stage14StoreDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-stage14-isolated-")
);

process.env.MIRA_LEARNING_FILE =
  path.join(stage14StoreDir, "work-learning-records.json");
process.env.MIRA_CHANGE_FILE =
  path.join(stage14StoreDir, "change-proposals.json");
process.env.MIRA_AUDIT_FILE =
  path.join(stage14StoreDir, "audit-log.json");

process.on("exit", () => {
  try {
    fs.rmSync(stage14StoreDir, {
      recursive: true,
      force: true
    });
  } catch (error) {
    console.error("Temporary test-store cleanup failed:", error.message);
    process.exitCode = 1;
  }
});

const learning = require("../services/mira-work-learning-engine");
const changes = require("../change-management");
const audit = require("../audit-log");

let checks = 0;

function check(label, fn) {
  fn();
  checks++;
  console.log("PASS " + label);
}

function workInput(taskId, executionId, overrides = {}) {
  const task = {
    id: taskId,
    title: "Prepare a client research report",
    description: "Research and prepare a report",
    requirements: ["Verify every requirement", "Check quality"],
    deliverables: ["research-report.md"],
    requiredSkills: ["research", "quality-control"],
    type: "research-report"
  };

  const executionResult = {
    taskId,
    executionId,
    planId: "plan-" + taskId,
    success: true,
    status: "completed",
    results: [{ type: "deliverable", status: "created" }],
    completedAt: new Date().toISOString()
  };

  const qaResult = {
    taskId,
    planId: "plan-" + taskId,
    status: "qa_failed",
    success: false,
    failedChecks: ["requirements", "quality"],
    reworkRequired: true
  };

  const feedback = {
    provided: true,
    summary: "The report needs more complete requirement checks.",
    positive: [],
    negative: ["Some requirements were not verified"],
    requestedChanges: ["Add explicit requirement verification"]
  };

  return {
    task: { ...task, ...(overrides.task || {}) },
    executionResult: {
      ...executionResult,
      ...(overrides.executionResult || {})
    },
    qaResult: {
      ...qaResult,
      ...(overrides.qaResult || {})
    },
    feedback: {
      ...feedback,
      ...(overrides.feedback || {})
    }
  };
}

function main() {
  check("Required learning APIs exist", () => {
    for (const name of [
      "learnFromWork",
      "getLearningRecord",
      "listLearningRecords",
      "verifyLearningRecordIntegrity",
      "findDuplicateProposal",
      "getLearningStats"
    ]) {
      assert.strictEqual(typeof learning[name], "function", name);
    }
  });

  check("Isolated learning and proposal stores start empty", () => {
    assert.strictEqual(learning.listLearningRecords().length, 0);
    assert.strictEqual(changes.listProposals({
      category: "self_improvement"
    }).length, 0);
  });

  const first = learning.learnFromWork(
    workInput("stage14-task-001", "stage14-exec-001")
  );

  check("Real work input produces a learning record", () => {
    assert.strictEqual(first.success, true);
    assert.ok(first.record);
    assert.ok(first.learningId);
    assert.ok(first.record.lessons.length > 0);
    assert.ok(first.record.knowledgeCandidates.length > 0);
  });

  check("QA failure creates an improvement proposal", () => {
    assert.strictEqual(first.status, "proposal_created");
    assert.ok(first.proposal);
    assert.strictEqual(first.proposal.category, "self_improvement");
    assert.ok(first.proposal.changeId);
  });

  check("Proposal remains subject to human approval", () => {
    assert.strictEqual(first.record.governance.approvalRequired, true);
    assert.strictEqual(first.record.governance.autoApplied, false);
    assert.ok(
      !["approved", "complete"].includes(first.proposal.status),
      "Learning must not approve or complete its own proposal"
    );
  });

  check("Persisted learning record matches returned record", () => {
    const stored = learning.getLearningRecord(first.learningId);
    assert.ok(stored);
    assert.strictEqual(stored.taskId, first.record.taskId);
    assert.strictEqual(stored.governance.autoApplied, false);
  });

  check("Learning record integrity verifies", () => {
    const result = learning.verifyLearningRecordIntegrity(first.learningId);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.valid, true);
  });

  check("Same task and execution are not learned twice", () => {
    const before = learning.listLearningRecords().length;
    const duplicate = learning.learnFromWork(
      workInput("stage14-task-001", "stage14-exec-001")
    );
    assert.strictEqual(duplicate.status, "duplicate");
    assert.strictEqual(duplicate.duplicate, true);
    assert.strictEqual(learning.listLearningRecords().length, before);
  });

  check("Invalid mismatched task IDs are rejected", () => {
    const bad = learning.learnFromWork(
      workInput("stage14-task-bad", "stage14-exec-bad", {
        executionResult: { taskId: "wrong-task" }
      })
    );
    assert.strictEqual(bad.success, false);
    assert.strictEqual(bad.status, "rejected_input");
  });

  check("QA-passed work without improvement signal makes no proposal", () => {
    const input = workInput("stage14-task-002", "stage14-exec-002", {
      qaResult: {
        status: "qa_passed",
        success: true,
        failedChecks: [],
        reworkRequired: false
      },
      feedback: {
        provided: false,
        requestedChanges: [],
        negative: []
      }
    });
    const result = learning.learnFromWork(input);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, "no_improvement_proposed");
    assert.strictEqual(result.proposal, null);
    assert.strictEqual(result.record.governance.autoApplied, false);
  });

  check("Duplicate improvement fingerprint is detected", () => {
    const duplicate = learning.findDuplicateProposal(first.record);
    assert.ok(duplicate);
    assert.strictEqual(duplicate.changeId, first.proposal.changeId);
  });

  check("Audit contains the work-learning event", () => {
    const entries = audit.getAuditLog(100);
    assert.ok(entries.some(entry =>
      entry.action === "work_learning_recorded" &&
      entry.resourceId === first.learningId
    ));
  });

  check("Audit hash chain verifies", () => {
    const result = audit.verifyAuditIntegrity();
    assert.strictEqual(result.ok, true, JSON.stringify(result.failures));
  });

  check("Learning statistics reflect recorded work", () => {
    const stats = learning.getLearningStats();
    assert.ok(stats.total >= 2);
    assert.ok(stats.proposalCreated >= 1);
    assert.ok(stats.noImprovementProposed >= 1);
  });

  console.log("STAGE14_SELF_IMPROVEMENT_LOOP_E2E: PASS");
  console.log("ASSERTIONS_PASSED=" + checks);
}

try {
  main();
} catch (error) {
  console.error("STAGE14_SELF_IMPROVEMENT_LOOP_E2E: FAIL");
  console.error(error && error.stack || error);
  process.exitCode = 1;
}
