"use strict";

require("dotenv").config();

const assert = require("assert");

const {
  createTaskPlan,
  replanTask,
  validatePlan
} = require("../services/mira-task-planner");

async function main() {
  // 1. Simple task
  const simple = await createTaskPlan(
    "Write a short research summary."
  );

  assert.strictEqual(simple.success, true);
  assert.strictEqual(simple.decision, "PLAN_VALID");
  assert.ok(simple.plan.subtasks.length >= 1);
  assert.strictEqual(simple.executionAllowed, false);
  assert.strictEqual(simple.planningOnly, true);

  // 2. Multi-step task
  const multi = await createTaskPlan(
    "Research cybersecurity careers and then organize the findings into a report. Create a research summary and report."
  );

  assert.strictEqual(multi.success, true);
  assert.ok(multi.plan.subtasks.length >= 3);
  assert.ok(
    multi.plan.subtasks.some(
      item => item.dependencies.length > 0
    )
  );

  // 3. Dependency ordering
  const dependencyValidation = validatePlan(multi.plan);

  assert.strictEqual(dependencyValidation.valid, true);
  assert.strictEqual(
    dependencyValidation.errors.length,
    0
  );

  // 4. Missing requirement
  const missing = await createTaskPlan(
    "Analyze the dataset and create a report."
  );

  assert.strictEqual(missing.decision, "BLOCK");
  assert.strictEqual(
    missing.plan.feasibility,
    "blocked_missing_requirements"
  );
  assert.ok(
    missing.plan.missingRequirements.length > 0
  );

  // 5. Impossible task
  const impossible = await createTaskPlan(
    "Teleport to another country and return the result."
  );

  assert.strictEqual(impossible.decision, "REJECT");
  assert.strictEqual(
    impossible.plan.feasibility,
    "infeasible"
  );
  assert.strictEqual(
    impossible.executionAllowed,
    false
  );

  // 6. Invalid dependency
  const invalid = JSON.parse(
    JSON.stringify(multi.plan)
  );

  invalid.subtasks[1].dependencies = [
    "does-not-exist"
  ];

  const invalidResult = validatePlan(invalid);

  assert.strictEqual(invalidResult.valid, false);
  assert.ok(
    invalidResult.errors.some(
      error => error.includes("unknown dependency")
    )
  );

  // 7. Dependency cycle
  const cycle = JSON.parse(
    JSON.stringify(multi.plan)
  );

  cycle.subtasks[0].dependencies = [
    cycle.subtasks[1].id
  ];

  const cycleResult = validatePlan(cycle);

  assert.strictEqual(cycleResult.valid, false);
  assert.ok(
    cycleResult.errors.some(
      error => error.includes("Dependency cycle")
    )
  );

  // 8. Verification plan
  assert.ok(
    Array.isArray(multi.plan.verificationPlan)
  );
  assert.ok(
    multi.plan.verificationPlan.length > 0
  );

  // 9. Deliverable definition
  assert.ok(multi.plan.deliverable);
  assert.ok(
    multi.plan.deliverable.acceptanceCriteria.length > 0
  );

  // 10. Re-planning
  const replanned = await replanTask(
    "Research cybersecurity careers and create a report.",
    {
      previousPlanId: multi.plan.id,
      previousVersion: multi.plan.version,
      failure: "The first research source was unavailable.",
      newInformation:
        "Use another reliable source instead."
    }
  );

  assert.strictEqual(replanned.success, true);
  assert.strictEqual(
    replanned.plan.version,
    multi.plan.version + 1
  );
  assert.strictEqual(
    replanned.plan.parentPlanId,
    multi.plan.id
  );
  assert.ok(
    replanned.plan.replanningReason.includes(
      "first research source"
    )
  );
  assert.strictEqual(
    replanned.executionAllowed,
    false
  );

  // 11. Explicit authorization boundary
  assert.strictEqual(
    simple.plan.executionAllowed,
    false
  );
  assert.strictEqual(
    multi.plan.executionAllowed,
    false
  );
  assert.strictEqual(
    replanned.plan.executionAllowed,
    false
  );

  console.log(
    "STAGE5_3_TASK_PLANNING_E2E: PASS"
  );
}

main().catch(error => {
  console.error(
    "STAGE5_3_TASK_PLANNING_E2E: FAIL"
  );
  console.error(error.stack || error);
  process.exitCode = 1;
});
