"use strict";

const assert = require("assert");

const {
  POLICY_DECISIONS,
  ACCEPTANCE_GATE_DECISIONS,
  evaluateWorkAcceptancePolicyGate,
  isPolicyGateAllowed,
  validatePolicyGateResult
} = require(
  "../services/mira-work-acceptance-policy-gate"
);

function baseInput() {
  return {
    opportunity: {
      opportunityId: "opp-916",
      title: "Safe work opportunity"
    },
    policy: {
      decision: "allowed",
      policyChecked: true,
      findings: [],
      reasons: [],
      evaluatedAt: new Date().toISOString()
    },
    acceptanceDecision: {
      decision: "accept",
      reason: "Complete and safe work scope."
    }
  };
}

console.log(
  "\n=== STAGE 9.1.6 WORK ACCEPTANCE POLICY GATE UNIT TEST ==="
);

console.log("\n[1] POLICY CONTRACT");

assert.deepStrictEqual(
  POLICY_DECISIONS,
  [
    "allowed",
    "restricted",
    "approval_required",
    "blocked"
  ]
);

assert.deepStrictEqual(
  ACCEPTANCE_GATE_DECISIONS,
  [
    "allow",
    "block",
    "approval_required",
    "clarification_required"
  ]
);

console.log(
  "PASS: policy and gate decision contracts"
);

console.log("\n[2] ALLOWED POLICY");

{
  const result =
    evaluateWorkAcceptancePolicyGate(
      baseInput()
    );

  assert.strictEqual(
    result.decision,
    "allow"
  );

  assert.strictEqual(
    result.allowed,
    true
  );

  assert.strictEqual(
    result.checks.policyChecked,
    true
  );

  assert.strictEqual(
    result.checks.policyAllowed,
    true
  );

  assert.strictEqual(
    result.checks.acceptanceDecisionFinal,
    true
  );

  assert.strictEqual(
    isPolicyGateAllowed(result),
    true
  );

  validatePolicyGateResult(result);

  console.log(
    "PASS: allowed policy -> allow"
  );
}

console.log("\n[3] BLOCKED POLICY");

{
  const input = baseInput();

  input.policy.decision =
    "blocked";

  const result =
    evaluateWorkAcceptancePolicyGate(input);

  assert.strictEqual(
    result.decision,
    "block"
  );

  assert.strictEqual(
    result.allowed,
    false
  );

  assert.strictEqual(
    result.checks.policyAllowed,
    false
  );

  assert.strictEqual(
    isPolicyGateAllowed(result),
    false
  );

  console.log(
    "PASS: blocked policy -> block"
  );
}

console.log("\n[4] RESTRICTED POLICY");

{
  const input = baseInput();

  input.policy.decision =
    "restricted";

  const result =
    evaluateWorkAcceptancePolicyGate(input);

  assert.strictEqual(
    result.decision,
    "block"
  );

  assert.strictEqual(
    result.allowed,
    false
  );

  console.log(
    "PASS: restricted policy -> block"
  );
}

console.log(
  "\n[5] APPROVAL REQUIRED WITHOUT HUMAN APPROVAL"
);

{
  const input = baseInput();

  input.policy.decision =
    "approval_required";

  input.humanApprovalGranted =
    false;

  const result =
    evaluateWorkAcceptancePolicyGate(input);

  assert.strictEqual(
    result.decision,
    "approval_required"
  );

  assert.strictEqual(
    result.allowed,
    false
  );

  assert.strictEqual(
    result.checks.humanApprovalRequired,
    true
  );

  assert.strictEqual(
    result.checks.humanApprovalGranted,
    false
  );

  console.log(
    "PASS: approval_required without approval -> blocked from acceptance"
  );
}

console.log(
  "\n[6] APPROVAL REQUIRED WITH HUMAN APPROVAL"
);

{
  const input = baseInput();

  input.policy.decision =
    "approval_required";

  input.humanApprovalGranted =
    true;

  const result =
    evaluateWorkAcceptancePolicyGate(input);

  assert.strictEqual(
    result.decision,
    "allow"
  );

  assert.strictEqual(
    result.allowed,
    true
  );

  assert.strictEqual(
    result.checks.humanApprovalRequired,
    true
  );

  assert.strictEqual(
    result.checks.humanApprovalGranted,
    true
  );

  console.log(
    "PASS: approval_required with approval -> allow"
  );
}

