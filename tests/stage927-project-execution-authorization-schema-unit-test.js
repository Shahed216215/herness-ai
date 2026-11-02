"use strict";

const assert = require("assert");

const {
  AUTHORIZATION_STATUSES,
  AUTHORIZATION_DECISIONS,
  createAuthorizationCheck,
  createProjectExecutionAuthorization,
  validateProjectExecutionAuthorization
} = require("../project-execution-authorization-schema");

function expectThrow(fn, label) {
  assert.throws(fn, Error, label);
}

function buildAuthorizedFixture() {
  return createProjectExecutionAuthorization({
    authorizationId: "auth-stage927-test-001",
    projectId: "project-stage927-test-001",
    scheduleId: "schedule-stage927-test-001",
    readinessId: "readiness-stage927-test-001",
    status: "authorized",
    decision: "authorize",
    checks: [
      createAuthorizationCheck({
        checkId: "readiness-ready",
        passed: true,
        reason: "Execution readiness is ready."
      }),
      createAuthorizationCheck({
        checkId: "project-safe",
        passed: true,
        reason: "Project safety flags are safe."
      })
    ],
    blockingReasons: [],
    authorizedBy: "test-admin",
    authorizationReason:
      "Explicit controlled authorization test."
  });
}

function buildBlockedFixture() {
  return createProjectExecutionAuthorization({
    authorizationId: "auth-stage927-test-002",
    projectId: "project-stage927-test-001",
    scheduleId: "schedule-stage927-test-001",
    readinessId: "readiness-stage927-test-002",
    status: "blocked",
    decision: "blocked",
    checks: [
      createAuthorizationCheck({
        checkId: "readiness-ready",
        passed: false,
        reason: "Readiness is blocked."
      })
    ],
    blockingReasons: [
      "Execution readiness is not ready."
    ],
    authorizationReason:
      "Authorization denied because readiness is blocked."
  });
}

console.log(
  "\n=== STAGE 9.2.7 AUTHORIZATION SCHEMA UNIT TEST ===\n"
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`[FAIL] ${name}`);
    console.log(error.message);
    failed += 1;
  }
}

test("AUTHORIZATION_STATUSES contract", () => {
  assert.deepStrictEqual(
    AUTHORIZATION_STATUSES,
    ["authorized", "blocked"]
  );
});

test("AUTHORIZATION_DECISIONS contract", () => {
  assert.deepStrictEqual(
    AUTHORIZATION_DECISIONS,
    ["authorize", "blocked"]
  );
});

test("Authorized authorization validates", () => {
  const authorization =
    buildAuthorizedFixture();

  const validation =
    validateProjectExecutionAuthorization(
      authorization
    );

  assert.strictEqual(validation.valid, true);
  assert.deepStrictEqual(
    validation.errors,
    []
  );
});

test("Blocked authorization validates", () => {
  const authorization =
    buildBlockedFixture();

  const validation =
    validateProjectExecutionAuthorization(
      authorization
    );

  assert.strictEqual(validation.valid, true);
});

test("Authorized state requires authorize decision", () => {
  const authorization =
    buildAuthorizedFixture();

  authorization.decision = "blocked";

  const validation =
    validateProjectExecutionAuthorization(
      authorization
    );

  assert.strictEqual(validation.valid, false);
});

test("Blocked state requires blocking reason", () => {
  const authorization =
    buildBlockedFixture();

  authorization.blockingReasons = [];

  const validation =
    validateProjectExecutionAuthorization(
      authorization
    );

  assert.strictEqual(validation.valid, false);
});

test("Authorized state rejects failed check", () => {
  const authorization =
    buildAuthorizedFixture();

  authorization.checks[0].passed = false;

  const validation =
    validateProjectExecutionAuthorization(
      authorization
    );

  assert.strictEqual(validation.valid, false);
});

test("Duplicate authorization check IDs rejected", () => {
  const authorization =
    buildAuthorizedFixture();

  authorization.checks.push({
    checkId: authorization.checks[0].checkId,
    passed: true,
    reason: "Duplicate."
  });

  const validation =
    validateProjectExecutionAuthorization(
      authorization
    );

  assert.strictEqual(validation.valid, false);
});

test("Execution remains disabled", () => {
  const authorization =
    buildAuthorizedFixture();

  assert.strictEqual(
    authorization.executionAllowed,
    false
  );
  assert.strictEqual(
    authorization.planningOnly,
    true
  );
});

test("External action remains disabled", () => {
  const authorization =
    buildAuthorizedFixture();

  assert.strictEqual(
    authorization.externalActionPerformed,
    false
  );
});

test("Payment and contract actions remain disabled", () => {
  const authorization =
    buildAuthorizedFixture();

  assert.strictEqual(
    authorization.paymentAllowed,
    false
  );
  assert.strictEqual(
    authorization.paymentTransferAuthorized,
    false
  );
  assert.strictEqual(
    authorization.contractSigningAllowed,
    false
  );
});

test("Unsafe execution flag rejected", () => {
  const authorization =
    buildAuthorizedFixture();

  authorization.executionAllowed = true;

  const validation =
    validateProjectExecutionAuthorization(
      authorization
    );

  assert.strictEqual(validation.valid, false);
});

test("Authorization is always explicitly required", () => {
  const authorization =
    buildAuthorizedFixture();

  assert.strictEqual(
    authorization.authorizationRequired,
    true
  );

  authorization.authorizationRequired = false;

  const validation =
    validateProjectExecutionAuthorization(
      authorization
    );

  assert.strictEqual(validation.valid, false);
});

test("Invalid status rejected", () => {
  const authorization =
    buildAuthorizedFixture();

  authorization.status = "ready";

  const validation =
    validateProjectExecutionAuthorization(
      authorization
    );

  assert.strictEqual(validation.valid, false);
});

test("Missing identity rejected", () => {
  expectThrow(
    () =>
      createProjectExecutionAuthorization({
        authorizationId: "auth-only"
      }),
    "Missing project/schedule/readiness identity"
  );
});

console.log(
  `\nPASSED=${passed}`
);
console.log(
  `FAILED=${failed}`
);

if (failed !== 0) {
  process.exit(1);
}

console.log(
  "\nSTAGE927_AUTHORIZATION_SCHEMA_UNIT_TEST: PASS\n"
);
