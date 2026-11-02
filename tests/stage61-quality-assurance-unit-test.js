"use strict";

const assert = require("assert");

const {
  ENGINE_VERSION,
  QA_CHECKS,
  evaluateQuality,
  createReworkDecision,
  buildReworkContext
} = require("../services/mira-quality-assurance-engine");

function makeTask() {
  return {
    id: "task-stage61-unit",
    title: "Stage 6.1 QA Unit Test",
    description: "Validate QA engine behavior.",
    requirements: [
      "Return the required result",
      "Use the required output format"
    ],
    deliverables: [
      {
        type: "text",
        description: "Final verified result"
      }
    ]
  };
}

function makePlan() {
  return {
    id: "plan-stage61-unit",
    version: 1,
    taskId: "task-stage61-unit",
    goal: "Produce the required verified result.",
    requirements: [
      "Return the required result",
      "Use the required output format"
    ],
    deliverable: {
      type: "text",
      description: "Final verified result",
      outputs: ["result"],
      acceptanceCriteria: [
        "All stated requirements are addressed.",
        "The result matches the task goal.",
        "Required verification checks pass.",
        "No unapproved irreversible action is performed."
      ]
    },
    verificationPlan: [
      {
        name: "goal",
        description: "Verify task goal"
      },
      {
        name: "requirements",
        description: "Verify requirements"
      }
    ]
  };
}

function makeExecutionResult(overrides = {}) {
  return {
    success: true,
    status: "execution_completed",
    stage: "5.4",
    taskId: "task-stage61-unit",
    planId: "plan-stage61-unit",
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
        tool: "calculator",
        success: true,
        result: {
          value: 42
        }
      }
    ],
    ...overrides
  };
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

console.log("STAGE 6.1 QUALITY ASSURANCE UNIT TEST");
console.log(`ENGINE_VERSION=${ENGINE_VERSION}`);

assert.strictEqual(ENGINE_VERSION, "6.1.0");
assert.strictEqual(QA_CHECKS.length, 8);

runTest("All 8 QA checks are registered", () => {
  assert.deepStrictEqual(QA_CHECKS, [
    "completeness",
    "correctness",
    "requirements",
    "output_format",
    "quality",
    "consistency",
    "security_safety",
    "final_acceptance"
  ]);
});

runTest("Valid execution result passes QA", () => {
  const result = evaluateQuality({
    task: makeTask(),
    plan: makePlan(),
    executionResult: makeExecutionResult()
  });

  assert.strictEqual(result.status, "qa_passed");
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.reworkRequired, false);
  assert.deepStrictEqual(result.failedChecks, []);
});

runTest("Missing execution result fails QA", () => {
  const result = evaluateQuality({
    task: makeTask(),
    plan: makePlan(),
    executionResult: null
  });

  assert.strictEqual(result.status, "qa_failed");
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reworkRequired, true);
  assert.ok(result.failedChecks.length > 0);
});

runTest("Requirement mismatch fails QA", () => {
  const task = makeTask();

  const result = evaluateQuality({
    task,
    plan: makePlan(),
    executionResult: makeExecutionResult({
      results: []
    })
  });

  assert.strictEqual(result.status, "qa_failed");
  assert.strictEqual(result.success, false);
  assert.ok(result.failedChecks.includes("completeness"));
});

runTest("Execution success alone cannot force QA pass", () => {
  const result = evaluateQuality({
    task: makeTask(),
    plan: {
      ...makePlan(),
      deliverable: {
        type: "text",
        description: "Missing acceptance criteria",
        outputs: [],
        acceptanceCriteria: []
      }
    },
    executionResult: makeExecutionResult()
  });

  assert.strictEqual(result.status, "qa_failed");
  assert.strictEqual(result.success, false);
});

runTest("QA failure produces bounded rework decision", () => {
  const qaResult = evaluateQuality({
    task: makeTask(),
    plan: makePlan(),
    executionResult: null
  });

  const decision = createReworkDecision(qaResult, {
    reworkAttempt: 0,
    maxReworkAttempts: 3
  });

  assert.strictEqual(decision.status, "rework_required");
  assert.strictEqual(decision.reworkRequired, true);
  assert.strictEqual(decision.recoveryRequired, false);
  assert.strictEqual(decision.reworkAttempts, 1);
});

runTest("Rework context is compatible with planner flow", () => {
  const qaResult = evaluateQuality({
    task: makeTask(),
    plan: makePlan(),
    executionResult: null
  });

  const decision = createReworkDecision(qaResult, {
    reworkAttempt: 0,
    maxReworkAttempts: 3
  });

  const context = buildReworkContext(
    makeTask(),
    makePlan(),
    qaResult,
    decision
  );

  assert.strictEqual(context.taskId, "task-stage61-unit");
  assert.strictEqual(context.previousPlanId, "plan-stage61-unit");
  assert.strictEqual(context.previousVersion, 1);
  assert.strictEqual(context.reworkAttempt, 1);
  assert.strictEqual(context.maxReworkAttempts, 3);
  assert.ok(typeof context.failure === "string");
  assert.ok(context.failure.length > 0);
  assert.ok(Array.isArray(context.recommendedActions));
});

runTest("Rework limit produces recovery_required", () => {
  const qaResult = evaluateQuality({
    task: makeTask(),
    plan: makePlan(),
    executionResult: null
  });

  const decision = createReworkDecision(qaResult, {
    reworkAttempts: 3,
    maxReworkAttempts: 3
  });

  assert.strictEqual(decision.status, "recovery_required");
  assert.strictEqual(decision.recoveryRequired, true);
  assert.strictEqual(decision.reworkRequired, false);
});

if (process.exitCode === 1) {
  console.error("STAGE6_1_QUALITY_ASSURANCE_UNIT_TEST: FAIL");
} else {
  console.log("STAGE6_1_QUALITY_ASSURANCE_UNIT_TEST: PASS");
}
