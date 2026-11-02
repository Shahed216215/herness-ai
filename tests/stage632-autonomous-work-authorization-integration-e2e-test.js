"use strict";

const assert = require("assert");

const {
  executeWork,
  getToolPolicy
} = require("../services/mira-work-execution-engine");

async function main() {
  console.log(
    "STAGE 6.3.2 AUTONOMOUS WORK AUTHORIZATION INTEGRATION E2E TEST"
  );

  const calculatorPolicy =
    getToolPolicy("calculator");

  assert.ok(
    calculatorPolicy,
    "calculator policy must exist"
  );

  assert.strictEqual(
    calculatorPolicy.autonomous,
    true
  );

  assert.strictEqual(
    calculatorPolicy.humanApprovalRequired,
    false
  );

  console.log(
    "PASS: Autonomous calculator policy is correctly configured"
  );

  const autonomous =
    await executeWork(
      "Calculate 2 + 3",
      {
        persist: false,
        permissionGranted: true
      }
    );

  assert.strictEqual(
    autonomous.success,
    true
  );

  assert.strictEqual(
    autonomous.status,
    "execution_completed"
  );

  assert.strictEqual(
    autonomous.autonomousApproval,
    true
  );

  assert.strictEqual(
    autonomous.executionStarted,
    true
  );

  assert.strictEqual(
    autonomous.results.length,
    1
  );

  console.log(
    "PASS: Trusted low-risk autonomous work executes through Stage 6.3.1"
  );

  const restorePolicy =
    getToolPolicy("memory_restore");

  assert.ok(
    restorePolicy,
    "memory_restore policy must exist"
  );

  assert.strictEqual(
    restorePolicy.autonomous,
    false
  );

  assert.strictEqual(
    restorePolicy.humanApprovalRequired,
    true
  );

  assert.strictEqual(
    restorePolicy.explicitConfirmation,
    true
  );

  console.log(
    "PASS: memory_restore policy requires human approval"
  );

  const blocked =
    await executeWork(
      "Restore memory",
      {
        persist: false,
        permissionGranted: true,
        toolCalls: [
          {
            name: "memory_restore",
            args: {}
          }
        ]
      }
    );

  assert.strictEqual(
    blocked.success,
    false
  );

  assert.strictEqual(
    blocked.status,
    "approval_required"
  );

  assert.strictEqual(
    blocked.executionStarted,
    false
  );

  assert.strictEqual(
    blocked.results.length,
    0
  );

  assert.ok(
    blocked.authorization,
    "authorization result must be returned"
  );

  assert.strictEqual(
    blocked.authorization.result.allowed,
    false
  );

  assert.strictEqual(
    blocked.authorization.result.autonomousApproval,
    false
  );

  assert.strictEqual(
    blocked.authorization.result.approvalRequired,
    true
  );

  console.log(
    "PASS: Non-autonomous memory_restore is blocked before execution"
  );

  const blockedWithConfirmation =
    await executeWork(
      "Restore memory",
      {
        persist: false,
        permissionGranted: true,
        toolCalls: [
          {
            name: "memory_restore",
            args: {
              confirm: true
            }
          }
        ]
      }
    );

  assert.strictEqual(
    blockedWithConfirmation.success,
    false
  );

  assert.strictEqual(
    blockedWithConfirmation.status,
    "approval_required"
  );

  assert.strictEqual(
    blockedWithConfirmation.executionStarted,
    false
  );

  assert.strictEqual(
    blockedWithConfirmation.results.length,
    0
  );

  assert.strictEqual(
    blockedWithConfirmation.authorization.result.allowed,
    false
  );

  console.log(
    "PASS: Explicit confirmation cannot bypass Stage 6.3.1 autonomous authorization"
  );

  console.log(
    "STAGE6_3_2_AUTONOMOUS_WORK_AUTHORIZATION_INTEGRATION_E2E_TEST: PASS"
  );
}

main().catch((error) => {
  console.error(
    "STAGE6_3_2_AUTONOMOUS_WORK_AUTHORIZATION_INTEGRATION_E2E_TEST: FAIL"
  );
  console.error(error);
  process.exitCode = 1;
});
