"use strict";

const fs = require("fs");
const crypto = require("crypto");

const engine =
  require("../services/mira-cross-task-learning-engine");

const STORE =
  "data/work-learning-records.json";

function sha256File(path) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path))
    .digest("hex");
}

function readStore() {
  return JSON.parse(
    fs.readFileSync(STORE, "utf8")
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }

  console.log(`PASS: ${message}`);
}

console.log(
  "STAGE 6.4.10 CROSS-TASK LEARNING E2E TEST"
);

const beforeHash =
  sha256File(STORE);

const beforeStore =
  readStore();

const beforeCount =
  Array.isArray(beforeStore.records)
    ? beforeStore.records.length
    : 0;

const targetTask = {
  id: "stage6410-target-task",
  title: "Research requirements and verify quality",
  description:
    "Perform structured research, analyze requirements, verify correctness and quality.",
  requirements: [
    "research",
    "requirements",
    "verification",
    "quality"
  ]
};

const result =
  engine.getCrossTaskLearning(
    targetTask,
    {
      limit: 10
    }
  );

assert(
  result &&
  result.engineVersion === "6.4.10",
  "Cross-task engine returns versioned result"
);

assert(
  Array.isArray(result.transfers),
  "Cross-task transfers are returned as an array"
);

assert(
  result.count === result.transfers.length,
  "Transfer count matches returned transfers"
);

assert(
  result.transfers.length > 0,
  "Relevant cross-task experience is retrieved"
);

assert(
  result.transfers.every(
    item =>
      item.source &&
      item.source.taskId !==
        targetTask.id
  ),
  "Same-task experience is excluded"
);

assert(
  result.transfers.every(
    item =>
      item.source &&
      item.source.learningId
  ),
  "Learning provenance is preserved"
);

assert(
  result.transfers.every(
    item =>
      item.experienceId
  ),
  "Experience identity is preserved"
);

assert(
  result.transfers.some(
    item =>
      Array.isArray(item.lessons) &&
      item.lessons.length > 0
  ),
  "Lessons are transferred from past experience"
);

assert(
  result.transfers.every(
    item =>
      item.relevance &&
      typeof item.relevance.score ===
        "number"
  ),
  "Relevance scoring is preserved"
);

assert(
  result.transfers.every(
    item =>
      item.governance &&
      item.governance.executable === false &&
      item.governance.modifiesCode === false &&
      item.governance.bypassesPolicy === false &&
      item.governance.requiresNormalTaskChecks === true
  ),
  "Every transferred experience keeps governance boundaries"
);

assert(
  result.governance.readOnly === true &&
  result.governance.executable === false &&
  result.governance.modifiesCode === false &&
  result.governance.bypassesPolicy === false &&
  result.governance.requiresNormalTaskChecks === true,
  "Cross-task result remains read-only and non-executable"
);

const emptyResult =
  engine.getCrossTaskLearning({
    id: "empty-task"
  });

assert(
  emptyResult.count === 0 &&
  Array.isArray(emptyResult.transfers),
  "Empty task safely returns no transfers"
);

const afterHash =
  sha256File(STORE);

const afterStore =
  readStore();

const afterCount =
  Array.isArray(afterStore.records)
    ? afterStore.records.length
    : 0;

assert(
  beforeHash === afterHash,
  "Source learning store remains unchanged"
);

assert(
  beforeCount === afterCount,
  "Source learning record count remains unchanged"
);

const stats =
  engine.getCrossTaskLearningStats();

assert(
  stats.readOnly === true &&
  stats.sourceWritable === false &&
  stats.autonomousExecution === false &&
  stats.governanceBypass === false,
  "Engine statistics expose safe governance boundaries"
);

console.log("");
console.log(
  `SOURCE SHA256: ${afterHash}`
);
console.log(
  `SOURCE RECORDS: ${afterCount}`
);
console.log("");
console.log(
  "STAGE6_4_10_CROSS_TASK_LEARNING_E2E: PASS"
);
