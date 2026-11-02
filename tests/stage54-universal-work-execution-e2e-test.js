"use strict";

const assert =
  require("assert");

const {
  executeWork,
  getToolPolicy
} =
  require("../services/mira-work-execution-engine");

async function main() {
  console.log(
    "STAGE 5.4 UNIVERSAL WORK EXECUTION E2E"
  );

  /*
   * 1. Tool policy must exist.
   */
  const calculatorPolicy =
    getToolPolicy(
      "calculator"
    );

  assert.ok(
    calculatorPolicy,
    "calculator policy missing"
  );

  assert.strictEqual(
    calculatorPolicy.autonomous,
    true,
    "calculator should support autonomous execution"
  );

  /*
   * 2. Normal safe task.
   */
  const normal =
    await executeWork(
      "Calculate 2 + 3",
      {
        persist: false,
        permissionGranted: true
      }
    );

  assert.strictEqual(
    normal.success,
    true,
    "normal task should succeed"
  );

  assert.strictEqual(
    normal.status,
    "execution_completed"
  );

  assert.strictEqual(
    normal.autonomousApproval,
    true
  );

  assert.strictEqual(
    normal.results.length,
    1
  );

  assert.strictEqual(
    normal.results[0].tool,
    "calculator"
  );

  assert.strictEqual(
    normal.results[0]
      .verification.passed,
    true
  );

  /*
   * 3. Permission must fail closed.
   *
   * Direct service calls do not receive
   * permission unless explicitly supplied.
   */
  const noPermission =
    await executeWork(
      "Calculate 2 + 3",
      {
        persist: false,
        permissionGranted: false
      }
    );

  assert.strictEqual(
    noPermission.success,
    false
  );

  assert.strictEqual(
    noPermission.status,
    "permission_denied"
  );

  /*
   * 4. Explicitly dangerous confirmation
   * must never be manufactured.
   */
  const restorePolicy =
    getToolPolicy(
      "memory_restore"
    );

  assert.strictEqual(
    restorePolicy.humanApprovalRequired,
    true
  );

  /*
   * 5. Unknown tools must be rejected.
   */
  const unknown =
    await executeWork(
      "Calculate 2 + 3",
      {
        persist: false,
        permissionGranted: true,
        toolCalls: [
          {
            name:
              "unknown_tool",
            args: {}
          }
        ]
      }
    );

  assert.strictEqual(
    unknown.success,
    false
  );

  assert.strictEqual(
    unknown.status,
    "unknown_tool"
  );

  console.log(
    "STAGE5_4_UNIVERSAL_WORK_EXECUTION_E2E: PASS"
  );
}

main().catch(error => {
  console.error(
    "STAGE5_4_UNIVERSAL_WORK_EXECUTION_E2E: FAIL"
  );
  console.error(
    error.stack || error.message
  );
  process.exit(1);
});
