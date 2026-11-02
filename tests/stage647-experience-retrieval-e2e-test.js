"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const retrievalEngine =
  require(
    "../services/mira-experience-retrieval-engine"
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

function assertGovernanceBoundary(
  experience
) {
  assert.strictEqual(
    experience.governance.executable,
    false
  );

  assert.strictEqual(
    experience.governance.modifiesCode,
    false
  );

  assert.strictEqual(
    experience.governance.bypassesPolicy,
    false
  );

  assert.strictEqual(
    experience.governance.requiresNormalTaskChecks,
    true
  );
}

function run() {
  console.log(
    "STAGE 6.4.7 EXPERIENCE RETRIEVAL E2E TEST"
  );

  const before =
    readStoreSnapshot();

  const baselineRecordCount =
    learningEngine.listLearningRecords({
      limit: 5000
    }).length;

  const experiences =
    experienceMemory.listExperiences({
      limit: 5000
    });

  assert.ok(
    experiences.length > 0,
    "Expected existing experiences"
  );

  const target =
    experiences.find(
      experience =>
        experience.task &&
        (
          experience.task.title ||
          experience.task.description
        )
    );

  assert.ok(
    target,
    "Expected an experience with task data"
  );

  const taskText =
    [
      target.task.title,
      target.task.description,
      ...(Array.isArray(
        target.task.requirements
      )
        ? target.task.requirements
        : [])
    ]
      .filter(
        value =>
          typeof value ===
          "string"
      )
      .join(" ");

  assert.ok(
    taskText.length > 0,
    "Expected task text for retrieval"
  );

  const retrieved =
    retrievalEngine.retrieveExperiences(
      taskText,
      {
        limit: 5
      }
    );

  assert.ok(
    retrieved.length > 0,
    "Expected matching past experience"
  );

  console.log(
    "PASS: Relevant past experience can be retrieved"
  );

  const top =
    retrieved[0];

  assert.ok(
    top.experienceId,
    "Expected experience identity"
  );

  assert.ok(
    top.source,
    "Expected source provenance"
  );

  assert.ok(
    top.source.learningId,
    "Expected learningId provenance"
  );

  assert.ok(
    top.source.taskId,
    "Expected taskId provenance"
  );

  assert.ok(
    top.source.executionId,
    "Expected executionId provenance"
  );

  console.log(
    "PASS: Retrieved experience preserves provenance"
  );

  assert.ok(
    top.task,
    "Expected task memory"
  );

  assert.ok(
    top.approach,
    "Expected approach memory"
  );

  assert.ok(
    top.result,
    "Expected result memory"
  );

  assert.ok(
    top.feedback,
    "Expected feedback memory"
  );

  assert.ok(
    top.performance,
    "Expected performance memory"
  );

  assert.ok(
    top.error,
    "Expected error memory"
  );

  assert.ok(
    top.correction,
    "Expected correction memory"
  );

  assert.ok(
    Array.isArray(
      top.lessons
    ),
    "Expected lesson memory"
  );

  console.log(
    "PASS: Retrieved experience contains the complete memory structure"
  );

  assert.ok(
    top.relevance &&
      top.relevance.score > 0,
    "Expected positive relevance"
  );

  assert.ok(
    Array.isArray(
      top.relevance.matchedTerms
    ),
    "Expected matched relevance terms"
  );

  console.log(
    "PASS: Experience relevance is calculated"
  );

  assertGovernanceBoundary(
    top
  );

  console.log(
    "PASS: Retrieved experience cannot authorize execution or bypass governance"
  );

  const task =
    {
      title:
        target.task.title ||
        "",
      description:
        target.task.description ||
        "",
      requirements:
        Array.isArray(
          target.task.requirements
        )
          ? target.task.requirements
          : []
    };

  const taskRetrieved =
    retrievalEngine.getExperiencesForTask(
      task,
      {
        limit: 5
      }
    );

  assert.ok(
    taskRetrieved.length > 0,
    "Expected task-specific experience retrieval"
  );

  console.log(
    "PASS: Task-specific experience retrieval works"
  );

  const stats =
    retrievalEngine.getRetrievalStats();

  assert.strictEqual(
    stats.retrievalIsReadOnly,
    true
  );

  assert.strictEqual(
    stats.autonomousExecution,
    false
  );

  assert.strictEqual(
    stats.sourceWritable,
    false
  );

  assert.strictEqual(
    stats.governanceBypass,
    false
  );

  console.log(
    "PASS: Retrieval engine governance boundaries are enforced"
  );

  const after =
    readStoreSnapshot();

  assert.strictEqual(
    after,
    before,
    "Source learning store was modified"
  );

  const sourceExperience =
    experienceMemory.getExperience(
      top.experienceId
    );

  assert.ok(
    sourceExperience,
    "Retrieved experience source could not be loaded"
  );

  const integrity =
    experienceMemory.verifyExperienceIntegrity(
      sourceExperience
    );

  assert.strictEqual(
    integrity,
    true,
    "Retrieved experience source integrity failed"
  );

  console.log(
    "PASS: Retrieval is read-only and source integrity remains valid"
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
    "PASS: Learning record count remains unchanged"
  );

  console.log(
    "\nSTAGE6_4_7_EXPERIENCE_RETRIEVAL: PASS"
  );
}

try {
  run();
} catch (error) {
  console.error(
    "\nSTAGE6_4_7_EXPERIENCE_RETRIEVAL: FAIL"
  );

  console.error(
    error.stack || error.message
  );

  process.exitCode = 1;
}
