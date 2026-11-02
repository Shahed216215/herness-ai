"use strict";

const fs = require("fs");
const path = require("path");

const {
  createCapabilityRequest,
  getCapabilityRequest,
  createCapabilityProposal,
  classifyCapabilityRisk,
  stageCapabilityRequest,
  recordCapabilityValidation,
  getCapabilityRequestStatus
} = require("../capability-request");

const {
  getProposal
} = require("../change-management");

const {
  getArtifact
} = require("../staging-manager");

const {
  validateCapabilityArtifact
} = require("../services/mira-capability-validation");

const REQUEST_FILE =
  path.join(
    __dirname,
    "..",
    "capability-requests.json"
  );

function assert(
  condition,
  message
) {
  if (!condition) {
    throw new Error(
      `ASSERTION_FAILED: ${message}`
    );
  }

  console.log(`PASS: ${message}`);
}

function cleanup(
  requestId,
  changeId
) {
  if (
    fs.existsSync(REQUEST_FILE)
  ) {
    const requests =
      JSON.parse(
        fs.readFileSync(
          REQUEST_FILE,
          "utf8"
        )
      );

    const filtered =
      requests.filter(
        request =>
          request.requestId !==
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

  if (changeId) {
    const stagingPath =
      path.join(
        __dirname,
        "..",
        "staging",
        "changes",
        changeId
      );

    if (
      fs.existsSync(stagingPath)
    ) {
      fs.rmSync(
        stagingPath,
        {
          recursive: true,
          force: true
        }
      );
    }

    const proposalFile =
      path.join(
        __dirname,
        "..",
        "change-proposals.json"
      );

    if (
      fs.existsSync(proposalFile)
    ) {
      const proposals =
        JSON.parse(
          fs.readFileSync(
            proposalFile,
            "utf8"
          )
        );

      const filtered =
        proposals.filter(
          proposal =>
            proposal.changeId !==
            changeId
        );

      fs.writeFileSync(
        proposalFile,
        JSON.stringify(
          filtered,
          null,
          2
        ),
        "utf8"
      );
    }
  }
}

let requestId = null;
let changeId = null;

try {
  console.log(
    "[1] Create capability request"
  );

  const request =
    createCapabilityRequest({
      capabilityType: "tool",
      name:
        "Stage 4.10.5 Validation Test Tool",
      description:
        "Controlled test capability for validating the 4.10.5 lifecycle.",
      requestedBy:
        "admin:stage-4.10.5-test"
    });

  requestId =
    request.requestId;

  assert(
    request.status ===
      "requested",
    "Initial status is requested"
  );

  console.log(
    "[2] Create proposal"
  );

  const proposalResult =
    createCapabilityProposal(
      requestId,
      {
        actor:
          "admin:stage-4.10.5-test",
        risk: "high",
        expectedBenefit:
          "Validate staged capability artifacts safely."
      }
    );

  changeId =
    proposalResult.proposal.changeId;

  assert(
    proposalResult.request.status ===
      "proposed",
    "Request moved to proposed"
  );

  console.log(
    "[3] Classify risk"
  );

  const riskResult =
    classifyCapabilityRisk(
      requestId,
      {
        actor:
          "admin:stage-4.10.5-test",
        risk: "high"
      }
    );

  assert(
    riskResult.request.status ===
      "risk_classified",
    "Risk classification completed"
  );

  assert(
    riskResult.riskClassification.risk ===
      "high",
    "Risk level is high"
  );

  console.log(
    "[4] Stage capability"
  );

  const stageResult =
    stageCapabilityRequest(
      requestId,
      {
        actor:
          "admin:stage-4.10.5-test"
      }
    );

  assert(
    stageResult.request.status ===
      "staged",
    "Capability moved to staged"
  );

  assert(
    stageResult.request.staging
      .executionAllowed ===
      false,
    "Staged execution remains blocked"
  );

  console.log(
    "[5] Validate staged artifact"
  );

  const validation =
    validateCapabilityArtifact(
      changeId
    );

  assert(
    validation.ok === true,
    "Artifact validation passed"
  );

  assert(
    validation.status ===
      "validated",
    "Validation status is validated"
  );

  assert(
    validation.integrity.ok ===
      true,
    "Artifact integrity verified"
  );

  assert(
    validation.artifacts.length >
      0,
    "At least one staged artifact was validated"
  );

  assert(
    validation.artifacts.every(
      item =>
        item.ok === true
    ),
    "All staged artifacts passed validation"
  );

  console.log(
    "[6] Record validation lifecycle"
  );

  const recordResult =
    recordCapabilityValidation(
      requestId,
      validation,
      "mira-validation-engine"
    );

  assert(
    recordResult.request.status ===
      "validated",
    "Capability moved to validated"
  );

  console.log(
    "[7] Verify proposal remains unapproved"
  );

  const storedProposal =
    getProposal(changeId);

  assert(
    storedProposal.status ===
      "proposed",
    "Proposal remains proposed"
  );

  assert(
    recordResult.request.approval ===
      null,
    "Approval remains null"
  );

  console.log(
    "[8] Verify apply and activation boundary"
  );

  assert(
    recordResult.request.apply ===
      null,
    "Apply remains null"
  );

  assert(
    recordResult.request.healthCheck ===
      null,
    "Health check remains null"
  );

  assert(
    recordResult.request.governance
      .executionAllowed ===
      false,
    "Execution remains blocked"
  );

  assert(
    recordResult.request.governance
      .activationAllowed ===
      false,
    "Activation remains blocked"
  );

  assert(
    recordResult.request.validation
      .approvalRequired ===
      true,
    "Human approval remains required"
  );

  console.log(
    "[9] Verify persisted validated state"
  );

  const storedRequest =
    getCapabilityRequest(
      requestId
    );

  assert(
    storedRequest.status ===
      "validated",
    "Validated state persisted"
  );

  assert(
    storedRequest.validation
      .status ===
      "validated",
    "Validation record persisted"
  );

  console.log(
    "[10] Verify status counters"
  );

  const status =
    getCapabilityRequestStatus();

  assert(
    status.ok === true,
    "Capability request status available"
  );

  assert(
    status.counts.validated >=
      1,
    "Validated request counter updated"
  );

  console.log(
    "STAGE_4.10.5_E2E: PASS"
  );

  console.log(
    "Capability Request -> Proposal -> Risk Classification -> Staging -> Validation verified."
  );

  console.log(
    "Validated capability remains blocked from approval, apply, execution, and activation."
  );
} catch (error) {
  console.error(
    "STAGE_4.10.5_E2E: FAIL"
  );

  console.error(
    error.message
  );

  process.exitCode = 1;
} finally {
  cleanup(
    requestId,
    changeId
  );
}
