"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT =
  path.resolve(__dirname, "..");

const LEARNING_FILE =
  path.join(
    PROJECT_ROOT,
    "data",
    "work-learning-records.json"
  );

const learning =
  require("../services/mira-work-learning-engine");

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8"
    )
  );
}

function writeJson(file, value) {
  fs.writeFileSync(
    file,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function pass(message) {
  console.log(
    `PASS: ${message}`
  );
}

function makeTask(id) {
  return {
    id,
    title:
      "Stage 6.4.2 controlled experience task",
    description:
      "Controlled task used to verify task, approach, and result recording.",
    type:
      "writing",
    requirements: [
      "Follow the supplied requirements.",
      "Produce the expected result."
    ],
    deliverables: [
      "Completed controlled result."
    ],
    requiredSkills: [
      "writing"
    ],
    risk:
      "low",
    status:
      "completed"
  };
}

function makePlan(task) {
  return {
    id:
      `${task.id}-plan`,
    version:
      1,
    taskId:
      task.id,
    goal:
      "Produce a controlled verified result.",
    requirements: [
      "Follow the supplied requirements.",
      "Produce the expected result."
    ],
    subtasks: [
      {
        id:
          `${task.id}-subtask-1`,
        title:
          "Prepare result",
        objective:
          "Prepare the requested result.",
        dependencies: [],
        inputs: [
          "Task requirements"
        ],
        outputs: [
          "Prepared result"
        ],
        verification: [
          "Check required output"
        ],
        order: 1
      }
    ],
    missingRequirements: [],
    feasibility:
      "feasible",
    feasibilityReasons: [
      "All required inputs are available."
    ],
    executionPlan: [
      {
        step: 1,
        subtaskId:
          `${task.id}-subtask-1`,
        action:
          "Prepare the controlled result.",
        expectedOutput:
          "Prepared result"
      }
    ],
    verificationPlan: [
      {
        checkId:
          "result-check",
        target:
          "controlled result",
        method:
          "inspect",
        expected:
          "result is present",
        required:
          true
      }
    ],
    deliverable: {
      type:
        "text",
      description:
        "Controlled text result.",
      outputs: [
        "controlled-result.txt"
      ],
      acceptanceCriteria: [
        "Result is present.",
        "Result follows requirements."
      ]
    },
    status:
      "validated",
    executionAllowed:
      false,
    planningOnly:
      true,
    createdAt:
      "2026-10-06T15:00:00.000Z",
    updatedAt:
      "2026-10-06T15:00:00.000Z",
    parentPlanId:
      null,
    replanningReason:
      null
  };
}

function makeExecution(task, plan) {
  return {
    success:
      true,
    stage:
      "5.4",
    status:
      "execution_completed",
    executionStarted:
      true,
    taskId:
      task.id,
    planId:
      plan.id,
    executionId:
      TEST_EXECUTION_ID,
    autonomousApproval:
      true,
    results: [
      {
        type:
          "text",
        status:
          "completed",
        output:
          "Controlled verified result."
      }
    ],
    recoveryRequired:
      false,
    recoveryReason:
      "",
    startedAt:
      "2026-10-06T15:01:00.000Z",
    completedAt:
      "2026-10-06T15:03:00.000Z"
  };
}

function makeQA(task, plan) {
  return {
    success:
      true,
    status:
      "qa_passed",
    stage:
      "6.1",
    engineVersion:
      "6.1.0",
    taskId:
      task.id,
    planId:
      plan.id,
    checks: [
      {
        name:
          "requirements",
        passed:
          true,
        reason:
          ""
      },
      {
        name:
          "deliverables",
        passed:
          true,
        reason:
          ""
      }
    ],
    failedChecks: [],
    reasons: [],
    reworkRequired:
      false,
    recoveryRequired:
      false,
    finalAcceptance:
      true,
    reworkContext:
      null,
    evaluatedAt:
      "2026-10-06T15:03:00.000Z"
  };
}

const TEST_TASK_ID =
  `stage642-task-${Date.now()}`;

const TEST_EXECUTION_ID =
  `stage642-execution-${Date.now()}`;

console.log(
  "STAGE 6.4.2 TASK/APPROACH/RESULT RECORDING E2E TEST"
);

const original =
  fs.readFileSync(
    LEARNING_FILE,
    "utf8"
  );

try {
  const task =
    makeTask(
      TEST_TASK_ID
    );

  const plan =
    makePlan(
      task
    );

  const execution =
    makeExecution(
      task,
      plan
    );

  const qa =
    makeQA(
      task,
      plan
    );

  const beforeStore =
    readJson(
      LEARNING_FILE
    );

  const beforeRecords =
    Array.isArray(
      beforeStore.records
    )
      ? beforeStore.records
      : [];

  const result =
    learning.learnFromWork({
      task,
      plan,
      executionResult:
        execution,
      qaResult:
        qa,
      feedback: {}
    });

  assert(
    result &&
      result.record,
    "learning result must contain a record"
  );

  const record =
    result.record;

  assert.strictEqual(
    record.taskId,
    TEST_TASK_ID
  );

  pass(
    "Task identity is recorded"
  );

  assert(
    record.task &&
      record.task.id ===
        TEST_TASK_ID,
    "task snapshot must be recorded"
  );

  pass(
    "Task snapshot is recorded"
  );

  assert(
    record.approach &&
      typeof record.approach ===
        "object",
    "approach snapshot must be recorded"
  );

  assert.strictEqual(
    record.approach.planId,
    plan.id
  );

  assert.strictEqual(
    record.approach.taskId,
    task.id
  );

  assert.strictEqual(
    record.approach.goal,
    plan.goal
  );

  assert(
    Array.isArray(
      record.approach.subtasks
    ),
    "approach subtasks must be an array"
  );

  assert(
    Array.isArray(
      record.approach.executionPlan
    ),
    "approach executionPlan must be an array"
  );

  assert(
    Array.isArray(
      record.approach.verificationPlan
    ),
    "approach verificationPlan must be an array"
  );

  assert(
    record.approach.deliverable &&
      typeof record.approach.deliverable ===
        "object",
    "approach deliverable must be recorded"
  );

  pass(
    "Approach snapshot is recorded from canonical task plan"
  );

  assert(
    record.execution &&
      typeof record.execution ===
        "object",
    "execution result must be recorded"
  );

  assert.strictEqual(
    record.execution.executionId,
    TEST_EXECUTION_ID
  );

  assert.strictEqual(
    record.execution.success,
    true
  );

  assert.strictEqual(
    record.execution.status,
    "execution_completed"
  );

  assert(
    Array.isArray(
      record.execution.results
    ),
    "execution results must be an array"
  );

  assert.strictEqual(
    record.execution.results[0].output,
    "Controlled verified result."
  );

  pass(
    "Execution result is recorded"
  );

  const persistedStore =
    readJson(
      LEARNING_FILE
    );

  const persistedRecords =
    Array.isArray(
      persistedStore.records
    )
      ? persistedStore.records
      : [];

  assert(
    persistedRecords.length >=
      beforeRecords.length + 1,
    "new learning record must be persisted"
  );

  const persisted =
    persistedRecords.find(
      item =>
        item.learningId ===
        record.learningId
    );

  assert(
    persisted,
    "persisted learning record must be retrievable"
  );

  assert(
    persisted.approach &&
      persisted.approach.planId ===
        plan.id,
    "persisted approach must survive storage"
  );

  assert(
    persisted.execution &&
      persisted.execution.executionId ===
        TEST_EXECUTION_ID,
    "persisted execution result must survive storage"
  );

  pass(
    "Task/approach/result data persists correctly"
  );

  const integrity =
    learning.verifyLearningRecordIntegrity(
      persisted.learningId
    );

  assert.strictEqual(
    integrity.success,
    true
  );

  assert.strictEqual(
    integrity.valid,
    true
  );

  pass(
    "Learning record integrity remains valid"
  );

  const reread =
    learning.getLearningRecord(
      record.learningId
    );

  assert(
    reread,
    "learning record must be retrievable by ID"
  );

  assert.strictEqual(
    reread.approach.planId,
    plan.id
  );

  assert.strictEqual(
    reread.execution.executionId,
    TEST_EXECUTION_ID
  );

  pass(
    "Recorded experience is retrievable through learning engine"
  );

  console.log(
    "\nSTAGE6_4_2_TASK_APPROACH_RESULT_RECORDING: PASS"
  );
} catch (error) {
  console.error(
    "FAIL:",
    error &&
      error.stack
      ? error.stack
      : String(error)
  );

  process.exitCode = 1;
} finally {
  /*
   * This test must not leave test data in the production
   * learning store.
   */
  writeJson(
    LEARNING_FILE,
    JSON.parse(
      original
    )
  );
}
