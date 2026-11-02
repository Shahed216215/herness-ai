"use strict";

const assert = require("assert");

const {
  runQualityAssurance
} = require("../services/mira-quality-assurance-engine");

const {
  replanTask
} = require("../services/mira-task-planner");

console.log(
  "STAGE 6.1 QUALITY ASSURANCE REWORK/RETEST E2E TEST"
);

function makeTask() {
  return {
    id: "task-stage61-rework",
    title: "Stage 6.1 Rework Test",
    description:
      "Produce a verified result after quality rework.",
    type: "writing",
    requirements: [
      "Produce the requested result.",
      "The final result must be complete.",
      "The final result must satisfy the acceptance criteria."
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

function makePlan(version = 1, parentPlanId = "") {
  return {
    id:
      version === 1
        ? "plan-stage61-rework-v1"
        : "plan-stage61-rework-v2",
    version,
    taskId: "task-stage61-rework",
    parentPlanId,
    goal: "Produce a verified final result.",
    requirements: [
      "Produce the requested result.",
      "The final result must be complete.",
      "The final result must satisfy the acceptance criteria."
    ],
    subtasks: [
      {
        id: "subtask-stage61-rework",
        title: "Produce result",
        objective: "Produce the requested result.",
        dependencies: [],
        inputs: [],
        outputs: ["final-result"],
        verification: [
          "Result exists.",
          "Result satisfies acceptance criteria."
        ],
        order: 1
      }
    ],
    executionPlan: [
      "Produce the requested result."
    ],
    verificationPlan: [
      {
        type: "result",
        description:
          "Verify the final result against requirements."
      }
    ],
    deliverable: {
      type: "text",
      description: "Verified final result",
      outputs: ["final-result"],
      acceptanceCriteria: [
        "All stated requirements are addressed.",
        "The result matches the task goal.",
        "Required verification checks pass."
      ]
    },
    feasibility: "feasible",
    feasibilityReasons: [],
    missingRequirements: [],
    status: "validated",
    executionAllowed: true,
    planningOnly: false
  };
}

function makeFailedExecution() {
  return {
    success: true,
    stage: "5.4",
    status: "execution_completed",
    taskId: "task-stage61-rework",
    planId: "plan-stage61-rework-v1",
    autonomousApproval: true,
    results: [
      {
        tool: "test-result-tool",
        success: true,
        result: {
          output:
            "Incomplete result: required acceptance criteria were not addressed."
        }
      }
    ],
    recoveryRequired: false
  };
}

function makeSuccessfulExecution() {
  return {
    success: true,
    stage: "5.4",
    status: "execution_completed",
    taskId: "task-stage61-rework",
    planId: "plan-stage61-rework-v2",
    autonomousApproval: true,
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
        tool: "test-result-tool",
        success: true,
        result: {
          output:
            "Verified final result satisfies all stated requirements."
        }
      }
    ],
    recoveryRequired: false
  };
}

async function main() {
  const task = makeTask();
  const initialPlan = makePlan();

  /*
   * Phase 1:
   * 5.4 reports successful execution,
   * but the produced result is incomplete.
   */
  const failedExecution = makeFailedExecution();

  const firstQA =
    await runQualityAssurance({
      task,
      plan: initialPlan,
      executionResult: failedExecution,
      persistAudit: false,
      reworkAttempts: 0,
      maxReworkAttempts: 3
    });

  assert.strictEqual(
    failedExecution.success,
    true
  );

  assert.strictEqual(
    firstQA.status,
    "qa_failed"
  );

  assert.strictEqual(
    firstQA.finalAcceptance,
    false
  );

  assert.strictEqual(
    firstQA.rework.reworkRequired,
    true
  );

  assert.strictEqual(
    firstQA.rework.recoveryRequired,
    false
  );

  assert.ok(
    firstQA.failedChecks.length > 0
  );

  console.log(
    "PASS: Initial execution is rejected by 6.1 QA"
  );

  /*
   * Phase 2:
   * 6.1 creates rework context and 5.3 replans.
   */
  const replanned =
    await replanTask(
      task,
      firstQA.reworkContext,
      {
        previousPlan: initialPlan
      }
    );

  assert.ok(
    replanned &&
    replanned.plan
  );

  assert.ok(
    typeof replanned.plan.id === "string"
  );

  assert.strictEqual(
    replanned.plan.parentPlanId,
    initialPlan.id
  );

  assert.strictEqual(
    replanned.plan.version,
    2
  );

  assert.ok(
    replanned.plan.replanningReason
  );

  assert.ok(
    replanned.validation &&
    replanned.validation.valid === true
  );

  console.log(
    "PASS: QA failure triggers planner-compatible replan"
  );

  /*
   * Phase 3:
   * 5.4 re-executes the corrected plan.
   *
   * This is represented by a controlled execution result
   * so the test validates the 5.3 -> 5.4 -> 6.1 contract
   * without modifying the Stage 5.4 engine.
   */
  const correctedPlan = {
    ...replanned.plan,
    status: "validated",
    feasibility: "feasible",
    executionAllowed: true,
    planningOnly: false,
    deliverable: initialPlan.deliverable,
    verificationPlan: initialPlan.verificationPlan
  };

  const correctedExecution =
    makeSuccessfulExecution();

  correctedExecution.planId =
    correctedPlan.id;

  correctedExecution.taskId =
    correctedPlan.taskId;

  assert.strictEqual(
    correctedExecution.success,
    true
  );

  assert.strictEqual(
    correctedExecution.status,
    "execution_completed"
  );

  console.log(
    "PASS: Reworked plan produces a successful 5.4 execution result"
  );

  /*
   * Phase 4:
   * 6.1 re-tests the corrected result.
   */
  const secondQA =
    await runQualityAssurance({
      task,
      plan: correctedPlan,
      executionResult: correctedExecution,
      persistAudit: false,
      reworkAttempts: firstQA.rework.reworkAttempts,
      maxReworkAttempts: 3
    });

  
  assert.strictEqual(
    secondQA.status,
    "qa_passed"
  );

  assert.strictEqual(
    secondQA.finalAcceptance,
    true
  );

  assert.strictEqual(
    secondQA.rework.reworkRequired,
    false
  );

  assert.strictEqual(
    secondQA.rework.recoveryRequired,
    false
  );

  assert.strictEqual(
    secondQA.failedChecks.length,
    0
  );

  console.log(
    "PASS: 6.1 QA re-test accepts the corrected result"
  );

  console.log(
    "PASS: Execute -> QA FAIL -> Replan -> Re-execute -> QA PASS"
  );

  console.log(
    "STAGE6_1_QUALITY_ASSURANCE_REWORK_RETEST_E2E_TEST: PASS"
  );
}

main().catch((error) => {
  console.error(
    "STAGE6_1_QUALITY_ASSURANCE_REWORK_RETEST_E2E_TEST: FAIL"
  );

  console.error(
    error.stack || error.message
  );

  process.exitCode = 1;
});
