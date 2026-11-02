"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  executeQualityLearningHandoff,
  resolveTask,
  ENGINE_VERSION
} = require("../services/mira-work-quality-learning-handoff");

const TASK_FILE =
  path.join(
    __dirname,
    "..",
    "data",
    "tasks.json"
  );

const LEARNING_FILE =
  path.join(
    __dirname,
    "..",
    "data",
    "work-learning-records.json"
  );

function readFileSafe(file) {
  return fs.existsSync(file)
    ? fs.readFileSync(file, "utf8")
    : null;
}

function restoreFile(file, snapshot) {
  if (snapshot === null) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    return;
  }

  fs.writeFileSync(
    file,
    snapshot
  );
}

async function main() {
  const taskSnapshot =
    readFileSafe(TASK_FILE);

  const learningSnapshot =
    readFileSafe(LEARNING_FILE);

  try {
    console.log(
      "\nSTAGE 6.2.2 INTEGRATION/HANDOFF E2E TEST\n"
    );

    const task = {
      id: "task-stage62-handoff",
      title: "Stage 6.2 handoff verification",
      description:
        "Verify execution to QA to learning handoff.",
      type: "task_result",
      requirements: [
        "preserve task identity",
        "run QA",
        "record learning"
      ],
      deliverables: [
        "handoff evidence"
      ],
      risk: "low"
    };

    const plan = {
      id: "plan-stage62-handoff",
      version: 1,
      taskId: task.id,
      goal:
        "Verify Stage 5.4 to 6.1 to 6.2 handoff.",
      requirements:
        task.requirements,
      deliverables:
        task.deliverables,
      subtasks: [],
      executionPlan: [],
      verificationPlan: [],
      deliverable: {},
      status: "validated",
      feasibility: "feasible",
      executionAllowed: true
    };

    const executionResult = {
      success: true,
      stage: "5.4",
      status: "execution_completed",
      executionStarted: true,
      taskId: task.id,
      planId: plan.id,
      results: [
        {
          success: true,
          status: "completed",
          output: "handoff test result",
          qaEvidence: {
            requirementsAddressed:
              task.requirements,
            acceptanceCriteriaSatisfied: true,
            deliverablesComplete: true,
            qualityAccepted: true,
            consistencyValid: true,
            securitySafe: true
          }
        }
      ],
      recoveryRequired: false
    };

    const qaResult = {
      status: "qa_passed",
      finalAcceptance: true,
      rework: {
        reworkRequired: false,
        recoveryRequired: false
      },
      failedChecks: 0
    };

    const learningResult = {
      success: true,
      stage: "6.2",
      engineVersion: "6.2.1",
      status: "no_improvement_proposed",
      learningId:
        "learning-stage62-handoff",
      executionId:
        "execution-stage62-handoff",
      proposal: null,
      proposalDuplicate: false,
      record: {
        learningId:
          "learning-stage62-handoff",
        executionId:
          "execution-stage62-handoff",
        status:
          "no_improvement_proposed"
      }
    };

    const result =
      await executeQualityLearningHandoff(
        {
          task,
          plan,
          executionResult,
          qaResult,
          learningResult
        },
        {
          persist: false,
          persistAudit: false
        }
      );

    assert.strictEqual(
      result.success,
      true
    );

    assert.strictEqual(
      result.stage,
      "6.2"
    );

    assert.strictEqual(
      result.engineVersion,
      ENGINE_VERSION
    );

    assert.strictEqual(
      result.taskId,
      task.id
    );

    assert.strictEqual(
      result.planId,
      plan.id
    );

    assert.strictEqual(
      result.execution,
      executionResult
    );

    assert.strictEqual(
      result.qualityAssurance,
      qaResult
    );

    assert.strictEqual(
      result.learning,
      learningResult
    );

    assert.strictEqual(
      result.governanceBoundary.approvalRequired,
      true
    );

    assert.strictEqual(
      result.governanceBoundary.autoApproved,
      false
    );

    assert.strictEqual(
      result.governanceBoundary.autoApplied,
      false
    );

    assert.strictEqual(
      result.governanceBoundary.proposalCreated,
      false
    );

    console.log(
      "PASS: 5.4 execution evidence preserved"
    );

    console.log(
      "PASS: 6.1 QA evidence preserved"
    );

    console.log(
      "PASS: 6.2 learning evidence preserved"
    );

    console.log(
      "PASS: taskId preserved across handoff"
    );

    console.log(
      "PASS: planId preserved across handoff"
    );

    console.log(
      "PASS: proposal approval boundary preserved"
    );

    console.log(
      "PASS: automatic approval disabled"
    );

    console.log(
      "PASS: automatic apply disabled"
    );

    /*
     * Resolver contract:
     * canonical task must win when taskId exists.
     */
    const resolved =
      resolveTask(
        {
          task: {
            id: task.id,
            title: "request copy"
          },
          plan
        },
        executionResult
      );

    assert.strictEqual(
      resolved.id,
      task.id
    );

    console.log(
      "PASS: canonical task identity resolver works"
    );

    /*
     * Invalid handoff must be rejected before
     * execution/QA/learning.
     */
    const rejected =
      await executeQualityLearningHandoff(
        {
          task,
          plan: {
            id: "invalid-plan"
          }
        },
        {
          persist: false,
          persistAudit: false
        }
      );

    assert.strictEqual(
      rejected.success,
      false
    );

    assert.strictEqual(
      rejected.status,
      "handoff_rejected"
    );

    console.log(
      "PASS: invalid plan handoff rejected"
    );

    console.log(
      "\nSTAGE6_2_INTEGRATION_HANDOFF_E2E_TEST: PASS\n"
    );
  } finally {
    restoreFile(
      TASK_FILE,
      taskSnapshot
    );

    restoreFile(
      LEARNING_FILE,
      learningSnapshot
    );

    console.log(
      "PASS: pre-test local state restored"
    );
  }
}

main().catch(error => {
  console.error(
    "\nSTAGE6_2_INTEGRATION_HANDOFF_E2E_TEST: FAIL\n"
  );

  console.error(
    error && error.stack
      ? error.stack
      : error
  );

  process.exitCode = 1;
});
