"use strict";

const fs = require("fs");
const path = require("path");

const {
  createCapabilityRequest,
  createCapabilityProposal,
  classifyCapabilityRisk,
  stageCapabilityRequest,
  recordCapabilityValidation,
  recordCapabilityApproval,
  getCapabilityRequest
} = require("../capability-request");

const {
  validateCapabilityArtifact
} = require("../services/mira-capability-validation");

const {
  approveValidatedCapability,
  autonomousApprovalAttempt
} = require("../services/mira-capability-approval");

const {
  authorizeCapabilityApply,
  applyCapabilityRequest,
  autonomousApplyAttempt
} = require("../services/mira-capability-apply-gate");

const {
  getArtifact
} = require("../staging-manager");

const {
  rollbackPreparedChange,
  getArtifactApplyStatus
} = require("../artifact-apply-engine");

const TEST_NAME =
  `stage-4.10.7-${Date.now()}`;

let requestId = null;
let changeId = null;


function assert(
  condition,
  message
) {
  if (!condition) {
    throw new Error(
      `FAIL: ${message}`
    );
  }

  console.log(
    `PASS: ${message}`
  );
}


function cleanup() {
  if (!changeId) {
    return;
  }

  try {
    const applyStatus =
      getArtifactApplyStatus(
        changeId
      );

    if (
      applyStatus &&
      applyStatus.transaction
    ) {
      const status =
        applyStatus.transaction.status;

      if (
        [
          "prepared",
          "applying",
          "applied",
          "failed"
        ].includes(status)
      ) {
        try {
          rollbackPreparedChange(
            changeId,
            "admin:stage-4.10.7-e2e-cleanup"
          );
        } catch (error) {
          // Best-effort cleanup.
        }
      }
    }
  } catch (error) {
    // Best-effort cleanup.
  }

  try {
    const changeRoot =
      path.join(
        __dirname,
        "..",
        "staging",
        "changes",
        changeId
      );

    fs.rmSync(
      changeRoot,
      {
        recursive: true,
        force: true
      }
    );
  } catch (error) {
    // Best-effort cleanup.
  }
}


