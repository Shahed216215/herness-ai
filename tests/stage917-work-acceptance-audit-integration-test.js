"use strict";

const fs = require("fs");

const store =
  require("../work-acceptance-store");

const {
  getAuditLog,
  verifyAuditIntegrity
} = require("../audit-log");

const registerWorkAcceptanceRoutes =
  require("../routes/work-acceptance");

const TEST_RUN_ID =
  Date.now().toString(36);

const TEST_ACCEPTANCE_ID =
  `stage917-audit-integration-${TEST_RUN_ID}`;

const TEST_BLOCKED_ID =
  `stage917-audit-integration-blocked-${TEST_RUN_ID}`;

const TEST_APPROVAL_ID =
  `stage917-audit-integration-approval-${TEST_RUN_ID}`;

const TEST_OPPORTUNITY_ID =
  `stage917-audit-integration-opportunity-${TEST_RUN_ID}`;

const TEST_PROPOSAL_ID =
  `stage917-audit-integration-proposal-${TEST_RUN_ID}`;

const TEST_REQUIREMENTS_ID =
  `stage917-audit-integration-requirements-${TEST_RUN_ID}`;

const TEST_CLIENT_RESPONSE_ID =
  `stage917-audit-integration-response-${TEST_RUN_ID}`;

const TEST_SCOPE_ID =
  `stage917-audit-integration-scope-${TEST_RUN_ID}`;

const TEST_STORE_PATH =
  store.getStorePath();

const ORIGINAL_DATA =
  fs.existsSync(TEST_STORE_PATH)
    ? fs.readFileSync(
        TEST_STORE_PATH,
        "utf8"
      )
    : null;

function assert(
  condition,
  message
) {
  if (!condition) {
    throw new Error(message);
  }
}

function createMockApp() {
  const routes = {
    post: new Map(),
    get: new Map(),
    patch: new Map()
  };

  return {
    routes,

    post(path, ...handlers) {
      routes.post.set(
        path,
        handlers
      );
    },

    get(path, ...handlers) {
      routes.get.set(
        path,
        handlers
      );
    },

    patch(path, ...handlers) {
      routes.patch.set(
        path,
        handlers
      );
    }
  };
}

function createResponse() {
  const response = {
    statusCode: 200,
    payload: null,

    status(code) {
      response.statusCode = code;
      return response;
    },

    json(payload) {
      response.payload = payload;
      return response;
    }
  };

  return response;
}

function createRequest(
  body = {},
  query = {},
  params = {}
) {
  return {
    body,
    query,
    params,
    session: {
      authenticated: true,
      role: "admin"
    }
  };
}

function runRoute(
  handlers,
  req
) {
  const res =
    createResponse();

  let index = 0;

  function next() {
    const handler =
      handlers[index++];

    if (!handler) {
      return;
    }

    return handler(
      req,
      res,
      next
    );
  }

  next();

  return res;
}

function authMiddleware(
  req,
  res,
  next
) {
  next();
}

function permissionMiddleware(
  req,
  res,
  next
) {
  next();
}

function getWorkAcceptanceAudits() {
  const actions = new Set([
    "WORK_ACCEPTANCE_EVALUATED",
    "WORK_ACCEPTANCE_POLICY_GATED",
    "WORK_ACCEPTANCE_APPROVAL_REQUIRED",
    "WORK_ACCEPTANCE_BLOCKED",
    "WORK_ACCEPTANCE_CREATED",
    "WORK_ACCEPTANCE_UPDATED"
  ]);

  return getAuditLog().filter(
    entry =>
      actions.has(entry.action)
  );
}

function getAuditsForResource(
  resourceId
) {
  return getWorkAcceptanceAudits()
    .filter(
      entry =>
        entry.resourceId ===
        resourceId
    );
}

function countAction(
  entries,
  action
) {
  return entries.filter(
    entry =>
      entry.action === action
  ).length;
}

