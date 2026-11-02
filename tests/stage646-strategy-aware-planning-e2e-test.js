"use strict";

const assert = require("assert");

const fs = require("fs");
const path = require("path");

const planner =
  require("../services/mira-task-planner");

const experienceMemory =
  require("../services/mira-experience-memory");

const strategyEngine =
  require("../services/mira-future-strategy-engine");

const STORE =
  path.join(
    __dirname,
    "..",
    "data",
    "work-learning-records.json"
  );

function readStore() {
  return fs.readFileSync(
    STORE,
    "utf8"
  );
}

async function main() {
  console.log(
    "STAGE 6.4.6.2 STRATEGY-AWARE PLANNING E2E TEST"
  );

  const before =
    readStore();

  const lessonEntries =
    experienceMemory.listLessons({
      limit: 100
    });

  assert(
    lessonEntries.length > 0,
    "Expected existing lessons"
  );

  const selectedLesson =
    lessonEntries.find(
      item =>
        typeof item.lesson === "string" &&
        item.lesson.trim().length > 0
    );

  assert(
    selectedLesson,
    "Expected a usable lesson"
  );

  const strategies =
    strategyEngine.retrieveStrategies(
      selectedLesson.lesson,
      {
        limit: 5
      }
    );

  assert(
    strategies.length > 0,
    "Expected lesson to produce a retrievable strategy"
  );

  const selectedStrategy =
    strategies[0];

  assert(
    selectedStrategy.strategy,
    "Strategy text must exist"
  );

  assert(
    selectedStrategy.source.learningId ===
      selectedLesson.learningId,
    "Strategy provenance must point to source learning record"
  );

  console.log(
    "PASS: Existing lesson produces a retrievable future strategy"
  );

  const taskText =
    `Create a task that follows this learned guidance: ${selectedStrategy.strategy}`;

  const result =
    await planner.createTaskPlan(
      taskText,
      {
        persist: false
      }
    );

  assert(
    result &&
      result.plan,
    "Planner must return a plan"
  );

  assert(
    result.experienceGuidance,
    "Planner must expose experience guidance"
  );

  assert(
    result.experienceGuidance.retrieved === true,
    "Planner must retrieve relevant experience strategy"
  );

  assert(
    result.experienceGuidance.count > 0,
    "Planner must retrieve at least one strategy"
  );

  assert(
    Array.isArray(
      result.experienceGuidance.strategies
    ),
    "Experience strategies must be an array"
  );

  const plannedStrategy =
    result.experienceGuidance.strategies.find(
      item =>
        item.source.learningId ===
        selectedStrategy.source.learningId &&
        item.strategy ===
        selectedStrategy.strategy
    );

  assert(
    plannedStrategy,
    "The source lesson strategy must reach the new plan"
  );

  console.log(
    "PASS: Retrieved strategy reaches the new task plan"
  );

  const strategyVerification =
    Array.isArray(
      result.plan.verificationPlan
    )
      ? result.plan.verificationPlan.find(
          check =>
            typeof check.checkId === "string" &&
            check.checkId.startsWith(
              "experience-strategy-"
            )
        )
      : null;

  assert(
    strategyVerification,
    "Strategy must influence planning verification guidance"
  );

  assert(
    strategyVerification.required === false,
    "Learned strategy must remain non-authorizing guidance"
  );

  console.log(
    "PASS: Learned strategy influences verification planning"
  );

  assert(
    result.executionAllowed === false,
    "Planner result must not authorize execution"
  );

  assert(
    result.planningOnly === true,
    "Planner result must remain planning-only"
  );

  assert(
    result.experienceGuidance.executionAuthorization ===
      false,
    "Experience guidance must not authorize execution"
  );

  for (
    const strategy of
    result.experienceGuidance.strategies
  ) {
    assert(
      strategy.governance.executable === false,
      "Strategy must not be executable"
    );

    assert(
      strategy.governance.modifiesCode === false,
      "Strategy must not modify code"
    );

    assert(
      strategy.governance.bypassesPolicy === false,
      "Strategy must not bypass policy"
    );

    assert(
      strategy.governance.requiresNormalTaskChecks === true,
      "Normal task checks must remain required"
    );
  }

  console.log(
    "PASS: Strategy governance boundaries remain enforced"
  );

  const after =
    readStore();

  assert.strictEqual(
    after,
    before,
    "Planning must not modify source learning memory"
  );

  console.log(
    "PASS: Strategy-aware planning is read-only"
  );

  const validation =
    planner.validatePlan(
      result.plan
    );

  assert(
    validation.valid === true,
    "Strategy-aware plan must remain valid"
  );

  console.log(
    "PASS: Strategy-aware plan remains schema-valid"
  );

  console.log(
    "\nSTAGE6_4_6_2_STRATEGY_AWARE_PLANNING: PASS"
  );
}

main().catch(error => {
  console.error(
    "\nSTAGE6_4_6_2_STRATEGY_AWARE_PLANNING: FAIL"
  );
  console.error(
    error && error.stack
      ? error.stack
      : error
  );
  process.exit(1);
});
