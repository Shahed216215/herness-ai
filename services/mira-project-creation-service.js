"use strict";

const {
  createProject
} = require("../project-schema");

const {
  getProject,
  createStoredProject
} = require("../project-store");

const {
  getWorkAcceptance
} = require("../work-acceptance-store");

function assertObject(value, name) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${name} must be an object`);
  }
}

function resolveAcceptedWorkAcceptance(
  acceptanceId
) {
  if (
    typeof acceptanceId !== "string" ||
    acceptanceId.trim().length === 0
  ) {
    throw new Error(
      "acceptanceId is required"
    );
  }

  const acceptance =
    getWorkAcceptance(acceptanceId);

  if (!acceptance) {
    throw new Error(
      `Work acceptance not found: ${acceptanceId}`
    );
  }

  if (acceptance.status !== "accepted") {
    throw new Error(
      `Work acceptance is not accepted: ${acceptanceId}`
    );
  }

  if (
    !acceptance.acceptanceDecision ||
    acceptance.acceptanceDecision.decision !==
      "accept"
  ) {
    throw new Error(
      `Work acceptance decision is not accept: ${acceptanceId}`
    );
  }

  if (
    !acceptance.workScope ||
    typeof acceptance.workScope !== "object"
  ) {
    throw new Error(
      `Accepted work scope is missing: ${acceptanceId}`
    );
  }

  return acceptance;
}

function buildProjectFromAcceptedWork(
  acceptance,
  input = {}
) {
  assertObject(acceptance, "acceptance");

  const scope =
    acceptance.workScope;

  return createProject({
    projectId:
      input.projectId,
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
    status: "planning",
    workScopeSnapshot: {
      scopeId: scope.scopeId,
      summary: scope.summary,
      deliverables: [
        ...(scope.deliverables || [])
      ],
      exclusions: [
        ...(scope.exclusions || [])
      ],
      createdAt: scope.createdAt
    },
    deliverables: [
      ...(scope.deliverables || [])
    ],
    taskIds: [],
    executionAllowed: false,
    planningOnly: true,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false,
    externalActionPerformed: false
  });
}

function createProjectFromAcceptedWork(
  input
) {
  assertObject(
    input,
    "input"
  );

  const acceptance =
    resolveAcceptedWorkAcceptance(
      input.acceptanceId
    );

  const existingProject =
    getProject(
      input.projectId
    );

  if (existingProject) {
    throw new Error(
      `Project already exists: ${input.projectId}`
    );
  }

  const project =
    buildProjectFromAcceptedWork(
      acceptance,
      input
    );

  return createStoredProject(
    project
  );
}

module.exports = {
  resolveAcceptedWorkAcceptance,
  buildProjectFromAcceptedWork,
  createProjectFromAcceptedWork
};
