"use strict";

const {
  validateProjectExecutionAuthorization,
  createProjectExecutionAuthorization,
  createAuthorizationCheck
} = require("../project-execution-authorization-schema");

const {
  getProject
} = require("../project-store");

const {
  getSchedule
} = require("../project-schedule-store");

function assertObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${label} must be an object.`);
  }
}

function requireString(value, label) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function resolvePlanningProject(projectId) {
  const project = getProject(
    requireString(projectId, "projectId")
  );

  if (!project) {
    throw new Error(
      `Project not found: ${projectId}`
    );
  }

  if (project.status !== "planning") {
    throw new Error(
      `Project must remain in planning status: ${projectId}`
    );
  }

  if (project.executionAllowed !== false) {
    throw new Error(
      "Project executionAllowed must remain false."
    );
  }

  if (project.planningOnly !== true) {
    throw new Error(
      "Project planningOnly must remain true."
    );
  }

  if (project.externalActionPerformed !== false) {
    throw new Error(
      "Project externalActionPerformed must remain false."
    );
  }

  if (project.paymentAllowed !== false) {
    throw new Error(
      "Project paymentAllowed must remain false."
    );
  }

  if (project.paymentTransferAuthorized !== false) {
    throw new Error(
      "Project paymentTransferAuthorized must remain false."
    );
  }

  if (project.contractSigningAllowed !== false) {
    throw new Error(
      "Project contractSigningAllowed must remain false."
    );
  }

  return project;
}

function resolveProjectSchedule(
  projectId,
  scheduleId
) {
  const schedule = getSchedule(
    requireString(scheduleId, "scheduleId")
  );

  if (!schedule) {
    throw new Error(
      `Schedule not found: ${scheduleId}`
    );
  }

  if (schedule.projectId !== projectId) {
    throw new Error(
      "Schedule does not belong to the project."
    );
  }

  return schedule;
}

function buildAuthorizationCheck(
  checkId,
  passed,
  reason
) {
  return createAuthorizationCheck({
    checkId,
    passed,
    reason
  });
}

function evaluateProjectExecutionAuthorization(
  input = {}
) {
  assertObject(input, "input");

  const projectId = requireString(
    input.projectId,
    "projectId"
  );

  const scheduleId = requireString(
    input.scheduleId,
    "scheduleId"
  );

  const readiness = input.readiness;

  assertObject(
    readiness,
    "readiness"
  );

  const project =
    resolvePlanningProject(projectId);

  const schedule =
    resolveProjectSchedule(
      projectId,
      scheduleId
    );

  const checks = [];
  const blockingReasons = [];

  function addCheck(
    checkId,
    passed,
    reason
  ) {
    const check =
      buildAuthorizationCheck(
        checkId,
        passed,
        reason
      );

    checks.push(check);

    if (!passed) {
      blockingReasons.push(reason);
    }
  }

  addCheck(
    "readiness-identity",
    readiness.projectId === projectId &&
      readiness.scheduleId === scheduleId,
    "Readiness must belong to the same project and schedule."
  );

  addCheck(
    "readiness-status",
    readiness.status === "ready" &&
      readiness.decision === "ready",
    "Execution readiness must be READY."
  );

  addCheck(
    "readiness-execution-disabled",
    readiness.executionAllowed === false &&
      readiness.planningOnly === true,
    "Readiness must remain non-executable."
  );

  addCheck(
    "project-planning-state",
    project.status === "planning",
    "Project must remain in planning status."
  );

  addCheck(
    "project-safety",
    project.executionAllowed === false &&
      project.planningOnly === true &&
      project.externalActionPerformed === false &&
      project.paymentAllowed === false &&
      project.paymentTransferAuthorized === false &&
      project.contractSigningAllowed === false,
    "Project safety boundary must remain intact."
  );

  addCheck(
    "schedule-planned-state",
    schedule.status === "planned",
    "Schedule must remain in planned status."
  );

  addCheck(
    "schedule-safety",
    schedule.executionAllowed === false &&
      schedule.planningOnly === true &&
      schedule.externalActionPerformed === false &&
      schedule.paymentAllowed === false &&
      schedule.paymentTransferAuthorized === false &&
      schedule.contractSigningAllowed === false,
    "Schedule safety boundary must remain intact."
  );

  const authorized =
    blockingReasons.length === 0;

  const authorization =
    createProjectExecutionAuthorization({
      authorizationId:
        input.authorizationId ||
        `project-auth-${projectId}-${Date.now()}`,
      projectId,
      scheduleId,
      readinessId:
        requireString(
          readiness.readinessId,
          "readiness.readinessId"
        ),
      status:
        authorized
          ? "authorized"
          : "blocked",
      decision:
        authorized
          ? "authorize"
          : "blocked",
      checks,
      blockingReasons,
      authorizedBy:
        authorized
          ? (
              input.authorizedBy === undefined
                ? null
                : input.authorizedBy
            )
          : null,
      authorizationReason:
        authorized
          ? "Project execution gate authorized based on valid execution readiness and safety checks."
          : "Project execution authorization blocked by one or more failed gate checks."
    });

  const validation =
    validateProjectExecutionAuthorization(
      authorization
    );

  if (!validation.valid) {
    throw new Error(
      `Generated authorization is invalid: ${validation.errors.join("; ")}`
    );
  }

  return {
    authorization,
    project,
    schedule,
    readiness,
    validation
  };
}

module.exports = {
  resolvePlanningProject,
  resolveProjectSchedule,
  evaluateProjectExecutionAuthorization
};
