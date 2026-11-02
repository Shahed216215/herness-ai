"use strict";

const assert = require("assert");

const {
  createStoredProject
} = require("../project-store");

const {
  createStoredProjectSchedule
} = require("../project-schedule-store");

const {
  evaluateProjectExecutionActivation
} = require("../services/mira-project-execution-activation-service");

const {
  getProject
} = require("../project-store");

const {
  getSchedule
} = require("../project-schedule-store");

function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

console.log(
  "\n=== STAGE 9.2.8 PROJECT EXECUTION ACTIVATION E2E TEST ==="
);

const projectId = unique(
  "project-stage928-e2e"
);

const scheduleId = unique(
  "schedule-stage928-e2e"
);

const authorizationId = unique(
  "authorization-stage928-e2e"
);

const acceptanceStore = require("../work-acceptance-store");

const existingAcceptances =
  acceptanceStore.listWorkAcceptances();

if (!existingAcceptances.length) {
  throw new Error("No stored work acceptance available for Stage 9.2.8 fixture");
}

const matchingAcceptance =
  existingAcceptances.find(
    acceptance =>
      acceptance.opportunityId === "opp-stage926"
  ) || existingAcceptances[0];

const acceptanceId =
  matchingAcceptance.acceptanceId;

const opportunityId =
  matchingAcceptance.opportunityId;

const scopeId =
  matchingAcceptance.workScope?.scopeId;

if (!scopeId) {
  throw new Error("Selected acceptance has no work scope");
}

const now =
  new Date().toISOString();

const project =
  createStoredProject({
    projectId,
    acceptanceId,
    opportunityId,
    qualificationId: null,
    proposalId: null,
    clientResponseId: null,
    status: "planning",
    workScopeSnapshot: {
      scopeId,
      summary: "Stage 9.2.8 E2E scope",
      deliverables: [
        "E2E activation artifact"
      ],
      exclusions: []
    },
    deliverables: [
      "E2E activation artifact"
    ],
    taskIds: [
      "task-stage928-e2e"
    ],
    executionAllowed: false,
    planningOnly: true,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false,
    externalActionPerformed: false,
    createdAt: now,
    updatedAt: now
  });

console.log(
  "PASS: E2E planning project fixture created"
);

const schedule =
  createStoredProjectSchedule({
    scheduleId,
    projectId,
    entries: [
      {
        taskId: "task-stage928-e2e",
        planId: "plan-stage928-e2e",
        sequence: 1,
        dependencies: [],
        deadline: "",
        estimatedDuration: null,
        scheduledStart: "",
        scheduledEnd: "",
        status: "planned"
      }
    ],
    status: "planned",
    executionAllowed: false,
    planningOnly: true,
    externalActionPerformed: false,
    paymentAllowed: false,
    paymentTransferAuthorized: false,
    contractSigningAllowed: false,
    createdAt: now,
    updatedAt: now
  });

console.log(
  "PASS: E2E planned schedule fixture created"
);

const authorization = {
  authorizationId,
  projectId,
  scheduleId,
  readinessId: unique(
    "readiness-stage928-e2e"
  ),
  status: "authorized",
  decision: "authorize",
  checks: [
    {
      checkId:
        "authorization-check-stage928-e2e",
      passed: true,
      reason:
        "Execution authorization is valid."
    }
  ],
  blockingReasons: [],
  authorizationRequired: true,
  authorizedBy: "stage928-e2e-test",
  authorizationReason:
    "Controlled project activation E2E test.",
  executionAllowed: false,
  planningOnly: true,
  externalActionPerformed: false,
  paymentAllowed: false,
  paymentTransferAuthorized: false,
  contractSigningAllowed: false
};

const before =
  getProject(projectId);

assert.strictEqual(
  before.status,
  "planning"
);

assert.strictEqual(
  before.executionAllowed,
  false
);

const result =
  evaluateProjectExecutionActivation({
    projectId,
    scheduleId,
    authorization,
    activationId: unique(
      "activation-stage928-e2e"
    ),
    activatedBy:
      "stage928-e2e-test"
  });

assert.strictEqual(
  result.projectUpdated,
  true
);

assert.strictEqual(
  result.activation.status,
  "activated"
);

assert.strictEqual(
  result.activation.decision,
  "activate"
);

assert.strictEqual(
  result.project.status,
  "in_progress"
);

console.log(
  "PASS: Authorized activation transitioned project to in_progress"
);

assert.strictEqual(
  result.activation.executionAllowed,
  false
);

assert.strictEqual(
  result.activation.externalActionPerformed,
  false
);

assert.strictEqual(
  result.activation.paymentAllowed,
  false
);

assert.strictEqual(
  result.activation.paymentTransferAuthorized,
  false
);

assert.strictEqual(
  result.activation.contractSigningAllowed,
  false
);

console.log(
  "PASS: Activation artifact safety boundary preserved"
);

const persistedProject =
  getProject(projectId);

const persistedSchedule =
  getSchedule(scheduleId);

assert.strictEqual(
  persistedProject.status,
  "in_progress"
);

assert.strictEqual(
  persistedProject.executionAllowed,
  false
);

assert.strictEqual(
  persistedProject.externalActionPerformed,
  false
);

assert.strictEqual(
  persistedProject.paymentAllowed,
  false
);

assert.strictEqual(
  persistedProject.paymentTransferAuthorized,
  false
);

assert.strictEqual(
  persistedProject.contractSigningAllowed,
  false
);

assert.strictEqual(
  persistedSchedule.status,
  "planned"
);

assert.strictEqual(
  persistedSchedule.executionAllowed,
  false
);

assert.strictEqual(
  persistedSchedule.externalActionPerformed,
  false
);

console.log(
  "PASS: Persisted project/schedule state verified"
);

const activationServiceSource =
  require("fs").readFileSync(
    "services/mira-project-execution-activation-service.js",
    "utf8"
  );

assert.strictEqual(
  activationServiceSource.includes(
    "mira-work-execution-engine"
  ),
  false
);

assert.strictEqual(
  activationServiceSource.includes(
    "executeWork"
  ),
  false
);

console.log(
  "PASS: Activation service does not invoke execution engine"
);

console.log(
  "\nSTAGE928_PROJECT_EXECUTION_ACTIVATION_E2E_TEST: PASS"
);
