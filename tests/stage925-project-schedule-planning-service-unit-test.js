"use strict";

const fs = require("fs");

const {
  createStoredProject
} = require("../project-store");

const {
  createStoredWorkAcceptance
} = require("../work-acceptance-store");

const {
  initializeProjectTasks
} = require("../services/mira-project-task-initialization-service");

const {
  createProjectSchedulePlan,
  buildScheduleEntry,
  getScheduleForProject
} = require("../services/mira-project-schedule-planning-service");

const {
  getSchedule
} = require("../project-schedule-store");

const {
  getTask,
  getTaskSummary
} = require("../task-store");

const PROJECT_FILE =
  require("../project-store").PROJECT_FILE;

const ACCEPTANCE_FILE =
  require("../work-acceptance-store").WORK_ACCEPTANCE_FILE;

const SCHEDULE_FILE =
  require("../project-schedule-store").getScheduleStorePath();

const TASK_FILE =
  require("../task-store").TASK_FILE;

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

const originalTasks =
  fs.readFileSync(
    TASK_FILE,
    "utf8"
  );

const originalTaskSummary =
  JSON.stringify(
    getTaskSummary()
  );

const projectId =
  "stage925-service-project";

const acceptanceId =
  "stage925-service-acceptance";

const scheduleId =
  "stage925-service-schedule";

function assert(
  condition,
  message
) {
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

  fs.writeFileSync(
    TASK_FILE,
    originalTasks,
    "utf8"
  );
}

