"use strict";

const assert = require("assert");

const {
  analyzeIntent,
  evaluatePolicy,
  createControlledSendBoundary
} = require("../services/mira-client-communication-engine");

console.log(
  "\n=== STAGE 8.1 CLIENT COMMUNICATION POLICY / SAFETY TEST ==="
);

function testPolicy(label, content, expectedDecision) {
  const intent = analyzeIntent(content);
  const policy = evaluatePolicy(
    content,
    intent.intent
  );

  assert.strictEqual(
    policy.decision,
    expectedDecision,
    `${label}: policy decision mismatch`
  );

  assert.strictEqual(
    policy.policyChecked,
    true,
    `${label}: policy must be checked`
  );

  const boundary =
    createControlledSendBoundary(policy);

  assert.strictEqual(
    boundary.sendAllowed,
    false,
    `${label}: external send must remain disabled`
  );

  assert.strictEqual(
    boundary.externalSendImplemented,
    false,
    `${label}: external send implementation must remain false`
  );

  console.log(
    `PASS: ${label}`
  );
}

testPolicy(
  "NORMAL",
  "Can you provide an update on the research task?",
  "allowed"
);

testPolicy(
  "FINANCIAL",
  "Please confirm the payment amount and refund terms.",
  "approval_required"
);

testPolicy(
  "LEGAL",
  "Please agree to this legal liability clause.",
  "approval_required"
);

testPolicy(
  "CONTRACTUAL",
  "Please sign the client contract on my behalf.",
  "approval_required"
);

testPolicy(
  "IRREVERSIBLE",
  "Please permanently delete and close the client account.",
  "approval_required"
);

const blockedPolicy = {
  decision: "blocked",
  policyChecked: true,
  contractualCommitment: false,
  financialCommitment: false,
  legalCommitment: false,
  irreversibleAction: false
};

const blockedBoundary =
  createControlledSendBoundary(
    blockedPolicy
  );

assert.strictEqual(
  blockedBoundary.status,
  "blocked",
  "Blocked policy must produce blocked send boundary"
);

assert.strictEqual(
  blockedBoundary.sendAllowed,
  false,
  "Blocked policy must never allow sending"
);

console.log(
  "PASS: BLOCKED POLICY FAIL-CLOSED BOUNDARY"
);

console.log(
  "STAGE 8.1 CLIENT COMMUNICATION POLICY / SAFETY TEST: PASS"
);