function assertSafetyBoundary(
  entry,
  label
) {
  const details =
    entry.details || {};

  assert(
    details.workExecutionAllowed ===
      false,
    `${label}: work execution boundary violated.`
  );

  assert(
    details.paymentAllowed ===
      false,
    `${label}: payment boundary violated.`
  );

  assert(
    details.paymentTransferAuthorized ===
      false,
    `${label}: payment transfer boundary violated.`
  );

  assert(
    details.contractSigningAllowed ===
      false,
    `${label}: contract signing boundary violated.`
  );

  assert(
    details.externalActionPerformed ===
      false,
    `${label}: external action boundary violated.`
  );
}

function cleanup() {
  if (
    ORIGINAL_DATA === null
  ) {
    if (
      fs.existsSync(
        TEST_STORE_PATH
      )
    ) {
      fs.unlinkSync(
        TEST_STORE_PATH
      );
    }

    return;
  }

  fs.writeFileSync(
    TEST_STORE_PATH,
    ORIGINAL_DATA
  );
}

try {
  const app =
    createMockApp();

  registerWorkAcceptanceRoutes(
    app,
    authMiddleware,
    () =>
      permissionMiddleware,
    {
      CLIENT_PROJECTS:
        "CLIENT_PROJECTS"
    }
  );

  const baseInput = {
    acceptanceId:
      TEST_ACCEPTANCE_ID,

    opportunityId:
      TEST_OPPORTUNITY_ID,

    proposalId:
      TEST_PROPOSAL_ID,

    clientResponseId:
      TEST_CLIENT_RESPONSE_ID,

    requirementsId:
      TEST_REQUIREMENTS_ID,

    opportunity: {
      opportunityId:
        TEST_OPPORTUNITY_ID,
      title:
        "Stage 9.1.7 audit integration opportunity"
    },

    proposal: {
      proposalId:
        TEST_PROPOSAL_ID,
      summary:
        "Stage 9.1.7 audit integration proposal"
    },

    clientResponse: {
      clientResponseId:
        TEST_CLIENT_RESPONSE_ID,
      accepted:
        true
    },

    requirements: {
      requirementsId:
        TEST_REQUIREMENTS_ID,
      complete:
        true
    },

    policy: {
      decision:
        "allowed",
      policyChecked:
        true,
      findings: [],
      reasons: [],
      evaluatedAt:
        "2026-10-08T00:00:00.000Z"
    },

    status:
      "accepted",

    acceptanceDecision: {
      decision:
        "accept",
      reason:
        "Stage 9.1.7 audit integration accepted scope.",
      decidedBy:
        "stage917-test"
    },

    workScope: {
      scopeId:
        TEST_SCOPE_ID,

      summary:
        "Stage 9.1.7 audit integration scope.",

      deliverables: [
        "Audit integration test deliverable"
      ],

      exclusions: [
        "No execution",
        "No payment transfer",
        "No contract signing"
      ]
    },

    paymentMetadata: {
      status:
        "agreed",
      amount:
        100,
      currency:
        "USD",
      terms:
        "Metadata-only test payment."
    }
  };


  let response =
    runRoute(
      app.routes.post.get(
        "/api/work-acceptances/evaluate"
      ),
      createRequest({
        opportunityId:
          TEST_OPPORTUNITY_ID,

        proposalId:
          TEST_PROPOSAL_ID,

        clientResponseId:
          TEST_CLIENT_RESPONSE_ID,

        requirementsId:
          TEST_REQUIREMENTS_ID,

        opportunity:
          baseInput.opportunity,

        proposal:
          baseInput.proposal,

        clientResponse:
          baseInput.clientResponse,

        requirements:
          baseInput.requirements,

        workScope:
          baseInput.workScope,

        policy:
          baseInput.policy
      })
    );

  assert(
    response.statusCode === 200,
    "Evaluate route should return 200."
  );

  assert(
    response.payload.decision.decision ===
      "accept",
    "Evaluate route should produce accept."
  );

  assert(
    response.payload.policyGate.decision ===
      "allow",
    "Evaluate route should produce allow gate."
  );

  const evaluatedAudits =
    getAuditsForResource(
      "work-acceptance-evaluation"
    );

  const latestEvaluated =
    getWorkAcceptanceAudits()
      .filter(
        entry =>
          entry.action ===
            "WORK_ACCEPTANCE_EVALUATED" &&
          entry.details?.opportunityId ===
            TEST_OPPORTUNITY_ID
      )
      .slice(-1)[0];

  const latestPolicyGate =
    getWorkAcceptanceAudits()
      .filter(
        entry =>
          entry.action ===
            "WORK_ACCEPTANCE_POLICY_GATED" &&
          entry.details?.opportunityId ===
            TEST_OPPORTUNITY_ID
      )
      .slice(-1)[0];

  assert(
    latestEvaluated,
    "Evaluation audit entry missing."
  );

  assert(
    latestPolicyGate,
    "Policy-gate audit entry missing."
  );

  assertSafetyBoundary(
    latestEvaluated,
    "Evaluation audit"
  );

  assertSafetyBoundary(
    latestPolicyGate,
    "Policy-gate audit"
  );

  console.log(
    "PASS: evaluate route creates audit events"
  );

  response =
    runRoute(
      app.routes.post.get(
        "/api/work-acceptances"
      ),
      createRequest(
        baseInput
      )
    );

  assert(
    response.statusCode === 201,
    "Create route should return 201."
  );

  assert(
    response.payload.acceptance.acceptanceId ===
      TEST_ACCEPTANCE_ID,
    "Created acceptance ID mismatch."
  );

  const createdAudits =
    getAuditsForResource(
      TEST_ACCEPTANCE_ID
    );

  assert(
    countAction(
      createdAudits,
      "WORK_ACCEPTANCE_EVALUATED"
    ) === 1,
    "Create should create exactly one evaluation audit."
  );

  assert(
    countAction(
      createdAudits,
      "WORK_ACCEPTANCE_POLICY_GATED"
    ) === 1,
    "Create should create exactly one policy-gate audit."
  );

  assert(
    countAction(
      createdAudits,
      "WORK_ACCEPTANCE_CREATED"
    ) === 1,
    "Create should create exactly one created audit."
  );

  const createdAudit =
    createdAudits.find(
      entry =>
        entry.action ===
        "WORK_ACCEPTANCE_CREATED"
    );

  assert(
    createdAudit,
    "Created audit entry missing."
  );

  assertSafetyBoundary(
    createdAudit,
    "Created audit"
  );

  assert(
    createdAudit.details?.opportunityId ===
      TEST_OPPORTUNITY_ID,
    "Created audit opportunity ID mismatch."
  );

  assert(
    createdAudit.details?.proposalId ===
      TEST_PROPOSAL_ID,
    "Created audit proposal ID mismatch."
  );

  console.log(
    "PASS: successful create audit chain"
  );

  response =
    runRoute(
      app.routes.post.get(
        "/api/work-acceptances"
      ),
      createRequest({
        ...baseInput,

        acceptanceId:
          TEST_BLOCKED_ID,

        policy: {
          decision:
            "blocked",
          policyChecked:
            true,
          findings: [],
          reasons: [],
          evaluatedAt:
            "2026-10-08T00:00:00.000Z"
        }
      })
    );

  assert(
    response.statusCode === 400,
    "Blocked policy should return 400."
  );

  const blockedAudits =
    getAuditsForResource(
      TEST_BLOCKED_ID
    );

  assert(
    countAction(
      blockedAudits,
      "WORK_ACCEPTANCE_EVALUATED"
    ) === 1,
    "Blocked request should create one evaluation audit."
  );

  assert(
    countAction(
      blockedAudits,
      "WORK_ACCEPTANCE_POLICY_GATED"
    ) === 1,
    "Blocked request should create one policy-gate audit."
  );

  assert(
    countAction(
      blockedAudits,
      "WORK_ACCEPTANCE_BLOCKED"
    ) === 1,
    "Blocked request should create one blocked audit."
  );

  const blockedAudit =
    blockedAudits.find(
      entry =>
        entry.action ===
        "WORK_ACCEPTANCE_BLOCKED"
    );

  assertSafetyBoundary(
    blockedAudit,
    "Blocked audit"
  );

  console.log(
    "PASS: blocked acceptance audit"
  );

  response =
    runRoute(
      app.routes.post.get(
        "/api/work-acceptances"
      ),
      createRequest({
        ...baseInput,

        acceptanceId:
          TEST_APPROVAL_ID,

        policy: {
          decision:
            "approval_required",
          policyChecked:
            true,
          findings: [],
          reasons: [],
          evaluatedAt:
            "2026-10-08T00:00:00.000Z"
        },

        humanApprovalGranted:
          false
      })
    );

  assert(
    response.statusCode === 400,
    "Approval-required policy should return 400."
  );

  const approvalAudits =
    getAuditsForResource(
      TEST_APPROVAL_ID
    );

  assert(
    countAction(
      approvalAudits,
      "WORK_ACCEPTANCE_EVALUATED"
    ) === 1,
    "Approval request should create one evaluation audit."
  );

  assert(
    countAction(
      approvalAudits,
      "WORK_ACCEPTANCE_POLICY_GATED"
    ) === 1,
    "Approval request should create one policy-gate audit."
  );

  assert(
    countAction(
      approvalAudits,
      "WORK_ACCEPTANCE_APPROVAL_REQUIRED"
    ) === 1,
    "Approval request should create one approval-required audit."
  );

  assert(
    countAction(
      approvalAudits,
      "WORK_ACCEPTANCE_CREATED"
    ) === 0,
    "Approval-required request must not create acceptance."
  );

  const approvalAudit =
    approvalAudits.find(
      entry =>
        entry.action ===
        "WORK_ACCEPTANCE_APPROVAL_REQUIRED"
    );

  assertSafetyBoundary(
    approvalAudit,
    "Approval-required audit"
  );

  console.log(
    "PASS: approval-required audit"
  );

  response =
    runRoute(
      app.routes.patch.get(
        "/api/work-acceptances/:acceptanceId"
      ),
      createRequest(
        {
          acceptanceDecision: {
            decision:
              "accept",
            reason:
              "Stage 9.1.7 audit update.",
            decidedBy:
              "stage917-test"
          }
        },
        {},
        {
          acceptanceId:
            TEST_ACCEPTANCE_ID
        }
      )
    );

  assert(
    response.statusCode === 200,
    "Patch route should return 200."
  );

  const updatedAudits =
    getAuditsForResource(
      TEST_ACCEPTANCE_ID
    );

  assert(
    countAction(
      updatedAudits,
      "WORK_ACCEPTANCE_UPDATED"
    ) === 1,
    "Patch should create exactly one updated audit."
  );

  const updatedAudit =
    updatedAudits.find(
      entry =>
        entry.action ===
        "WORK_ACCEPTANCE_UPDATED"
    );

  assert(
    updatedAudit,
    "Updated audit entry missing."
  );

  assertSafetyBoundary(
    updatedAudit,
    "Updated audit"
  );

  console.log(
    "PASS: update audit"
  );

  const integrity =
    verifyAuditIntegrity();

  assert(
    integrity.ok === true,
    "Audit integrity must remain valid."
  );

  assert(
    integrity.integrityFailures === 0,
    "Audit integrity failures detected."
  );

  assert(
    integrity.chainFailures === 0,
    "Audit chain failures detected."
  );

  assert(
    integrity.tamperDetected === false,
    "Audit tampering detected."
  );

  console.log(
    "PASS: audit integrity after route integration"
  );

  console.log(
    "\nSTAGE9_1_7_WORK_ACCEPTANCE_AUDIT_INTEGRATION_TEST: PASS"
  );
} finally {
  cleanup();
}
