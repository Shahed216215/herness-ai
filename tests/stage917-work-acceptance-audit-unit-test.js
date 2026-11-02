"use strict";

const assert =
  require("assert");

const {
  AUDIT_ACTIONS,
  buildDetails,
  buildResourceId,
  recordAcceptanceEvaluated,
  recordPolicyGated,
  recordApprovalRequired,
  recordAcceptanceBlocked,
  recordAcceptanceCreated,
  recordAcceptanceUpdated
} =
  require(
    "../services/mira-work-acceptance-audit"
  );

const {
  getAuditLog,
  verifyAuditIntegrity
} = require("../audit-log");

const marker =
  "STAGE917_RAW_CLIENT_SECRET_7x9k";

function latest(action) {
  const entries =
    getAuditLog(500);

  return [...entries]
    .reverse()
    .find(
      entry =>
        entry.action === action
    );
}

function assertSafetyBoundary(entry) {
  assert.strictEqual(
    entry.details.workExecutionAllowed,
    false
  );

  assert.strictEqual(
    entry.details.paymentAllowed,
    false
  );

  assert.strictEqual(
    entry.details.paymentTransferAuthorized,
    false
  );

  assert.strictEqual(
    entry.details.contractSigningAllowed,
    false
  );

  assert.strictEqual(
    entry.details.externalActionPerformed,
    false
  );
}

console.log(
  "\n=== STAGE 9.1.7 WORK ACCEPTANCE AUDIT UNIT TEST ===\n"
);

console.log(
  "[1] AUDIT ACTION CONTRACT"
);

assert.deepStrictEqual(
  Object.values(AUDIT_ACTIONS),
  [
    "WORK_ACCEPTANCE_EVALUATED",
    "WORK_ACCEPTANCE_POLICY_GATED",
    "WORK_ACCEPTANCE_APPROVAL_REQUIRED",
    "WORK_ACCEPTANCE_BLOCKED",
    "WORK_ACCEPTANCE_CREATED",
    "WORK_ACCEPTANCE_UPDATED"
  ]
);

console.log(
  "PASS: audit action contract"
);

console.log(
  "[2] RESOURCE ID"
);

assert.strictEqual(
  buildResourceId(
    "acc-917",
    "test"
  ),
  "acc-917"
);

assert.ok(
  buildResourceId(
    "",
    "test"
  ).startsWith(
    "work-acceptance-"
  )
);

console.log(
  "PASS: resource ID normalization"
);

console.log(
  "[3] DETAILS SANITIZATION"
);

const details =
  buildDetails({
    acceptanceId:
      "acc-917",
    opportunityId:
      "opp-917",
    proposalId:
      "prop-917",
    decision:
      "accept",
    policyDecision:
      "allowed",
    policyChecked:
      true,
    policyAllowed:
      true,
    policyGateDecision:
      "allow",
    humanApprovalGranted:
      true,
    acceptanceFinal:
      true,
    allowed:
      true,
    workExecutionAllowed:
      true,
    paymentAllowed:
      true,
    paymentTransferAuthorized:
      true,
    contractSigningAllowed:
      true,
    externalActionPerformed:
      true,
    rawContent:
      marker
  });

assert.strictEqual(
  details.acceptanceId,
  "acc-917"
);

assert.ok(
  !JSON.stringify(details)
    .includes(marker)
);

assert.strictEqual(
  details.workExecutionAllowed,
  true
);

console.log(
  "PASS: audit details sanitize input"
);

console.log(
  "[4] EVALUATED AUDIT"
);

recordAcceptanceEvaluated({
  acceptanceId:
    "stage917-evaluated",
  opportunityId:
    "opp-917",
  proposalId:
    "prop-917",
  decision:
    "accept",
  decisionStatus:
    "accepted",
  policyDecision:
    "allowed",
  policyChecked:
    true,
  policyAllowed:
    true,
  policyGateDecision:
    "allow",
  acceptanceFinal:
    true,
  allowed:
    true,
  rawContent:
    marker
});

const evaluated =
  latest(
    AUDIT_ACTIONS.EVALUATED
  );

assert.ok(
  evaluated
);

assert.strictEqual(
  evaluated.resource,
  "work_acceptance"
);

