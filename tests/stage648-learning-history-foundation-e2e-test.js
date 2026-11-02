"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const historyEngine =
  require(
    "../services/mira-learning-history"
  );

const experienceMemory =
  require(
    "../services/mira-experience-memory"
  );

const learningEngine =
  require(
    "../services/mira-work-learning-engine"
  );

const STORE_PATH =
  path.join(
    __dirname,
    "..",
    "data",
    "work-learning-records.json"
  );

function readStoreSnapshot() {
  return fs.readFileSync(
    STORE_PATH,
    "utf8"
  );
}

function run() {
  console.log(
    "STAGE 6.4.8.1 LEARNING HISTORY FOUNDATION E2E TEST"
  );

  const before =
    readStoreSnapshot();

  const baselineRecordCount =
    learningEngine.listLearningRecords({
      limit: 5000
    }).length;

  const sourceExperiences =
    experienceMemory.listExperiences({
      limit: 5000
    });

  assert.ok(
    sourceExperiences.length > 0,
    "Expected existing experiences"
  );

  const history =
    historyEngine.listLearningHistory({
      limit: 5000
    });

  assert.strictEqual(
    history.length,
    sourceExperiences.length,
    "History count must match source experience count"
  );

  console.log(
    "PASS: Learning history covers all existing experiences"
  );

  const first =
    history[0];

  assert.ok(
    first.historyId,
    "Expected historyId"
  );

  assert.ok(
    first.source.learningId,
    "Expected learningId"
  );

  assert.ok(
    first.source.taskId,
    "Expected taskId"
  );

  assert.ok(
    first.source.executionId,
    "Expected executionId"
  );

  console.log(
    "PASS: Learning history preserves source provenance"
  );

  for (
    let i = 1;
    i < history.length;
    i++
  ) {
    const previous =
      history[i - 1]
        .timestamps.createdAt || "";

    const current =
      history[i]
        .timestamps.createdAt || "";

    assert.ok(
      previous >= current,
      "Learning history is not chronologically ordered"
    );
  }

  console.log(
    "PASS: Learning history is ordered newest first"
  );

  assert.ok(
    first.task,
    "Expected task history"
  );

  assert.ok(
    first.approach,
    "Expected approach history"
  );

  assert.ok(
    first.result,
    "Expected result history"
  );

  assert.ok(
    first.feedback,
    "Expected feedback history"
  );

  assert.ok(
    first.performance,
    "Expected performance history"
  );

  assert.ok(
    first.error,
    "Expected error history"
  );

  assert.ok(
    first.correction,
    "Expected correction history"
  );

  assert.ok(
    Array.isArray(first.lessons),
    "Expected lessons array"
  );

  console.log(
    "PASS: Learning history contains the complete experience structure"
  );

  assert.strictEqual(
    first.integrity.sourceValid,
    true,
    "Source experience integrity failed"
  );

  console.log(
    "PASS: Learning history preserves source integrity"
  );

  assert.strictEqual(
    first.governance.readOnly,
    true
  );

  assert.strictEqual(
    first.governance.executable,
    false
  );

  assert.strictEqual(
    first.governance.modifiesCode,
    false
  );

  assert.strictEqual(
    first.governance.bypassesPolicy,
    false
  );

  assert.strictEqual(
    first.governance.requiresNormalTaskChecks,
    true
  );

  console.log(
    "PASS: Learning history governance boundary is enforced"
  );

  const specific =
    historyEngine.getLearningHistory(
      first.historyId
    );

  assert.ok(
    specific,
    "Expected specific history retrieval"
  );

  assert.strictEqual(
    specific.historyId,
    first.historyId
  );

  assert.strictEqual(
    specific.source.learningId,
    first.source.learningId
  );

  console.log(
    "PASS: Individual learning history retrieval works"
  );

  const stats =
    historyEngine.getLearningHistoryStats();

  assert.strictEqual(
    stats.historyCount,
    sourceExperiences.length
  );

  assert.strictEqual(
    stats.sourceExperienceCount,
    sourceExperiences.length
  );

  assert.strictEqual(
    stats.readOnly,
    true
  );

  assert.strictEqual(
    stats.sourceWritable,
    false
  );

  assert.strictEqual(
    stats.autonomousExecution,
    false
  );

  assert.strictEqual(
    stats.governanceBypass,
    false
  );

  console.log(
    "PASS: Learning history statistics and boundaries are valid"
  );

  const after =
    readStoreSnapshot();

  assert.strictEqual(
    after,
    before,
    "Learning history modified the source learning store"
  );

  const finalRecords =
    learningEngine.listLearningRecords({
      limit: 5000
    });

  assert.strictEqual(
    finalRecords.length,
    baselineRecordCount,
    "Unexpected learning record count change"
  );

  console.log(
    "PASS: Learning history is read-only and source record count is unchanged"
  );

  console.log(
    "\nSTAGE6_4_8_1_LEARNING_HISTORY_FOUNDATION: PASS"
  );
}

try {
  run();
} catch (error) {
  console.error(
    "\nSTAGE6_4_8_1_LEARNING_HISTORY_FOUNDATION: FAIL"
  );

  console.error(
    error.stack ||
      error.message
  );

  process.exitCode = 1;
}
