"use strict";

const fs = require("fs");
const crypto = require("crypto");

const planner =
  require("../services/mira-task-planner");

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

async function main() {
  console.log(
    "STAGE 6.4.10 CROSS-TASK PLANNING INTEGRATION E2E TEST"
  );

  const beforeHash =
    sha256File(STORE);

  const beforeStore =
    readStore();

  const beforeCount =
    Array.isArray(beforeStore.records)
      ? beforeStore.records.length
      : 0;

  const targetTask =
    "Perform structured research, analyze requirements, verify correctness and quality.";

  const result =
    await planner.createTaskPlan(
      targetTask,
      {
        persist: false
      }
    );

  assert(
    result &&
    result.success === true,
    "Planner successfully creates a plan"
  );

  assert(
    result.planningOnly === true,
    "Plan remains planning-only"
  );

  assert(
    result.executionAllowed === false,
    "Planner does not authorize execution"
  );

  assert(
    result.experienceGuidance &&
    result.experienceGuidance.crossTaskLearning,
    "Cross-task learning reaches planner guidance"
  );

  const crossTask =
    result.experienceGuidance.crossTaskLearning;

  assert(
    Array.isArray(crossTask.transfers),
    "Planner exposes cross-task transfers"
  );

  assert(
    crossTask.count ===
      crossTask.transfers.length,
    "Planner cross-task count matches transfers"
  );

  assert(
    crossTask.transfers.length > 0,
    "Planner receives relevant cross-task experience"
  );

  const currentTaskId =
    result.plan.taskId;

  assert(
    crossTask.transfers.every(
      transfer =>
        transfer.source?.taskId !==
        currentTaskId
    ),
    "Planner excludes same-task experience"
  );

  assert(
    crossTask.transfers.every(
      transfer =>
        transfer.source?.learningId
    ),
    "Planner preserves cross-task provenance"
  );

  assert(
    crossTask.transfers.some(
      transfer =>
        Array.isArray(transfer.lessons) &&
        transfer.lessons.length > 0
    ),
    "Planner receives lessons from prior tasks"
  );

  assert(
    crossTask.governance &&
    crossTask.governance.readOnly === true &&
    crossTask.governance.executable === false &&
    crossTask.governance.modifiesCode === false &&
    crossTask.governance.bypassesPolicy === false &&
    crossTask.governance.requiresNormalTaskChecks === true,
    "Cross-task planner guidance keeps governance boundaries"
  );

  const verificationPlan =
    Array.isArray(result.plan.verificationPlan)
      ? result.plan.verificationPlan
      : [];

  assert(
    verificationPlan.some(
      check =>
        typeof check.checkId === "string" &&
        check.checkId.startsWith(
          "cross-task-experience-"
        )
    ),
    "Cross-task experience influences verification planning"
  );

  assert(
    verificationPlan.some(
      check =>
        typeof check.expected === "string" &&
        check.expected.includes(
          "risk, policy, capability, approval, execution, or QA checks"
        )
    ),
    "Cross-task guidance explicitly preserves normal governance checks"
  );

  assert(
    result.experienceGuidance.executionAuthorization ===
      false,
    "Experience guidance cannot authorize execution"
  );

  assert(
    result.plan.status === "validated" ||
    result.plan.status === "blocked" ||
    result.plan.status === "rejected",
    "Plan has a valid planner status"
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

  console.log("");
  console.log(
    `SOURCE SHA256: ${afterHash}`
  );
  console.log(
    `SOURCE RECORDS: ${afterCount}`
  );
  console.log(
    `CROSS-TASK TRANSFERS: ${crossTask.count}`
  );
  console.log("");
  console.log(
    "STAGE6_4_10_CROSS_TASK_PLANNING_INTEGRATION: PASS"
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
