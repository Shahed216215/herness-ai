const assert = require("assert");
const fs = require("fs");
const path = require("path");

const learning =
  require(
    "../services/mira-work-learning-engine"
  );

const experience =
  require(
    "../services/mira-experience-memory"
  );

const STORE =
  path.join(
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

function findRecordWithLessons(records) {
  return records.find(
    record =>
      Array.isArray(record.lessons) &&
      record.lessons.length > 0
  );
}

console.log(
  "STAGE 6.4.5 LESSON RETRIEVAL E2E TEST"
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

  const sourceRecord =
    findRecordWithLessons(
      records
    );

  assert(
    sourceRecord,
    "At least one learning record with lessons is required"
  );

  const sourceLessons =
    sourceRecord.lessons;

  assert(
    sourceLessons.length > 0,
    "Source lesson list should not be empty"
  );

  const retrieved =
    experience.getLessons(
      sourceRecord.learningId
    );

  assert(
    Array.isArray(retrieved),
    "getLessons() should return an array"
  );

  assert.strictEqual(
    retrieved.length,
    sourceLessons.length,
    "getLessons() should return all source lessons"
  );

  for (
    let i = 0;
    i < retrieved.length;
    i++
  ) {
    assert.strictEqual(
      retrieved[i].lesson,
      sourceLessons[i],
      "Retrieved lesson must match source lesson"
    );

    assert.strictEqual(
      retrieved[i].learningId,
      sourceRecord.learningId,
      "Lesson provenance must preserve learningId"
    );

    assert.strictEqual(
      retrieved[i].taskId,
      sourceRecord.taskId,
      "Lesson provenance must preserve taskId"
    );

    assert.strictEqual(
      retrieved[i].executionId,
      sourceRecord.executionId,
      "Lesson provenance must preserve executionId"
    );
  }

  console.log(
    "PASS: getLessons() retrieves existing lessons correctly"
  );

  const listed =
    experience.listLessons({
      limit: 100
    });

  assert(
    Array.isArray(listed),
    "listLessons() should return an array"
  );

  assert(
    listed.length >= sourceLessons.length,
    "listLessons() should expose stored lessons"
  );

  const matching =
    listed.filter(
      item =>
        item.learningId ===
        sourceRecord.learningId
    );

  assert.strictEqual(
    matching.length,
    sourceLessons.length,
    "listLessons() should preserve lesson count per record"
  );

  for (const item of matching) {
    assert(
      sourceLessons.includes(
        item.lesson
      ),
      "Listed lesson must originate from source memory"
    );
  }

  console.log(
    "PASS: listLessons() exposes source lessons with provenance"
  );

  const verified =
    learning.verifyLearningRecordIntegrity(
      sourceRecord.learningId
    );

  assert.strictEqual(
    verified.valid,
    true,
    "Source learning record integrity must remain valid"
  );

  console.log(
    "PASS: Source learning record integrity remains valid"
  );

} finally {
  const after =
    snapshotStore();

  assert.strictEqual(
    after,
    before,
    "Lesson retrieval must not modify source memory"
  );

  console.log(
    "PASS: Lesson retrieval does not modify source memory"
  );
}

console.log(
  "\nSTAGE6_4_5_LESSON_RETRIEVAL: PASS"
);
