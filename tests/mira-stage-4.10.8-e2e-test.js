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
  recordCapabilityApproval,
  recordCapabilityHealthCheck
} = require("../capability-request");

const {
  validateCapabilityArtifact
} = require("../services/mira-capability-validation");

const {
  approveValidatedCapability
} = require("../services/mira-capability-approval");

const {
  applyCapabilityRequest
} = require("../services/mira-capability-apply-gate");

const {
  healthCheckCapability
} = require("../services/mira-capability-health-check");

const {
  getArtifact
} = require("../staging-manager");

const {
  getArtifactApplyStatus,
  rollbackPreparedChange
} = require("../artifact-apply-engine");

const PROJECT_ROOT =
  path.resolve(__dirname, "..");

function assert(
  condition,
  message
) {
  if (!condition) {
    throw new Error(
      message
    );
  }

  console.log(
    `PASS: ${message}`
  );
}

function cleanup(
  requestId,
  changeId
) {
  try {
    if (changeId) {
      const status =
        getArtifactApplyStatus(
          changeId
        );

      if (
        status &&
        status.transaction &&
        [
          "prepared",
          "applying",
          "applied",
          "failed"
        ].includes(
          status.transaction.status
        )
      ) {
        try {
          rollbackPreparedChange(
            changeId,
            "admin:stage-4.10.8-e2e-cleanup"
          );
        } catch (_) {}
      }

      const stagingRoot =
        path.join(
          PROJECT_ROOT,
          "staging",
          "changes",
          changeId
        );

      fs.rmSync(
        stagingRoot,
        {
          recursive: true,
          force: true
        }
      );

      const backupRoot =
        path.join(
          PROJECT_ROOT,
          "backups",
          "artifact-applies",
          changeId
        );

      fs.rmSync(
        backupRoot,
        {
          recursive: true,
          force: true
        }
      );
    }

    if (requestId) {
      const {
        REQUEST_FILE
      } = require(
        "../capability-request"
      );

      if (
        fs.existsSync(
          REQUEST_FILE
        )
      ) {
        const data =
          JSON.parse(
            fs.readFileSync(
              REQUEST_FILE,
              "utf8"
            )
          );

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
    }
  } catch (_) {}
}

let requestId = null;
let changeId = null;

try {
  console.log(
    "[1] Create capability request"
  );

  const created =
    createCapabilityRequest({
      capabilityType:
        "tool",

      name:
        "stage-4-10-8-health-test-tool",

      description:
        "Stage 4.10.8 E2E health-check capability.",

      requestedBy:
        "admin:stage-4.10.8-e2e"
    });

  requestId =
    created.requestId;

  assert(
    created.status ===
      "requested",
    "Initial status is requested"
  );

  console.log(
    "[2] Create proposal"
  );

  const proposal =
    createCapabilityProposal(
      requestId,
      {
        reason:
          "Verify applied capability health.",

        expectedBenefit:
          "Provide post-apply health verification.",

        risk:
          "high",

        actor:
          "admin:stage-4.10.8-e2e"
      }
    );

  changeId =
    proposal.proposal.changeId;

  assert(
    proposal.status ===
      "capability_proposed",
    "Capability proposal created"
  );

  console.log(
    "[3] Classify risk"
  );

  const classified =
    classifyCapabilityRisk(
      requestId,
      {
        risk:
          "high",

        actor:
          "admin:stage-4.10.8-e2e"
      }
    );

  assert(
    classified.status ===
      "risk_classified",
    "Risk classification completed"
  );

  console.log(
    "[4] Stage capability"
  );

  const staged =
    stageCapabilityRequest(
      requestId,
      {
        actor:
          "admin:stage-4.10.8-e2e"
      }
    );

  assert(
    staged.status ===
      "capability_staged",
    "Capability staged"
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
    "Capability artifact validation passed"
  );

  const recordedValidation =
    recordCapabilityValidation(
      requestId,
      validation,
      "admin:stage-4.10.8-e2e"
    );

  assert(
    recordedValidation.status ===
      "capability_validated",
    "Validation lifecycle recorded"
  );

  console.log(
    "[6] Human approval"
  );

  const approval =
    approveValidatedCapability(
      requestId,
      "admin:stage-4.10.8-e2e"
    );

  assert(
    approval.ok === true,
    "Human approval accepted"
  );

  recordCapabilityApproval(
    requestId,
    approval.approval,
    "admin:stage-4.10.8-e2e"
  );

  assert(
    getCapabilityRequest(
      requestId
    ).approval.status ===
      "approved",
    "Human approval persisted"
  );

  console.log(
    "[7] Controlled apply"
  );

  const applied =
    applyCapabilityRequest(
      requestId,
      "admin:stage-4.10.8-e2e"
    );

  assert(
    applied.ok === true,
    "Controlled apply completed"
  );

  const appliedArtifact =
    getArtifact(
      changeId
    );

  assert(
    appliedArtifact.manifest.status ===
      "applied",
    "Artifact status is applied"
  );

  console.log(
    "[8] Tool health check"
  );

  const health =
    healthCheckCapability(
      requestId
    );

  assert(
    health.ok === true,
    "Tool health check passed"
  );

  assert(
    health.status ===
      "health_check_passed",
    "Health check status is passed"
  );

  assert(
    health.healthCheckPassed ===
      true,
    "Health check result is healthy"
  );

  assert(
    health.checks.length >= 1,
    "At least one applied artifact was health-checked"
  );

  assert(
    health.checks.every(
      item =>
        item.ok === true
    ),
    "All applied artifacts passed health checks"
  );

  console.log(
    "[9] Verify safety boundary"
  );

  assert(
    health.executionAllowed ===
      false,
    "Execution remains blocked"
  );

  assert(
    health.activationAllowed ===
      false,
    "Activation remains blocked"
  );

  assert(
    health.applyAllowed ===
      false,
    "Health check does not grant apply permission"
  );

  console.log(
    "[10] Record health-check lifecycle"
  );

  const recordedHealth =
    recordCapabilityHealthCheck(
      requestId,
      health,
      "admin:stage-4.10.8-e2e"
    );

  assert(
    recordedHealth.ok === true,
    "Health check lifecycle recorded"
  );

  assert(
    recordedHealth.status ===
      "health_check_recorded",
    "Health check record persisted"
  );

  console.log(
    "[11] Verify persisted state"
  );

  const persisted =
    getCapabilityRequest(
      requestId
    );

  assert(
    persisted.healthCheck &&
      persisted.healthCheck.status ===
        "health_check_passed",
    "Health check state persisted"
  );

  assert(
    persisted.healthCheck.executionAllowed ===
      false,
    "Persisted execution boundary remains blocked"
  );

  assert(
    persisted.healthCheck.activationAllowed ===
      false,
    "Persisted activation boundary remains blocked"
  );

  console.log(
    "[12] Verify lifecycle"
  );

  const lifecycle =
    persisted.lifecycle.map(
      item =>
        item.status
    );

  const expectedLifecycle = [
    "requested",
    "proposed",
    "risk_classified",
    "staged",
    "validated",
    "approved_for_controlled_apply",
    "health_check_passed"
  ];

  assert(
    JSON.stringify(
      lifecycle
    ) ===
      JSON.stringify(
        expectedLifecycle
      ),
    "Lifecycle requested -> proposed -> risk_classified -> staged -> validated -> approved_for_controlled_apply -> health_check_passed verified"
  );

  console.log(
    "[13] Verify duplicate health check is denied"
  );

  let duplicateDenied =
    false;

  try {
    recordCapabilityHealthCheck(
      requestId,
      health,
      "admin:stage-4.10.8-e2e"
    );
  } catch (_) {
    duplicateDenied =
      true;
  }

  assert(
    duplicateDenied,
    "Duplicate health check denied"
  );

  console.log(
    "[14] Final safety boundary"
  );

  assert(
    persisted.governance.executionAllowed ===
      false,
    "Governance execution remains blocked"
  );

  assert(
    persisted.governance.activationAllowed ===
      false,
    "Governance activation remains blocked"
  );

  console.log(
    ""
  );

  console.log(
    "STAGE_4.10.8_E2E: PASS"
  );

  console.log(
    "Capability Apply -> Tool Health Check -> Persistence -> Safety Boundary verified."
  );

  cleanup(
    requestId,
    changeId
  );

} catch (error) {
  console.error(
    ""
  );

  console.error(
    "STAGE_4.10.8_E2E: FAIL"
  );

  console.error(
    error.message
  );

  cleanup(
    requestId,
    changeId
  );

  process.exit(
    1
  );
}
