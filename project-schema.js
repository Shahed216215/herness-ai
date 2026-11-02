"use strict";

const PROJECT_STATUSES = Object.freeze([
  "planning",
  "in_progress",
  "review",
  "delivered",
  "revision",
  "completed",
  "archived"
]);

function assertNonEmptyString(value, fieldName) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(`${fieldName} is required`);
  }
}

function normalizeStringArray(value, fieldName) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }

  return value.map((item, index) => {
    assertNonEmptyString(item, `${fieldName}[${index}]`);
    return item.trim();
  });
}

function normalizeScopeSnapshot(workScope) {
  if (!workScope || typeof workScope !== "object") {
    throw new Error("workScopeSnapshot is required");
  }

  assertNonEmptyString(
    workScope.scopeId,
    "workScopeSnapshot.scopeId"
  );

  assertNonEmptyString(
    workScope.summary,
    "workScopeSnapshot.summary"
  );

  return {
    scopeId: workScope.scopeId.trim(),
    summary: workScope.summary.trim(),
    deliverables: normalizeStringArray(
      workScope.deliverables,
      "workScopeSnapshot.deliverables"
    ),
    exclusions: normalizeStringArray(
      workScope.exclusions,
      "workScopeSnapshot.exclusions"
    ),
    createdAt:
      typeof workScope.createdAt === "string"
        ? workScope.createdAt
        : null
  };
}

function createProject(input = {}) {
  if (!input || typeof input !== "object") {
    throw new Error("project input must be an object");
  }

  assertNonEmptyString(input.projectId, "projectId");
  assertNonEmptyString(input.acceptanceId, "acceptanceId");
  assertNonEmptyString(input.opportunityId, "opportunityId");

  const status =
    input.status === undefined
      ? "planning"
      : input.status;

  if (!PROJECT_STATUSES.includes(status)) {
    throw new Error(`Invalid project status: ${status}`);
  }

  const now = new Date().toISOString();

  const project = {
    projectId: input.projectId.trim(),
    acceptanceId: input.acceptanceId.trim(),
    opportunityId: input.opportunityId.trim(),

    qualificationId:
      input.qualificationId === undefined ||
      input.qualificationId === null
        ? null
        : String(input.qualificationId).trim(),

    proposalId:
      input.proposalId === undefined ||
      input.proposalId === null
        ? null
        : String(input.proposalId).trim(),

    clientResponseId:
      input.clientResponseId === undefined ||
      input.clientResponseId === null
        ? null
        : String(input.clientResponseId).trim(),

    status,

    workScopeSnapshot: normalizeScopeSnapshot(
      input.workScopeSnapshot || input.workScope
    ),

    deliverables: normalizeStringArray(
      input.deliverables,
      "deliverables"
    ),

    taskIds: normalizeStringArray(
      input.taskIds,
      "taskIds"
    ),

    executionAllowed: false,
    planningOnly: true,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false,
    externalActionPerformed: false,

    createdAt:
      typeof input.createdAt === "string"
        ? input.createdAt
        : now,

    updatedAt:
      typeof input.updatedAt === "string"
        ? input.updatedAt
        : now
  };

  return project;
}

function validateProject(project) {
  if (!project || typeof project !== "object") {
    return {
      valid: false,
      errors: ["project must be an object"]
    };
  }

  const errors = [];

  try {
    assertNonEmptyString(project.projectId, "projectId");
  } catch (error) {
    errors.push(error.message);
  }

  try {
    assertNonEmptyString(project.acceptanceId, "acceptanceId");
  } catch (error) {
    errors.push(error.message);
  }

  try {
    assertNonEmptyString(project.opportunityId, "opportunityId");
  } catch (error) {
    errors.push(error.message);
  }

  if (!PROJECT_STATUSES.includes(project.status)) {
    errors.push(`Invalid project status: ${project.status}`);
  }

  if (
    !project.workScopeSnapshot ||
    typeof project.workScopeSnapshot !== "object"
  ) {
    errors.push("workScopeSnapshot is required");
  } else {
    try {
      normalizeScopeSnapshot(project.workScopeSnapshot);
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (!Array.isArray(project.taskIds)) {
    errors.push("taskIds must be an array");
  }

  if (!Array.isArray(project.deliverables)) {
    errors.push("deliverables must be an array");
  }

  if (project.executionAllowed !== false) {
    errors.push("executionAllowed must remain false");
  }

  if (project.planningOnly !== true) {
    errors.push("planningOnly must remain true");
  }

  if (project.paymentAllowed !== false) {
    errors.push("paymentAllowed must remain false");
  }

  if (project.paymentTransferAuthorized !== false) {
    errors.push(
      "paymentTransferAuthorized must remain false"
    );
  }

  if (project.contractSigningAllowed !== false) {
    errors.push(
      "contractSigningAllowed must remain false"
    );
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  PROJECT_STATUSES,
  createProject,
  validateProject
};
