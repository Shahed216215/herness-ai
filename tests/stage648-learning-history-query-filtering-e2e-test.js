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

function assertChronological(history) {
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
      "History is not newest-first"
    );
  }
}

function run() {
  console.log(
    "STAGE 6.4.8.2 LEARNING HISTORY QUERY & FILTERING E2E TEST"
  );

  const before =
    readStoreSnapshot();

  const baselineExperienceCount =
    experienceMemory.listExperiences({
      limit: 5000
    }).length;

  const allHistory =
    historyEngine.listLearningHistory({
      limit: 5000
    });

  assert.ok(
    allHistory.length > 0,
    "Expected existing learning history"
  );

  console.log(
    "PASS: Base learning history is available"
  );

  assertChronological(
    allHistory
  );

  console.log(
    "PASS: Base history remains chronologically ordered"
  );

  const first =
    allHistory[0];

  assert.ok(
    first.historyId,
    "Expected historyId"
  );

  const byHistoryId =
    historyEngine.listLearningHistory({
      historyId:
        first.historyId,
      limit: 5000
    });

  assert.strictEqual(
    byHistoryId.length,
    1,
    "historyId filter must return exactly one entry"
  );

  assert.strictEqual(
    byHistoryId[0].historyId,
    first.historyId
  );

  console.log(
    "PASS: historyId filtering works"
  );

  const taskId =
    first.source.taskId;

  const byTask =
    historyEngine.listLearningHistory({
      taskId,
      limit: 5000
    });

  assert.ok(
    byTask.length > 0,
    "Expected task-specific history"
  );

  for (const entry of byTask) {
    assert.strictEqual(
      entry.source.taskId,
      taskId,
      "Task filter returned unrelated history"
    );
  }

  assertChronological(
    byTask
  );

  console.log(
    "PASS: taskId filtering works"
  );

  const knownStatuses =
    [
      ...new Set(
        allHistory
          .map(
            entry =>
              entry.result.status
          )
          .filter(Boolean)
      )
    ];

  assert.ok(
    knownStatuses.length > 0,
    "Expected at least one execution status"
  );

  const executionStatus =
    knownStatuses[0];

  const byExecutionStatus =
    historyEngine.listLearningHistory({
      executionStatus,
      limit: 5000
    });

  assert.ok(
    byExecutionStatus.length > 0,
    "Expected execution-status history"
  );

  for (const entry of byExecutionStatus) {
    assert.strictEqual(
      entry.result.status,
      executionStatus,
      "Execution status filter returned unrelated history"
    );
  }

  assertChronological(
    byExecutionStatus
  );

  console.log(
    "PASS: executionStatus filtering works"
  );

  const successValues =
    [
      ...new Set(
        allHistory.map(
          entry =>
            entry.result.success
        )
      )
    ];

  for (const value of successValues) {
    assert.strictEqual(
      typeof value,
      "boolean",
      "Result success must be boolean"
    );

    const filtered =
      historyEngine.listLearningHistory({
        success: value,
        limit: 5000
      });

    for (const entry of filtered) {
      assert.strictEqual(
        entry.result.success,
        value,
        "Success filter returned unrelated history"
      );
    }

    assertChronological(
      filtered
    );
  }

  console.log(
    "PASS: success filtering works"
  );

  const limited =
    historyEngine.listLearningHistory({
      limit: 2
    });

  assert.ok(
    limited.length <= 2,
    "Limit was not enforced"
  );

  assertChronological(
    limited
  );

  console.log(
    "PASS: Query limit works"
  );

  const combined =
    historyEngine.listLearningHistory({
      taskId,
      success:
        first.result.success,
      executionStatus:
        first.result.status,
      limit: 5000
    });

  for (const entry of combined) {
    assert.strictEqual(
      entry.source.taskId,
      taskId
    );

    assert.strictEqual(
      entry.result.success,
      first.result.success
    );

    assert.strictEqual(
      entry.result.status,
      first.result.status
    );
  }

  console.log(
    "PASS: Multiple filters compose correctly"
  );

  const empty =
    historyEngine.listLearningHistory({
      historyId:
        "non-existent-learning-history-id",
      limit: 5000
    });

  assert.deepStrictEqual(
    empty,
    [],
    "Unknown historyId should return empty result"
  );

  console.log(
    "PASS: Unknown query returns empty result safely"
  );

  const after =
    readStoreSnapshot();

  assert.strictEqual(
    after,
    before,
    "Query/filtering modified source learning store"
  );

  const sourceExperiences =
    experienceMemory.listExperiences({
      limit: 5000
    });

  assert.strictEqual(
    sourceExperiences.length,
    baselineExperienceCount,
    "Unexpected source experience count change"
  );

  console.log(
    "PASS: Query/filtering is read-only and source count is unchanged"
  );

  console.log(
    "\nSTAGE6_4_8_2_LEARNING_HISTORY_QUERY_FILTERING: PASS"
  );
}

try {
  run();
} catch (error) {
  console.error(
    "\nSTAGE6_4_8_2_LEARNING_HISTORY_QUERY_FILTERING: FAIL"
  );

  console.error(
    error.stack ||
      error.message
  );

  process.exitCode = 1;
}
