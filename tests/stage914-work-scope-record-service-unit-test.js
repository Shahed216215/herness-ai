"use strict";

const assert = require("assert");

const {
  buildWorkScopeRecord,
  validateScopeConsistency,
  buildAcceptedWorkScope,
  isScopeChange,
  buildScopeRecordGovernance
} = require(
  "../services/mira-work-scope-record-service"
);

console.log(
  "\n=== STAGE 9.1.4 WORK SCOPE RECORD SERVICE UNIT TEST ==="
);

// 1. Build valid scope
{
  const scope = buildWorkScopeRecord({
    scopeId: "scope-914",
    summary: "Build a secure web application",
    deliverables: [
      "Source code",
      "Documentation"
    ],
    exclusions: [
      "Production deployment"
    ]
  });

  assert.strictEqual(
    scope.scopeId,
    "scope-914"
  );
  assert.strictEqual(
    scope.summary,
    "Build a secure web application"
  );
  assert.deepStrictEqual(
    scope.deliverables,
    [
      "Source code",
      "Documentation"
    ]
  );
  assert.deepStrictEqual(
    scope.exclusions,
    [
      "Production deployment"
    ]
  );

  console.log(
    "PASS: valid work scope record"
  );
}

// 2. Missing scopeId rejected
{
  assert.throws(
    () =>
      buildWorkScopeRecord({
        summary: "Test scope"
      }),
    /scopeId/
  );

  console.log(
    "PASS: missing scopeId rejected"
  );
}

// 3. Missing summary rejected
{
  assert.throws(
    () =>
      buildWorkScopeRecord({
        scopeId: "scope-invalid"
      }),
    /summary/
  );

  console.log(
    "PASS: missing summary rejected"
  );
}

// 4. Matching scope is consistent
{
  const scope = buildWorkScopeRecord({
    scopeId: "scope-match",
    summary: "Matching scope"
  });

  const result =
    validateScopeConsistency(
      scope,
      {
        scopeId: "scope-match",
        summary: "Matching scope"
      }
    );

  assert.strictEqual(
    result.valid,
    true
  );
  assert.deepStrictEqual(
    result.errors,
    []
  );

  console.log(
    "PASS: matching scope consistency"
  );
}

// 5. Scope ID mismatch rejected
{
  const scope = buildWorkScopeRecord({
    scopeId: "scope-a",
    summary: "Same summary"
  });

  const result =
    validateScopeConsistency(
      scope,
      {
        scopeId: "scope-b"
      }
    );

  assert.strictEqual(
    result.valid,
    false
  );

  console.log(
    "PASS: scopeId mismatch rejected"
  );
}

// 6. Summary mismatch rejected
{
  const scope = buildWorkScopeRecord({
    scopeId: "scope-summary",
    summary: "Original scope"
  });

  const result =
    validateScopeConsistency(
      scope,
      {
        summary: "Different scope"
      }
    );

  assert.strictEqual(
    result.valid,
    false
  );

  console.log(
    "PASS: summary mismatch rejected"
  );
}

// 7. Accepted work requires scope
{
  const result =
    buildAcceptedWorkScope({
      status: "accepted"
    });

  assert.strictEqual(
    result.valid,
    false
  );
  assert.strictEqual(
    result.workScope,
    null
  );

  console.log(
    "PASS: accepted work requires scope"
  );
}

// 8. Accepted work creates scope
{
  const result =
    buildAcceptedWorkScope({
      status: "accepted",
      workScope: {
        scopeId: "scope-accepted",
        summary: "Accepted work",
        deliverables: [
          "Deliverable A"
        ]
      },
      expectedScope: {
        scopeId: "scope-accepted",
        summary: "Accepted work"
      }
    });

  assert.strictEqual(
    result.valid,
    true
  );
  assert.strictEqual(
    result.workScope.scopeId,
    "scope-accepted"
  );

  console.log(
    "PASS: accepted work creates scope"
  );
}

// 9. Non-accepted work cannot finalize scope
{
  const result =
    buildAcceptedWorkScope({
      status: "pending",
      workScope: {
        scopeId: "scope-pending",
        summary: "Pending work"
      }
    });

  assert.strictEqual(
    result.valid,
    false
  );
  assert.strictEqual(
    result.workScope,
    null
  );

  console.log(
    "PASS: non-accepted work cannot finalize scope"
  );
}

// 10. Scope change detected
{
  assert.strictEqual(
    isScopeChange(
      ["design", "development"],
      ["design", "development"]
    ),
    false
  );

  assert.strictEqual(
    isScopeChange(
      ["design"],
      ["design", "development"]
    ),
    true
  );

  console.log(
    "PASS: scope change detection"
  );
}

// 11. Governance boundary
{
  const governance =
    buildScopeRecordGovernance();

  assert.strictEqual(
    governance.workExecutionAllowed,
    false
  );
  assert.strictEqual(
    governance.paymentAllowed,
    false
  );
  assert.strictEqual(
    governance.paymentTransferAuthorized,
    false
  );
  assert.strictEqual(
    governance.contractSigningAllowed,
    false
  );
  assert.strictEqual(
    governance.externalActionPerformed,
    false
  );
  assert.strictEqual(
    governance.scopeChangeAutoApproved,
    false
  );

  console.log(
    "PASS: scope governance boundary"
  );
}

// 12. Missing scope consistency rejected
{
  const result =
    validateScopeConsistency(
      null,
      {
        scopeId: "scope-required"
      }
    );

  assert.strictEqual(
    result.valid,
    false
  );

  console.log(
    "PASS: missing scope consistency rejected"
  );
}

console.log(
  "\nSTAGE9_1_4_WORK_SCOPE_RECORD_SERVICE_UNIT_TEST: PASS"
);
