const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const historyEngine =
  require("../services/mira-learning-history");

const sourcePath =
  path.join(
    process.cwd(),
    "data",
    "work-learning-records.json"
  );

function hashFile(filePath) {
  return crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(filePath)
    )
    .digest("hex");
}

function assert(
  condition,
  message
) {
  if (!condition) {
    throw new Error(
      `FAIL: ${message}`
    );
  }

  console.log(
    `PASS: ${message}`
  );
}

console.log(
  "STAGE 6.4.8.3 LEARNING HISTORY DETAIL & TIMELINE E2E TEST"
);

const beforeHash =
  hashFile(sourcePath);

const baseHistory =
  historyEngine.listLearningHistory({
    limit: 100
  });

assert(
  baseHistory.length > 0,
  "Learning history contains existing records"
);

const lessonHistory =
  baseHistory.find(
    entry =>
      Array.isArray(entry.lessons) &&
      entry.lessons.length > 0
  );

assert(
  Boolean(lessonHistory),
  "A history record with lessons is available"
);

const historyId =
  lessonHistory.historyId;

const detail =
  historyEngine.getLearningHistoryDetail(
    historyId
  );

assert(
  Boolean(detail),
  "Learning history detail retrieval works"
);

assert(
  detail.historyId === historyId,
  "Detail preserves history identity"
);

assert(
  Array.isArray(detail.timeline),
  "Timeline is returned as an array"
);

assert(
  detail.timeline.length >= 3,
  "Timeline contains task, approach and result events"
);

const eventTypes =
  detail.timeline.map(
    event => event.type
  );

assert(
  eventTypes.includes("task"),
  "Timeline contains task event"
);

assert(
  eventTypes.includes("approach"),
  "Timeline contains approach event"
);

assert(
  eventTypes.includes("result"),
  "Timeline contains result event"
);

assert(
  eventTypes.includes("lesson"),
  "Timeline contains lesson event"
);

const timestamps =
  detail.timeline
    .map(
      event =>
        event.timestamp
    )
    .filter(Boolean);

for (
  let i = 1;
  i < timestamps.length;
  i += 1
) {
  assert(
    timestamps[i - 1] <=
      timestamps[i],
    "Timeline events are chronologically ordered"
  );
}

assert(
  detail.futureStrategy &&
    detail.futureStrategy.derived === true,
  "Future strategy reference is explicitly marked as derived"
);

assert(
  detail.futureStrategy.readOnly === true,
  "Future strategy reference is read-only"
);

assert(
  detail.governance &&
    detail.governance.readOnly === true,
  "Detail is read-only"
);

assert(
  detail.governance.executable === false,
  "Detail cannot authorize execution"
);

assert(
  detail.governance.modifiesCode === false,
  "Detail cannot modify code"
);

assert(
  detail.governance.bypassesPolicy === false,
  "Detail cannot bypass policy"
);

const timeline =
  historyEngine.getLearningHistoryTimeline(
    historyId
  );

assert(
  Array.isArray(timeline),
  "Dedicated timeline retrieval works"
);

assert(
  timeline.length ===
    detail.timeline.length,
  "Detail timeline matches dedicated timeline retrieval"
);

const missingTimeline =
  historyEngine.getLearningHistoryTimeline(
    "history-does-not-exist"
  );

assert(
  missingTimeline === null,
  "Unknown history timeline returns null safely"
);

const missingDetail =
  historyEngine.getLearningHistoryDetail(
    "history-does-not-exist"
  );

assert(
  missingDetail === null,
  "Unknown history detail returns null safely"
);

const afterHash =
  hashFile(sourcePath);

assert(
  beforeHash === afterHash,
  "Source learning store remains unchanged"
);

const finalHistory =
  historyEngine.listLearningHistory({
    limit: 100
  });

assert(
  finalHistory.length ===
    baseHistory.length,
  "Learning history record count remains unchanged"
);

console.log(
  "\nSTAGE6_4_8_3_LEARNING_HISTORY_DETAIL_TIMELINE: PASS"
);

console.log(
  `\nSOURCE SHA256: ${afterHash}`
);

console.log(
  `History records: ${finalHistory.length}`
);

console.log(
  `Timeline events tested: ${timeline.length}`
);
