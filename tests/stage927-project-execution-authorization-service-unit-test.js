"use strict";

const assert = require("assert");

const {
  getProject,
  listProjects
} = require("../project-store");

const {
  getSchedule,
  listSchedules
} = require("../project-schedule-store");

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
      return { project, schedule };
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
      `readiness-stage927-${Date.now()}`,
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

function snapshotState(projectId, scheduleId) {
  return {
    project: getProject(projectId),
    schedule: getSchedule(scheduleId)
  };
}

function assertUnchanged(before, after) {
  assert.deepStrictEqual(
    after.project,
    before.project
  );

  assert.deepStrictEqual(
    after.schedule,
    before.schedule
  );
}

console.log(
  "\n=== STAGE 9.2.7 AUTHORIZATION SERVICE UNIT TEST ===\n"
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`[FAIL] ${name}`);
    console.log(error.message);
    failed += 1;
  }
}

const fixture = findFixture();
const project = fixture.project;
const schedule = fixture.schedule;

console.log(
  `FIXTURE_PROJECT=${project.projectId}`
);
console.log(
  `FIXTURE_SCHEDULE=${schedule.scheduleId}`
);

test("READY project is authorized", () => {
  const readiness =
    buildReadiness(
      project,
      schedule
    );

  const result =
    evaluateProjectExecutionAuthorization({
      projectId: project.projectId,
      scheduleId: schedule.scheduleId,
      readiness,
      authorizationId:
        "auth-stage927-unit-ready",
      authorizedBy: "test-admin"
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
    result.validation.valid,
    true
  );
});

test("Authorization remains non-executable", () => {
  const readiness =
    buildReadiness(
      project,
      schedule
    );

  const result =
    evaluateProjectExecutionAuthorization({
      projectId: project.projectId,
      scheduleId: schedule.scheduleId,
      readiness,
      authorizationId:
        "auth-stage927-unit-safety"
    });

  assert.strictEqual(
    result.authorization.executionAllowed,
    false
  );

  assert.strictEqual(
    result.authorization.planningOnly,
    true
  );

  assert.strictEqual(
    result.authorization.externalActionPerformed,
    false
  );

  assert.strictEqual(
    result.authorization.paymentAllowed,
    false
  );

  assert.strictEqual(
    result.authorization.paymentTransferAuthorized,
    false
  );

  assert.strictEqual(
    result.authorization.contractSigningAllowed,
    false
  );
});

test("BLOCKED readiness blocks authorization", () => {
  const readiness =
    buildReadiness(
      project,
      schedule,
      {
        status: "blocked",
        decision: "blocked"
      }
    );

  const result =
    evaluateProjectExecutionAuthorization({
      projectId: project.projectId,
      scheduleId: schedule.scheduleId,
      readiness,
      authorizationId:
        "auth-stage927-unit-blocked"
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
});

test("Readiness project mismatch blocks authorization", () => {
  const readiness =
    buildReadiness(
      project,
      schedule,
      {
        projectId: "wrong-project-id"
      }
    );

  const result =
    evaluateProjectExecutionAuthorization({
      projectId: project.projectId,
      scheduleId: schedule.scheduleId,
      readiness,
      authorizationId:
        "auth-stage927-unit-project-mismatch"
    });

  assert.strictEqual(
    result.authorization.status,
    "blocked"
  );
});

test("Readiness schedule mismatch blocks authorization", () => {
  const readiness =
    buildReadiness(
      project,
      schedule,
      {
        scheduleId: "wrong-schedule-id"
      }
    );

  const result =
    evaluateProjectExecutionAuthorization({
      projectId: project.projectId,
      scheduleId: schedule.scheduleId,
      readiness,
      authorizationId:
        "auth-stage927-unit-schedule-mismatch"
    });

  assert.strictEqual(
    result.authorization.status,
    "blocked"
  );
});

test("Unsafe readiness is blocked", () => {
  const readiness =
    buildReadiness(
      project,
      schedule
    );

  readiness.executionAllowed = true;

  const result =
    evaluateProjectExecutionAuthorization({
      projectId: project.projectId,
      scheduleId: schedule.scheduleId,
      readiness,
      authorizationId:
        "auth-stage927-unit-unsafe-readiness"
    });

  assert.strictEqual(
    result.authorization.status,
    "blocked"
  );
});

test("Missing project is rejected", () => {
  const readiness = {
    readinessId:
      "readiness-stage927-missing-project",
    projectId: "missing-project",
    scheduleId: schedule.scheduleId,
    status: "ready",
    decision: "ready",
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false
  };

  assert.throws(
    () =>
      evaluateProjectExecutionAuthorization({
        projectId: "missing-project",
        scheduleId: schedule.scheduleId,
        readiness
      }),
    /Project not found/
  );
});

test("Missing schedule is rejected", () => {
  const readiness = buildReadiness(
    project,
    schedule,
    {
      scheduleId: "missing-schedule"
    }
  );

  assert.throws(
    () =>
      evaluateProjectExecutionAuthorization({
        projectId: project.projectId,
        scheduleId: "missing-schedule",
        readiness
      }),
    /Schedule not found/
  );
});

test("Authorization evaluation does not mutate stores", () => {
  const before =
    snapshotState(
      project.projectId,
      schedule.scheduleId
    );

  const readiness =
    buildReadiness(
      project,
      schedule
    );

  evaluateProjectExecutionAuthorization({
    projectId: project.projectId,
    scheduleId: schedule.scheduleId,
    readiness,
    authorizationId:
      "auth-stage927-unit-noninterference"
  });

  const after =
    snapshotState(
      project.projectId,
      schedule.scheduleId
    );

  assertUnchanged(
    before,
    after
  );
});

test("Explicit authorization identity is preserved", () => {
  const readiness =
    buildReadiness(
      project,
      schedule
    );

  const result =
    evaluateProjectExecutionAuthorization({
      projectId: project.projectId,
      scheduleId: schedule.scheduleId,
      readiness,
      authorizationId:
        "auth-stage927-explicit-id",
      authorizedBy: "test-admin"
    });

  assert.strictEqual(
    result.authorization.authorizationId,
    "auth-stage927-explicit-id"
  );

  assert.strictEqual(
    result.authorization.authorizedBy,
    "test-admin"
  );
});

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
  "\nSTAGE927_PROJECT_EXECUTION_AUTHORIZATION_SERVICE_UNIT_TEST: PASS\n"
);
