"use strict";

const assert = require("assert");

const {
  listProjects,
  getProject
} = require("../project-store");

const {
  listSchedules,
  getSchedule
} = require("../project-schedule-store");

const {
  listTasks,
  getTask
} = require("../task-store");

const {
  evaluateProjectExecutionAuthorization
} = require("../services/mira-project-execution-authorization-service");

function findFixture() {
  const projects = listProjects({
    status: "planning"
  });

  const schedules = listSchedules({
    status: "planned"
  });

  for (const project of projects) {
    const schedule = schedules.find(
      item => item.projectId === project.projectId
    );

    if (schedule) {
      return {
        project,
        schedule
      };
    }
  }

  throw new Error(
    "No planning project with planned schedule fixture found."
  );
}

function buildReadiness(
  project,
  schedule,
  overrides = {}
) {
  return {
    readinessId:
      overrides.readinessId ||
      `readiness-stage927-e2e-${Date.now()}`,

    projectId:
      overrides.projectId === undefined
        ? project.projectId
        : overrides.projectId,

    scheduleId:
      overrides.scheduleId === undefined
        ? schedule.scheduleId
        : overrides.scheduleId,

    status:
      overrides.status === undefined
        ? "ready"
        : overrides.status,

    decision:
      overrides.decision === undefined
        ? "ready"
        : overrides.decision,

    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false
  };
}

function snapshotState(
  projectId,
  scheduleId,
  taskIds
) {
  return {
    project: getProject(projectId),
    schedule: getSchedule(scheduleId),
    tasks: taskIds.map(
      taskId => getTask(taskId)
    )
  };
}

function assertStateUnchanged(
  before,
  after
) {
  assert.deepStrictEqual(
    after.project,
    before.project
  );

  assert.deepStrictEqual(
    after.schedule,
    before.schedule
  );

  assert.deepStrictEqual(
    after.tasks,
    before.tasks
  );
}

console.log(
  "\n=== STAGE 9.2.7 PROJECT EXECUTION AUTHORIZATION E2E TEST ===\n"
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();

    console.log(
      `[PASS] ${name}`
    );

    passed += 1;
  } catch (error) {
    console.log(
      `[FAIL] ${name}`
    );

    console.log(
      error.message
    );

    failed += 1;
  }
}

const fixture = findFixture();

const project = fixture.project;
const schedule = fixture.schedule;

const taskIds = Array.isArray(project.taskIds)
  ? [...project.taskIds]
  : [];

console.log(
  `FIXTURE_PROJECT=${project.projectId}`
);

console.log(
  `FIXTURE_SCHEDULE=${schedule.scheduleId}`
);

console.log(
  `FIXTURE_TASK_COUNT=${taskIds.length}`
);

test(
  "READY readiness transitions to AUTHORIZED",
  () => {
    const readiness =
      buildReadiness(
        project,
        schedule,
        {
          readinessId:
            "readiness-stage927-e2e-authorized"
        }
      );

    const result =
      evaluateProjectExecutionAuthorization({
        projectId:
          project.projectId,

        scheduleId:
          schedule.scheduleId,

        readiness,

        authorizationId:
          "auth-stage927-e2e-authorized",

        authorizedBy:
          "stage927-e2e-test-admin"
      });

    assert.strictEqual(
      result.authorization.status,
      "authorized"
    );

    assert.strictEqual(
      result.authorization.decision,
      "authorize"
    );

    assert.strictEqual(
      result.authorization.readinessId,
      readiness.readinessId
    );

    assert.strictEqual(
      result.authorization.projectId,
      project.projectId
    );

    assert.strictEqual(
      result.authorization.scheduleId,
      schedule.scheduleId
    );

    assert.strictEqual(
      result.authorization.authorizedBy,
      "stage927-e2e-test-admin"
    );

    assert.strictEqual(
      result.validation.valid,
      true
    );
  }
);

