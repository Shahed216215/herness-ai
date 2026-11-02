"use strict";

const assert = require("assert");

const {
  authorizeWork,
  SYSTEM_PREAUTHORIZED_RISKS
} = require("../services/mira-autonomous-work-authorization");

function plan({
  risk = "low",
  text = "Research a topic and prepare a normal report."
} = {}) {
  return {
    taskId: "stage631-task",
    taskUnderstanding: {
      task: {
        id: "stage631-task",
        title: text,
        description: text,
        risk,
        requirements: [],
        deliverables: []
      }
    }
  };
}

function expectApproval(name, input) {
  const result = authorizeWork(input);

  assert.strictEqual(
    result.allowed,
    false,
    `${name}: must not be autonomously allowed`
  );

  assert.strictEqual(
    result.approvalRequired,
    true,
    `${name}: approval must be required`
  );

  assert.strictEqual(
    result.governance.stage417Authoritative,
    true,
    `${name}: 4.17 boundary missing`
  );

  console.log(`PASS: ${name}`);
}

function expectAllowed(name, input) {
  const result = authorizeWork(input);

  assert.strictEqual(
    result.allowed,
    true,
    `${name}: must be autonomously allowed`
  );

  assert.strictEqual(
    result.status,
    "autonomous_allowed",
    `${name}: wrong authorization status`
  );

  assert.strictEqual(
    result.autonomousApproval,
    true,
    `${name}: autonomous approval flag missing`
  );

  assert.strictEqual(
    result.approvalRequired,
    false,
    `${name}: approval must not be required`
  );

  assert.strictEqual(
    result.governance.stage417Authoritative,
    true,
    `${name}: 4.17 boundary missing`
  );

  assert.strictEqual(
    result.governance.autonomousApplyAllowed,
    false,
    `${name}: autonomous apply must remain disabled`
  );

  console.log(`PASS: ${name}`);
}

console.log(
  "STAGE 6.3.1 AUTONOMOUS WORK AUTHORIZATION E2E TEST"
);

/*
 * The autonomous pre-authorization policy is system-owned.
 * Low-risk work is eligible without caller-supplied trust flags.
 */
assert.ok(
  SYSTEM_PREAUTHORIZED_RISKS instanceof Set,
  "system pre-authorization policy must be a Set"
);

assert.strictEqual(
  SYSTEM_PREAUTHORIZED_RISKS.has("low"),
  true,
  "low risk must be system-pre-authorized"
);

console.log(
  "PASS: Low-risk autonomous pre-authorization is controlled by system policy"
);

expectAllowed(
  "Low-risk system-pre-authorized work",
  {
    plan: plan(),
    operation: "test",
    permissionGranted: true
  }
);

/*
 * Caller-supplied trust fields must not be required.
 */
expectAllowed(
  "Low-risk work without caller-supplied trust fields",
  {
    plan: plan(),
    operation: "test",
    permissionGranted: true
  }
);

/*
 * Even if a caller attempts to inject the old trust fields,
 * those fields cannot manufacture authority.
 */
expectAllowed(
  "Low-risk work remains allowed without trusting caller authorization fields",
  {
    plan: plan(),
    operation: "test",
    permissionGranted: true,
    trustedPreAuthorization: false,
    trustedAuthorizationSource: ""
  }
);

expectAllowed(
  "Low-risk work ignores caller-declared authorization source",
  {
    plan: plan(),
    operation: "test",
    permissionGranted: true,
    trustedPreAuthorization: true,
    trustedAuthorizationSource: "model"
  }
);

expectApproval(
  "Medium-risk work",
  {
    plan: plan({
      risk: "medium",
      text: "Perform a medium risk research task."
    }),
    operation: "test",
    permissionGranted: true
  }
);

expectApproval(
  "High-risk work",
  {
    plan: plan({
      risk: "high",
      text: "Perform a high risk task."
    }),
    operation: "test",
    permissionGranted: true
  }
);

expectApproval(
  "Critical-risk work",
  {
    plan: plan({
      risk: "critical",
      text: "Perform a critical task."
    }),
    operation: "test",
    permissionGranted: true
  }
);

expectApproval(
  "Unknown risk",
  {
    plan: plan({
      risk: "unknown",
      text: "Do something."
    }),
    operation: "test",
    permissionGranted: true
  }
);

expectApproval(
  "Financial action",
  {
    plan: plan({
      text: "Make a payment for the client."
    }),
    operation: "test",
    permissionGranted: true
  }
);

expectApproval(
  "Legal contract action",
  {
    plan: plan({
      text: "Accept and sign the client contract."
    }),
    operation: "test",
    permissionGranted: true
  }
);

expectApproval(
  "External communication",
  {
    plan: plan({
      text: "Send an email to the client."
    }),
    operation: "test",
    permissionGranted: true
  }
);

expectApproval(
  "Mira core modification",
  {
    plan: plan({
      text: "Modify Mira core governance code."
    }),
    operation: "test",
    permissionGranted: true
  }
);

expectApproval(
  "Core artifact engine modification",
  {
    plan: plan({
      text: "Modify artifact-apply-engine.js."
    }),
    operation: "test",
    permissionGranted: true
  }
);

expectApproval(
  "Autonomous file modification operation remains policy controlled",
  {
    plan: plan(),
    operation: "file_modify",
    permissionGranted: true
  }
);

expectApproval(
  "Permission failure",
  {
    plan: plan(),
    operation: "test",
    permissionGranted: false
  }
);

console.log(
  "STAGE6_3_1_AUTONOMOUS_WORK_AUTHORIZATION_E2E_TEST: PASS"
);
