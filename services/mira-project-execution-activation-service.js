"use strict";

const {
  validateProjectExecutionActivation,
  createProjectExecutionActivation,
  createActivationCheck
} = require("../project-execution-activation-schema");

const {
  getProject,
  updateProjectStatus
} = require("../project-store");

const {
  getSchedule
} = require("../project-schedule-store");

function assertObject(value, fieldName) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${fieldName} must be an object`);
  }
}

function requireString(value, fieldName) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(`${fieldName} is required`);
  }

  return value.trim();
}

function resolvePlanningProject(projectId) {
  const id = requireString(projectId, "projectId");
  const project = getProject(id);

  if (!project) {
    throw new Error(`Project not found: ${id}`);
  }

  if (project.status !== "planning") {
    throw new Error(
      `Project must be planning before activation: ${project.status}`
    );
  }

  if (project.executionAllowed !== false) {
    throw new Error("Project executionAllowed must remain false");
  }

  if (project.planningOnly !== true) {
    throw new Error("Project planningOnly must be true before activation");
  }

  if (project.externalActionPerformed !== false) {
    throw new Error("Project has external action recorded");
  }

  if (project.paymentAllowed !== false) {
    throw new Error("Project paymentAllowed must remain false");
  }

  if (project.paymentTransferAuthorized !== false) {
    throw new Error(
      "Project paymentTransferAuthorized must remain false"
    );
  }

  if (project.contractSigningAllowed !== false) {
    throw new Error(
      "Project contractSigningAllowed must remain false"
    );
  }

  return project;
}

function resolveProjectSchedule(projectId, scheduleId) {
  const projectIdValue =
    requireString(projectId, "projectId");

  const scheduleIdValue =
    requireString(scheduleId, "scheduleId");

  const schedule =
    getSchedule(scheduleIdValue);

  if (!schedule) {
    throw new Error(
      `Schedule not found: ${scheduleIdValue}`
    );
  }

  if (schedule.projectId !== projectIdValue) {
    throw new Error(
      "Schedule does not belong to project"
    );
  }

  if (schedule.status !== "planned") {
    throw new Error(
      `Schedule must be planned before activation: ${schedule.status}`
    );
  }

  if (schedule.executionAllowed !== false) {
    throw new Error(
      "Schedule executionAllowed must remain false"
    );
  }

  if (schedule.planningOnly !== true) {
    throw new Error(
      "Schedule planningOnly must remain true"
    );
  }

  if (schedule.externalActionPerformed !== false) {
    throw new Error(
      "Schedule has external action recorded"
    );
  }

  return schedule;
}

function buildActivationCheck(
  checkId,
  passed,
  reason
) {
  return createActivationCheck({
    checkId,
    passed,
    reason
  });
}

function evaluateProjectExecutionActivation(input) {
  assertObject(input, "input");

  const projectId =
    requireString(input.projectId, "projectId");

  const scheduleId =
    requireString(input.scheduleId, "scheduleId");

  assertObject(input.authorization, "authorization");

  const project =
    resolvePlanningProject(projectId);

  const schedule =
    resolveProjectSchedule(
      projectId,
      scheduleId
    );

  const authorization =
    input.authorization;

  const checks = [];
  const blockingReasons = [];

  function addCheck(checkId, passed, reason) {
    checks.push(
      buildActivationCheck(
        checkId,
        passed,
        reason
      )
    );

    if (!passed) {
      blockingReasons.push(reason);
    }
  }

  addCheck(
    "authorization_identity",
    authorization.projectId === projectId &&
      authorization.scheduleId === scheduleId,
    "Authorization must belong to the target project and schedule."
  );

  addCheck(
    "authorization_status",
    authorization.status === "authorized" &&
      authorization.decision === "authorize",
    "Execution authorization must be authorized."
  );

  addCheck(
    "authorization_safety",
    authorization.executionAllowed === false &&
      authorization.planningOnly === true &&
      authorization.externalActionPerformed === false &&
      authorization.paymentAllowed === false &&
      authorization.paymentTransferAuthorized === false &&
      authorization.contractSigningAllowed === false,
    "Authorization safety boundary must remain non-executable."
  );

  addCheck(
    "project_planning_state",
    project.status === "planning",
    "Project must currently be planning."
  );

  addCheck(
    "project_safety",
    project.executionAllowed === false &&
      project.planningOnly === true &&
      project.externalActionPerformed === false &&
      project.paymentAllowed === false &&
      project.paymentTransferAuthorized === false &&
      project.contractSigningAllowed === false,
    "Project must remain within the controlled safety boundary."
  );

  addCheck(
    "schedule_planned_state",
    schedule.status === "planned",
    "Schedule must currently be planned."
  );

  addCheck(
    "schedule_safety",
    schedule.executionAllowed === false &&
      schedule.planningOnly === true &&
      schedule.externalActionPerformed === false &&
      schedule.paymentAllowed === false &&
      schedule.paymentTransferAuthorized === false &&
      schedule.contractSigningAllowed === false,
    "Schedule must remain within the controlled safety boundary."
  );

  const activated =
    blockingReasons.length === 0;

  const activation =
    createProjectExecutionActivation({
      activationId:
        input.activationId ||
        `activation-${projectId}-${Date.now()}`,
      projectId,
      scheduleId,
      authorizationId:
        requireString(
          authorization.authorizationId,
          "authorization.authorizationId"
        ),
      status:
        activated
          ? "activated"
          : "blocked",
      decision:
        activated
          ? "activate"
          : "blocked",
      checks,
      blockingReasons,
      activatedBy:
        input.activatedBy === undefined
          ? null
          : input.activatedBy
    });

  const validation =
    validateProjectExecutionActivation(
      activation
    );

  if (!validation.valid) {
    throw new Error(
      `Generated activation is invalid: ${validation.errors.join("; ")}`
    );
  }

  if (!activated) {
    return {
      activation,
      project,
      schedule,
      authorization,
      validation,
      projectUpdated: false
    };
  }

  const updatedProject =
    updateProjectStatus(
      projectId,
      "in_progress"
    );

  return {
    activation,
    project: updatedProject,
    previousProject: project,
    schedule,
    authorization,
    validation,
    projectUpdated: true
  };
}

module.exports = {
  resolvePlanningProject,
  resolveProjectSchedule,
  evaluateProjectExecutionActivation
};
