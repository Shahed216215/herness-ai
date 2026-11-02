"use strict";

const fs = require("fs");
const assert = require("assert");

const {
  REQUEST_FILE,
  createCapabilityRequest,
  getCapabilityRequest,
  listCapabilityRequests,
  getCapabilityRequestStatus,
  cancelCapabilityRequest
} = require("../capability-request");

function clean() {
  if (fs.existsSync(REQUEST_FILE)) {
    fs.unlinkSync(REQUEST_FILE);
  }
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function main() {
  console.log("");
  console.log(
    "=========================================="
  );
  console.log(
    "MIRA STAGE 4.10.1 CAPABILITY REQUEST TEST"
  );
  console.log(
    "=========================================="
  );
  console.log("");

  clean();

  try {
    console.log(
      "[1] Create capability request"
    );

    const request =
      createCapabilityRequest({
        capabilityType: "tool",
        name: "Stage 4.10 Test Tool",
        description:
          "Test capability request for Stage 4.10.",
        requestedBy: "stage-4.10.1-test"
      });

    assert.ok(
      request.requestId
    );

    assert.strictEqual(
      request.status,
      "requested"
    );

    pass(
      "Capability request created"
    );

    console.log(
      "[2] Verify safety boundary"
    );

    assert.strictEqual(
      request.governance.executionAllowed,
      false
    );

    assert.strictEqual(
      request.governance.stagingAllowed,
      true
    );

    assert.strictEqual(
      request.governance.activationAllowed,
      false
    );

    assert.strictEqual(
      request.governance.approvalRequired,
      true
    );

    pass(
      "Capability request is inactive by default"
    );

    console.log(
      "[3] Verify persistent request"
    );

    const stored =
      getCapabilityRequest(
        request.requestId
      );

    assert.ok(stored);

    assert.strictEqual(
      stored.requestId,
      request.requestId
    );

    assert.strictEqual(
      stored.status,
      "requested"
    );

    pass(
      "Capability request persisted"
    );

    console.log(
      "[4] Verify lifecycle"
    );

    assert.ok(
      Array.isArray(
        stored.lifecycle
      )
    );

    assert.ok(
      stored.lifecycle.some(
        entry =>
          entry.status ===
          "requested"
      )
    );

    pass(
      "Initial lifecycle recorded"
    );

    console.log(
      "[5] Verify listing"
    );

    const listed =
      listCapabilityRequests({
        status: "requested"
      });

    assert.ok(
      listed.some(
        item =>
          item.requestId ===
          request.requestId
      )
    );

    pass(
      "Capability request listing works"
    );

    console.log(
      "[6] Verify system status"
    );

    const status =
      getCapabilityRequestStatus();

    assert.strictEqual(
      status.ok,
      true
    );

    assert.strictEqual(
      status.operational,
      true
    );

    assert.strictEqual(
      status.counts.requested,
      1
    );

    assert.strictEqual(
      status.safetyBoundary.activationAllowed,
      false
    );

    assert.strictEqual(
      status.safetyBoundary.humanApprovalRequired,
      true
    );

    pass(
      "Capability request safety status verified"
    );

    console.log(
      "[7] Verify cancellation boundary"
    );

    const cancelled =
      cancelCapabilityRequest(
        request.requestId,
        "stage-4.10.1-test",
        "E2E cleanup"
      );

    assert.strictEqual(
      cancelled.status,
      "cancelled"
    );

    assert.ok(
      cancelled.cancellation
    );

    pass(
      "Capability request cancellation works"
    );

    console.log("");
    console.log(
      "=========================================="
    );
    console.log(
      "STAGE_4.10.1_E2E: PASS"
    );
    console.log(
      "Capability Request lifecycle verified."
    );
    console.log(
      "No execution, staging, or activation allowed."
    );
    console.log(
      "=========================================="
    );
    console.log("");

  } finally {
    clean();
  }
}

try {
  main();
} catch (error) {
  console.error("");
  console.error(
    "STAGE_4.10.1_E2E: FAIL"
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
