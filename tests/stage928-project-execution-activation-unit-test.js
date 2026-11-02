"use strict";

const assert = require("assert");

const {
  createActivationCheck,
  createProjectExecutionActivation,
  validateProjectExecutionActivation
} = require("../project-execution-activation-schema");

const {
  evaluateProjectExecutionActivation
} = require("../services/mira-project-execution-activation-service");

const {
  getProject
} = require("../project-store");

const {
  getSchedule
} = require("../project-schedule-store");

function logPass(name) {
  console.log(`PASS: ${name}`);
}

function makeAuthorization(projectId, scheduleId) {
  return {
    authorizationId: `authorization-test-${Date.now()}`,
    projectId,
    scheduleId,
    readinessId: "readiness-test",
    status: "authorized",
    decision: "authorize",
    checks: [
      {
        checkId: "authorization-test-check",
        passed: true,
        reason: "Authorization test check passed."
      }
    ],
    blockingReasons: [],
    authorizationRequired: true,
    authorizedBy: "unit-test",
    authorizationReason: "Unit test authorization.",
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false
  };
}

function findUsableFixture() {
  const projects =
    require("../project-store").listProjects();

  for (const project of projects) {
    if (
      project.status !== "planning" ||
      project.executionAllowed !== false ||
      project.planningOnly !== true
    ) {
      continue;
    }

    const schedules =
      require("../project-schedule-store")
        .listSchedules({
          projectId: project.projectId
        });

    const schedule =
      schedules.find(item =>
        item.status === "planned" &&
        item.executionAllowed === false &&
        item.planningOnly === true
      );

    if (schedule) {
      return {
        project,
        schedule
      };
    }
  }

  throw new Error(
    "No usable planning project/schedule fixture found."
  );
}

console.log(
  "\n=== STAGE 9.2.8 PROJECT EXECUTION ACTIVATION UNIT TEST ==="
);

const fixture = findUsableFixture();

const projectId =
  fixture.project.projectId;

const scheduleId =
  fixture.schedule.scheduleId;

const authorization =
  makeAuthorization(
    projectId,
    scheduleId
  );

const originalProject =
  JSON.parse(
    JSON.stringify(
      fixture.project
    )
  );

const originalSchedule =
  JSON.parse(
    JSON.stringify(
      fixture.schedule
    )
  );

// 1. Schema check creation
{
  const check =
    createActivationCheck({
      checkId: "check-1",
      passed: true,
      reason: "Test passed."
    });

  assert.strictEqual(
    check.passed,
    true
  );

  logPass(
    "Activation check creation"
  );
}

// 2. Authorized schema
{
  const activation =
    createProjectExecutionActivation({
      activationId: "activation-test-1",
      projectId,
      scheduleId,
      authorizationId:
        authorization.authorizationId,
      status: "activated",
      decision: "activate",
      checks: [
        {
          checkId: "check-1",
          passed: true,
          reason: "Test passed."
        }
      ],
      blockingReasons: [],
      activatedBy: "unit-test"
    });

  const validation =
    validateProjectExecutionActivation(
      activation
    );

  assert.strictEqual(
    validation.valid,
    true
  );

  logPass(
    "Authorized activation schema"
  );
}

// 3. Blocked schema
{
  const activation =
    createProjectExecutionActivation({
      activationId: "activation-test-2",
      projectId,
      scheduleId,
      authorizationId:
        authorization.authorizationId,
      status: "blocked",
      decision: "blocked",
      checks: [
        {
          checkId: "check-1",
          passed: false,
          reason: "Authorization failed."
        }
      ],
      blockingReasons: [
        "Authorization failed."
      ]
    });

  const validation =
    validateProjectExecutionActivation(
      activation
    );

  assert.strictEqual(
    validation.valid,
    true
  );

  logPass(
    "Blocked activation schema"
  );
}

// 4. Authorized activation cannot contain failed checks
{
  const activation =
    createProjectExecutionActivation({
      activationId: "activation-test-3",
      projectId,
      scheduleId,
      authorizationId:
        authorization.authorizationId,
      status: "activated",
      decision: "activate",
      checks: [
        {
          checkId: "check-1",
          passed: false,
          reason: "Failed."
        }
      ],
      blockingReasons: []
    });

  const validation =
    validateProjectExecutionActivation(
      activation
    );

  assert.strictEqual(
    validation.valid,
    false
  );

  assert.ok(
    validation.errors.some(error =>
      error.toLowerCase().includes("failed")
    )
  );

  logPass(
    "Authorized activation rejects failed checks"
  );
}

