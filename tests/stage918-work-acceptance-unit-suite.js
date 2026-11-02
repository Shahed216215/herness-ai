"use strict";

const assert =
  require("assert");

const {
  ACCEPTANCE_STATUSES,
  ACCEPTANCE_DECISIONS,
  createPaymentMetadata,
  createWorkScopeRecord,
  createAcceptanceDecision,
  createWorkAcceptance,
  validateWorkAcceptance
} = require("../work-acceptance-schema");

const {
  evaluateAcceptanceDecision,
  decisionRequiresScope,
  isAcceptanceDecisionFinal,
  getAcceptanceStatusForDecision,
  validateDecisionStatus
} = require(
  "../services/mira-work-acceptance-decision-engine"
);

const {
  buildWorkScopeRecord,
  buildAcceptedWorkScope,
  validateScopeConsistency,
  isScopeChange,
  buildScopeRecordGovernance
} = require(
  "../services/mira-work-scope-record-service"
);

const {
  evaluateWorkAcceptancePolicyGate,
  isPolicyGateAllowed,
  validatePolicyGateResult
} = require(
  "../services/mira-work-acceptance-policy-gate"
);

const {
  AUDIT_ACTIONS,
  buildDetails,
  buildResourceId,
  normalizeId,
  normalizeDecision,
  normalizeStatus
} = require(
  "../services/mira-work-acceptance-audit"
);

function pass(label) {
  console.log(`PASS: ${label}`);
}

function expectThrow(fn, label) {
  assert.throws(fn);
  pass(label);
}

function buildOpportunity(
  overrides = {}
) {
  return {
    opportunityId:
      "stage918-opportunity-001",
    title:
      "Website content project",
    description:
      "Create website content",
    policy: {
      decision: "allowed",
      policyChecked: true,
      findings: [],
      reasons: [],
      evaluatedAt:
        "2026-10-08T00:00:00.000Z"
    },
    ...overrides
  };
}

function buildCompleteInput(
  overrides = {}
) {
  return {
    opportunity:
      buildOpportunity(),
    proposal: {
      proposalId:
        "stage918-proposal-001"
    },
    clientResponse: {
      clientResponseId:
        "stage918-response-001"
    },
    requirements: {
      requirementsId:
        "stage918-requirements-001",
      summary:
        "Create five website pages"
    },
    workScope: {
      scopeId:
        "stage918-scope-001",
      summary:
        "Create five website pages",
      deliverables: [
        "Five website pages"
      ],
      exclusions: [
        "Hosting changes"
      ]
    },
    acceptanceDecision: {
      decision: "accept",
      reason:
        "All acceptance requirements are complete."
    },
    humanApprovalGranted: false,
    ...overrides
  };
}

console.log(
  "\n=== STAGE 9.1.8 WORK ACCEPTANCE UNIT SUITE ===\n"
);