try {
  console.log(
    "[1] Create capability request"
  );

  const created =
    createCapabilityRequest({
      capabilityType: "tool",
      name: TEST_NAME,
      description:
        "Stage 4.10.7 controlled apply E2E capability.",
      requestedBy:
        "admin:stage-4.10.7-e2e"
    });

  requestId =
    created.requestId;

  assert(
    typeof requestId ===
      "string" &&
      requestId.length > 0,
    "Capability request created"
  );

  assert(
    created.status ===
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
        title:
          "Stage 4.10.7 Controlled Apply Test",

        reason:
          "Verify controlled capability apply boundary.",

        expectedBenefit:
          "Validate controlled apply lifecycle.",

        category:
          "tool",

        risk:
          "high",

        actor:
          "admin:stage-4.10.7-e2e"
      }
    );

  assert(
    proposalResult.ok === true,
    "Capability proposal created"
  );

  changeId =
    proposalResult.proposal.changeId;

  assert(
    typeof changeId ===
      "string" &&
      changeId.length > 0,
    "Proposal changeId created"
  );

  let request =
    getCapabilityRequest(
      requestId
    );

  assert(
    request.status ===
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
        risk:
          "high",

        actor:
          "admin:stage-4.10.7-e2e"
      }
    );

  assert(
    riskResult.ok === true,
    "Risk classification completed"
  );

  request =
    getCapabilityRequest(
      requestId
    );

  assert(
    request.status ===
      "risk_classified",
    "Request moved to risk_classified"
  );


  console.log(
    "[4] Stage capability"
  );

  const stagingResult =
    stageCapabilityRequest(
      requestId,
      {
        actor:
          "admin:stage-4.10.7-e2e"
      }
    );

  assert(
    stagingResult.ok === true,
    "Capability staged"
  );

  request =
    getCapabilityRequest(
      requestId
    );

  assert(
    request.status ===
      "staged",
    "Request moved to staged"
  );

  assert(
    request.governance.executionAllowed ===
      false,
    "Staged execution remains blocked"
  );


  console.log(
    "[5] Validate capability"
  );

  const validation =
    validateCapabilityArtifact(
      changeId
    );

  assert(
    validation.ok === true,
    "Capability artifact validated"
  );

  const validationRecord =
    recordCapabilityValidation(
      requestId,
      validation,
      "mira-validation-engine"
    );

  assert(
    validationRecord.ok === true,
    "Validation lifecycle recorded"
  );

  request =
    getCapabilityRequest(
      requestId
    );

  assert(
    request.status ===
      "validated",
    "Capability moved to validated"
  );


  console.log(
    "[6] Verify autonomous approval is denied"
  );

  const autonomousApproval =
    autonomousApprovalAttempt(
      requestId
    );

  assert(
    autonomousApproval.ok === false,
    "Autonomous approval denied"
  );


  console.log(
    "[7] Human approval"
  );

  const approval =
    approveValidatedCapability(
      requestId,
      "admin:stage-4.10.7-e2e"
    );

  assert(
    approval.ok === true,
    "Authorized human approval accepted"
  );

  const approvalRecord =
    recordCapabilityApproval(
      requestId,
      approval.approval,
      "admin:stage-4.10.7-e2e"
    );

  assert(
    approvalRecord.ok === true,
    "Human approval persisted"
  );

  request =
    getCapabilityRequest(
      requestId
    );

  assert(
    request.approval &&
      request.approval.status ===
        "approved",
    "Approval status is approved"
  );


  console.log(
    "[8] Verify autonomous apply is denied"
  );

  const autonomousApply =
    autonomousApplyAttempt(
      requestId
    );

  assert(
    autonomousApply.ok === false,
    "Autonomous apply denied"
  );

  assert(
    autonomousApply.executionAllowed ===
      false,
    "Autonomous execution remains blocked"
  );


  console.log(
    "[9] Verify artifact before controlled apply"
  );

  let artifact =
    getArtifact(
      changeId
    );

  assert(
    artifact &&
      artifact.manifest &&
      artifact.manifest.status ===
        "ready_for_review",
    "Artifact remains ready_for_review before apply gate"
  );


  console.log(
    "[10] Authorize controlled apply"
  );

  const authorization =
    authorizeCapabilityApply(
      requestId,
      "admin:stage-4.10.7-e2e"
    );

  assert(
    authorization.ok === true,
    "Controlled apply authorization accepted"
  );

  assert(
    authorization.humanApprovalVerified ===
      true,
    "Human approval verified by apply gate"
  );

  assert(
    authorization.validationVerified ===
      true,
    "Capability validation verified by apply gate"
  );

  assert(
    authorization.applyAllowed ===
      true,
    "Controlled apply gate grants apply permission"
  );

  assert(
    authorization.executionAllowed ===
      false,
    "Execution remains independently blocked"
  );

  assert(
    authorization.activationAllowed ===
      false,
    "Activation remains independently blocked"
  );


  console.log(
    "[11] Verify non-admin apply is denied"
  );

  let unauthorizedDenied =
    false;

  try {
    authorizeCapabilityApply(
      requestId,
      "mira"
    );
  } catch (error) {
    unauthorizedDenied = true;
  }

  assert(
    unauthorizedDenied,
    "Non-admin controlled apply denied"
  );


  console.log(
    "[12] Controlled apply"
  );

  const applyResult =
    applyCapabilityRequest(
      requestId,
      "admin:stage-4.10.7-e2e"
    );

  assert(
    applyResult.ok === true,
    "Controlled apply completed"
  );

  assert(
    applyResult.status ===
      "controlled_apply_completed",
    "Controlled apply lifecycle completed"
  );

  assert(
    applyResult.applied &&
      applyResult.applied.status ===
        "applied",
    "Existing artifact apply engine reported applied"
  );


  console.log(
    "[13] Verify artifact apply status"
  );

  artifact =
    getArtifact(
      changeId
    );

  assert(
    artifact &&
      artifact.manifest &&
      artifact.manifest.status ===
        "applied",
    "Artifact status is applied"
  );


  console.log(
    "[14] Verify capability safety boundary"
  );

  request =
    getCapabilityRequest(
      requestId
    );

  assert(
    request.approval.activationAllowed ===
      false,
    "Activation remains blocked after apply"
  );

  assert(
    request.governance.activationAllowed ===
      false,
    "Governance activation boundary remains blocked"
  );

  assert(
    request.healthCheck === null,
    "Health check remains unset for Stage 4.10.8"
  );


  console.log(
    "[15] Verify apply audit"
  );

  const auditPath =
    path.join(
      __dirname,
      "..",
      "capability-apply-audit.json"
    );

  assert(
    fs.existsSync(auditPath),
    "Controlled apply audit file created"
  );

  const audit =
    JSON.parse(
      fs.readFileSync(
        auditPath,
        "utf8"
      )
    );

  assert(
    audit.some(
      entry =>
        entry.requestId ===
          requestId &&
        entry.event ===
          "controlled_apply_authorized"
    ),
    "Apply authorization was audited"
  );

  assert(
    audit.some(
      entry =>
        entry.requestId ===
          requestId &&
        entry.event ===
          "controlled_apply_completed"
    ),
    "Apply completion was audited"
  );


  console.log("");

  console.log(
    "STAGE_4.10.7_E2E: PASS"
  );

  console.log(
    "Capability Request -> Proposal -> Risk Classification -> Staging -> Validation -> Human Approval -> Controlled Apply verified."
  );

  console.log(
    "Autonomous approval/apply, non-admin apply, direct activation, and execution remain blocked."
  );

} catch (error) {
  console.error("");

  console.error(
    "STAGE_4.10.7_E2E: FAIL"
  );

  console.error(
    error.message
  );

  process.exitCode = 1;

} finally {
  cleanup();
}
