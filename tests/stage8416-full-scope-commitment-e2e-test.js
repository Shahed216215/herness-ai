'use strict';

const assert = require('assert');

const {
  evaluateClientRequest
} = require('../services/mira-scope-commitment-service');

const {
  evaluateFailSafe
} = require('../services/mira-scope-commitment-failsafe');

const {
  recordScopeCommitmentAudit
} = require('../services/mira-scope-commitment-audit');

const {
  verifyAuditIntegrity,
  getAuditLog
} = require('../audit-log');

function makeApproval(overrides = {}) {
  return {
    approvalId: 'APP-8416-001',
    status: 'approved',
    approverId: 'human-8416',
    approverRoles: [
      'price_approver',
      'contract_approver',
      'legal_approver',
      'senior_approver'
    ],
    requestId: 'REQ-8416-001',
    approvedScope: [
      'update homepage text'
    ],
    commitmentTypes: [
      'price_commitment'
    ],
    createdAt: '2026-10-07T16:00:00.000Z',
    ...overrides
  };
}

function auditDecision(result, requestId) {
  return recordScopeCommitmentAudit({
    requestId,
    scopeType: result.scopeType,
    scopeChanged: result.scopeChanged,
    commitmentTypes: result.commitmentTypes ||
      [],
    approvalRequired:
      result.approvalRequired,
    approvalStatus:
      result.approvalStatus,
    approvalGranted:
      result.approvalGranted,
    approvalValidation:
      result.approvalValidation &&
      result.approvalValidation.valid === true,
    provenanceValidation:
      result.provenanceValidation &&
      result.provenanceValidation.valid === true,
    authorityValidation:
      result.authorityValidation &&
      result.authorityValidation.valid === true,
    replayValidation:
      result.replayValidation &&
      result.replayValidation.valid === true,
    failSafe: false,
    reviewRequired: false,
    allowed: result.allowed === true,
    blocked: result.blocked === true,
    decision:
      result.decision ||
      result.analysisDecision ||
      'unknown'
  });
}

console.log('\n=== FULL E2E TEST START ===');

/* 1. NORMAL EXISTING-SCOPE REQUEST */

{
  const requestId = 'REQ-8416-NORMAL';

  const result =
    evaluateClientRequest({
      requestId,
      request:
        'Update the homepage text.',
      existingScope: [
        'update homepage text'
      ],
      requestedScope: [
        'update homepage text'
      ]
    });

  assert(
    result,
    'NORMAL_RESULT_MISSING'
  );

  assert(
    result.scopeType === 'existing_scope',
    'NORMAL_SCOPE_TYPE_FAILED'
  );

  assert(
    result.scopeChanged === false,
    'NORMAL_SCOPE_CHANGED_FAILED'
  );

  assert(
    result.approvalRequired === false,
    'NORMAL_APPROVAL_SHOULD_NOT_BE_REQUIRED'
  );

  auditDecision(result, requestId);

  console.log(
    'NORMAL EXISTING SCOPE: PASS'
  );
}

/* 2. NEW SCOPE WITHOUT APPROVAL */

{
  const requestId = 'REQ-8416-NEW';

  const result =
    evaluateClientRequest({
      requestId,
      request:
        'Also redesign the pricing page.',
      existingScope: [
        'update homepage text'
      ],
      requestedScope: [
        'update homepage text',
        'redesign pricing page'
      ]
    });

  assert(
    result.scopeType === 'new_scope',
    'NEW_SCOPE_CLASSIFICATION_FAILED'
  );

  assert(
    result.approvalRequired === true,
    'NEW_SCOPE_APPROVAL_REQUIRED_FAILED'
  );

  assert(
    result.blocked === true ||
    result.allowed === false,
    'NEW_SCOPE_MUST_NOT_AUTO_ALLOW'
  );

  auditDecision(result, requestId);

  console.log(
    'NEW SCOPE WITHOUT APPROVAL: PASS'
  );
}

/* 3. PRICE COMMITMENT WITHOUT APPROVAL */