try {
  /*
   * 1. Schema contract
   */
  assert(
    Array.isArray(
      ACCEPTANCE_STATUSES
    )
  );

  assert(
    Array.isArray(
      ACCEPTANCE_DECISIONS
    )
  );

  const paymentMetadata =
    createPaymentMetadata();

  assert.strictEqual(
    paymentMetadata.metadataOnly,
    true
  );

  assert.strictEqual(
    paymentMetadata.transferAuthorized,
    false
  );

  pass(
    "payment metadata remains informational only"
  );

  const scope =
    createWorkScopeRecord({
      scopeId:
        "stage918-scope-schema",
      summary:
        "Defined work scope",
      deliverables: [
        "Deliverable A"
      ],
      exclusions: [
        "Exclusion A"
      ]
    });

  assert.strictEqual(
    scope.scopeId,
    "stage918-scope-schema"
  );

  const decision =
    createAcceptanceDecision({
      decision: "accept",
      reason:
        "Complete"
    });

  assert.strictEqual(
    decision.decision,
    "accept"
  );

  const acceptance =
    createWorkAcceptance({
      acceptanceId:
        "stage918-acceptance-schema",
      opportunityId:
        "stage918-opportunity-schema",
      status:
        "accepted",
      acceptanceDecision:
        decision,
      workScope:
        scope,
      paymentMetadata
    });

  const acceptanceValidation =
    validateWorkAcceptance(
      acceptance
    );

  assert.strictEqual(
    acceptanceValidation.valid,
    true
  );

  assert.deepStrictEqual(
    acceptanceValidation.errors,
    []
  );

  pass(
    "schema creates a valid accepted work record"
  );

  /*
   * 2. Decision engine contract
   */
  const completeInput =
    buildCompleteInput();

  const acceptResult =
    evaluateAcceptanceDecision(
      completeInput
    );

  assert.strictEqual(
    acceptResult.decision,
    "accept"
  );

  assert.strictEqual(
    acceptResult.status,
    "accepted"
  );

  assert.strictEqual(
    acceptResult.governance.workExecutionAllowed,
    false
  );

  assert.strictEqual(
    acceptResult.governance.paymentAllowed,
    false
  );

  assert.strictEqual(
    acceptResult.governance.contractSigningAllowed,
    false
  );

  pass(
    "complete acceptance input produces accept decision"
  );

  const pendingResult =
    evaluateAcceptanceDecision({
      opportunity:
        buildOpportunity()
    });

  assert.strictEqual(
    pendingResult.decision,
    "pending"
  );

  pass(
    "incomplete acceptance input remains pending"
  );

  const clarificationResult =
    evaluateAcceptanceDecision({
      opportunity:
        buildOpportunity(),
      proposal: {
        proposalId:
          "stage918-proposal"
      },
      clientResponse: {
        clientResponseId:
          "stage918-response"
      }
    });

  assert.strictEqual(
    clarificationResult.decision,
    "request_clarification"
  );

  pass(
    "missing requirements requires clarification"
  );

  /*
   * 3. Decision helpers
   */
  assert.strictEqual(
    decisionRequiresScope(
      "accept"
    ),
    true
  );

  assert.strictEqual(
    isAcceptanceDecisionFinal(
      "accept"
    ),
    true
  );

  assert.strictEqual(
    isAcceptanceDecisionFinal(
      "pending"
    ),
    false
  );

  assert.strictEqual(
    getAcceptanceStatusForDecision(
      "accept"
    ),
    "accepted"
  );

  assert.strictEqual(
    validateDecisionStatus(
      "accept",
      "accepted"
    ),
    true
  );

  pass(
    "decision helper contracts remain consistent"
  );

  /*
   * 4. Work scope service
   */
  const serviceScope =
    buildWorkScopeRecord(
      completeInput.workScope
    );

  assert.strictEqual(
    serviceScope.scopeId,
    completeInput.workScope.scopeId
  );

  const acceptedScope =
    buildAcceptedWorkScope({
      status:
        "accepted",
      workScope:
        completeInput.workScope
    });

  assert.strictEqual(
    acceptedScope.valid,
    true
  );

  const scopeConsistency =
    validateScopeConsistency(
      acceptedScope.workScope,
      completeInput.workScope
    );

  assert.strictEqual(
    scopeConsistency.valid,
    true
  );

  assert.deepStrictEqual(
    scopeConsistency.errors,
    []
  );

  pass(
    "accepted work produces a consistent scope record"
  );

  assert.strictEqual(
    isScopeChange(
      completeInput.workScope.deliverables,
      [
        ...completeInput.workScope.deliverables,
        "Deliverable B"
      ]
    ),
    true
  );

  pass(
    "scope changes are detected"
  );

  const scopeGovernance =
    buildScopeRecordGovernance();

  assert.strictEqual(
    scopeGovernance.workExecutionAllowed,
    false
  );

  assert.strictEqual(
    scopeGovernance.paymentAllowed,
    false
  );

  assert.strictEqual(
    scopeGovernance.paymentTransferAuthorized,
    false
  );

  assert.strictEqual(
    scopeGovernance.contractSigningAllowed,
    false
  );

  assert.strictEqual(
    scopeGovernance.externalActionPerformed,
    false
  );

  pass(
    "scope governance boundary is preserved"
  );

  /*
   * 5. Policy gate
   */
  const gateResult =
    evaluateWorkAcceptancePolicyGate(
      completeInput
    );

  assert.strictEqual(
    gateResult.decision,
    "allow"
  );

  assert.strictEqual(
    gateResult.allowed,
    true
  );

  assert.strictEqual(
    isPolicyGateAllowed(
      gateResult
    ),
    true
  );

  assert.strictEqual(
    validatePolicyGateResult(
      gateResult
    ),
    true
  );

  pass(
    "allowed policy + accepted decision passes gate"
  );

  const blockedGate =
    evaluateWorkAcceptancePolicyGate({
      ...completeInput,
      opportunity:
        buildOpportunity({
          policy: {
            decision: "blocked",
            policyChecked: true,
            findings: [],
            reasons: [],
            evaluatedAt:
              "2026-10-08T00:00:00.000Z"
          }
        })
    });

  assert.strictEqual(
    blockedGate.decision,
    "block"
  );

  assert.strictEqual(
    blockedGate.allowed,
    false
  );

  pass(
    "blocked policy cannot pass acceptance gate"
  );

  const approvalGate =
    evaluateWorkAcceptancePolicyGate({
      ...completeInput,
      opportunity:
        buildOpportunity({
          policy: {
            decision:
              "approval_required",
            policyChecked: true,
            findings: [],
            reasons: [],
            evaluatedAt:
              "2026-10-08T00:00:00.000Z"
          }
        }),
      humanApprovalGranted:
        false
    });

  assert.strictEqual(
    approvalGate.decision,
    "approval_required"
  );

  assert.strictEqual(
    approvalGate.allowed,
    false
  );

  pass(
    "approval-required policy cannot pass without approval"
  );

  /*
   * 6. Cross-component safety boundary
   */
  assert.strictEqual(
    gateResult.governance
      .workExecutionAllowed,
    false
  );

  assert.strictEqual(
    gateResult.governance
      .paymentAllowed,
    false
  );

  assert.strictEqual(
    gateResult.governance
      .paymentTransferAuthorized,
    false
  );

  assert.strictEqual(
    gateResult.governance
      .contractSigningAllowed,
    false
  );

  assert.strictEqual(
    gateResult.governance
      .externalActionPerformed,
    false
  );

  pass(
    "policy gate cannot authorize execution, payment, contract, or external action"
  );

  /*
   * 7. Audit adapter contract
   */
  assert.strictEqual(
    normalizeId(
      "  stage918-id  "
    ),
    "stage918-id"
  );

  assert.strictEqual(
    normalizeDecision(
      " accept "
    ),
    "accept"
  );

  assert.strictEqual(
    normalizeStatus(
      " accepted "
    ),
    "accepted"
  );

  assert.strictEqual(
    buildResourceId(
      "stage918-acceptance"
    ),
    "stage918-acceptance"
  );

  const auditDetails =
    buildDetails({
      acceptanceId:
        "stage918-acceptance",
      opportunityId:
        "stage918-opportunity",
      decision:
        "accept",
      status:
        "accepted",
      policyDecision:
        "allowed",
      policyChecked:
        true,
      policyAllowed:
        true,
      policyGateDecision:
        "allow",
      humanApprovalRequired:
        false,
      humanApprovalGranted:
        false,
      acceptanceFinal:
        true,
      allowed:
        true,
      blocked:
        false,
      approvalRequired:
        false,
      clarificationRequired:
        false,
      workExecutionAllowed:
        false,
      paymentAllowed:
        false,
      paymentTransferAuthorized:
        false,
      contractSigningAllowed:
        false,
      externalActionPerformed:
        false
    });

  assert.strictEqual(
    auditDetails.acceptanceId,
    "stage918-acceptance"
  );

  assert.strictEqual(
    auditDetails.paymentTransferAuthorized,
    false
  );

  pass(
    "audit adapter preserves acceptance and safety boundaries"
  );

  /*
   * 8. Audit action contract
   */
  const requiredActions = [
    "EVALUATED",
    "POLICY_GATED",
    "APPROVAL_REQUIRED",
    "BLOCKED",
    "CREATED",
    "UPDATED"
  ];

  for (
    const key of requiredActions
  ) {
    assert(
      AUDIT_ACTIONS[key]
    );
  }

  pass(
    "all required work acceptance audit actions exist"
  );

  /*
   * 9. Invalid states
   */
  expectThrow(
    () =>
      createAcceptanceDecision({
        decision:
          "unknown",
        reason:
          "invalid"
      }),
    "invalid acceptance decision is rejected"
  );

  expectThrow(
    () =>
      createWorkScopeRecord({
        scopeId:
          "",
        summary:
          "Invalid"
      }),
    "empty scope ID is rejected"
  );

  const invalidAcceptedWork =
    validateWorkAcceptance({
      acceptanceId:
        "stage918-invalid",
      opportunityId:
        "stage918-opportunity",
      status:
        "accepted",
      acceptanceDecision: {
        decision:
          "accept",
        reason:
          "Accepted"
      }
    });

  assert.strictEqual(
    invalidAcceptedWork.valid,
    false
  );

  assert.ok(
    invalidAcceptedWork.errors.length > 0
  );

  pass(
    "accepted work without scope is rejected"
  );

  const unknownPolicyGate =
    evaluateWorkAcceptancePolicyGate({
      ...completeInput,
      opportunity:
        buildOpportunity({
          policy: {
            decision:
              "unknown",
            policyChecked:
              true,
            findings: [],
            reasons: [],
            evaluatedAt:
              null
          }
        })
    });

  assert.strictEqual(
    unknownPolicyGate.decision,
    "clarification_required"
  );

  assert.strictEqual(
    unknownPolicyGate.allowed,
    false
  );

  pass(
    "unknown policy decision requires clarification"
  );

  /*
   * 10. Final cross-component contract
   */
  assert.strictEqual(
    acceptResult.decision,
    "accept"
  );

  assert.strictEqual(
    gateResult.decision,
    "allow"
  );

  assert.strictEqual(
    acceptedScope.valid,
    true
  );


  assert.strictEqual(
    gateResult.governance
      .workExecutionAllowed,
    false
  );

  assert.strictEqual(
    gateResult.governance
      .paymentTransferAuthorized,
    false
  );

  pass(
    "final cross-component acceptance contract"
  );

  console.log(
    "\nSTAGE9_1_8_WORK_ACCEPTANCE_UNIT_SUITE: PASS\n"
  );
} catch (error) {
  console.error(
    "\nSTAGE9_1_8_WORK_ACCEPTANCE_UNIT_SUITE: FAIL\n"
  );
  console.error(error);
  process.exit(1);
}
