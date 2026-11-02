"use strict";

const assert = require("node:assert/strict");

const registerRoutes = require(
  "../routes/mira-marketing-workflow"
);

async function main() {
  const mounts = [];
  const calls = [];

  const app = {
    use(...args) {
      mounts.push(args);
    }
  };

  const permissionFactory = permission => {
    assert.equal(permission, "SYSTEM_ADMIN");

    return function adminMiddleware(req, res, next) {
      req.role = "admin";
      next();
    };
  };

  registerRoutes(
    app,
    permissionFactory,
    { SYSTEM_ADMIN: "SYSTEM_ADMIN" },
    {
      runMarketingWorkflow: async (input, context) => {
        calls.push({ input, context });

        return {
          success: true,
          status: "MARKETING_WORKFLOW_READY_FOR_REVIEW",
          reviewRequired: true
        };
      }
    }
  );

  assert.equal(mounts.length, 1);
  assert.equal(
    mounts[0][0],
    "/api/admin/mira-marketing-workflow"
  );

  const router = mounts[0][2];

  const layer = router.stack.find(item =>
    item.route &&
    item.route.path === "/run" &&
    item.route.methods.post
  );

  assert.ok(layer, "POST /run route must exist");

  const handler =
    layer.route.stack[layer.route.stack.length - 1].handle;

  const oldFlag =
    process.env.MIRA_SEO_RESEARCH_LIVE_ENABLED;

  function response() {
    return {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(value) {
        this.body = value;
        return this;
      }
    };
  }

  const session = {
    authenticated: true,
    role: "admin",
    username: "stage4-test-admin",
    userId: "stage4-admin-001"
  };

  const inputBody = {
    brief: {
      clientId: "stage4-test-client"
    },
    query: "SEO market research",
    auditInput: {},
    confirmLiveResearch: true
  };

  try {
    delete process.env.MIRA_SEO_RESEARCH_LIVE_ENABLED;

    const disabled = response();

    await handler({
      session,
      role: "admin",
      body: inputBody
    }, disabled);

    assert.equal(disabled.statusCode, 403);
    assert.equal(
      disabled.body.reason,
      "LIVE_SEO_RESEARCH_FEATURE_DISABLED"
    );
    assert.equal(calls.length, 0);

    console.log("PASS: live feature flag disabled by default");

    process.env.MIRA_SEO_RESEARCH_LIVE_ENABLED = "true";

    const noSession = response();

    await handler({
      session: null,
      role: "admin",
      body: inputBody
    }, noSession);

    assert.equal(noSession.statusCode, 403);
    assert.equal(
      noSession.body.reason,
      "NAMED_ADMIN_BROWSER_SESSION_REQUIRED"
    );
    assert.equal(calls.length, 0);

    console.log("PASS: named Admin browser session required");

    const injectedPermission = response();

    await handler({
      session,
      role: "admin",
      body: {
        ...inputBody,
        permissionGranted: true
      }
    }, injectedPermission);

    assert.equal(injectedPermission.statusCode, 400);
    assert.equal(calls.length, 0);

    console.log("PASS: request-controlled permission rejected");

    const injectedAuthorization = response();

    await handler({
      session,
      role: "admin",
      body: {
        ...inputBody,
        clientAuthorization: {
          status: "authorized",
          scopes: ["seo_audit"]
        }
      }
    }, injectedAuthorization);

    assert.equal(injectedAuthorization.statusCode, 400);
    assert.equal(calls.length, 0);

    console.log("PASS: request-controlled client authorization rejected");

    const noConfirmation = response();

    await handler({
      session,
      role: "admin",
      body: {
        brief: inputBody.brief,
        query: inputBody.query
      }
    }, noConfirmation);

    assert.equal(noConfirmation.statusCode, 400);
    assert.equal(
      noConfirmation.body.reason,
      "EXPLICIT_LIVE_RESEARCH_CONFIRMATION_REQUIRED"
    );
    assert.equal(calls.length, 0);

    console.log("PASS: explicit live confirmation required");

    const success = response();

    await handler({
      session,
      role: "admin",
      body: inputBody
    }, success);

    assert.equal(success.statusCode, 200);
    assert.equal(success.body.success, true);
    assert.equal(calls.length, 1);

    assert.equal(
      Object.hasOwn(calls[0].input, "confirmLiveResearch"),
      false
    );

    assert.equal(
      calls[0].context.permissionGranted,
      true
    );

    assert.equal(
      calls[0].context.actor.username,
      "stage4-test-admin"
    );

    console.log("PASS: workflow receives sanitized input");
    console.log("PASS: trusted route context supplied internally");
    console.log("PASS: successful workflow response");

    const invalidBody = response();

    await handler({
      session,
      role: "admin",
      body: []
    }, invalidBody);

    assert.equal(invalidBody.statusCode, 400);
    assert.equal(calls.length, 1);

    console.log("PASS: invalid request body rejected");

    console.log("WORKFLOW_MOCK_CALLS=" + calls.length);
    console.log("REAL_WORKFLOW_EXECUTION=NO");
    console.log("NETWORK_CALLS=0");
    console.log("LIVE_API_CALLS=0");
    console.log("EXTERNAL_ACTIONS=0");
    console.log("MARKETING_WORKFLOW_ROUTE_TEST_STATUS=PASS");
  } finally {
    if (oldFlag === undefined) {
      delete process.env.MIRA_SEO_RESEARCH_LIVE_ENABLED;
    } else {
      process.env.MIRA_SEO_RESEARCH_LIVE_ENABLED = oldFlag;
    }
  }
}

main().catch(error => {
  console.error("MARKETING_WORKFLOW_ROUTE_TEST_STATUS=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