test(
  "Authorization preserves the execution safety boundary",
  () => {
    const readiness =
      buildReadiness(
        project,
        schedule,
        {
          readinessId:
            "readiness-stage927-e2e-safety"
        }
      );

    const result =
      evaluateProjectExecutionAuthorization({
        projectId:
          project.projectId,

        scheduleId:
          schedule.scheduleId,

        readiness,

        authorizationId:
          "auth-stage927-e2e-safety"
      });

    const authorization =
      result.authorization;

    assert.strictEqual(
      authorization.authorizationRequired,
      true
    );

    assert.strictEqual(
      authorization.executionAllowed,
      false
    );

    assert.strictEqual(
      authorization.planningOnly,
      true
    );

    assert.strictEqual(
      authorization.externalActionPerformed,
      false
    );

    assert.strictEqual(
      authorization.paymentAllowed,
      false
    );

    assert.strictEqual(
      authorization.paymentTransferAuthorized,
      false
    );

    assert.strictEqual(
      authorization.contractSigningAllowed,
      false
    );
  }
);

test(
  "Authorization does not execute work",
  () => {
    const before =
      snapshotState(
        project.projectId,
        schedule.scheduleId,
        taskIds
      );

    const readiness =
      buildReadiness(
        project,
        schedule,
        {
          readinessId:
            "readiness-stage927-e2e-no-execution"
        }
      );

    const result =
      evaluateProjectExecutionAuthorization({
        projectId:
          project.projectId,

        scheduleId:
          schedule.scheduleId,

        readiness,

        authorizationId:
          "auth-stage927-e2e-no-execution"
      });

    assert.strictEqual(
      result.authorization.executionAllowed,
      false
    );

    const after =
      snapshotState(
        project.projectId,
        schedule.scheduleId,
        taskIds
      );

    assertStateUnchanged(
      before,
      after
    );
  }
);

test(
  "BLOCKED readiness remains BLOCKED",
  () => {
    const readiness =
      buildReadiness(
        project,
        schedule,
        {
          readinessId:
            "readiness-stage927-e2e-blocked",

          status:
            "blocked",

          decision:
            "blocked"
        }
      );

    const result =
      evaluateProjectExecutionAuthorization({
        projectId:
          project.projectId,

        scheduleId:
          schedule.scheduleId,

        readiness,

        authorizationId:
          "auth-stage927-e2e-blocked"
      });

    assert.strictEqual(
      result.authorization.status,
      "blocked"
    );

    assert.strictEqual(
      result.authorization.decision,
      "blocked"
    );

    assert.ok(
      result.authorization.blockingReasons.length > 0
    );

    assert.strictEqual(
      result.authorization.executionAllowed,
      false
    );
  }
);

test(
  "Mismatched readiness cannot authorize the project",
  () => {
    const readiness =
      buildReadiness(
        project,
        schedule,
        {
          readinessId:
            "readiness-stage927-e2e-mismatch",

          projectId:
            "wrong-project",

          scheduleId:
            "wrong-schedule"
        }
      );

    const result =
      evaluateProjectExecutionAuthorization({
        projectId:
          project.projectId,

        scheduleId:
          schedule.scheduleId,

        readiness,

        authorizationId:
          "auth-stage927-e2e-mismatch"
      });

    assert.strictEqual(
      result.authorization.status,
      "blocked"
    );

    assert.strictEqual(
      result.authorization.decision,
      "blocked"
    );

    assert.ok(
      result.authorization.blockingReasons.includes(
        "Readiness must belong to the same project and schedule."
      )
    );
  }
);

test(
  "Project and schedule remain unchanged after authorization",
  () => {
    const before =
      snapshotState(
        project.projectId,
        schedule.scheduleId,
        taskIds
      );

    const readiness =
      buildReadiness(
        project,
        schedule,
        {
          readinessId:
            "readiness-stage927-e2e-noninterference"
        }
      );

    evaluateProjectExecutionAuthorization({
      projectId:
        project.projectId,

      scheduleId:
        schedule.scheduleId,

      readiness,

      authorizationId:
        "auth-stage927-e2e-noninterference"
    });

    const after =
      snapshotState(
        project.projectId,
        schedule.scheduleId,
        taskIds
      );

    assertStateUnchanged(
      before,
      after
    );
  }
);

console.log(
  `\nPASSED=${passed}`
);

console.log(
  `FAILED=${failed}`
);

if (failed !== 0) {
  process.exit(1);
}

console.log(
  "\nSTAGE927_PROJECT_EXECUTION_AUTHORIZATION_E2E_TEST: PASS\n"
);