{
  const requestId = 'REQ-8416-PRICE-NO';

  const result =
    evaluateClientRequest({
      requestId,
      request:
        'Please confirm the price.',
      existingScope: [
        'update homepage text'
      ],
      requestedScope: [
        'update homepage text'
      ]
    });

  assert(
    Array.isArray(result.commitmentTypes),
    'PRICE_COMMITMENT_RESULT_MISSING'
  );

  assert(
    result.commitmentTypes.includes(
      'price_commitment'
    ),
    'PRICE_COMMITMENT_NOT_DETECTED'
  );

  assert(
    result.approvalRequired === true,
    'PRICE_APPROVAL_REQUIRED_FAILED'
  );

  assert(
    result.allowed === false,
    'PRICE_COMMITMENT_MUST_NOT_AUTO_ALLOW'
  );

  auditDecision(result, requestId);

  console.log(
    'PRICE COMMITMENT WITHOUT APPROVAL: PASS'
  );
}

/* 4. VALID AUTHORIZED APPROVAL */

{
  const requestId = 'REQ-8416-VALID';

  const result =
    evaluateClientRequest({
      requestId,
      request:
        'Please confirm the price.',
      existingScope: [
        'update homepage text'
      ],
      requestedScope: [
        'update homepage text'
      ],
      approval: makeApproval({
        requestId
      }),
      approverRoles: [
        'price_approver'
      ],
      now:
        '2026-10-07T16:30:00.000Z'
    });

  assert(
    result.approvalRequired === true,
    'VALID_APPROVAL_BOUNDARY_FAILED'
  );

  assert(
    result.approvalGranted === true,
    'VALID_APPROVAL_NOT_GRANTED'
  );

  assert(
    result.allowed === true,
    'VALID_AUTHORIZED_APPROVAL_NOT_ALLOWED'
  );

  assert(
    result.blocked === false,
    'VALID_AUTHORIZED_APPROVAL_BLOCKED'
  );

  auditDecision(result, requestId);

  console.log(
    'VALID AUTHORIZED APPROVAL: PASS'
  );
}

/* 5. WRONG REQUEST ID */

{
  const requestId = 'REQ-8416-WRONG-ID';

  const result =
    evaluateClientRequest({
      requestId,
      request:
        'Please confirm the price.',
      existingScope: [
        'update homepage text'
      ],
      requestedScope: [
        'update homepage text'
      ],
      approval: makeApproval({
        requestId:
          'REQ-OTHER'
      }),
      approverRoles: [
        'price_approver'
      ],
      now:
        '2026-10-07T16:30:00.000Z'
    });

  assert(
    result.allowed === false,
    'WRONG_REQUEST_ID_ALLOWED'
  );

  assert(
    result.blocked === true,
    'WRONG_REQUEST_ID_NOT_BLOCKED'
  );

  auditDecision(result, requestId);

  console.log(
    'WRONG REQUEST ID: PASS'
  );
}

/* 6. UNAUTHORIZED APPROVER */

{
  const requestId = 'REQ-8416-AUTH';

  const result =
    evaluateClientRequest({
      requestId,
      request:
        'Please confirm the price.',
      existingScope: [
        'update homepage text'
      ],
      requestedScope: [
        'update homepage text'
      ],
      approval: makeApproval({
        requestId,
        approverRoles: [
          'viewer'
        ]
      }),
      approverRoles: [
        'viewer'
      ],
      now:
        '2026-10-07T16:30:00.000Z'
    });

  assert(
    result.allowed === false,
    'UNAUTHORIZED_APPROVER_ALLOWED'
  );

  assert(
    result.blocked === true,
    'UNAUTHORIZED_APPROVER_NOT_BLOCKED'
  );

  auditDecision(result, requestId);

  console.log(
    'UNAUTHORIZED APPROVER: PASS'
  );
}

/* 7. REVOKED APPROVAL */

{
  const requestId = 'REQ-8416-REVOKED';

  const result =
    evaluateClientRequest({
      requestId,
      request:
        'Please confirm the price.',
      existingScope: [
        'update homepage text'
      ],
      requestedScope: [
        'update homepage text'
      ],
      approval: makeApproval({
        requestId,
        revoked: true
      }),
      approverRoles: [
        'price_approver'
      ],
      now:
        '2026-10-07T16:30:00.000Z'
    });

  assert(
    result.allowed === false,
    'REVOKED_APPROVAL_ALLOWED'
  );

  assert(
    result.blocked === true,
    'REVOKED_APPROVAL_NOT_BLOCKED'
  );

  auditDecision(result, requestId);

  console.log(
    'REVOKED APPROVAL: PASS'
  );
}

