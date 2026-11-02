"use strict";

const assert = require("assert");
const fs = require("fs");

const experience =
  require("../services/mira-experience-memory");

const learning =
  require("../services/mira-work-learning-engine");

const LEARNING_FILE =
  "data/work-learning-records.json";

function readStore() {
  return JSON.parse(
    fs.readFileSync(
      LEARNING_FILE,
      "utf8"
    )
  );
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

const before =
  fs.readFileSync(
    LEARNING_FILE,
    "utf8"
  );

try {
  const store =
    readStore();

  const failedRecord =
    Array.isArray(store.records)
      ? store.records.find(
          record =>
            record.qa &&
            record.qa.success === false
        )
      : null;

  assert(
    failedRecord,
    "an existing failed QA record is required"
  );

  const exp =
    experience.getExperience(
      failedRecord.learningId
    );

  assert(
    exp,
    "failed experience must be retrievable"
  );

  assert.strictEqual(
    exp.error.executionFailed,
    false
  );

  assert.strictEqual(
    exp.error.executionStatus,
    ""
  );

  assert.strictEqual(
    exp.error.recoveryRequired,
    false
  );

  assert.deepStrictEqual(
    exp.error.failedChecks,
    [
      "requirements",
      "quality"
    ]
  );

  assert.deepStrictEqual(
    exp.error.reasons,
    [
      "Not all stated requirements were addressed.",
      "Final result quality was insufficient."
    ]
  );

  assert.deepStrictEqual(
    exp.error.whatFailed,
    failedRecord.whatFailed
  );

  pass(
    "Existing QA failure is recorded as error memory"
  );

  assert.strictEqual(
    exp.correction.reworkRequired,
    true
  );

  assert.strictEqual(
    exp.correction.reworkContext,
    null
  );

  assert.deepStrictEqual(
    exp.correction.requestedChanges,
    [
      "Verify each requirement before completion."
    ]
  );

  assert.strictEqual(
    exp.correction.status,
    "rework_required"
  );

  pass(
    "Existing rework and requested correction are recorded"
  );

  const synthetic =
    {
      learningId:
        "stage644-synthetic-execution-failure",
      taskId:
        "stage644-synthetic-task",
      execution: {
        success: false,
        status:
          "execution_failed",
        recoveryRequired: true,
        recoveryReason:
          "Tool execution failed"
      },
      qa: {
        status:
          "qa_failed",
        success: false,
        failedChecks: [
          "correctness"
        ],
        reasons: [
          "Output was incorrect."
        ],
        reworkRequired: true,
        recoveryRequired: true,
        reworkContext: {
          reason:
            "Correct the output"
        }
      },
      whatFailed: [
        "Execution failed.",
        "Output was incorrect."
      ],
      feedback: {
        provided: true,
        summary:
          "The output needs correction.",
        positive: [],
        negative: [
          "Incorrect output"
        ],
        requestedChanges: [
          "Correct the output."
        ]
      },
      result: {
        success: false,
        status:
          "execution_failed"
      },
      approach: {},
      task: {},
      lessons: []
    };

  const syntheticExperience =
    experience.normalizeExperience(
      synthetic
    );

  assert.strictEqual(
    syntheticExperience.error.executionFailed,
    true
  );

  assert.strictEqual(
    syntheticExperience.error.executionStatus,
    "execution_failed"
  );

  assert.strictEqual(
    syntheticExperience.error.recoveryRequired,
    true
  );

  assert.strictEqual(
    syntheticExperience.error.recoveryReason,
    "Tool execution failed"
  );

  assert.deepStrictEqual(
    syntheticExperience.error.failedChecks,
    [
      "correctness"
    ]
  );

  assert.deepStrictEqual(
    syntheticExperience.error.reasons,
    [
      "Output was incorrect."
    ]
  );

  assert.deepStrictEqual(
    syntheticExperience.error.whatFailed,
    [
      "Execution failed.",
      "Output was incorrect."
    ]
  );

  assert.strictEqual(
    syntheticExperience.correction.reworkRequired,
    true
  );

  assert.deepStrictEqual(
    syntheticExperience.correction.reworkContext,
    {
      reason:
        "Correct the output"
    }
  );

  assert.deepStrictEqual(
    syntheticExperience.correction.requestedChanges,
    [
      "Correct the output."
    ]
  );

  assert.strictEqual(
    syntheticExperience.correction.status,
    "rework_required"
  );

  pass(
    "Execution failure and recovery data are normalized correctly"
  );

  const integrity =
    learning.verifyLearningRecordIntegrity(
      failedRecord.learningId
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
    "Failed learning record integrity remains valid"
  );

  const after =
    fs.readFileSync(
      LEARNING_FILE,
      "utf8"
    );

  assert.strictEqual(
    after,
    before
  );

  pass(
    "Error/correction inspection does not modify source memory"
  );

  console.log(
    "\nSTAGE6_4_4_ERROR_CORRECTION_MEMORY: PASS"
  );
} finally {
  fs.writeFileSync(
    LEARNING_FILE,
    before
  );
}
