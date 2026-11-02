"use strict";

const fs = require("fs");
const assert = require("assert");

const {
  REQUEST_FILE,
  createCapabilityRequest,
  getCapabilityRequest,
  createCapabilityProposal,
  getCapabilityRequestStatus
} = require("../capability-request");

const {
  CHANGE_FILE,
  getProposal
} = require("../change-management");

function clean() {
  if (fs.existsSync(REQUEST_FILE)) {
    fs.unlinkSync(REQUEST_FILE);
  }
}

function cleanProposal(changeId) {
  if (!fs.existsSync(CHANGE_FILE)) {
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
    "MIRA STAGE 4.10.2 REQUEST -> PROPOSAL TEST"
  );
  console.log(
    "=========================================="
  );
  console.log("");

  clean();

  let changeId = null;

  try {
    console.log(
      "[1] Create capability request"
    );

    const request =
      createCapabilityRequest({
        capabilityType: "tool",
        name:
          "Stage 4.10.2 Test Tool",
        description:
          "Verify capability request to proposal conversion.",
        requestedBy:
          "stage-4.10.2-test"
      });

    assert.strictEqual(
      request.status,
      "requested"
    );

    pass(
      "Capability request created"
    );

    console.log(
      "[2] Convert request into proposal"
    );

    const result =
      createCapabilityProposal(
        request.requestId,
        {
          actor:
            "mira",
          risk:
            "low",
          estimatedComplexity:
            "low",
          expectedBenefit:
            "Verify controlled proposal creation."
        }
      );

    assert.strictEqual(
      result.ok,
      true
    );

    assert.strictEqual(
      result.status,
      "capability_proposed"
    );

    assert.ok(
      result.proposal
    );

    changeId =
      result.proposal.changeId;

    pass(
      "Proposal created from capability request"
    );

    console.log(
      "[3] Verify proposal contract"
    );

    assert.strictEqual(
      result.proposal.category,
      "tool"
    );

    assert.strictEqual(
      result.proposal.risk,
      "low"
    );

    assert.strictEqual(
      result.proposal.status,
      "proposed"
    );

    assert.strictEqual(
      result.proposal.createdBy,
      "mira"
    );

    pass(
      "Existing change-management proposal contract preserved"
    );

    console.log(
      "[4] Verify request linkage"
    );

    const storedRequest =
      getCapabilityRequest(
        request.requestId
      );

    assert.strictEqual(
      storedRequest.status,
      "proposed"
    );

    assert.strictEqual(
      storedRequest.proposal.changeId,
      changeId
    );

    pass(
      "Capability request linked to change proposal"
    );

    console.log(
      "[5] Verify proposal persistence"
    );

    const storedProposal =
      getProposal(changeId);

    assert.ok(
      storedProposal
    );

    assert.strictEqual(
      storedProposal.changeId,
      changeId
    );

    assert.strictEqual(
      storedProposal.status,
      "proposed"
    );

    pass(
      "Proposal persisted in existing proposal store"
    );

    console.log(
      "[6] Verify no automatic approval"
    );

    assert.strictEqual(
      storedProposal.status,
      "proposed"
    );

    assert.strictEqual(
      storedRequest.governance.activationAllowed,
      false
    );

    assert.strictEqual(
      storedRequest.governance.approvalRequired,
      true
    );

    pass(
      "Proposal remains unapproved and inactive"
    );

    console.log(
      "[7] Verify lifecycle"
    );

    assert.ok(
      storedRequest.lifecycle.some(
        entry =>
          entry.status ===
          "requested"
      )
    );

    assert.ok(
      storedRequest.lifecycle.some(
        entry =>
          entry.status ===
          "proposed"
      )
    );

    pass(
      "Request lifecycle records requested -> proposed"
    );

    console.log(
      "[8] Verify status counters"
    );

    const status =
      getCapabilityRequestStatus();

    assert.strictEqual(
      status.counts.proposed,
      1
    );

    assert.strictEqual(
      status.counts.requested,
      0
    );

    pass(
      "Capability request status counters verified"
    );

    console.log("");
    console.log(
      "=========================================="
    );
    console.log(
      "STAGE_4.10.2_E2E: PASS"
    );
    console.log(
      "Capability Request -> Proposal verified."
    );
    console.log(
      "No automatic approval, staging, apply, or activation."
    );
    console.log(
      "=========================================="
    );
    console.log("");

  } finally {
    if (changeId) {
      cleanProposal(changeId);
    }

    clean();
  }
}

try {
  main();
} catch (error) {
  console.error("");
  console.error(
    "STAGE_4.10.2_E2E: FAIL"
  );
  console.error(
    error && error.stack
      ? error.stack
      : error
  );
  console.error("");

  clean();
  process.exitCode = 1;
}