/* 8. USED APPROVAL */

{
  const requestId = 'REQ-8416-USED';

  const result =
    evaluateClientRequest({
      requestId,
      request:
        'Please confirm the price.',
      existingScope: [
        'update homepage text'
      ],
      requestedScope: [
        'update homepage text'
      ],
      approval: makeApproval({
        requestId,
        used: true
      }),
      approverRoles: [
        'price_approver'
      ],
      now:
        '2026-10-07T16:30:00.000Z'
    });

  assert(
    result.allowed === false,
    'USED_APPROVAL_ALLOWED'
  );

  assert(
    result.blocked === true,
    'USED_APPROVAL_NOT_BLOCKED'
  );

  auditDecision(result, requestId);

  console.log(
    'USED APPROVAL: PASS'
  );
}

/* 9. EXPIRED APPROVAL */

{
  const requestId = 'REQ-8416-EXPIRED';

  const result =
    evaluateClientRequest({
      requestId,
      request:
        'Please confirm the price.',
      existingScope: [
        'update homepage text'
      ],
      requestedScope: [
        'update homepage text'
      ],
      approval: makeApproval({
        requestId,
        createdAt:
          '2026-10-01T16:00:00.000Z'
      }),
      approverRoles: [
        'price_approver'
      ],
      now:
        '2026-10-07T16:30:00.000Z'
    });

  assert(
    result.allowed === false,
    'EXPIRED_APPROVAL_ALLOWED'
  );

  assert(
    result.blocked === true,
    'EXPIRED_APPROVAL_NOT_BLOCKED'
  );

  auditDecision(result, requestId);

  console.log(
    'EXPIRED APPROVAL: PASS'
  );
}

/* 10. FAIL-SAFE */

{
  const result =
    evaluateFailSafe({
      request: '',
      scopeType: 'unclear_scope',
      commitmentTypes: [
        'unknown_commitment'
      ]
    });

  assert(
    result.safe === false,
    'FAILSAFE_MARKED_SAFE'
  );

  assert(
    result.blocked === true,
    'FAILSAFE_NOT_BLOCKED'
  );

  assert(
    result.reviewRequired === true,
    'FAILSAFE_REVIEW_NOT_REQUIRED'
  );

  assert(
    result.decision === 'review',
    'FAILSAFE_DECISION_FAILED'
  );

  recordScopeCommitmentAudit({
    requestId:
      'REQ-8416-FAILSAFE',
    scopeType:
      'unclear_scope',
    scopeChanged: false,
    commitmentTypes: [
      'unknown_commitment'
    ],
    approvalRequired: true,
    approvalStatus: 'required',
    approvalGranted: false,
    failSafe: true,
    reviewRequired: true,
    allowed: false,
    blocked: true,
    decision: 'review'
  });

  console.log(
    'FAIL-SAFE BLOCK + REVIEW: PASS'
  );
}

/* 11. AUDIT INTEGRITY */

{
  const entries =
    getAuditLog(500);

  const stageEntries =
    entries.filter(
      (entry) =>
        entry.action ===
        'SCOPE_COMMITMENT_DECISION'
    );

  assert(
    stageEntries.length >= 10,
    'EXPECTED_AUDIT_ENTRIES_MISSING'
  );

  const integrity =
    verifyAuditIntegrity();

  assert(
    integrity &&
    integrity.ok === true &&
    integrity.integrityFailures === 0 &&
    integrity.chainFailures === 0 &&
    integrity.tamperDetected === false,
    'FINAL_AUDIT_INTEGRITY_FAILED'
  );

  console.log(
    'AUDIT ENTRIES: PASS'
  );

  console.log(
    'AUDIT HASH CHAIN INTEGRITY: PASS'
  );
}

console.log(
  '\nSTAGE84_FULL_SCOPE_COMMITMENT_E2E_TEST: PASS'
);

console.log(
  '=== FULL E2E TEST COMPLETE ==='
);
