"use strict";

const assert = require("assert");

const {
  evaluateAcceptanceDecision
} = require(
  "../services/mira-work-acceptance-decision-engine"
);

const {
  evaluateWorkAcceptancePolicyGate,
  isPolicyGateAllowed
} = require(
  "../services/mira-work-acceptance-policy-gate"
);

function baseAcceptanceInput() {
  return {
    opportunity: {
      opportunityId: "opp-916-int",
      title: "Safe client work"
    },

    proposal: {
      proposalId: "prop-916-int"
    },

    requirements: {
      requirementsId: "req-916-int"
    },

    clientResponse: {
      clientResponseId: "resp-916-int"
    },

    workScope: {
      scopeId: "scope-916-int"
    },

    policyDecision: "allowed"
  };
}

function buildPolicy(decision) {
  return {
    decision,
    policyChecked: true,
    findings: [],
    reasons: [],
    evaluatedAt: new Date().toISOString()
  };
}

function runAcceptanceDecision(input) {
  return evaluateAcceptanceDecision(input);
}

function assertSafetyBoundary(result) {
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
}

console.log(
  "\n=== STAGE 9.1.6 WORK ACCEPTANCE POLICY GATE INTEGRATION TEST ==="
);

console.log(
  "\n[1] ALLOWED POLICY + ACCEPT DECISION"
);

{
  const input =
    baseAcceptanceInput();

  const acceptance =
    runAcceptanceDecision(input);

  assert.strictEqual(
    acceptance.decision,
    "accept"
  );

  const gate =
    evaluateWorkAcceptancePolicyGate({
      opportunity: input.opportunity,
      policy: buildPolicy("allowed"),
      acceptanceDecision: acceptance
    });

  assert.strictEqual(
    gate.decision,
    "allow"
  );

  assert.strictEqual(
    isPolicyGateAllowed(gate),
    true
  );

  assertSafetyBoundary(
    gate
  );

  console.log(
    "PASS: allowed + accept -> allow"
  );
}

console.log(
  "\n[2] BLOCKED POLICY"
);

{
  const input =
    baseAcceptanceInput();

  const acceptance =
    runAcceptanceDecision(input);

  assert.strictEqual(
    acceptance.decision,
    "accept"
  );

  const gate =
    evaluateWorkAcceptancePolicyGate({
      opportunity: input.opportunity,
      policy: buildPolicy("blocked"),
      acceptanceDecision: acceptance
    });

  assert.strictEqual(
    gate.decision,
    "block"
  );

  assert.strictEqual(
    gate.allowed,
    false
  );

  console.log(
    "PASS: blocked policy prevents acceptance"
  );
}

console.log(
  "\n[3] RESTRICTED POLICY"
);

{
  const input =
    baseAcceptanceInput();

  const acceptance =
    runAcceptanceDecision(input);

  const gate =
    evaluateWorkAcceptancePolicyGate({
      opportunity: input.opportunity,
      policy: buildPolicy("restricted"),
      acceptanceDecision: acceptance
    });

  assert.strictEqual(
    gate.decision,
    "block"
  );

  assert.strictEqual(
    gate.allowed,
    false
  );

  console.log(
    "PASS: restricted policy prevents acceptance"
  );
}

console.log(
  "\n[4] APPROVAL REQUIRED WITHOUT APPROVAL"
);

{
  const input =
    baseAcceptanceInput();

  const acceptance =
    runAcceptanceDecision(input);

  const gate =
    evaluateWorkAcceptancePolicyGate({
      opportunity: input.opportunity,
      policy: buildPolicy(
        "approval_required"
      ),
      acceptanceDecision: acceptance,
      humanApprovalGranted: false
    });

  assert.strictEqual(
    gate.decision,
    "approval_required"
  );

  assert.strictEqual(
    gate.allowed,
    false
  );

  console.log(
    "PASS: approval_required without approval"
  );
}

console.log(
  "\n[5] APPROVAL REQUIRED WITH APPROVAL"
);

{
  const input =
    baseAcceptanceInput();

  const acceptance =
    runAcceptanceDecision(input);

  const gate =
    evaluateWorkAcceptancePolicyGate({
      opportunity: input.opportunity,
      policy: buildPolicy(
        "approval_required"
      ),
      acceptanceDecision: acceptance,
      humanApprovalGranted: true
    });

  assert.strictEqual(
    gate.decision,
    "allow"
  );

  assert.strictEqual(
    gate.allowed,
    true
  );

  assertSafetyBoundary(
    gate
  );

  console.log(
    "PASS: approval_required + approval -> allow"
  );
}

console.log(
  "\n[6] UNCHECKED POLICY"
);

{
  const input =
    baseAcceptanceInput();

  const acceptance =
    runAcceptanceDecision(input);

  const policy =
    buildPolicy("allowed");

  policy.policyChecked =
    false;

  const gate =
    evaluateWorkAcceptancePolicyGate({
      opportunity: input.opportunity,
      policy,
      acceptanceDecision: acceptance
    });

  assert.strictEqual(
    gate.decision,
    "clarification_required"
  );

  assert.strictEqual(
    gate.allowed,
    false
  );

  console.log(
    "PASS: unchecked policy cannot pass gate"
  );
}

console.log(
  "\n[7] ACCEPTANCE DECISION REJECT"
);

{
  const input =
    baseAcceptanceInput();

  const acceptance =
    runAcceptanceDecision({
      ...input,
      policyDecision: "blocked"
    });

  assert.strictEqual(
    acceptance.decision,
    "reject"
  );

  const gate =
    evaluateWorkAcceptancePolicyGate({
      opportunity: input.opportunity,
      policy: buildPolicy("allowed"),
      acceptanceDecision: acceptance
    });

  assert.strictEqual(
    gate.decision,
    "block"
  );

  console.log(
    "PASS: rejected acceptance cannot pass policy gate"
  );
}

console.log(
  "\n[8] ACCEPTANCE CLARIFICATION"
);

{
  const input =
    baseAcceptanceInput();

  delete input.requirements;

  const acceptance =
    runAcceptanceDecision(input);

  assert.strictEqual(
    acceptance.decision,
    "request_clarification"
  );

  const gate =
    evaluateWorkAcceptancePolicyGate({
      opportunity: input.opportunity,
      policy: buildPolicy("allowed"),
      acceptanceDecision: acceptance
    });

  assert.strictEqual(
    gate.decision,
    "clarification_required"
  );

  console.log(
    "PASS: clarification decision cannot pass gate"
  );
}

console.log(
  "\n[9] SAFETY BOUNDARY WITH APPROVAL"
);

{
  const input =
    baseAcceptanceInput();

  const acceptance =
    runAcceptanceDecision(input);

  const gate =
    evaluateWorkAcceptancePolicyGate({
      opportunity: input.opportunity,
      policy: buildPolicy(
        "approval_required"
      ),
      acceptanceDecision: acceptance,
      humanApprovalGranted: true
    });

  assert.strictEqual(
    gate.decision,
    "allow"
  );

  assertSafetyBoundary(
    gate
  );

  console.log(
    "PASS: approval never authorizes execution/payment/contract/external action"
  );
}

console.log(
  "\nSTAGE9_1_6_WORK_ACCEPTANCE_POLICY_GATE_INTEGRATION_TEST: PASS"
);
