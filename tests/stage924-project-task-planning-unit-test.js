"use strict";

const fs = require("fs");
const path = require("path");

const {
  getProject,
  createStoredProject
} = require("../project-store");

const {
  getTask,
  getTaskSummary
} = require("../task-store");

const {
  createStoredWorkAcceptance
} = require("../work-acceptance-store");

const {
  planProjectTasks
} = require("../services/mira-project-task-planning-service");

const PROJECT_FILE =
  path.join(__dirname, "..", "data", "projects.json");

const TASK_FILE =
  path.join(__dirname, "..", "data", "tasks.json");

const WORK_ACCEPTANCE_FILE =
  path.join(
    __dirname,
    "..",
    "data",
    "work-acceptances.json"
  );

const projectBackup =
  fs.readFileSync(PROJECT_FILE, "utf8");

const taskBackup =
  fs.readFileSync(TASK_FILE, "utf8");

const workAcceptanceBackup =
  fs.readFileSync(
    WORK_ACCEPTANCE_FILE,
    "utf8"
  );

function assert(condition, message) {
  if (!condition) {
    throw new Error(
      `FAIL: ${message}`
    );
  }
}

async function expectThrowAsync(
  fn,
  label
) {
  let thrown = false;

  try {
    await fn();
  } catch (error) {
    thrown = true;
    console.log(
      `PASS: ${label}`
    );
  }

  assert(
    thrown,
    `${label} should throw`
  );
}

