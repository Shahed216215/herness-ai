"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const learning =
  require("../services/mira-work-learning-engine");

const experience =
  require("../services/mira-experience-memory");

const LEARNING_FILE =
  path.join(
    __dirname,
    "..",
    "data",
    "work-learning-records.json"
  );

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, "utf8")
  );
}

function writeJson(file, data) {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2) + "\n"
  );
}

function snapshotFile(file) {
  return fs.readFileSync(file, "utf8");
}

function restoreFile(file, content) {
  fs.writeFileSync(file, content);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

const before =
  snapshotFile(LEARNING_FILE);

const task = {
  id:
    "stage643-task-feedback-performance",
  type: "research",
  title:
    "Evaluate feedback and performance",
  goal:
    "Record feedback and QA performance",
  requirements: [
    "Return a structured result"
  ],
  deliverables: [
    "structured-result"
  ],
  risk: "low"
};

const plan = {
  id:
    "stage643-plan-feedback-performance",
  version: 1,
  taskId: task.id,
  goal: task.goal,
  requirements: task.requirements,
  subtasks: [
    {
      id: "subtask-1",
      title: "Produce result",
      objective: "Produce the requested result",
      dependencies: [],
      inputs: [],
      outputs: ["structured-result"],
      verification: [],
      order: 1
    }
  ],
  missingRequirements: [],
  feasibility: "feasible",
  feasibilityReasons: [],
  executionPlan: [
    {
      step: 1,
      subtaskId: "subtask-1",
      action: "Produce structured result",
      expectedOutput: "structured-result"
    }
  ],
  verificationPlan: [],
  deliverable: {
    type: "document",
    description: "Structured result",
    outputs: ["structured-result"],
    acceptanceCriteria: ["Result is complete"]
  },
  status: "ready_for_execution",
  executionAllowed: false,
  planningOnly: true,
  createdAt: "2026-10-06T10:00:00.000Z",
  updatedAt: "2026-10-06T10:00:00.000Z"
};

const execution = {
  executionId:
    "stage643-execution-feedback-performance",
  success: true,
  stage: "5.4",
  status: "execution_completed",
  executionStarted: true,
  taskId: task.id,
  planId: plan.id,
  autonomousApproval: true,
  results: [
    {
      type: "structured-result",
      output: "completed"
    }
  ],
  recoveryRequired: false,
  startedAt:
    "2026-10-06T10:01:00.000Z",
  completedAt:
    "2026-10-06T10:02:00.000Z"
};

const qa = {
  success: true,
  status: "qa_passed",
  stage: "6.1",
  engineVersion: "6.1",
  taskId: task.id,
  planId: plan.id,
  checks: {},
  failedChecks: [],
  reasons: [],
  reworkRequired: false,
  evaluatedAt:
    "2026-10-06T10:03:00.000Z"
};

const feedback = {
  provided: true,
  summary:
    "The result met the requested requirements.",
  positive: [
    "Complete result",
    "Requirements were satisfied"
  ],
  negative: [],
  requestedChanges: []
};

try {
  const result =
    learning.learnFromWork({
      task,
      plan,
      executionResult: execution,
      qaResult: qa,
      feedback
    });

  assert.strictEqual(
    result.success,
    true
  );

  const exp =
    experience.getExperience(
      result.learningId
    );

  assert(
    exp,
    "experience retrieval must succeed"
  );

  assert.strictEqual(
    exp.feedback.provided,
    true
  );

  assert.strictEqual(
    exp.feedback.summary,
    feedback.summary
  );

  assert.deepStrictEqual(
    exp.feedback.positive,
    feedback.positive
  );

  assert.deepStrictEqual(
    exp.feedback.negative,
    []
  );

  assert.deepStrictEqual(
    exp.feedback.requestedChanges,
    []
  );

  pass(
    "Positive feedback is recorded"
  );

  assert.strictEqual(
    exp.performance.qaStatus,
    "qa_passed"
  );

  assert.strictEqual(
    exp.performance.qaSuccess,
    true
  );

  assert.deepStrictEqual(
    exp.performance.failedChecks,
    []
  );

  assert.strictEqual(
    exp.performance.reworkRequired,
    false
  );

  assert.strictEqual(
    exp.performance.evaluatedAt,
    qa.evaluatedAt
  );

  pass(
    "Successful QA performance is recorded"
  );

  const integrity =
    learning.verifyLearningRecordIntegrity(
      result.learningId
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

  const listed =
    experience.listExperiences({
      limit: 100
    });

  assert(
    Array.isArray(listed),
    "experience listing must return an array"
  );

  const listedExperience =
    listed.find(
      item =>
        item.experienceId ===
        result.learningId
    );

  assert(
    listedExperience,
    "recorded experience must appear in experience listing"
  );

  assert.strictEqual(
    listedExperience.performance.qaSuccess,
    true
  );

  pass(
    "Feedback and performance survive experience listing"
  );

  console.log(
    "\nSTAGE6_4_3_FEEDBACK_PERFORMANCE_MEMORY: PASS"
  );
} finally {
  restoreFile(
    LEARNING_FILE,
    before
  );
}
