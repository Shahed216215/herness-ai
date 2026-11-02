"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  createCapabilityRequest,
  getCapabilityRequest,
  createCapabilityProposal,
  classifyCapabilityRisk,
  stageCapabilityRequest,
  recordCapabilityValidation,
  recordCapabilityApproval
} = require("../capability-request");

const {
  validateCapabilityArtifact
} = require("../services/mira-capability-validation");

const {
  approveValidatedCapability,
  autonomousApprovalAttempt
} = require("../services/mira-capability-approval");

const {
  getArtifact
} = require("../staging-manager");

const {
  CHANGE_FILE
} = require("../change-management");

const REQUEST_FILE =
  path.join(
    __dirname,
    "..",
    "capability-requests.json"
  );

const CHANGE_ID_PREFIX =
  "chg-";

let requestId = null;
let changeId = null;

function pass(message) {
  console.log(
    `PASS: ${message}`
  );
}

function fail(message) {
  throw new Error(
    `ASSERTION_FAILED: ${message}`
  );
}

function expectThrow(fn, expectedText) {
  let thrown = false;

  try {
    fn();
  } catch (error) {
    thrown = true;

    if (
      expectedText &&
      !String(error.message).includes(
        expectedText
      )
    ) {
      throw new Error(
        `Unexpected error: ${error.message}`
      );
    }
  }

  if (!thrown) {
    throw new Error(
      "Expected operation to throw."
    );
  }
}

function cleanup() {
  try {
    if (requestId) {
      const data =
        fs.existsSync(REQUEST_FILE)
          ? JSON.parse(
              fs.readFileSync(
                REQUEST_FILE,
                "utf8"
              )
            )
          : [];

      const filtered =
        data.filter(
          item =>
            item.requestId !==
            requestId
        );

      fs.writeFileSync(
        REQUEST_FILE,
        JSON.stringify(
          filtered,
          null,
          2
        ),
        "utf8"
      );
    }
  } catch (_) {}

  try {
    if (changeId) {
      const stagingDir =
        path.join(
          __dirname,
          "..",
          "staging",
          "changes",
          changeId
        );

      fs.rmSync(
        stagingDir,
        {
          recursive: true,
          force: true
        }
      );
    }
  } catch (_) {}

  try {
    if (changeId) {
      const changes =
        fs.existsSync(CHANGE_FILE)
          ? JSON.parse(
              fs.readFileSync(
                CHANGE_FILE,
                "utf8"
              )
            )
          : [];

      const filtered =
        changes.filter(
          item =>
            item.changeId !==
            changeId
        );

      fs.writeFileSync(
        CHANGE_FILE,
        JSON.stringify(
          filtered,
          null,
          2
        ),
        "utf8"
      );
    }
  } catch (_) {}
}

