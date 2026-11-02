"use strict";

const fs = require("fs");
const path = require("path");

const {
  createCapabilityRequest,
  getCapabilityRequest,
  createCapabilityProposal,
  classifyCapabilityRisk,
  stageCapabilityRequest,
  getCapabilityRequestStatus
} = require("../capability-request");

const {
  getProposal
} = require("../change-management");

const {
  getArtifact
} = require("../staging-manager");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function cleanup(changeId, requestId) {
  const stagingDir =
    path.join(
      __dirname,
      "..",
      "staging",
      "changes",
      changeId
    );

  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, {
      recursive: true,
      force: true
    });
  }

  const requestFile =
    path.join(
      __dirname,
      "..",
      "capability-requests.json"
    );

  if (fs.existsSync(requestFile)) {
    const requests =
      JSON.parse(
        fs.readFileSync(
          requestFile,
          "utf8"
        )
      );

    const filtered =
      requests.filter(
        item =>
          item.requestId !== requestId
      );

    fs.writeFileSync(
      requestFile,
      JSON.stringify(
        filtered,
        null,
        2
      ),
      "utf8"
    );
  }

  const proposalFile =
    path.join(
      __dirname,
      "..",
      "change-proposals.json"
    );

  if (fs.existsSync(proposalFile)) {
    const proposals =
      JSON.parse(
        fs.readFileSync(
          proposalFile,
          "utf8"
        )
      );

    const filtered =
      proposals.filter(
        item =>
          item.changeId !== changeId
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

let requestId = null;
let changeId = null;

try {
  console.log(
    "[1] Create capability request"
  );

  const created =
    createCapabilityRequest({
      capabilityType: "tool",
      name:
        "stage-4-10-4-test-tool",
      description:
        "Temporary capability staging test.",
      requestedBy:
        "stage-4.10.4-test"
    });

  requestId =
    created.requestId;

  assert(
    created.status === "requested",
    "Initial status must be requested."
  );

  assert(
    created.governance.stagingAllowed === true,
    "Staging must be allowed for the staging lifecycle."
  );

  console.log("PASS");

  console.log(
    "[2] Create proposal"
  );

  const proposalResult =
    createCapabilityProposal(
      requestId,
      {
        actor:
          "mira-stage-4.10.4",
        risk: "high",
        title:
          "Stage 4.10.4 capability test",
        reason:
          "Verify capability staging lifecycle.",
        expectedBenefit:
          "Verify safe inactive staging."
      }
    );

  changeId =
    proposalResult.proposal.changeId;

  assert(
    proposalResult.request.status ===
      "proposed",
    "Request must become proposed."
  );

  assert(
    proposalResult.proposal.status ===
      "proposed",
    "Proposal must remain proposed."
  );

  console.log("PASS");

  console.log(
    "[3] Classify risk"
  );

  const riskResult =
    classifyCapabilityRisk(
      requestId,
      {
        actor:
          "mira-stage-4.10.4"
      }
    );

  assert(
    riskResult.request.status ===
      "risk_classified",
    "Request must become risk_classified."
  );

  assert(
    riskResult.riskClassification.risk ===
      "high",
    "Risk must remain high."
  );

  console.log("PASS");

  console.log(
    "[4] Stage capability"
  );

  const stageResult =
    stageCapabilityRequest(
      requestId,
      {
        actor:
          "mira-stage-4.10.4"
      }
    );

  assert(
    stageResult.ok === true,
    "Staging must succeed."
  );

  assert(
    stageResult.request.status ===
      "staged",
    "Request must become staged."
  );

  assert(
    stageResult.staging.artifactStatus ===
      "ready_for_review",
    "Artifact must be ready_for_review."
  );

  assert(
    stageResult.staging.verified === true,
    "Staged artifact must verify."
  );

  console.log("PASS");

  console.log(
    "[5] Verify artifact"
  );

  const artifact =
    getArtifact(changeId);

  assert(
    artifact.ok === true,
    "Artifact must exist."
  );

  assert(
    artifact.manifest.status ===
      "ready_for_review",
    "Artifact status must be ready_for_review."
  );

  assert(
    artifact.manifest.artifacts.length >= 1,
    "Artifact must contain at least one file."
  );

  console.log("PASS");

  console.log(
    "[6] Verify proposal remains unapproved"
  );

  const proposal =
    getProposal(changeId);

  assert(
    proposal !== null,
    "Proposal must still exist."
  );

  assert(
    proposal.status === "proposed",
    `Proposal must remain proposed. Current: ${proposal.status}`
  );

  console.log("PASS");

  console.log(
    "[7] Verify safety boundary"
  );

  const storedRequest =
    getCapabilityRequest(
      requestId
    );

  assert(
    storedRequest.governance.executionAllowed ===
      false,
    "Execution must remain blocked."
  );

  assert(
    storedRequest.governance.activationAllowed ===
      false,
    "Activation must remain blocked."
  );

  assert(
    storedRequest.governance.approvalRequired ===
      true,
    "Human approval must remain required."
  );

  assert(
    storedRequest.approval === null,
    "Approval must not exist."
  );

  assert(
    storedRequest.apply === null,
    "Apply must not exist."
  );

  assert(
    storedRequest.healthCheck === null,
    "Health check must not exist."
  );

  console.log(
    "PASS: Execution, approval, apply, and activation remain blocked"
  );

  console.log(
    "[8] Verify status counters"
  );

  const status =
    getCapabilityRequestStatus();

  assert(
    status.counts.staged >= 1,
    "Staged counter must increase."
  );

  assert(
    status.safetyBoundary.executionAllowed ===
      false,
    "Global execution boundary must remain blocked."
  );

  assert(
    status.safetyBoundary.activationAllowed ===
      false,
    "Global activation boundary must remain blocked."
  );

  console.log("PASS");

  console.log("");
  console.log(
    "STAGE_4.10.4_E2E: PASS"
  );
  console.log(
    "Capability Request -> Proposal -> Risk Classification -> Staging verified."
  );
  console.log(
    "Staged artifact is inactive and remains blocked from approval, apply, execution, and activation."
  );

} catch (error) {
  console.error("");
  console.error(
    "STAGE_4.10.4_E2E: FAIL"
  );
  console.error(
    error.message
  );
  process.exitCode = 1;

} finally {
  if (requestId && changeId) {
    cleanup(
      changeId,
      requestId
    );
  }
}
