"use strict";

const assert = require("assert");

const {
  runQualityAssurance
} = require("../services/mira-quality-assurance-engine");

const {
  replanTask
} = require("../services/mira-task-planner");

function makeTask() {
  return {
    id: "task-stage61-integration",
    title: "Stage 6.1 Integration E2E",
    description:
      "Produce and verify a required task result.",
    type: "writing",
    requirements: [
      "Return the required result",
      "Address all stated requirements",
      "Return a usable final output"
    ],
    deliverables: [
      {
        type: "text",
        description: "Verified final result"
      }
    ],
    status: "active"
  };
}

function makePlan(version = 1) {
  return {
    id: `plan-stage61-integration-v${version}`,
    version,
    taskId: "task-stage61-integration",
    goal: "Produce the required verified result.",
    requirements: [
      "Return the required result",
      "Address all stated requirements",
      "Return a usable final output"
    ],
    subtasks: [
      {
        id: "subtask-1",
        title: "Produce result",
        objective: "Produce the required result.",
        verification: [
          "Result exists",
          "Result satisfies task requirements"
        ],
        order: 1
      }
    ],
    executionPlan: [
      {
        subtaskId: "subtask-1",
        order: 1
      }
    ],
    verificationPlan: [
      {
        checkId: "goal",
        description: "Verify task goal",
        required: true
      },
      {
        checkId: "requirements",
        description: "Verify task requirements",
        required: true
      },
      {
        checkId: "deliverable",
        description: "Verify final deliverable",
        required: true
      }
    ],
    deliverable: {
      type: "text",
      description: "Verified final result",
      outputs: ["result"],
      acceptanceCriteria: [
        "All stated requirements are addressed.",
        "The result matches the task goal.",
        "Required verification checks pass.",
        "No unapproved irreversible action is performed."
      ]
    },
    status: "ready_for_execution",
    executionAllowed: true,
    planningOnly: false
  };
}

function makeSuccessfulExecution() {
  return {
    success: true,
    stage: "5.4",
    status: "execution_completed",
    taskId: "task-stage61-integration",
    planId: "plan-stage61-integration-v1",
    qaEvidence: {
      requirementsAddressed: true,
      acceptanceCriteriaSatisfied: true,
      deliverablesComplete: true,
      qualityAccepted: true,
      consistencyValid: true,
      securitySafe: true
    },
    results: [
      {
        tool: "controlled_test_tool",
        success: true,
        result: {
          output:
            "Required result produced successfully.",
          safe: true,
          authorized: true
        }
      }
    ],
    recoveryRequired: false
  };
}

function makeBadExecution() {
  return {
    success: true,
    stage: "5.4",
    status: "execution_completed",
    taskId: "task-stage61-integration",
    planId: "plan-stage61-integration-v1",
    results: [],
    recoveryRequired: false
  };
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

console.log("STAGE 6.1 QUALITY ASSURANCE INTEGRATION E2E TEST");

const task = makeTask();
const plan = makePlan();

async function main() {
  let failed = false;

  async function runSequentialTest(name, fn) {
    try {
      await fn();
      console.log(`PASS: ${name}`);
    } catch (error) {
      failed = true;
      console.error(`FAIL: ${name}`);
      console.error(error.stack || error.message);
    }
  }

  await runSequentialTest(
    "Stage 5.4 successful execution is accepted by Stage 6.1",
    async () => {
      const executionResult =
        makeSuccessfulExecution();

      const qaResult =
        await runQualityAssurance({
          task,
          plan,
          executionResult,
          persistAudit: false,
          reworkAttempts: 0,
          maxReworkAttempts: 3
        });

      assert.strictEqual(
        executionResult.success,
        true
      );

      assert.strictEqual(
        qaResult.status,
        "qa_passed"
      );

      assert.strictEqual(
        qaResult.finalAcceptance,
        true
      );

      assert.strictEqual(
        qaResult.rework.reworkRequired,
        false
      );
    }
  );

  await runSequentialTest(
    "Execution success alone cannot produce final acceptance",
    async () => {
      const executionResult =
        makeBadExecution();

      const qaResult =
        await runQualityAssurance({
          task,
          plan,
          executionResult,
          persistAudit: false,
          reworkAttempts: 0,
          maxReworkAttempts: 3
        });

      assert.strictEqual(
        executionResult.success,
        true
      );

      assert.strictEqual(
        qaResult.status,
        "qa_failed"
      );

      assert.strictEqual(
        qaResult.finalAcceptance,
        false
      );

      assert.strictEqual(
        qaResult.rework.reworkRequired,
        true
      );

      assert.ok(
        qaResult.failedChecks.length > 0
      );
    }
  );

  await runSequentialTest(
    "QA failure produces planner-compatible rework context",
    async () => {
      const executionResult =
        makeBadExecution();

      const qaResult =
        await runQualityAssurance({
          task,
          plan,
          executionResult,
          persistAudit: false,
          reworkAttempts: 0,
          maxReworkAttempts: 3
        });

      assert.strictEqual(
        qaResult.status,
        "qa_failed"
      );

      const replanned =
        await replanTask(
          task,
          qaResult.reworkContext,
          {
            previousPlan: plan
          }
        );

      assert.ok(
        replanned &&
        replanned.plan
      );

      assert.ok(
        typeof replanned.plan.taskId === "string"
      );

      assert.strictEqual(
        replanned.plan.taskId,
        task.id
      );

      assert.strictEqual(
        replanned.plan.parentPlanId,
        plan.id
      );

      assert.strictEqual(
        replanned.plan.version,
        2
      );

      assert.ok(
        replanned.plan.status === "validated" ||
        replanned.plan.status === "blocked"
      );

      assert.ok(
        replanned.plan.feasibility === "feasible" ||
        replanned.plan.feasibility === "blocked_missing_requirements"
      );

      assert.ok(
        replanned.validation &&
        replanned.validation.valid === true
      );

      assert.ok(
        replanned.plan.replanningReason
      );

      assert.ok(
        replanned.plan.replanningReason.includes(
          "Previous failure:"
        )
      );
    }
  );

  await runSequentialTest(
    "Final sanity QA pass",
    async () => {
      const executionResult =
        makeSuccessfulExecution();

      const qaResult =
        await runQualityAssurance({
          task,
          plan,
          executionResult,
          persistAudit: false,
          reworkAttempts: 0,
          maxReworkAttempts: 3
        });

      assert.strictEqual(
        qaResult.status,
        "qa_passed"
      );

      assert.strictEqual(
        qaResult.finalAcceptance,
        true
      );
    }
  );

  if (failed) {
    console.error(
      "STAGE6_1_QUALITY_ASSURANCE_INTEGRATION_E2E_TEST: FAIL"
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    "STAGE6_1_QUALITY_ASSURANCE_INTEGRATION_E2E_TEST: PASS"
  );
}

main().catch((error) => {
  console.error(
    "STAGE6_1_QUALITY_ASSURANCE_INTEGRATION_E2E_TEST: FAIL"
  );
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
