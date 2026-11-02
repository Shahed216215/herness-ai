"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const learning =
  require(
    "../services/mira-work-learning-engine"
  );

const experience =
  require(
    "../services/mira-experience-memory"
  );

const strategyEngine =
  require(
    "../services/mira-future-strategy-engine"
  );

const STORE =
  require("path").join(
    __dirname,
    "..",
    "data",
    "work-learning-records.json"
  );

function snapshotStore() {
  return fs.readFileSync(
    STORE,
    "utf8"
  );
}

console.log(
  "STAGE 6.4.6 FUTURE STRATEGY ENGINE E2E TEST"
);

const before =
  snapshotStore();

try {
  const records =
    learning.listLearningRecords({
      limit: 100
    });

  assert(
    records.length > 0,
    "Learning records should exist"
  );

  const lessonRecord =
    records.find(
      record =>
        Array.isArray(
          record.lessons
        ) &&
        record.lessons.length > 0
    );

  assert(
    lessonRecord,
    "A lesson-bearing learning record is required"
  );

  const strategies =
    strategyEngine.getAllStrategies({
      limit: 100
    });

  assert(
    Array.isArray(
      strategies
    ),
    "getAllStrategies() should return an array"
  );

  assert(
    strategies.length > 0,
    "Future strategies should be derived from stored lessons"
  );

  const matchingStrategy =
    strategies.find(
      item =>
        item.source.learningId ===
        lessonRecord.learningId
    );

  assert(
    matchingStrategy,
    "Strategy must preserve lesson provenance"
  );

  assert(
    matchingStrategy.strategy.length > 0,
    "Derived strategy must contain usable strategy text"
  );

  assert.strictEqual(
    matchingStrategy.type,
    "lesson_derived",
    "Strategy type must identify lesson-derived strategy"
  );

  assert.strictEqual(
    matchingStrategy.governance.executable,
    false,
    "Strategy memory must never directly authorize execution"
  );

  assert.strictEqual(
    matchingStrategy.governance.modifiesCode,
    false,
    "Strategy memory must never modify source code"
  );

  assert.strictEqual(
    matchingStrategy.governance.bypassesPolicy,
    false,
    "Strategy memory must never bypass policy"
  );

  console.log(
    "PASS: Lessons are converted into governed future strategies"
  );

  const taskText =
    lessonRecord.task?.description ||
    lessonRecord.task?.title ||
    lessonRecord.taskId;

  const retrieved =
    strategyEngine.retrieveStrategies(
      taskText,
      {
        limit: 20
      }
    );

  assert(
    Array.isArray(
      retrieved
    ),
    "retrieveStrategies() should return an array"
  );

  assert(
    retrieved.length > 0,
    "Relevant strategy should be retrievable"
  );

  assert(
    retrieved.some(
      item =>
        item.source.learningId ===
        lessonRecord.learningId
    ),
    "Relevant lesson-derived strategy should be ranked for the task"
  );

  for (
    const item of retrieved
  ) {
    assert(
      item.relevance &&
      typeof item.relevance.score ===
        "number",
      "Retrieved strategy must include relevance score"
    );

    assert(
      item.relevance.score > 0,
      "Retrieved strategy must have positive relevance"
    );
  }

  console.log(
    "PASS: Relevant strategies can be retrieved and ranked"
  );

  const task =
    {
      title:
        lessonRecord.task?.title ||
        "Previous task",

      description:
        lessonRecord.task?.description ||
        "",

      requirements:
        Array.isArray(
          lessonRecord.task?.requirements
        )
          ? lessonRecord.task.requirements
          : []
    };

  const taskStrategies =
    strategyEngine.getStrategiesForTask(
      task,
      {
        limit: 20
      }
    );

  assert(
    Array.isArray(
      taskStrategies
    ),
    "getStrategiesForTask() should return an array"
  );

  assert(
    taskStrategies.length > 0,
    "Task-specific strategy retrieval should work"
  );

  console.log(
    "PASS: Task-specific future strategy retrieval works"
  );

  const stats =
    strategyEngine.getStrategyStats();

  assert.strictEqual(
    stats.strategyCount,
    strategies.length,
    "Strategy statistics must match strategy retrieval"
  );

  assert.strictEqual(
    stats.autonomousExecution,
    false,
    "Strategy engine must not execute work"
  );

  assert.strictEqual(
    stats.sourceWritable,
    false,
    "Strategy engine must be read-only"
  );

  assert.strictEqual(
    stats.governanceBypass,
    false,
    "Strategy engine must not bypass governance"
  );

  console.log(
    "PASS: Strategy governance boundaries are enforced"
  );

} finally {
  const after =
    snapshotStore();

  assert.strictEqual(
    after,
    before,
    "Future strategy retrieval must not modify source memory"
  );

  console.log(
    "PASS: Future strategy processing does not modify source memory"
  );
}

console.log(
  "\nSTAGE6_4_6_FUTURE_STRATEGY_ENGINE: PASS"
);
