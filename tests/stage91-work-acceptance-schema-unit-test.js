"use strict";

const assert = require("assert");

const {
  createPaymentMetadata,
  createWorkScopeRecord,
  createAcceptanceDecision,
  createWorkAcceptance,
  validateWorkAcceptance
} = require("../work-acceptance-schema");

console.log("\n=== STAGE 9.1.1 WORK ACCEPTANCE SCHEMA UNIT TEST ===\n");

// 1. Payment metadata must remain metadata-only
{
  const payment = createPaymentMetadata({
    amount: 150,
    currency: "USD",
    status: "agreed",
    terms: "Milestone based",
    reference: "PAY-REF-001"
  });

  assert.strictEqual(payment.amount, 150);
  assert.strictEqual(payment.currency, "USD");
  assert.strictEqual(payment.metadataOnly, true);
  assert.strictEqual(payment.transferAuthorized, false);

  console.log("PASS: payment metadata boundary");
}

// 2. Work scope record
{
  const scope = createWorkScopeRecord({
    scopeId: "scope-001",
    summary: "Build landing page",
    deliverables: ["HTML", "CSS"],
    exclusions: ["Hosting"]
  });

  assert.strictEqual(scope.scopeId, "scope-001");
  assert.strictEqual(scope.summary, "Build landing page");
  assert.deepStrictEqual(
    scope.deliverables,
    ["HTML", "CSS"]
  );

  console.log("PASS: work scope record");
}

// 3. Acceptance decision
{
  const decision = createAcceptanceDecision({
    decision: "accept",
    reason: "Client requirements confirmed",
    decidedBy: "human-review"
  });

  assert.strictEqual(decision.decision, "accept");
  assert.strictEqual(
    decision.decidedBy,
    "human-review"
  );

  console.log("PASS: acceptance decision");
}

// 4. Pending acceptance
{
  const result = validateWorkAcceptance({
    acceptanceId: "accept-001",
    opportunityId: "opp-001",
    proposalId: "proposal-001",
    status: "pending",
    acceptanceDecision: {
      decision: "pending",
      reason: "Waiting for client confirmation"
    }
  });

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.record.status, "pending");

  console.log("PASS: pending acceptance");
}

// 5. Accepted work requires scope
{
  const result = validateWorkAcceptance({
    acceptanceId: "accept-002",
    opportunityId: "opp-002",
    proposalId: "proposal-002",
    status: "accepted",
    acceptanceDecision: {
      decision: "accept",
      reason: "Client accepted proposal"
    }
  });

  assert.strictEqual(result.valid, false);
  assert(
    result.errors.some(
      error =>
        error.includes(
          "Accepted work must contain a work scope record"
        )
    )
  );

  console.log("PASS: accepted work requires scope");
}

// 6. Fully accepted work
{
  const result = validateWorkAcceptance({
    acceptanceId: "accept-003",
    opportunityId: "opp-003",
    qualificationId: "qual-003",
    proposalId: "proposal-003",
    clientResponseId: "response-003",
    requirementsId: "req-003",

    status: "accepted",

    acceptanceDecision: {
      decision: "accept",
      reason: "Client confirmed final requirements",
      decidedBy: "human-review"
    },

    workScope: {
      scopeId: "scope-003",
      summary: "Complete agreed project",
      deliverables: ["Final deliverable"],
      exclusions: ["Out-of-scope changes"]
    },

    paymentMetadata: {
      amount: 500,
      currency: "USD",
      status: "agreed"
    }
  });

  assert.strictEqual(result.valid, true);
  assert.strictEqual(
    result.record.acceptanceDecision.decision,
    "accept"
  );
  assert.strictEqual(
    result.record.workScope.scopeId,
    "scope-003"
  );
  assert.strictEqual(
    result.record.paymentMetadata.metadataOnly,
    true
  );
  assert.strictEqual(
    result.record.paymentMetadata.transferAuthorized,
    false
  );

  console.log("PASS: fully accepted work");
}

// 7. Rejected work
{
  const result = validateWorkAcceptance({
    acceptanceId: "accept-004",
    opportunityId: "opp-004",
    status: "rejected",
    acceptanceDecision: {
      decision: "reject",
      reason: "Requirements not suitable"
    }
  });

  assert.strictEqual(result.valid, true);

  console.log("PASS: rejected work");
}

// 8. Invalid decision/status combination
{
  const result = validateWorkAcceptance({
    acceptanceId: "accept-005",
    opportunityId: "opp-005",
    status: "accepted",
    acceptanceDecision: {
      decision: "reject",
      reason: "Rejected by reviewer"
    },
    workScope: {
      scopeId: "scope-005",
      summary: "Invalid combination"
    }
  });

  assert.strictEqual(result.valid, false);
  assert(
    result.errors.some(
      error =>
        error.includes(
          "Accepted work must have an accept decision"
        )
    )
  );

  console.log("PASS: invalid acceptance decision rejected");
}

// 9. Invalid payment status
{
  assert.throws(
    () =>
      createPaymentMetadata({
        amount: 100,
        currency: "USD",
        status: "transfer_completed"
      }),
    /paymentMetadata.status/
  );

  console.log("PASS: unsupported payment status rejected");
}

// 10. Invalid payment amount
{
  assert.throws(
    () =>
      createPaymentMetadata({
        amount: -50,
        currency: "USD"
      }),
    /non-negative finite number/
  );

  console.log("PASS: invalid payment amount rejected");
}

console.log(
  "\nSTAGE9_1_1_WORK_ACCEPTANCE_SCHEMA_UNIT_TEST: PASS\n"
);