try {
  console.log(
    "[1] Create capability request"
  );

  const request =
    createCapabilityRequest({
      capabilityType:
        "tool",

      name:
        "stage-4.10.6-approval-test",

      description:
        "Controlled human approval gate test.",

      requestedBy:
        "stage-4.10.6-test"
    });

  requestId =
    request.requestId;

  assert.strictEqual(
    request.status,
    "requested"
  );

  pass(
    "Initial status is requested"
  );

  console.log(
    "[2] Create proposal"
  );

  const proposal =
    createCapabilityProposal(
      requestId,
      {
        title:
          "Stage 4.10.6 approval test",

        reason:
          "Verify human approval gate.",

        expectedBenefit:
          "Validated capabilities can enter controlled apply only after human approval.",

        risk:
          "high",

        actor:
          "mira-stage-4.10.6-test"
      }
    );

  changeId =
    proposal.proposal.changeId;

  const afterProposal =
    getCapabilityRequest(
      requestId
    );

  assert.strictEqual(
    afterProposal.status,
    "proposed"
  );

  pass(
    "Request moved to proposed"
  );

  console.log(
    "[3] Classify risk"
  );

  classifyCapabilityRisk(
    requestId,
    {
      risk:
        "high",

      actor:
        "mira-risk-engine"
    }
  );

  const afterRisk =
    getCapabilityRequest(
      requestId
    );

  assert.strictEqual(
    afterRisk.status,
    "risk_classified"
  );

  pass(
    "Risk classification completed"
  );

  console.log(
    "[4] Stage capability"
  );

  stageCapabilityRequest(
    requestId,
    {
      actor:
        "mira-staging-engine"
    }
  );

  const afterStage =
    getCapabilityRequest(
      requestId
    );

  assert.strictEqual(
    afterStage.status,
    "staged"
  );

  assert.strictEqual(
    afterStage.staging
      .executionAllowed,
    false
  );

  pass(
    "Capability staged"
  );

  console.log(
    "[5] Validate capability"
  );

  const validation =
    validateCapabilityArtifact(
      changeId
    );

  assert.strictEqual(
    validation.ok,
    true
  );

  assert.strictEqual(
    validation.status,
    "validated"
  );

  pass(
    "Capability artifact validated"
  );

  recordCapabilityValidation(
    requestId,
    validation,
    "mira-validation-engine"
  );

  const afterValidation =
    getCapabilityRequest(
      requestId
    );

  assert.strictEqual(
    afterValidation.status,
    "validated"
  );

  pass(
    "Capability moved to validated"
  );

  console.log(
    "[6] Verify autonomous approval is denied"
  );

  const autonomous =
    autonomousApprovalAttempt(
      requestId
    );

  assert.strictEqual(
    autonomous.ok,
    false
  );

  assert.strictEqual(
    autonomous.status,
    "approval_denied"
  );

  assert.strictEqual(
    autonomous.humanApprovalRequired,
    true
  );

  pass(
    "Autonomous approval denied"
  );

  console.log(
    "[7] Verify non-admin approval is denied"
  );

  expectThrow(
    () =>
      approveValidatedCapability(
        requestId,
        "mira",
        "mira"
      ),
    "authorized admin actor"
  );

  pass(
    "Non-admin approval denied"
  );

  console.log(
    "[8] Human approval"
  );

  const approval =
    approveValidatedCapability(
      requestId,
      "admin:stage-4.10.6-test"
    );

  assert.strictEqual(
    approval.ok,
    true
  );

  assert.strictEqual(
    approval.status,
    "approved_for_controlled_apply"
  );

  assert.strictEqual(
    approval.approval.approvedBy,
    "admin:stage-4.10.6-test"
  );

  assert.strictEqual(
    approval.approval.executionAllowed,
    false
  );

  assert.strictEqual(
    approval.approval.applyAllowed,
    false
  );

  assert.strictEqual(
    approval.approval.activationAllowed,
    false
  );

  pass(
    "Authorized human approval accepted"
  );

  console.log(
    "[9] Persist approval"
  );

  const persisted =
    recordCapabilityApproval(
      requestId,
      approval.approval,
      "admin:stage-4.10.6-test"
    );

  assert.strictEqual(
    persisted.ok,
    true
  );

  assert.strictEqual(
    persisted.request.approval.status,
    "approved"
  );

  pass(
    "Approval persisted"
  );

  console.log(
    "[10] Verify final safety boundary"
  );

  const finalState =
    getCapabilityRequest(
      requestId
    );

  assert.strictEqual(
    finalState.status,
    "approved_for_controlled_apply"
  );

  assert.strictEqual(
    finalState.approval.status,
    "approved"
  );

  assert.strictEqual(
    finalState.approval
      .executionAllowed,
    false
  );

  assert.strictEqual(
    finalState.approval
      .applyAllowed,
    false
  );

  assert.strictEqual(
    finalState.approval
      .activationAllowed,
    false
  );

  assert.strictEqual(
    finalState.healthCheck,
    null
  );

  pass(
    "Execution, apply, and activation remain blocked"
  );

  console.log(
    "[11] Verify staged artifact remains inactive"
  );

  const artifact =
    getArtifact(changeId);

  assert.strictEqual(
    artifact.ok,
    true
  );

  assert.strictEqual(
    artifact.manifest.status,
    "ready_for_review"
  );

  pass(
    "Staged artifact remains ready_for_review"
  );

  console.log(
    "[12] Verify lifecycle"
  );

  const lifecycle =
    finalState.lifecycle
      .map(item => item.status);

  assert.deepStrictEqual(
    lifecycle.slice(-5),
    [
      "proposed",
      "risk_classified",
      "staged",
      "validated",
      "approved_for_controlled_apply"
    ]
  );

  pass(
    "Lifecycle requested -> proposed -> risk_classified -> staged -> validated -> approved_for_controlled_apply verified"
  );

  console.log(
    "[13] Verify approval cannot be duplicated"
  );

  expectThrow(
    () =>
      recordCapabilityApproval(
        requestId,
        approval.approval,
        "admin:stage-4.10.6-test"
      ),
    "must be validated before approval"
  );

  pass(
    "Duplicate approval denied"
  );

  console.log(
    ""
  );

  console.log(
    "STAGE_4.10.6_E2E: PASS"
  );

  console.log(
    "Human Approval Gate verified."
  );

  console.log(
    "Autonomous approval, non-admin approval, apply, execution, and activation remain blocked."
  );
} catch (error) {
  console.error(
    "STAGE_4.10.6_E2E: FAIL"
  );

  console.error(
    error.message
  );

  process.exitCode = 1;
} finally {
  cleanup();
}