async function main() {
  const originalSummary =
    getTaskSummary();

  assert(
    originalSummary.total > 0,
    "existing task total must remain unchanged"
  );

  assert(
    originalSummary.new >= 0,
    "existing task state must remain readable"
  );

  const tasksData =
    JSON.parse(taskBackup);

  assert(
    Array.isArray(tasksData.tasks) &&
    tasksData.tasks.length >= 2,
    "at least two existing tasks are required"
  );

  const taskIds = [
    tasksData.tasks[0].id,
    tasksData.tasks[1].id
  ];

  const firstTaskBefore =
    getTask(taskIds[0]);

  const secondTaskBefore =
    getTask(taskIds[1]);

  assert(
    firstTaskBefore &&
    secondTaskBefore,
    "existing test tasks must be retrievable"
  );

  const stamp =
    Date.now();

  const acceptanceId =
    `stage924-test-acceptance-${stamp}`;

  const projectId =
    `stage924-test-project-${stamp}`;

  try {
    const acceptance =
      createStoredWorkAcceptance({
        acceptanceId,
        opportunityId:
          `stage924-test-opportunity-${stamp}`,
        proposalId:
          `stage924-test-proposal-${stamp}`,
        clientResponseId:
          `stage924-test-response-${stamp}`,
        status: "accepted",
        acceptanceDecision: {
          decision: "accept",
          reason:
            "Stage 9.2.4 unit test acceptance"
        },
        workScope: {
          scopeId:
            `stage924-test-scope-${stamp}`,
          summary:
            "Stage 9.2.4 planning test scope",
          deliverables: [
            "Stage 9.2.4 planning output"
          ],
          exclusions: []
        }
      });

    assert(
      acceptance &&
      acceptance.acceptanceId === acceptanceId,
      "temporary accepted work acceptance"
    );

    console.log(
      "[0] ACCEPTED WORK ACCEPTANCE: PASS"
    );

    const created =
      createStoredProject({
        projectId,
        acceptanceId,
        opportunityId:
          acceptance.opportunityId,
        qualificationId:
          `stage924-test-qualification-${stamp}`,
        proposalId:
          acceptance.proposalId,
        clientResponseId:
          acceptance.clientResponseId,
        status: "planning",
        workScopeSnapshot: {
          scopeId:
            acceptance.workScope.scopeId,
          summary:
            acceptance.workScope.summary
        },
        deliverables:
          acceptance.workScope.deliverables,
        taskIds
      });

    assert(
      created &&
      created.projectId === projectId,
      "planning project creation"
    );

    console.log(
      "[1] PLANNING PROJECT RESOLUTION: PASS"
    );

    const project =
      getProject(projectId);

    assert(
      project &&
      project.status === "planning",
      "project must be planning"
    );

    const result =
      await planProjectTasks({
        projectId,
        persistUnderstanding: false
      });

    assert(
      result &&
      result.projectId === projectId,
      "planning result projectId"
    );

    console.log(
      "[2] LINKED TASKS RESOLVED: PASS"
    );

    assert(
      Array.isArray(result.plans),
      "plans must be an array"
    );

    assert(
      result.plans.length === taskIds.length,
      "one plan must exist per linked task"
    );

    console.log(
      "[3] ONE PLAN PER LINKED TASK: PASS"
    );

    const plannedIds =
      result.plans.map(
        item => item.taskId
      );

    assert(
      JSON.stringify(plannedIds) ===
      JSON.stringify(taskIds),
      "plan taskIds must match linked taskIds"
    );

    for (const item of result.plans) {
      assert(
        item.plan &&
        item.plan.taskId === item.taskId,
        `plan.taskId must match linked task ${item.taskId}`
      );
    }

    console.log(
      "[4] PLAN TASK IDS MATCH: PASS"
    );

    for (const item of result.plans) {
      assert(
        item.validation &&
        typeof item.validation.valid === "boolean",
        `planner validation missing for ${item.taskId}`
      );

      assert(
        item.validation.valid === true,
        `planner validation failed for ${item.taskId}`
      );

      assert(
        item.feasibility,
        `feasibility missing for ${item.taskId}`
      );

      assert(
        item.executionAllowed === false,
        `executionAllowed must be false for ${item.taskId}`
      );

      assert(
        item.planningOnly === true,
        `planningOnly must be true for ${item.taskId}`
      );

      assert(
        item.plan.executionAllowed === false,
        `plan executionAllowed must be false for ${item.taskId}`
      );

      assert(
        item.plan.planningOnly === true,
        `plan planningOnly must be true for ${item.taskId}`
      );
    }

    console.log(
      "[5] PLAN VALIDATION: PASS"
    );

    console.log(
      "[6] FEASIBILITY PRESENT: PASS"
    );

    console.log(
      "[7] EXECUTION SAFETY: PASS"
    );

    console.log(
      "[8] PLANNING-ONLY SAFETY: PASS"
    );

    const unchangedProject =
      getProject(projectId);

    assert(
      unchangedProject.status === "planning",
      "project status must remain planning"
    );

    assert(
      unchangedProject.taskIds.length ===
      taskIds.length,
      "project task linkage must remain unchanged"
    );

    console.log(
      "[9] PROJECT STATUS REMAINS PLANNING: PASS"
    );

    const firstTaskAfter =
      getTask(taskIds[0]);

    const secondTaskAfter =
      getTask(taskIds[1]);

    assert(
      firstTaskAfter.status === "new" &&
      secondTaskAfter.status === "new",
      "task statuses must remain new"
    );

    assert(
      JSON.stringify(firstTaskBefore) ===
      JSON.stringify(firstTaskAfter),
      "first existing task must remain unchanged"
    );

    assert(
      JSON.stringify(secondTaskBefore) ===
      JSON.stringify(secondTaskAfter),
      "second existing task must remain unchanged"
    );

    console.log(
      "[10] TASK STATUS REMAINS NEW: PASS"
    );

    const finalSummary =
      getTaskSummary();

    assert(
      JSON.stringify(finalSummary) ===
      JSON.stringify(originalSummary),
      "existing task summary must remain unchanged"
    );

    console.log(
      "[11] EXISTING 81 TASKS UNCHANGED: PASS"
    );

    await expectThrowAsync(
      () =>
        planProjectTasks({
          projectId:
            "stage924-missing-project",
          persistUnderstanding: false
        }),
      "missing project blocked"
    );

    await expectThrowAsync(
      () =>
        planProjectTasks({
          projectId:
            projectId + "-missing",
          persistUnderstanding: false
        }),
      "unknown project blocked"
    );

    const projectsData =
      JSON.parse(
        fs.readFileSync(
          PROJECT_FILE,
          "utf8"
        )
      );

    const originalProject =
      projectsData.projects.find(
        project =>
          project.projectId === projectId
      );

    assert(
      originalProject &&
      originalProject.status === "planning",
      "temporary project remains planning"
    );

    console.log(
      "[12] INVALID PROJECT INPUT BLOCKED: PASS"
    );

    console.log(
      "\nSTAGE924_PROJECT_TASK_PLANNING_UNIT_TEST: PASS"
    );
  } finally {
    fs.writeFileSync(
      PROJECT_FILE,
      projectBackup
    );

    fs.writeFileSync(
      TASK_FILE,
      taskBackup
    );

    fs.writeFileSync(
      WORK_ACCEPTANCE_FILE,
      workAcceptanceBackup
    );

    console.log(
      "\nTEST DATA RESTORED"
    );
  }
}

main().catch(error => {
  console.error(error);

  try {
    fs.writeFileSync(
      PROJECT_FILE,
      projectBackup
    );

    fs.writeFileSync(
      TASK_FILE,
      taskBackup
    );

    fs.writeFileSync(
      WORK_ACCEPTANCE_FILE,
      workAcceptanceBackup
    );

    console.log(
      "TEST DATA RESTORED AFTER FAILURE"
    );
  } catch (restoreError) {
    console.error(
      "RESTORE FAILED:",
      restoreError.message
    );
  }

  process.exit(1);
});
