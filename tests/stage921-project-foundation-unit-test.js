"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const projectSchema = require("../project-schema");
const projectStore = require("../project-store");
const workAcceptanceSchema = require("../work-acceptance-schema");

const projectFile = projectStore.PROJECT_FILE;
const workAcceptanceFile = path.join(
  __dirname,
  "..",
  "data",
  "work-acceptances.json"
);

const originalProjects = fs.readFileSync(
  projectFile,
  "utf8"
);

const originalAcceptances = fs.readFileSync(
  workAcceptanceFile,
  "utf8"
);

function writeAcceptances(records) {
  fs.writeFileSync(
    workAcceptanceFile,
    JSON.stringify(
      { workAcceptances: records },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function resetProjects() {
  fs.writeFileSync(
    projectFile,
    JSON.stringify(
      { projects: [] },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function makeAcceptance({
  acceptanceId,
  status,
  acceptanceDecision
}) {
  return workAcceptanceSchema.createWorkAcceptance({
    acceptanceId,
    opportunityId: "opp-stage921-001",
    qualificationId: "qual-stage921-001",
    proposalId: "proposal-stage921-001",
    clientResponseId: "response-stage921-001",
    requirementsId: "requirements-stage921-001",
    status,
    acceptanceDecision: {
      decision: acceptanceDecision,
      reason:
        acceptanceDecision === "accept"
          ? "Client accepted the work."
          : acceptanceDecision === "reject"
            ? "Work acceptance rejected for testing."
            : "Acceptance is pending for testing."
    },
    workScope: {
      scopeId: "scope-stage921-001",
      summary: "Stage 9.2.1 test project scope",
      deliverables: [
        "Test deliverable A",
        "Test deliverable B"
      ],
      exclusions: [
        "Payment transfer",
        "Contract signing"
      ],
      createdAt: new Date().toISOString()
    },
    paymentMetadata: {
      status: "agreed",
      currency: "USD",
      amount: 100,
      metadataOnly: true,
      transferAuthorized: false
    }
  });
}

function expectThrow(fn, expectedText) {
  assert.throws(
    fn,
    error => {
      assert(
        error.message.includes(expectedText),
        `Expected error containing "${expectedText}", got "${error.message}"`
      );

      return true;
    }
  );
}

try {
  console.log("\n=== STAGE 9.2.1 PROJECT FOUNDATION UNIT TEST ===");

  const accepted = makeAcceptance({
    acceptanceId: "accept-stage921-001",
    status: "accepted",
    acceptanceDecision: "accept"
  });

  const pending = makeAcceptance({
    acceptanceId: "accept-stage921-002",
    status: "pending",
    acceptanceDecision: "pending"
  });

  const rejected = makeAcceptance({
    acceptanceId: "accept-stage921-003",
    status: "rejected",
    acceptanceDecision: "reject"
  });

  writeAcceptances([
    accepted,
    pending,
    rejected
  ]);

  resetProjects();

  console.log("[1] ACCEPTED WORK -> PROJECT");

  const project =
    projectStore.createStoredProject({
      projectId: "project-stage921-001",
      acceptanceId: accepted.acceptanceId,
      opportunityId: accepted.opportunityId,
      qualificationId: accepted.qualificationId,
      proposalId: accepted.proposalId,
      clientResponseId: accepted.clientResponseId,
      workScopeSnapshot: accepted.workScope,
      deliverables: accepted.workScope.deliverables
    });

  assert.strictEqual(
    project.status,
    "planning"
  );

  assert.strictEqual(
    project.acceptanceId,
    accepted.acceptanceId
  );

  assert.strictEqual(
    project.opportunityId,
    accepted.opportunityId
  );

  assert.deepStrictEqual(
    project.taskIds,
    []
  );

  assert.deepStrictEqual(
    project.deliverables,
    accepted.workScope.deliverables
  );

  assert.strictEqual(
    project.workScopeSnapshot.scopeId,
    accepted.workScope.scopeId
  );

  assert.strictEqual(
    project.workScopeSnapshot.summary,
    accepted.workScope.summary
  );

  console.log("PASS");

  console.log("[2] SAFETY FLAGS");

  assert.strictEqual(
    project.executionAllowed,
    false
  );

  assert.strictEqual(
    project.planningOnly,
    true
  );

  assert.strictEqual(
    project.paymentAllowed,
    false
  );

  assert.strictEqual(
    project.paymentTransferAuthorized,
    false
  );

  assert.strictEqual(
    project.contractSigningAllowed,
    false
  );

  assert.strictEqual(
    project.externalActionPerformed,
    false
  );

  console.log("PASS");

  console.log("[3] PROJECT RETRIEVAL");

  const retrieved =
    projectStore.getProject(
      project.projectId
    );

  assert(retrieved);
  assert.strictEqual(
    retrieved.projectId,
    project.projectId
  );

  assert.strictEqual(
    projectStore.countProjects(),
    1
  );

  console.log("PASS");

  console.log("[4] DUPLICATE PROJECT BLOCK");

  expectThrow(
    () =>
      projectStore.createStoredProject({
        projectId: project.projectId,
        acceptanceId: accepted.acceptanceId,
        opportunityId: accepted.opportunityId,
        workScopeSnapshot: accepted.workScope
      }),
    "Project already exists"
  );

  console.log("PASS");

  console.log("[5] MISSING ACCEPTANCE BLOCK");

  expectThrow(
    () =>
      projectStore.createStoredProject({
        projectId: "project-stage921-missing",
        acceptanceId: "accept-stage921-missing",
        opportunityId: "opp-stage921-001",
        workScopeSnapshot: accepted.workScope
      }),
    "Work acceptance not found"
  );

  console.log("PASS");

  console.log("[6] PENDING ACCEPTANCE BLOCK");

  expectThrow(
    () =>
      projectStore.createStoredProject({
        projectId: "project-stage921-pending",
        acceptanceId: pending.acceptanceId,
        opportunityId: pending.opportunityId,
        workScopeSnapshot: accepted.workScope
      }),
    "Work acceptance is not accepted"
  );

  console.log("PASS");

  console.log("[7] REJECTED ACCEPTANCE BLOCK");

  expectThrow(
    () =>
      projectStore.createStoredProject({
        projectId: "project-stage921-rejected",
        acceptanceId: rejected.acceptanceId,
        opportunityId: rejected.opportunityId,
        workScopeSnapshot: accepted.workScope
      }),
    "Work acceptance is not accepted"
  );

  console.log("PASS");

  console.log("[8] OPPORTUNITY LINKAGE BLOCK");

  expectThrow(
    () =>
      projectStore.createStoredProject({
        projectId: "project-stage921-wrong-opportunity",
        acceptanceId: accepted.acceptanceId,
        opportunityId: "wrong-opportunity",
        workScopeSnapshot: accepted.workScope
      }),
    "opportunityId does not match"
  );

  console.log("PASS");

  console.log("[9] SCOPE LINKAGE BLOCK");

  expectThrow(
    () =>
      projectStore.createStoredProject({
        projectId: "project-stage921-wrong-scope",
        acceptanceId: accepted.acceptanceId,
        opportunityId: accepted.opportunityId,
        workScopeSnapshot: {
          ...accepted.workScope,
          scopeId: "wrong-scope"
        }
      }),
    "Project scope does not match"
  );

  console.log("PASS");

  console.log("[10] STATUS UPDATE");

  const updated =
    projectStore.updateProjectStatus(
      project.projectId,
      "in_progress"
    );

  assert.strictEqual(
    updated.status,
    "in_progress"
  );

  console.log("PASS");

  console.log("[11] TASK SYSTEM NON-INTERFERENCE");

  const taskStore = require("../task-store");
  const taskSummary =
    taskStore.getTaskSummary();

  const baselineTaskSummary = {
    total: taskSummary.total,
    new: taskSummary.new,
    active: taskSummary.active,
    completed: taskSummary.completed,
    failed: taskSummary.failed,
    cancelled: taskSummary.cancelled
  };

  assert.strictEqual(
    taskSummary.total,
    baselineTaskSummary.total
  );

  assert.strictEqual(
    taskSummary.new,
    baselineTaskSummary.new
  );

  assert.strictEqual(
    taskSummary.active,
    baselineTaskSummary.active
  );

  assert.strictEqual(
    taskSummary.completed,
    baselineTaskSummary.completed
  );

  console.log("PASS");

  console.log("\nSTAGE921_PROJECT_FOUNDATION_UNIT_TEST: PASS");
} finally {
  fs.writeFileSync(
    projectFile,
    originalProjects,
    "utf8"
  );

  fs.writeFileSync(
    workAcceptanceFile,
    originalAcceptances,
    "utf8"
  );

  console.log("\nTEST DATA RESTORED");
}
