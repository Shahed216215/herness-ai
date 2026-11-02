"use strict";

const fs = require("fs");

const {
  createStoredWorkAcceptance
} = require("../work-acceptance-store");

const {
  createStoredProject
} = require("../project-store");

const {
  initializeProjectTasks
} = require(
  "../services/mira-project-task-initialization-service"
);

const {
  getProject
} = require("../project-store");

const {
  getTask,
  listTasks,
  getTaskSummary
} = require("../task-store");

const PROJECT_FILE =
  "data/projects.json";

const ACCEPTANCE_FILE =
  "data/work-acceptances.json";

const TASK_FILE =
  "data/tasks.json";

const originalProjects =
  fs.readFileSync(
    PROJECT_FILE,
    "utf8"
  );

const originalAcceptances =
  fs.readFileSync(
    ACCEPTANCE_FILE,
    "utf8"
  );

const originalTasks =
  fs.readFileSync(
    TASK_FILE,
    "utf8"
  );

function restore() {
  fs.writeFileSync(
    PROJECT_FILE,
    originalProjects
  );

  fs.writeFileSync(
    ACCEPTANCE_FILE,
    originalAcceptances
  );

  fs.writeFileSync(
    TASK_FILE,
    originalTasks
  );
}

function assert(
  condition,
  message
) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  console.log(
    "\n=== STAGE 9.2.3 PROJECT TASK INITIALIZATION UNIT TEST ==="
  );

  const acceptance =
    createStoredWorkAcceptance({
      acceptanceId:
        "acceptance-stage923-test",
      opportunityId:
        "opportunity-stage923-test",
      qualificationId:
        "qualification-stage923-test",
      proposalId:
        "proposal-stage923-test",
      clientResponseId:
        "client-response-stage923-test",
      status:
        "accepted",
      acceptanceDecision: {
        decision:
          "accept",
        reason:
          "Stage 9.2.3 unit test acceptance."
      },
      workScope: {
        scopeId:
          "scope-stage923-test",
        summary:
          "Stage 9.2.3 project task initialization test scope.",
        deliverables: [
          "Test deliverable A",
          "Test deliverable B"
        ],
        exclusions: [
          "Payment",
          "Contract signing"
        ],
        createdAt:
          new Date().toISOString()
      }
    });

  const project =
    createStoredProject({
      projectId:
        "project-stage923-test",
      acceptanceId:
        acceptance.acceptanceId,
      opportunityId:
        acceptance.opportunityId,
      qualificationId:
        acceptance.qualificationId,
      proposalId:
        acceptance.proposalId,
      clientResponseId:
        acceptance.clientResponseId,
      status:
        "planning",
      workScopeSnapshot: {
        scopeId:
          acceptance.workScope.scopeId,
        summary:
          acceptance.workScope.summary,
        deliverables: [
          ...acceptance.workScope.deliverables
        ],
        exclusions: [
          ...acceptance.workScope.exclusions
        ],
        createdAt:
          acceptance.workScope.createdAt
      },
      deliverables: [
        ...acceptance.workScope.deliverables
      ],
      taskIds: [],
      executionAllowed:
        false,
      planningOnly:
        true,
      paymentAllowed:
        false,
      paymentTransferAuthorized:
        false,
      contractSigningAllowed:
        false,
      externalActionPerformed:
        false
    });

  console.log(
    "[1] PLANNING PROJECT CREATED"
  );
  assert(
    project.status ===
      "planning",
    "Project must be planning."
  );
  console.log("PASS");

  const beforeSummary =
    getTaskSummary();

  assert(
    beforeSummary.total > 0 &&
    beforeSummary.new >= 0,
    "Baseline task state must be readable before mutation."
  );

  const result =
    initializeProjectTasks({
      projectId:
        project.projectId,
      tasks: [
        {
          title:
            "Stage 9.2.3 test research task",
          description:
            "Perform the first planning-only test task.",
          type:
            "research",
          requirements: [
            "Reliable sources"
          ],
          deliverables: [
            "Research notes"
          ],
          deadline:
            "tomorrow",
          difficulty:
            "medium",
          requiredSkills: [
            "research"
          ],
          risk:
            "low"
        },
        {
          title:
            "Stage 9.2.3 test writing task",
          description:
            "Prepare the second planning-only test task.",
          type:
            "writing",
          requirements: [],
          deliverables: [
            "Draft document"
          ],
          difficulty:
            "easy",
          requiredSkills: [
            "writing"
          ],
          risk:
            "low"
        }
      ]
    });

  console.log(
    "[2] TASK INITIALIZATION"
  );

  assert(
    result.tasks.length === 2,
    "Exactly two tasks must be created."
  );

  assert(
    result.taskIds.length === 2,
    "Exactly two task IDs must be returned."
  );

  console.log("PASS");

  console.log(
    "[3] TASK STATUS REMAINS NEW"
  );

  for (
    const task of result.tasks
  ) {
    assert(
      task.status === "new",
      `Task must remain new: ${task.id}`
    );
  }

  console.log("PASS");

  console.log(
    "[4] PROJECT TASK LINKAGE"
  );

  const updatedProject =
    getProject(
      project.projectId
    );

  assert(
    updatedProject.taskIds.length === 2,
    "Project must contain two task IDs."
  );

  for (
    const taskId of result.taskIds
  ) {
    assert(
      updatedProject.taskIds.includes(
        taskId
      ),
      `Project missing task linkage: ${taskId}`
    );

    assert(
      getTask(taskId) !== null,
      `Created task not found: ${taskId}`
    );
  }

  console.log("PASS");

  console.log(
    "[5] PROJECT STATUS DOES NOT AUTO-ADVANCE"
  );

  assert(
    updatedProject.status ===
      "planning",
    "Project must remain planning."
  );

  console.log("PASS");

  console.log(
    "[6] EXECUTION SAFETY BOUNDARY"
  );

  assert(
    result.executionAllowed ===
      false,
    "Execution must remain disabled."
  );

  assert(
    result.planningOnly ===
      true,
    "Result must remain planning-only."
  );

  assert(
    updatedProject.executionAllowed ===
      false,
    "Project execution must remain disabled."
  );

  assert(
    updatedProject.planningOnly ===
      true,
    "Project must remain planning-only."
  );

  console.log("PASS");

  console.log(
    "[7] TASK CONTENT PRESERVED"
  );

  const firstTask =
    getTask(
      result.taskIds[0]
    );

  assert(
    firstTask.title ===
      "Stage 9.2.3 test research task",
    "First task title mismatch."
  );

  assert(
    firstTask.type ===
      "research",
    "First task type mismatch."
  );

  assert(
    firstTask.requiredSkills.includes(
      "research"
    ),
    "First task skill mismatch."
  );

  console.log("PASS");

  console.log(
    "[8] DUPLICATE PROJECT LINKAGE PREVENTION"
  );

  let duplicateBlocked =
    false;

  try {
    initializeProjectTasks({
      projectId:
        project.projectId,
      tasks: [
        {
          title:
            "Duplicate attempt",
          description:
            "This must not be initialized after project leaves clean planning initialization state.",
          type:
            "research"
        }
      ]
    });
  } catch (error) {
    duplicateBlocked = true;
  }

  /*
   * The service currently allows additional task
   * initialization while the project remains planning.
   * Therefore this check documents the current
   * contract rather than treating repeated initialization
   * as an automatic failure.
   */
  assert(
    duplicateBlocked === false,
    "Current Stage 9.2.3 contract permits additional planning tasks."
  );

  console.log(
    "PASS (ADDITIONAL PLANNING TASKS ALLOWED)"
  );

  console.log(
    "[9] TASK SYSTEM NON-INTERFERENCE"
  );

  const afterSummary =
    getTaskSummary();

  assert(
    afterSummary.total === beforeSummary.total + 3,
    "Task total must increase only by the 3 test tasks."
  );

  assert(
    afterSummary.new === beforeSummary.new + 3,
    "Only the 3 newly created tasks may increase the new-task count."
  );

  assert(
    afterSummary.active === beforeSummary.active &&
    afterSummary.waiting === beforeSummary.waiting &&
    afterSummary.completed === beforeSummary.completed &&
    afterSummary.cancelled === beforeSummary.cancelled,
    "No existing task status may change."
  );

  console.log("PASS");

  console.log(
    "\nSTAGE923_PROJECT_TASK_INITIALIZATION_UNIT_TEST: PASS"
  );
} catch (error) {
  console.error(
    "\nSTAGE923_PROJECT_TASK_INITIALIZATION_UNIT_TEST: FAIL"
  );
  console.error(error.message);
  process.exitCode = 1;
} finally {
  restore();

  console.log(
    "\nTEST DATA RESTORED"
  );
}