assert.ok(
  !JSON.stringify(evaluated)
    .includes(marker)
);

assertSafetyBoundary(
  evaluated
);

console.log(
  "PASS: acceptance evaluated audit"
);

console.log(
  "[5] POLICY GATE AUDIT"
);

recordPolicyGated({
  acceptanceId:
    "stage917-policy",
  opportunityId:
    "opp-917",
  policyDecision:
    "allowed",
  policyChecked:
    true,
  policyAllowed:
    true,
  policyGateDecision:
    "allow",
  allowed:
    true
});

const policy =
  latest(
    AUDIT_ACTIONS.POLICY_GATED
  );

assert.ok(
  policy
);

assert.strictEqual(
  policy.details.policyGateDecision,
  "allow"
);

assertSafetyBoundary(
  policy
);

console.log(
  "PASS: policy gate audit"
);

console.log(
  "[6] APPROVAL REQUIRED AUDIT"
);

recordApprovalRequired({
  acceptanceId:
    "stage917-approval",
  policyDecision:
    "approval_required",
  policyChecked:
    true,
  policyGateDecision:
    "approval_required",
  humanApprovalRequired:
    true,
  humanApprovalGranted:
    false
});

const approval =
  latest(
    AUDIT_ACTIONS.APPROVAL_REQUIRED
  );

assert.ok(
  approval
);

assert.strictEqual(
  approval.status,
  "approval_required"
);

assert.strictEqual(
  approval.details.approvalRequired,
  true
);

assertSafetyBoundary(
  approval
);

console.log(
  "PASS: approval-required audit"
);

console.log(
  "[7] BLOCKED AUDIT"
);

recordAcceptanceBlocked({
  acceptanceId:
    "stage917-blocked",
  policyDecision:
    "blocked",
  policyChecked:
    true,
  policyAllowed:
    false,
  policyGateDecision:
    "block",
  blocked:
    true
});

const blocked =
  latest(
    AUDIT_ACTIONS.BLOCKED
  );

assert.ok(
  blocked
);

assert.strictEqual(
  blocked.status,
  "blocked"
);

assert.strictEqual(
  blocked.details.blocked,
  true
);

assertSafetyBoundary(
  blocked
);

console.log(
  "PASS: blocked acceptance audit"
);

console.log(
  "[8] CREATED AUDIT"
);

recordAcceptanceCreated({
  acceptanceId:
    "stage917-created",
  opportunityId:
    "opp-917",
  proposalId:
    "prop-917",
  decision:
    "accept",
  decisionStatus:
    "accepted",
  policyDecision:
    "allowed",
  policyChecked:
    true,
  policyAllowed:
    true,
  policyGateDecision:
    "allow",
  acceptanceFinal:
    true,
  allowed:
    true
});

const created =
  latest(
    AUDIT_ACTIONS.CREATED
  );

assert.ok(
  created
);

assert.strictEqual(
  created.resourceId,
  "stage917-created"
);

assertSafetyBoundary(
  created
);

console.log(
  "PASS: created acceptance audit"
);

console.log(
  "[9] UPDATED AUDIT"
);

recordAcceptanceUpdated({
  acceptanceId:
    "stage917-created",
  opportunityId:
    "opp-917",
  decisionStatus:
    "accepted"
});

const updated =
  latest(
    AUDIT_ACTIONS.UPDATED
  );

assert.ok(
  updated
);

assert.strictEqual(
  updated.resourceId,
  "stage917-created"
);

assertSafetyBoundary(
  updated
);

console.log(
  "PASS: updated acceptance audit"
);

console.log(
  "[10] AUDIT INTEGRITY"
);

const integrity =
  verifyAuditIntegrity();

assert.ok(
  integrity &&
  integrity.ok === true
);

assert.strictEqual(
  integrity.integrityFailures,
  0
);

assert.strictEqual(
  integrity.chainFailures,
  0
);

assert.strictEqual(
  integrity.tamperDetected,
  false
);

console.log(
  "PASS: audit integrity"
);

console.log(
  "\nSTAGE9_1_7_WORK_ACCEPTANCE_AUDIT_UNIT_TEST: PASS"
);
