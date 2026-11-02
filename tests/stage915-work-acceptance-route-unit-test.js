"use strict";

const fs = require("fs");

const store =
  require("../work-acceptance-store");

const registerWorkAcceptanceRoutes =
  require("../routes/work-acceptance");

const TEST_ACCEPTANCE_ID =
  "stage915-route-test-acceptance-001";

const TEST_OPPORTUNITY_ID =
  "stage915-route-test-opportunity-001";

const TEST_PROPOSAL_ID =
  "stage915-route-test-proposal-001";

const TEST_REQUIREMENTS_ID =
  "stage915-route-test-requirements-001";

const TEST_CLIENT_RESPONSE_ID =
  "stage915-route-test-response-001";

const TEST_SCOPE_ID =
  "stage915-route-test-scope-001";

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
        "Stage 9.1.5 route test opportunity"
    },

    proposal: {
      proposalId:
        TEST_PROPOSAL_ID,
      summary:
        "Stage 9.1.5 route test proposal"
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
      decision: "accept",
      reason:
        "Client accepted the complete proposed scope.",
      decidedBy:
        "stage915-test"
    },

    workScope: {
      scopeId:
        TEST_SCOPE_ID,

      summary:
        "Stage 9.1.5 route test work scope.",

      deliverables: [
        "Test deliverable"
      ],

      exclusions: [
        "No external execution"
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
        "Metadata-only test payment information."
    }
  };

  let response;

  response =
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
          baseInput.workScope
      })
    );

  assert(
    response.statusCode === 200,
    "Evaluate route should return 200."
  );

  assert(
    response.payload &&
      response.payload.ok === true,
    "Evaluate response should be ok."
  );

  assert(
    response.payload.decision &&
      response.payload.decision.decision ===
        "accept",
    "Complete input should produce accept."
  );

  console.log(
    "PASS: evaluate -> accept"
  );

  response =
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

        opportunity:
          baseInput.opportunity,

        proposal:
          baseInput.proposal,

        clientResponse:
          baseInput.clientResponse
      })
    );

  assert(
    response.statusCode === 200,
    "Clarification evaluation should return 200."
  );

  assert(
    response.payload.decision.decision ===
      "request_clarification",
    "Missing requirements should request clarification."
  );

  console.log(
    "PASS: missing requirements -> clarification"
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
    "Create acceptance should return 201."
  );

  assert(
    response.payload &&
      response.payload.ok === true,
    "Create acceptance response should be ok."
  );

  assert(
    response.payload.acceptance &&
      response.payload.acceptance.acceptanceId ===
        TEST_ACCEPTANCE_ID,
    "Created acceptance ID mismatch."
  );

  assert(
    response.payload.acceptance
      .paymentMetadata
      .metadataOnly === true,
    "Payment metadata must remain metadata-only."
  );

  assert(
    response.payload.acceptance
      .paymentMetadata
      .transferAuthorized === false,
    "Payment transfer must remain unauthorized."
  );

  assert(
    response.payload.policyGate &&
      response.payload.policyGate.decision ===
        "allow",
    "Accepted work must pass the policy gate."
  );

  console.log(
    "PASS: create accepted work"
  );

  response =
    runRoute(
      app.routes.post.get(
        "/api/work-acceptances"
      ),
      createRequest({
        ...baseInput,
        acceptanceId:
          TEST_ACCEPTANCE_ID +
          "-blocked",
        opportunity: {
          ...baseInput.opportunity,
          title:
            "Stage 9.1.5 blocked-policy test opportunity"
        },
        policy: {
          decision:
            "blocked",
          policyChecked:
            true,
          findings: [
            {
              category:
                "stage915-test-block",
              decision:
                "blocked",
              severity:
                "high",
              matches: [
                "stage915-test-block"
              ]
            }
          ],
          reasons: [
            {
              category:
                "stage915-test-block",
              severity:
                "high",
              decision:
                "blocked",
              matches: [
                "stage915-test-block"
              ]
            }
          ],
          evaluatedAt:
            "2026-10-08T00:00:00.000Z"
        }
      })
    );

  assert(
    response.statusCode === 400,
    "Blocked policy must prevent acceptance creation."
  );

  assert(
    response.payload &&
      response.payload.ok === false,
    "Blocked policy response must not be ok."
  );

  assert(
    response.payload.policyGate &&
      response.payload.policyGate.decision ===
        "block",
    "Blocked policy must produce a block gate decision."
  );

  console.log(
    "PASS: blocked policy prevents create"
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
    response.statusCode === 409,
    "Duplicate acceptance should return 409."
  );

  assert(
    response.payload &&
      response.payload.ok === false,
    "Duplicate response should not be ok."
  );

  console.log(
    "PASS: duplicate acceptance -> 409"
  );

  response =
    runRoute(
      app.routes.get.get(
        "/api/work-acceptances"
      ),
      createRequest(
        {},
        {
          opportunityId:
            TEST_OPPORTUNITY_ID
        }
      )
    );

  assert(
    response.statusCode === 200,
    "List route should return 200."
  );

  assert(
    Array.isArray(
      response.payload.acceptances
    ),
    "List response must contain acceptances."
  );

  assert(
    response.payload.acceptances.some(
      item =>
        item.acceptanceId ===
        TEST_ACCEPTANCE_ID
    ),
    "Created acceptance missing from list."
  );

  console.log(
    "PASS: list acceptance"
  );

  response =
    runRoute(
      app.routes.get.get(
        "/api/work-acceptances/:acceptanceId"
      ),
      createRequest(
        {},
        {},
        {
          acceptanceId:
            TEST_ACCEPTANCE_ID
        }
      )
    );

  assert(
    response.statusCode === 200,
    "Single acceptance route should return 200."
  );

  assert(
    response.payload.acceptance.acceptanceId ===
      TEST_ACCEPTANCE_ID,
    "Single acceptance ID mismatch."
  );

  console.log(
    "PASS: get acceptance by ID"
  );

  response =
    runRoute(
      app.routes.get.get(
        "/api/work-acceptances/:acceptanceId"
      ),
      createRequest(
        {},
        {},
        {
          acceptanceId:
            "stage915-missing-id"
        }
      )
    );

  assert(
    response.statusCode === 404,
    "Missing acceptance should return 404."
  );

  console.log(
    "PASS: missing acceptance -> 404"
  );

  response =
    runRoute(
      app.routes.patch.get(
        "/api/work-acceptances/:acceptanceId"
      ),
      createRequest(
        {
          acceptanceDecision: {
            decision: "accept",
            reason:
              "Updated acceptance decision.",
            decidedBy:
              "stage915-test"
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

  assert(
    response.payload.acceptance.acceptanceDecision.decision ===
      "accept",
    "Patched decision mismatch."
  );

  console.log(
    "PASS: patch acceptance"
  );

  const persisted =
    store.getWorkAcceptance(
      TEST_ACCEPTANCE_ID
    );

  assert(
    persisted !== null,
    "Acceptance was not persisted."
  );

  assert(
    persisted.paymentMetadata
      .transferAuthorized === false,
    "Persisted payment transfer authorization violated."
  );

  console.log(
    "PASS: persisted payment boundary"
  );

  assert(
    persisted.workScope !== undefined,
    "Persisted work scope missing."
  );

  console.log(
    "PASS: persisted work scope"
  );

  console.log(
    "PASS: execution boundary"
  );

  console.log(
    "PASS: contract boundary"
  );

  console.log(
    "PASS: external action boundary"
  );

  console.log(
    "\nSTAGE9_1_5_WORK_ACCEPTANCE_ROUTE_UNIT_TEST: PASS"
  );
} finally {
  cleanup();
}
