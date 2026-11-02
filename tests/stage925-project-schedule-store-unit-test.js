"use strict";

const fs = require("fs");

const {
  createStoredProject,
  deleteProject
} = require("../project-store");

const {
  createStoredProjectSchedule,
  getSchedule,
  listSchedules,
  countSchedules,
  updateProjectSchedule,
  deleteProjectSchedule
} = require("../project-schedule-store");

const {
  getTaskSummary
} = require("../task-store");

const {
  createStoredWorkAcceptance
} = require("../work-acceptance-store");

const {
  getScheduleStorePath
} = require("../project-schedule-store");

const PROJECT_FILE =
  require("../project-store").PROJECT_FILE;

const ACCEPTANCE_FILE =
  require("../work-acceptance-store").WORK_ACCEPTANCE_FILE;

const SCHEDULE_FILE =
  getScheduleStorePath();

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

const originalSchedules =
  fs.readFileSync(
    SCHEDULE_FILE,
    "utf8"
  );

const originalTaskSummary =
  JSON.stringify(getTaskSummary());

let projectId =
  "stage925-test-project";

let acceptanceId =
  "stage925-test-acceptance";

let scheduleId =
  "stage925-test-schedule";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function restore() {
  fs.writeFileSync(
    PROJECT_FILE,
    originalProjects,
    "utf8"
  );

  fs.writeFileSync(
    ACCEPTANCE_FILE,
    originalAcceptances,
    "utf8"
  );

  fs.writeFileSync(
    SCHEDULE_FILE,
    originalSchedules,
    "utf8"
  );
}

