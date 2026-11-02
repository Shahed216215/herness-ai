"use strict";

const assert = require("assert");

const {
  evaluateAcceptanceDecision,
  decisionRequiresScope,
  isAcceptanceDecisionFinal,
  getAcceptanceStatusForDecision,
  validateDecisionStatus
} = require(
  "../services/mira-work-acceptance-decision-engine"
);

function baseInput() {
  return {
    opportunity: {
      opportunityId: "opp-913"
    },
    proposal: {
      proposalId: "prop-913"
    },
    requirements: {
      requirementsId: "req-913"
    },
    clientResponse: {
      clientResponseId: "resp-913"
    },
    workScope: {
      scopeId: "scope-913"
    },
    policyDecision: "allowed"
  };
}

console.log(
  "\n=== STAGE 9.1.3 WORK ACCEPTANCE DECISION ENGINE UNIT TEST ==="
);

// 1. Missing opportunity -> pending
{
  const input = baseInput();
  delete input.opportunity;

  const result =
    evaluateAcceptanceDecision(input);

  assert.strictEqual(
    result.decision,
    "pending"
  );
  assert.strictEqual(
    result.status,
    "pending"
  );
  assert.strictEqual(
    result.governance.workExecutionAllowed,
    false
  );

  console.log(
    "PASS: missing opportunity -> pending"
  );
}

// 2. Missing client response -> pending
{
  const input = baseInput();
  delete input.clientResponse;

  const result =
    evaluateAcceptanceDecision(input);

  assert.strictEqual(
    result.decision,
    "pending"
  );

  console.log(
    "PASS: missing client response -> pending"
  );
}

// 3. Missing requirements -> clarification
{
  const input = baseInput();
  delete input.requirements;

  const result =
    evaluateAcceptanceDecision(input);

  assert.strictEqual(
    result.decision,
    "request_clarification"
  );
  assert.strictEqual(
    result.status,
    "needs_clarification"
  );

  console.log(
    "PASS: missing requirements -> clarification"
  );
}

// 4. Blocked policy -> reject
{
  const input = baseInput();
  input.policyDecision = "blocked";

  const result =
    evaluateAcceptanceDecision(input);

  assert.strictEqual(
    result.decision,
    "reject"
  );
  assert.strictEqual(
    result.status,
    "rejected"
  );
  assert.strictEqual(
    result.checks.policyAllowed,
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

  console.log(
    "PASS: blocked policy -> reject"
  );
}

// 5. Restricted policy -> reject
{
  const input = baseInput();
  input.policyDecision = "restricted";

  const result =
    evaluateAcceptanceDecision(input);

  assert.strictEqual(
    result.decision,
    "reject"
  );

  console.log(
    "PASS: restricted policy -> reject"
  );
}

// 6. Missing scope -> clarification
{
  const input = baseInput();
  delete input.workScope;

  const result =
    evaluateAcceptanceDecision(input);

  assert.strictEqual(
    result.decision,
    "request_clarification"
  );
  assert.strictEqual(
    result.status,
    "needs_clarification"
  );

  console.log(
    "PASS: missing scope -> clarification"
  );
}

// 7. Complete valid input -> accept
{
  const result =
    evaluateAcceptanceDecision(
      baseInput()
    );

  assert.strictEqual(
    result.decision,
    "accept"
  );
  assert.strictEqual(
    result.status,
    "accepted"
  );

  assert.strictEqual(
    result.governance.acceptanceDecisionMade,
    true
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
    "PASS: complete valid input -> accept"
  );
}

// 8. Scope requirement helper
{
  assert.strictEqual(
    decisionRequiresScope("accept"),
    true
  );

  assert.strictEqual(
    decisionRequiresScope("reject"),
    false
  );

  console.log(
    "PASS: scope requirement helper"
  );
}

// 9. Final decision helper
{
  assert.strictEqual(
    isAcceptanceDecisionFinal("accept"),
    true
  );

  assert.strictEqual(
    isAcceptanceDecisionFinal("reject"),
    true
  );

  assert.strictEqual(
    isAcceptanceDecisionFinal(
      "request_clarification"
    ),
    false
  );

  assert.strictEqual(
    isAcceptanceDecisionFinal("pending"),
    false
  );

  console.log(
    "PASS: final decision helper"
  );
}

// 10. Decision -> status mapping
{
  assert.strictEqual(
    getAcceptanceStatusForDecision("accept"),
    "accepted"
  );

  assert.strictEqual(
    getAcceptanceStatusForDecision("reject"),
    "rejected"
  );

  assert.strictEqual(
    getAcceptanceStatusForDecision(
      "request_clarification"
    ),
    "needs_clarification"
  );

  assert.strictEqual(
    getAcceptanceStatusForDecision("pending"),
    "pending"
  );

  console.log(
    "PASS: decision -> status mapping"
  );
}

// 11. Decision/status validation
{
  assert.strictEqual(
    validateDecisionStatus(
      "accept",
      "accepted"
    ),
    true
  );

  assert.strictEqual(
    validateDecisionStatus(
      "reject",
      "rejected"
    ),
    true
  );

  assert.strictEqual(
    validateDecisionStatus(
      "accept",
      "rejected"
    ),
    false
  );

  console.log(
    "PASS: decision/status validation"
  );
}

// 12. Unknown decision rejected
{
  assert.throws(
    () =>
      getAcceptanceStatusForDecision(
        "unknown"
      ),
    /Unsupported acceptance decision/
  );

  console.log(
    "PASS: unknown decision rejected"
  );
}

console.log(
  "\nSTAGE9_1_3_WORK_ACCEPTANCE_DECISION_ENGINE_UNIT_TEST: PASS"
);
