"use strict";

const assert = require("assert");

const fs = require("fs");
const path = require("path");

const experienceMemory =
  require("../services/mira-experience-memory");

const learningEngine =
  require("../services/mira-work-learning-engine");

const LEARNING_FILE =
  learningEngine.LEARNING_FILE;

function readFile() {
  return fs.readFileSync(
    LEARNING_FILE,
    "utf8"
  );
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

console.log(
  "STAGE 6.4.1 EXPERIENCE MEMORY FOUNDATION E2E TEST"
);

try {
  const before =
    readFile();

  const records =
    learningEngine.listLearningRecords({
      limit: 10
    });

  assert(
    Array.isArray(records),
    "learning records must be an array"
  );

  pass(
    "Existing work-learning records are readable"
  );

  if (records.length === 0) {
    console.log(
      "INFO: No learning records available; structural checks only."
    );
  } else {
    const source =
      records[0];

    assert(
      source.learningId,
      "source learning record must have learningId"
    );

    const experience =
      experienceMemory.normalizeExperience(
        source
      );

    assert.strictEqual(
      experience.experienceId,
      source.learningId
    );

    pass(
      "Experience ID is derived from learning ID"
    );

    assert.strictEqual(
      experience.source.type,
      "work-learning-record"
    );

    assert.strictEqual(
      experience.source.learningId,
      source.learningId
    );

    assert.strictEqual(
      experience.source.taskId,
      source.taskId
    );

    pass(
      "Source provenance is preserved"
    );

    assert(
      experience.task &&
        typeof experience.task ===
          "object",
      "task section must exist"
    );

    assert(
      experience.approach &&
        typeof experience.approach ===
          "object",
      "approach section must exist"
    );

    assert(
      experience.result &&
        typeof experience.result ===
          "object",
      "result section must exist"
    );

    assert(
      experience.feedback &&
        typeof experience.feedback ===
          "object",
      "feedback section must exist"
    );

    assert(
      experience.error &&
        typeof experience.error ===
          "object",
      "error section must exist"
    );

    assert(
      experience.correction &&
        typeof experience.correction ===
          "object",
      "correction section must exist"
    );

    assert(
      Array.isArray(
        experience.lesson
      ),
      "lesson must be an array"
    );

    assert.strictEqual(
      experience.futureStrategy,
      null
    );

    pass(
      "Experience memory foundation structure is complete"
    );

    assert(
      experience.integrity,
      "experience integrity hash must exist"
    );

    assert.strictEqual(
      experienceMemory.verifyExperienceIntegrity(
        experience
      ),
      true
    );

    pass(
      "Experience integrity verification passes"
    );

    const fetched =
      experienceMemory.getExperience(
        source.learningId
      );

    assert(
      fetched,
      "experience must be retrievable by learning ID"
    );

    assert.strictEqual(
      fetched.experienceId,
      source.learningId
    );

    assert.strictEqual(
      experienceMemory.verifyExperienceIntegrity(
        fetched
      ),
      true
    );

    pass(
      "Experience retrieval works"
    );
  }

  const experiences =
    experienceMemory.listExperiences({
      limit: 10
    });

  assert(
    Array.isArray(experiences),
    "listExperiences must return an array"
  );

  pass(
    "Experience listing works"
  );

  const stats =
    experienceMemory.getExperienceStats();

  assert(
    stats &&
      typeof stats.total === "number",
    "experience stats must be available"
  );

  assert(
    stats.total >= 0,
    "experience total must be non-negative"
  );

  pass(
    "Experience statistics work"
  );

  const after =
    readFile();

  assert.strictEqual(
    after,
    before,
    "6.4.1 must not modify the source learning store"
  );

  pass(
    "Source learning store remains unchanged"
  );

  console.log(
    "\nSTAGE6_4_1_EXPERIENCE_MEMORY_FOUNDATION: PASS"
  );
} catch (error) {
  fail(
    error &&
      error.stack
      ? error.stack
      : String(error)
  );
}