try {
  console.log(
    "=== STAGE 9.2.5 PROJECT SCHEDULE STORE UNIT TEST ==="
  );

  const acceptance =
    createStoredWorkAcceptance({
      acceptanceId,
      opportunityId:
        "stage925-test-opportunity",
      proposalId:
        "stage925-test-proposal",
      clientResponseId:
        "stage925-test-response",
      status: "accepted",
      acceptanceDecision: {
        decision: "accept",
        reason:
          "Stage 9.2.5 store test acceptance."
      },
      workScope: {
        scopeId:
          "stage925-test-scope",
        summary:
          "Stage 9.2.5 schedule store test scope.",
        deliverables: [
          "Test deliverable"
        ],
        exclusions: [],
        createdAt:
          new Date().toISOString()
      }
    });

  assert(
    acceptance.status === "accepted",
    "Accepted Work Acceptance was not created."
  );

  const project =
    createStoredProject({
      projectId,
      acceptanceId,
      opportunityId:
        "stage925-test-opportunity",
      qualificationId:
        "stage925-test-qualification",
      proposalId:
        "stage925-test-proposal",
      clientResponseId:
        "stage925-test-response",
      workScopeSnapshot: {
        scopeId:
          "stage925-test-scope",
        summary:
          "Stage 9.2.5 schedule store test scope.",
        deliverables: [
          "Test deliverable"
        ],
        exclusions: [],
        createdAt:
          new Date().toISOString()
      },
      deliverables: [
        "Test deliverable"
      ],
      taskIds: []
    });

  assert(
    project.status === "planning",
    "Project must remain planning."
  );

  console.log(
    "[1] PLANNING PROJECT CREATED: PASS"
  );

  const schedule =
    createStoredProjectSchedule({
      scheduleId,
      projectId,
      entries: [
        {
          taskId:
            "stage925-task-1",
          planId:
            "stage925-plan-1",
          sequence: 1,
          dependencies: [],
          deadline: "tomorrow",
          estimatedDuration: null,
          scheduledStart: "",
          scheduledEnd: "",
          status: "planned"
        },
        {
          taskId:
            "stage925-task-2",
          planId:
            "stage925-plan-2",
          sequence: 2,
          dependencies: [
            "stage925-task-1"
          ],
          deadline: "Friday",
          estimatedDuration: 60,
          scheduledStart: "",
          scheduledEnd: "",
          status: "planned"
        }
      ]
    });

  assert(
    schedule.scheduleId === scheduleId,
    "Created schedule ID mismatch."
  );

  assert(
    schedule.projectId === projectId,
    "Created schedule project ID mismatch."
  );

  assert(
    schedule.entries.length === 2,
    "Expected two schedule entries."
  );

  console.log(
    "[2] SCHEDULE CREATION: PASS"
  );

  const fetched =
    getSchedule(scheduleId);

  assert(
    fetched &&
      fetched.scheduleId === scheduleId,
    "Created schedule could not be retrieved."
  );

  console.log(
    "[3] GET SCHEDULE: PASS"
  );

  assert(
    listSchedules({
      projectId
    }).length === 1,
    "Project schedule listing failed."
  );

  assert(
    listSchedules({
      status: schedule.status
    }).some(
      item => item.scheduleId === scheduleId
    ),
    "Status schedule listing failed."
  );

  const scheduleCountAfterCreate =
    countSchedules();

  assert(
    scheduleCountAfterCreate >= 1,
    "Created schedule must be counted."
  );

  console.log(
    "[4] LIST AND COUNT: PASS"
  );

  let duplicateBlocked = false;

  try {
    createStoredProjectSchedule({
      scheduleId,
      projectId,
      entries: []
    });
  } catch (error) {
    duplicateBlocked = true;
  }

  assert(
    duplicateBlocked,
    "Duplicate schedule ID was not blocked."
  );

  console.log(
    "[5] DUPLICATE SCHEDULE BLOCKED: PASS"
  );

  const updated =
    updateProjectSchedule(
      scheduleId,
      {
        status: "blocked"
      }
    );

  assert(
    updated.status === "blocked",
    "Schedule status update failed."
  );

  assert(
    updated.executionAllowed === false &&
      updated.planningOnly === true,
    "Schedule safety flags changed during update."
  );

  console.log(
    "[6] SCHEDULE UPDATE: PASS"
  );

  let missingProjectBlocked = false;

  try {
    createStoredProjectSchedule({
      scheduleId:
        "stage925-missing-project",
      projectId:
        "stage925-missing-project",
      entries: []
    });
  } catch (error) {
    missingProjectBlocked = true;
  }

  assert(
    missingProjectBlocked,
    "Missing project schedule creation was not blocked."
  );

  console.log(
    "[7] MISSING PROJECT BLOCKED: PASS"
  );

  const deleted =
    deleteProjectSchedule(
      scheduleId
    );

  assert(
    deleted &&
      deleted.scheduleId === scheduleId,
    "Schedule deletion failed."
  );

  assert(
    getSchedule(scheduleId) === null,
    "Deleted schedule is still retrievable."
  );

  assert(
    !getSchedule(scheduleId),
    "Deleted schedule must no longer be retrievable."
  );

  assert(
    listSchedules({
      projectId
    }).every(
      item => item.scheduleId !== scheduleId
    ),
    "Deleted schedule must be absent from project listing."
  );

  console.log(
    "[8] SCHEDULE DELETE: PASS"
  );

  const finalTaskSummary =
    JSON.stringify(
      getTaskSummary()
    );

  assert(
    finalTaskSummary ===
      originalTaskSummary,
    "Existing task system was modified."
  );

  console.log(
    "[9] TASK SYSTEM NON-INTERFERENCE: PASS"
  );

  console.log(
    "\nSTAGE925_PROJECT_SCHEDULE_STORE_UNIT_TEST: PASS"
  );
} catch (error) {
  console.error(
    "\nSTAGE925_PROJECT_SCHEDULE_STORE_UNIT_TEST: FAIL"
  );

  console.error(
    error.stack || error.message
  );

  process.exitCode = 1;
} finally {
  try {
    restore();
    console.log(
      "\nTEST DATA RESTORED"
    );
  } catch (restoreError) {
    console.error(
      "RESTORE FAILED:",
      restoreError.message
    );
    process.exitCode = 1;
  }
}