// 5. Activation cannot enable execution
{
  const activation =
    createProjectExecutionActivation({
      activationId: "activation-test-4",
      projectId,
      scheduleId,
      authorizationId:
        authorization.authorizationId,
      status: "activated",
      decision: "activate",
      checks: [
        {
          checkId: "check-1",
          passed: true,
          reason: "Passed."
        }
      ],
      blockingReasons: []
    });

  assert.strictEqual(
    activation.executionAllowed,
    false
  );

  assert.strictEqual(
    activation.externalActionPerformed,
    false
  );

  assert.strictEqual(
    activation.paymentAllowed,
    false
  );

  assert.strictEqual(
    activation.contractSigningAllowed,
    false
  );

  logPass(
    "Activation remains non-executable"
  );
}

// 6. Happy-path activation
{
  const result =
    evaluateProjectExecutionActivation({
      projectId,
      scheduleId,
      authorization,
      activationId:
        `activation-unit-${Date.now()}`,
      activatedBy: "unit-test"
    });

  assert.strictEqual(
    result.activation.status,
    "activated"
  );

  assert.strictEqual(
    result.activation.decision,
    "activate"
  );

  assert.strictEqual(
    result.projectUpdated,
    true
  );

  assert.strictEqual(
    result.project.status,
    "in_progress"
  );

  assert.strictEqual(
    result.project.executionAllowed,
    false
  );

  assert.strictEqual(
    result.project.externalActionPerformed,
    false
  );

  assert.strictEqual(
    result.project.paymentAllowed,
    false
  );

  assert.strictEqual(
    result.project.paymentTransferAuthorized,
    false
  );

  assert.strictEqual(
    result.project.contractSigningAllowed,
    false
  );

  logPass(
    "Authorized project transitions planning -> in_progress"
  );

  // Restore fixture so this unit test does not leave state behind.
  require("../project-store")
    .updateProjectStatus(
      projectId,
      originalProject.status
    );
}

// 7. Mismatched authorization blocked
{
  const badAuthorization =
    makeAuthorization(
      "wrong-project",
      scheduleId
    );

  const result =
    evaluateProjectExecutionActivation({
      projectId,
      scheduleId,
      authorization:
        badAuthorization,
      activationId:
        `activation-blocked-${Date.now()}`
    });

  assert.strictEqual(
    result.activation.status,
    "blocked"
  );

  assert.strictEqual(
    result.activation.decision,
    "blocked"
  );

  assert.strictEqual(
    result.projectUpdated,
    false
  );

  assert.strictEqual(
    getProject(projectId).status,
    originalProject.status
  );

  logPass(
    "Mismatched authorization is blocked"
  );
}

// 8. Non-authorized status blocked
{
  const blockedAuthorization = {
    ...authorization,
    authorizationId:
      `blocked-auth-${Date.now()}`,
    status: "blocked",
    decision: "blocked"
  };

  const result =
    evaluateProjectExecutionActivation({
      projectId,
      scheduleId,
      authorization:
        blockedAuthorization,
      activationId:
        `activation-blocked-status-${Date.now()}`
    });

  assert.strictEqual(
    result.activation.status,
    "blocked"
  );

  assert.strictEqual(
    result.projectUpdated,
    false
  );

  logPass(
    "Blocked authorization cannot activate project"
  );
}

// 9. Project and schedule safety remain unchanged
{
  const projectAfter =
    getProject(projectId);

  const scheduleAfter =
    getSchedule(scheduleId);

  assert.strictEqual(
    projectAfter.status,
    originalProject.status
  );

  assert.strictEqual(
    projectAfter.executionAllowed,
    originalProject.executionAllowed
  );

  assert.strictEqual(
    projectAfter.externalActionPerformed,
    originalProject.externalActionPerformed
  );

  assert.strictEqual(
    scheduleAfter.status,
    originalSchedule.status
  );

  assert.strictEqual(
    scheduleAfter.executionAllowed,
    originalSchedule.executionAllowed
  );

  assert.strictEqual(
    scheduleAfter.externalActionPerformed,
    originalSchedule.externalActionPerformed
  );

  logPass(
    "Project and schedule safety remain unchanged"
  );
}

// 10. No execution engine dependency
{
  const serviceSource =
    require("fs").readFileSync(
      "services/mira-project-execution-activation-service.js",
      "utf8"
    );

  assert.strictEqual(
    serviceSource.includes(
      "mira-work-execution-engine"
    ),
    false
  );

  assert.strictEqual(
    serviceSource.includes(
      "executeWork"
    ),
    false
  );

  logPass(
    "Activation service does not invoke execution engine"
  );
}

console.log(
  "\nSTAGE928_PROJECT_EXECUTION_ACTIVATION_UNIT_TEST: PASS"
);