console.log("\n[7] POLICY NOT CHECKED");

{
  const input = baseInput();

  input.policy.policyChecked =
    false;

  const result =
    evaluateWorkAcceptancePolicyGate(input);

  assert.strictEqual(
    result.decision,
    "clarification_required"
  );

  assert.strictEqual(
    result.allowed,
    false
  );

  console.log(
    "PASS: unchecked policy -> clarification"
  );
}

console.log("\n[8] MISSING POLICY");

{
  const input = baseInput();

  delete input.policy;

  const result =
    evaluateWorkAcceptancePolicyGate(input);

  assert.strictEqual(
    result.decision,
    "clarification_required"
  );

  assert.strictEqual(
    result.allowed,
    false
  );

  console.log(
    "PASS: missing policy -> clarification"
  );
}

console.log("\n[9] MISSING OPPORTUNITY");

{
  const input = baseInput();

  delete input.opportunity;

  const result =
    evaluateWorkAcceptancePolicyGate(input);

  assert.strictEqual(
    result.decision,
    "clarification_required"
  );

  assert.strictEqual(
    result.allowed,
    false
  );

  console.log(
    "PASS: missing opportunity -> clarification"
  );
}

console.log("\n[10] REJECTED ACCEPTANCE DECISION");

{
  const input = baseInput();

  input.acceptanceDecision = {
    decision: "reject",
    reason: "Scope rejected."
  };

  const result =
    evaluateWorkAcceptancePolicyGate(input);

  assert.strictEqual(
    result.decision,
    "block"
  );

  assert.strictEqual(
    result.allowed,
    false
  );

  console.log(
    "PASS: rejected acceptance -> block"
  );
}

console.log(
  "\n[11] CLARIFICATION ACCEPTANCE DECISION"
);

{
  const input = baseInput();

  input.acceptanceDecision = {
    decision: "request_clarification",
    reason: "Requirements incomplete."
  };

  const result =
    evaluateWorkAcceptancePolicyGate(input);

  assert.strictEqual(
    result.decision,
    "clarification_required"
  );

  assert.strictEqual(
    result.allowed,
    false
  );

  console.log(
    "PASS: clarification decision -> clarification"
  );
}

console.log(
  "\n[12] NON-FINAL ACCEPTANCE DECISION"
);

{
  const input = baseInput();

  input.acceptanceDecision = {
    decision: "pending",
    reason: "Still waiting."
  };

  const result =
    evaluateWorkAcceptancePolicyGate(input);

  assert.strictEqual(
    result.decision,
    "clarification_required"
  );

  assert.strictEqual(
    result.allowed,
    false
  );

  console.log(
    "PASS: pending decision -> clarification"
  );
}

console.log(
  "\n[13] UNKNOWN POLICY DECISION"
);

{
  const input = baseInput();

  input.policy.decision =
    "unknown";

  const result =
    evaluateWorkAcceptancePolicyGate(input);

  assert.strictEqual(
    result.decision,
    "clarification_required"
  );

  assert.strictEqual(
    result.allowed,
    false
  );

  console.log(
    "PASS: unknown policy -> clarification"
  );
}

console.log(
  "\n[14] SAFETY GOVERNANCE BOUNDARY"
);

{
  const result =
    evaluateWorkAcceptancePolicyGate(
      baseInput()
    );

  assert.strictEqual(
    result.governance.acceptanceAllowed,
    false
  );

  assert.strictEqual(
    result.governance.workExecutionAllowed,
    false
  );

  assert.strictEqual(
    result.governance.paymentAllowed,
    false
  );

  assert.strictEqual(
    result.governance.paymentTransferAuthorized,
    false
  );

  assert.strictEqual(
    result.governance.contractSigningAllowed,
    false
  );

  assert.strictEqual(
    result.governance.externalActionPerformed,
    false
  );

  console.log(
    "PASS: acceptance gate cannot authorize execution/payment/contract/external action"
  );
}

console.log(
  "\n[15] INVALID RESULT REJECTED"
);

{
  assert.throws(
    () =>
      validatePolicyGateResult({
        decision: "invalid",
        governance: {}
      }),
    /Invalid policy gate decision/
  );

  console.log(
    "PASS: invalid gate result rejected"
  );
}

console.log(
  "\nSTAGE9_1_6_WORK_ACCEPTANCE_POLICY_GATE_UNIT_TEST: PASS"
);
