"use strict";

const fs = require("fs");
const assert = require("assert");

const {
  REQUEST_FILE,
  createCapabilityRequest,
  getCapabilityRequest,
  createCapabilityProposal,
  classifyCapabilityRisk,
  getCapabilityRequestStatus
} = require("../capability-request");

const {
  CHANGE_FILE,
  getProposal
} = require("../change-management");

function cleanRequestStore() {
  if (fs.existsSync(REQUEST_FILE)) {
    fs.unlinkSync(REQUEST_FILE);
  }
}

function cleanProposal(changeId) {
  if (!changeId || !fs.existsSync(CHANGE_FILE)) {
    return;
  }

  const data =
    JSON.parse(
      fs.readFileSync(
        CHANGE_FILE,
        "utf8"
      )
    );

  const filtered =
    data.filter(
      item =>
        item.changeId !== changeId
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

function pass(message) {
  console.log(
    `PASS: ${message}`
  );
}

function main() {
  console.log("");
  console.log(
    "=========================================="
  );
  console.log(
    "MIRA STAGE 4.10.3 RISK CLASSIFICATION TEST"
  );
  console.log(
    "=========================================="
  );
  console.log("");

  cleanRequestStore();

  let changeId = null;

  try {
    console.log(
      "[1] Create capability request"
    );

    const request =
      createCapabilityRequest({
        capabilityType: "tool",
        name:
          "Stage 4.10.3 Test Tool",
        description:
          "Verify controlled capability risk classification.",
        requestedBy:
          "stage-4.10.3-test"
      });

    assert.strictEqual(
      request.status,
      "requested"
    );

    pass(
      "Capability request created"
    );

    console.log(
      "[2] Create proposal"
    );

    const proposalResult =
      createCapabilityProposal(
        request.requestId,
        {
          actor: "mira",
          risk: "high",
          estimatedComplexity: "medium"
        }
      );

    changeId =
      proposalResult.proposal.changeId;

    assert.strictEqual(
      proposalResult.request.status,
      "proposed"
    );

    pass(
      "Capability proposal created"
    );

    console.log(
      "[3] Classify risk"
    );

    const riskResult =
      classifyCapabilityRisk(
        request.requestId,
        {
          actor:
            "mira-risk-engine"
        }
      );

    assert.strictEqual(
      riskResult.ok,
      true
    );

    assert.strictEqual(
      riskResult.status,
      "risk_classified"
    );

    assert.strictEqual(
      riskResult.riskClassification.risk,
      "high"
    );

    pass(
      "Risk classification completed"
    );

    console.log(
      "[4] Verify classification factors"
    );

    assert.ok(
      riskResult.riskClassification.factors.includes(
        "tool_capability"
      )
    );

    assert.strictEqual(
      riskResult.riskClassification.humanApprovalRequired,
      true
    );

    pass(
      "Risk factors and approval requirement verified"
    );

    console.log(
      "[5] Verify request lifecycle"
    );

    const storedRequest =
      getCapabilityRequest(
        request.requestId
      );

    assert.strictEqual(
      storedRequest.status,
      "risk_classified"
    );

    assert.ok(
      storedRequest.lifecycle.some(
        item =>
          item.status ===
          "requested"
      )
    );

    assert.ok(
      storedRequest.lifecycle.some(
        item =>
          item.status ===
          "proposed"
      )
    );

    assert.ok(
      storedRequest.lifecycle.some(
        item =>
          item.status ===
          "risk_classified"
      )
    );

    pass(
      "Lifecycle requested -> proposed -> risk_classified verified"
    );

    console.log(
      "[6] Verify proposal remains unapproved"
    );

    const storedProposal =
      getProposal(changeId);

    assert.ok(
      storedProposal
    );

    assert.strictEqual(
      storedProposal.status,
      "proposed"
    );

    pass(
      "Proposal remains unapproved"
    );

    console.log(
      "[7] Verify safety boundary"
    );

    assert.strictEqual(
      storedRequest.governance.executionAllowed,
      false
    );

    assert.strictEqual(
      storedRequest.governance.stagingAllowed,
      true
    );

    assert.strictEqual(
      storedRequest.governance.activationAllowed,
      false
    );

    assert.strictEqual(
      storedRequest.riskClassification.executionAllowed,
      false
    );

    assert.strictEqual(
      storedRequest.riskClassification.stagingAllowed,
      true
    );

    assert.strictEqual(
      storedRequest.riskClassification.activationAllowed,
      false
    );

    pass(
      "Execution, staging, and activation remain blocked"
    );

    console.log(
      "[8] Verify status counters"
    );

    const status =
      getCapabilityRequestStatus();

    assert.strictEqual(
      status.counts.risk_classified,
      1
    );

    assert.strictEqual(
      status.counts.proposed,
      0
    );

    pass(
      "Risk classification status counters verified"
    );

    console.log("");
    console.log(
      "=========================================="
    );
    console.log(
      "STAGE_4.10.3_E2E: PASS"
    );
    console.log(
      "Risk Classification lifecycle verified."
    );
    console.log(
      "No staging, apply, execution, or activation."
    );
    console.log(
      "=========================================="
    );
    console.log("");

  } finally {
    cleanProposal(changeId);
    cleanRequestStore();
  }
}

try {
  main();
} catch (error) {
  console.error("");
  console.error(
    "STAGE_4.10.3_E2E: FAIL"
  );
  console.error(
    error && error.stack
      ? error.stack
      : error
  );
  console.error("");

  cleanRequestStore();
  process.exitCode = 1;
}
