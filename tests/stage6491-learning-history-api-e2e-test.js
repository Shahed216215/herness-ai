"use strict";

const assert = require("assert");
const fs = require("fs");
const crypto = require("crypto");

const historyService =
  require("../services/mira-learning-history");

const experienceMemory =
  require("../services/mira-experience-memory");

const storeFile =
  "data/work-learning-records.json";

function sha256File(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function getSourceCount() {
  const data =
    JSON.parse(
      fs.readFileSync(storeFile, "utf8")
    );

  return Array.isArray(data)
    ? data.length
    : Array.isArray(data.records)
      ? data.records.length
      : 0;
}

console.log(
  "STAGE 6.4.9.1 LEARNING HISTORY API E2E TEST"
);

const beforeHash =
  sha256File(storeFile);

const beforeCount =
  getSourceCount();

const history =
  historyService.listLearningHistory({
    limit: 100
  });

assert(
  Array.isArray(history),
  "Learning history must be an array"
);
console.log(
  "PASS: Learning history list is available"
);

assert.strictEqual(
  history.length,
  experienceMemory.listExperiences({
    limit: experienceMemory.MAX_EXPERIENCES
  }).length
);
console.log(
  "PASS: History covers all experience records"
);

const first =
  history[0];

assert(
  first &&
  typeof first.historyId === "string",
  "History identity missing"
);
console.log(
  "PASS: History identity is preserved"
);

assert(
  first.governance &&
  first.governance.readOnly === true &&
  first.governance.executable === false &&
  first.governance.modifiesCode === false &&
  first.governance.bypassesPolicy === false,
  "Governance boundary invalid"
);
console.log(
  "PASS: History governance boundary is enforced"
);

const stats =
  historyService.getLearningHistoryStats();

assert(
  stats &&
  stats.readOnly === true &&
  stats.sourceWritable === false &&
  stats.autonomousExecution === false &&
  stats.governanceBypass === false,
  "History statistics boundary invalid"
);
console.log(
  "PASS: History statistics expose read-only boundaries"
);

const lessons =
  experienceMemory.listLessons({
    limit: experienceMemory.MAX_EXPERIENCES
  });

assert(
  Array.isArray(lessons),
  "Lessons must be an array"
);
console.log(
  "PASS: Lessons endpoint source data is available"
);

if (first) {
  const detail =
    historyService.getLearningHistory(
      first.historyId
    );

  assert(
    detail &&
    detail.historyId === first.historyId,
    "Detail retrieval failed"
  );
  console.log(
    "PASS: History detail retrieval works"
  );

  const timeline =
    historyService.getLearningHistoryTimeline(
      first.historyId
    );

  assert(
    Array.isArray(timeline),
    "Timeline retrieval failed"
  );
  console.log(
    "PASS: History timeline retrieval works"
  );

  assert(
    detail.governance &&
    detail.governance.readOnly === true &&
    detail.governance.executable === false &&
    detail.governance.modifiesCode === false &&
    detail.governance.bypassesPolicy === false,
    "Timeline governance boundary invalid"
  );
  console.log(
    "PASS: Timeline governance boundary is enforced"
  );
}

assert.strictEqual(
  sha256File(storeFile),
  beforeHash,
  "Source learning store changed"
);
console.log(
  "PASS: Source learning store remains unchanged"
);

assert.strictEqual(
  getSourceCount(),
  beforeCount,
  "Source learning record count changed"
);
console.log(
  "PASS: Source learning record count remains unchanged"
);

assert.strictEqual(
  historyService.getLearningHistory(
    "__unknown_learning_history__"
  ),
  null
);
console.log(
  "PASS: Unknown history detail returns null safely"
);

assert.strictEqual(
  historyService.getLearningHistoryTimeline(
    "__unknown_learning_history__"
  ),
  null
);
console.log(
  "PASS: Unknown history timeline returns null safely"
);

console.log("");
console.log(
  "STAGE6_4_9_1_LEARNING_HISTORY_API: PASS"
);
console.log("");
console.log(
  "SOURCE SHA256:",
  sha256File(storeFile)
);
console.log(
  "SOURCE RECORDS:",
  getSourceCount()
);
console.log(
  "LESSON ENTRIES:",
  lessons.length
);
