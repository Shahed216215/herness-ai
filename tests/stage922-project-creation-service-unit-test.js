"use strict";

const fs = require("fs");

const workAcceptanceStore =
  require("../work-acceptance-store");

const projectStore =
  require("../project-store");

const projectCreationService =
  require("../services/mira-project-creation-service");

const taskStore =
  require("../task-store");

const WORK_ACCEPTANCE_FILE =
  "data/work-acceptances.json";

const PROJECT_FILE =
  "data/projects.json";

const originalWorkAcceptances =
  fs.readFileSync(
    WORK_ACCEPTANCE_FILE,
    "utf8"
  );

const originalProjects =
  fs.readFileSync(
    PROJECT_FILE,
    "utf8"
  );

const originalTaskSummary =
  taskStore.getTaskSummary();

function writeJson(path, data) {
  fs.writeFileSync(
    path,
    JSON.stringify(data, null, 2) + "\n"
  );
}

function createAcceptance(
  acceptanceId,
  status,
  decision
) {
  return workAcceptanceStore.createStoredWorkAcceptance({
    acceptanceId,
    opportunityId: `opp-${acceptanceId}`,
    qualificationId: `qual-${acceptanceId}`,
    proposalId: `proposal-${acceptanceId}`,
    clientResponseId: `response-${acceptanceId}`,
    status,
    acceptanceDecision: {
      decision,
      reason:
        decision === "accept"
          ? "Client accepted the work for testing."
          : "Acceptance state created for testing."
    },
    workScope: {
      scopeId: `scope-${acceptanceId}`,
      summary:
        "Stage 9.2.2 project creation test scope.",
      deliverables: [
        "Test deliverable A",
        "Test deliverable B"
      ],
      exclusions: [
        "Payment handling",
        "Contract signing"
      ],
      createdAt:
        new Date().toISOString()
    }
  });
}

try {
  writeJson(
    WORK_ACCEPTANCE_FILE,
    { workAcceptances: [] }
  );

  writeJson(
    PROJECT_FILE,
    { projects: [] }
  );

  console.log(
    "\n=== STAGE 9.2.2 PROJECT CREATION SERVICE UNIT TEST ==="
  );

  console.log("[1] ACCEPTED WORK -> PROJECT");

  createAcceptance(
    "accept-stage922-001",
    "accepted",
    "accept"
  );

  const project =
    projectCreationService
      .createProjectFromAcceptedWork({
        acceptanceId:
          "accept-stage922-001",
        projectId:
          "project-stage922-001"
      });

  if (
    project.status !== "planning"
  ) {
    throw new Error(
      "Project status is not planning"
    );
  }

  if (
    project.acceptanceId !==
    "accept-stage922-001"
  ) {
    throw new Error(
      "Acceptance linkage mismatch"
    );
  }

  if (
    project.opportunityId !==
    "opp-accept-stage922-001"
  ) {
    throw new Error(
      "Opportunity linkage mismatch"
    );
  }

  console.log("PASS");

  console.log("[2] SCOPE SNAPSHOT");

  if (
    !project.workScopeSnapshot ||
    project.workScopeSnapshot.scopeId !==
      "scope-accept-stage922-001"
  ) {
    throw new Error(
      "Scope snapshot missing or incorrect"
    );
  }

  if (
    project.workScopeSnapshot.summary !==
    "Stage 9.2.2 project creation test scope."
  ) {
    throw new Error(
      "Scope summary mismatch"
    );
  }

  if (
    project.deliverables.length !== 2 ||
    project.taskIds.length !== 0
  ) {
    throw new Error(
      "Project deliverables/taskIds initialization incorrect"
    );
  }

  console.log("PASS");

  console.log("[3] SAFETY BOUNDARY");

  if (
    project.executionAllowed !== false ||
    project.planningOnly !== true ||
    project.paymentAllowed !== false ||
    project.paymentTransferAuthorized !== false ||
    project.contractSigningAllowed !== false ||
    project.externalActionPerformed !== false
  ) {
    throw new Error(
      "Project safety boundary violated"
    );
  }

  console.log("PASS");

  console.log("[4] PROJECT RETRIEVAL");

  const storedProject =
    projectStore.getProject(
      "project-stage922-001"
    );

  if (
    !storedProject ||
    storedProject.projectId !==
      "project-stage922-001"
  ) {
    throw new Error(
      "Stored project retrieval failed"
    );
  }

  console.log("PASS");

  console.log("[5] DUPLICATE PROJECT BLOCK");

  let duplicateBlocked = false;

  try {
    projectCreationService
      .createProjectFromAcceptedWork({
        acceptanceId:
          "accept-stage922-001",
        projectId:
          "project-stage922-001"
      });
  } catch (error) {
    duplicateBlocked = true;
  }

  if (!duplicateBlocked) {
    throw new Error(
      "Duplicate project was not blocked"
    );
  }

  console.log("PASS");

  console.log("[6] MISSING ACCEPTANCE BLOCK");

  let missingBlocked = false;

  try {
    projectCreationService
      .createProjectFromAcceptedWork({
        acceptanceId:
          "accept-stage922-missing",
        projectId:
          "project-stage922-missing"
      });
  } catch (error) {
    missingBlocked = true;
  }

  if (!missingBlocked) {
    throw new Error(
      "Missing acceptance was not blocked"
    );
  }

  console.log("PASS");

  console.log("[7] PENDING ACCEPTANCE BLOCK");

  createAcceptance(
    "accept-stage922-pending",
    "pending",
    "pending"
  );

  let pendingBlocked = false;

  try {
    projectCreationService
      .createProjectFromAcceptedWork({
        acceptanceId:
          "accept-stage922-pending",
        projectId:
          "project-stage922-pending"
      });
  } catch (error) {
    pendingBlocked = true;
  }

  if (!pendingBlocked) {
    throw new Error(
      "Pending acceptance was not blocked"
    );
  }

  console.log("PASS");

  console.log("[8] REJECTED ACCEPTANCE BLOCK");

  createAcceptance(
    "accept-stage922-rejected",
    "rejected",
    "reject"
  );

  let rejectedBlocked = false;

  try {
    projectCreationService
      .createProjectFromAcceptedWork({
        acceptanceId:
          "accept-stage922-rejected",
        projectId:
          "project-stage922-rejected"
      });
  } catch (error) {
    rejectedBlocked = true;
  }

  if (!rejectedBlocked) {
    throw new Error(
      "Rejected acceptance was not blocked"
    );
  }

  console.log("PASS");

  console.log("[9] TASK SYSTEM NON-INTERFERENCE");

  const finalTaskSummary =
    taskStore.getTaskSummary();

  if (
    JSON.stringify(finalTaskSummary) !==
    JSON.stringify(originalTaskSummary)
  ) {
    throw new Error(
      "Task system was modified"
    );
  }

  console.log("PASS");

  console.log(
    "\nSTAGE922_PROJECT_CREATION_SERVICE_UNIT_TEST: PASS"
  );
} finally {
  fs.writeFileSync(
    WORK_ACCEPTANCE_FILE,
    originalWorkAcceptances
  );

  fs.writeFileSync(
    PROJECT_FILE,
    originalProjects
  );

  console.log(
    "\nTEST DATA RESTORED"
  );
}