async function main() {
  console.log(
    "=== STAGE 9.2.5 PROJECT SCHEDULE PLANNING SERVICE UNIT TEST ==="
  );

  const acceptance =
    createStoredWorkAcceptance({
      acceptanceId,
      opportunityId:
        "stage925-service-opportunity",
      proposalId:
        "stage925-service-proposal",
      clientResponseId:
        "stage925-service-response",
      status: "accepted",
      acceptanceDecision: {
        decision: "accept",
        reason:
          "Stage 9.2.5 service test acceptance."
      },
      workScope: {
        scopeId:
          "stage925-service-scope",
        summary:
          "Stage 9.2.5 schedule planning service test scope.",
        deliverables: [
          "Schedule planning test result"
        ],
        exclusions: [],
        createdAt:
          new Date().toISOString()
      }
    });

  assert(
    acceptance.status === "accepted",
    "Accepted Work Acceptance creation failed."
  );

  const project =
    createStoredProject({
      projectId,
      acceptanceId,
      opportunityId:
        "stage925-service-opportunity",
      qualificationId:
        "stage925-service-qualification",
      proposalId:
        "stage925-service-proposal",
      clientResponseId:
        "stage925-service-response",
      workScopeSnapshot: {
        scopeId:
          "stage925-service-scope",
        summary:
          "Stage 9.2.5 schedule planning service test scope.",
        deliverables: [
          "Schedule planning test result"
        ],
        exclusions: [],
        createdAt:
          new Date().toISOString()
      },
      deliverables: [
        "Schedule planning test result"
      ],
      taskIds: []
    });

  assert(
    project.status === "planning",
    "Project is not planning."
  );

  console.log(
    "[1] PLANNING PROJECT CREATED: PASS"
  );

  const taskInitialization =
    initializeProjectTasks({
      projectId,
      tasks: [
        {
          title:
            "Research cybersecurity scheduling requirements",
          description:
            "Research scheduling requirements and prepare a structured result.",
          type:
            "research",
          requirements: [
            "Use reliable sources"
          ],
          deliverables: [
            "Research scheduling report"
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
            "Write the schedule planning summary",
          description:
            "Write a concise schedule planning summary.",
          type:
            "writing",
          requirements: [],
          deliverables: [
            "Schedule planning summary"
          ],
          deadline:
            "Friday",
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

  assert(
    taskInitialization.tasks.length === 2,
    "Expected two initialized tasks."
  );

  assert(
    taskInitialization.project.taskIds.length === 2,
    "Project task linkage failed."
  );

  const taskSummaryAfterInitialization =
    JSON.stringify(
      getTaskSummary()
    );

  const taskFileAfterInitialization =
    fs.readFileSync(
      TASK_FILE,
      "utf8"
    );

  console.log(
    "[2] LINKED TASKS INITIALIZED: PASS"
  );

  for (
    const taskId of
    taskInitialization.project.taskIds
  ) {
    const task =
      getTask(taskId);

    assert(
      task &&
        task.status === "new",
      `Task is not new: ${taskId}`
    );
  }

  console.log(
    "[3] TASKS REMAIN NEW: PASS"
  );

  const result =
    await createProjectSchedulePlan({
      projectId,
      scheduleId,
      persistUnderstanding:
        false
    });

  assert(
    result.projectId === projectId,
    "Result project ID mismatch."
  );

  assert(
    result.taskIds.length === 2,
    "Expected two planned task IDs."
  );

  assert(
    result.plans.length === 2,
    "Expected one plan per task."
  );

  assert(
    result.schedule.scheduleId ===
      scheduleId,
    "Schedule ID mismatch."
  );

  assert(
    result.schedule.projectId ===
      projectId,
    "Schedule project ID mismatch."
  );

  console.log(
    "[4] SCHEDULE PLANNING CREATED: PASS"
  );

  assert(
    result.plans.every(
      item =>
        item.plan.taskId ===
        item.taskId
    ),
    "Plan task IDs do not match source tasks."
  );

  assert(
    result.plans.every(
      item =>
        item.validation.valid === true
    ),
    "One or more generated plans failed validation."
  );

  console.log(
    "[5] PLAN LINKAGE AND VALIDATION: PASS"
  );

  assert(
    result.schedule.entries.length === 2,
    "Expected one schedule entry per linked task."
  );

  assert(
    result.schedule.entries[0].sequence === 1 &&
      result.schedule.entries[1].sequence === 2,
    "Schedule sequence is incorrect."
  );

  assert(
    result.schedule.entries[0].taskId ===
      result.taskIds[0] &&
      result.schedule.entries[1].taskId ===
      result.taskIds[1],
    "Schedule task linkage is incorrect."
  );

  assert(
    result.schedule.entries[0].planId ===
      result.plans[0].plan.id &&
      result.schedule.entries[1].planId ===
      result.plans[1].plan.id,
    "Schedule plan linkage is incorrect."
  );

  console.log(
    "[6] ONE ENTRY PER TASK AND SEQUENCE: PASS"
  );

  assert(
    result.schedule.entries[0].deadline ===
      "tomorrow",
    "First task deadline was not preserved."
  );

  assert(
    result.schedule.entries[1].deadline ===
      "Friday",
    "Second task deadline was not preserved."
  );

  assert(
    result.schedule.entries.every(
      entry =>
        entry.estimatedDuration ===
          null &&
        entry.scheduledStart === "" &&
        entry.scheduledEnd === ""
    ),
    "Scheduler invented timing data."
  );

  console.log(
    "[7] DEADLINE PRESERVATION AND NO GUESSED TIMING: PASS"
  );

  const schedule =
    result.schedule;

  assert(
    schedule.executionAllowed ===
      false &&
      schedule.planningOnly ===
        true &&
      schedule.externalActionPerformed ===
        false &&
      schedule.paymentAllowed ===
        false &&
      schedule.paymentTransferAuthorized ===
        false &&
      schedule.contractSigningAllowed ===
        false,
    "Schedule safety flags are invalid."
  );

  assert(
    result.executionAllowed ===
      false &&
      result.planningOnly ===
        true,
    "Service execution safety flags are invalid."
  );

  console.log(
    "[8] EXECUTION AND EXTERNAL ACTION SAFETY: PASS"
  );

  const stored =
    getSchedule(scheduleId);

  assert(
    stored &&
      stored.projectId === projectId,
    "Stored project schedule could not be retrieved."
  );

  assert(
    getScheduleForProject(projectId) &&
      getScheduleForProject(projectId)
        .scheduleId === scheduleId,
    "Project schedule lookup failed."
  );

  console.log(
    "[9] SCHEDULE PERSISTENCE AND PROJECT LOOKUP: PASS"
  );

  const duplicateBlocked =
    await (async () => {
      try {
        await createProjectSchedulePlan({
          projectId,
          scheduleId:
            "stage925-service-duplicate",
          persistUnderstanding:
            false
        });

        return false;
      } catch (error) {
        return true;
      }
    })();

  assert(
    duplicateBlocked,
    "Duplicate project schedule was not blocked."
  );

  console.log(
    "[10] DUPLICATE PROJECT SCHEDULE BLOCKED: PASS"
  );

  const currentProject =
    require("../project-store").getProject(
      projectId
    );

  assert(
    currentProject.status ===
      "planning",
    "Project status changed during schedule planning."
  );

  assert(
    currentProject.executionAllowed ===
      false &&
      currentProject.planningOnly ===
        true,
    "Project safety flags changed."
  );

  console.log(
    "[11] PROJECT REMAINS PLANNING: PASS"
  );

  const finalTaskSummary =
    JSON.stringify(
      getTaskSummary()
    );

  assert(
    finalTaskSummary ===
      taskSummaryAfterInitialization,
    "Schedule planning modified the task summary."
  );

  console.log(
    "[12] EXISTING TASK SYSTEM NON-INTERFERENCE: PASS"
  );

  const taskFileAfterPlanning =
    fs.readFileSync(
      TASK_FILE,
      "utf8"
    );

  assert(
    taskFileAfterPlanning ===
      taskFileAfterInitialization,
    "Schedule planning modified the task store."
  );

  console.log(
    "[13] TASK STORE INTEGRITY CHECK: PASS"
  );

  console.log(
    "\nSTAGE925_PROJECT_SCHEDULE_PLANNING_SERVICE_UNIT_TEST: PASS"
  );
}

(async () => {
  try {
    await main();
  } catch (error) {
    console.error(
      "\nSTAGE925_PROJECT_SCHEDULE_PLANNING_SERVICE_UNIT_TEST: FAIL"
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

      console.log(
        "POST-RESTORE SCHEDULE STORE:"
      );

      console.log(
        fs.readFileSync(
          SCHEDULE_FILE,
          "utf8"
        )
      );

      console.log(
        "POST-RESTORE TASK SUMMARY:"
      );

      console.log(
        JSON.stringify(
          getTaskSummary()
        )
      );
    } catch (restoreError) {
      console.error(
        "RESTORE FAILED:",
        restoreError.message
      );

      process.exitCode = 1;
    }
  }
})();
