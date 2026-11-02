"use strict";

const assert = require("node:assert/strict");
const registerRoutes = require("../routes/mira-seo-research");

async function main() {
  const mounts = [];
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

  registerRoutes(app, permissionFactory, {
    SYSTEM_ADMIN: "SYSTEM_ADMIN"
  }, {
    runSeoResearch: async (input, context) => ({
      success: true,
      receivedInput: input,
      receivedContext: context
    })
  });

  assert.equal(mounts.length, 1);
  assert.equal(mounts[0][0], "/api/admin/mira-seo-research");
  assert.equal(typeof mounts[0][1], "function");

  const router = mounts[0][2];
  const layer = router.stack.find(item =>
    item.route && item.route.path === "/run"
  );

  assert.ok(layer, "POST /run route must be registered");
  assert.equal(layer.route.methods.post, true);

  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const oldFlag = process.env.MIRA_SEO_RESEARCH_LIVE_ENABLED;

  const response = () => ({
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
  });

  try {
    delete process.env.MIRA_SEO_RESEARCH_LIVE_ENABLED;

    const disabledRes = response();
    await handler({
      session: {
        authenticated: true,
        role: "admin",
        username: "test-admin"
      },
      role: "admin",
      body: {
        confirmLiveResearch: true,
        brief: {},
        query: "test"
      }
    }, disabledRes);

    assert.equal(disabledRes.statusCode, 403);
    assert.equal(
      disabledRes.body.reason,
      "LIVE_SEO_RESEARCH_FEATURE_DISABLED"
    );

    process.env.MIRA_SEO_RESEARCH_LIVE_ENABLED = "true";

    const noConfirmRes = response();
    await handler({
      session: {
        authenticated: true,
        role: "admin",
        username: "test-admin"
      },
      role: "admin",
      body: {
        brief: {},
        query: "test"
      }
    }, noConfirmRes);

    assert.equal(noConfirmRes.statusCode, 400);
    assert.equal(
      noConfirmRes.body.reason,
      "EXPLICIT_LIVE_RESEARCH_CONFIRMATION_REQUIRED"
    );

    const noSessionRes = response();
    await handler({
      session: null,
      role: "admin",
      body: { confirmLiveResearch: true }
    }, noSessionRes);

    assert.equal(noSessionRes.statusCode, 403);
    assert.equal(
      noSessionRes.body.reason,
      "NAMED_ADMIN_BROWSER_SESSION_REQUIRED"
    );

    console.log("PASS: Admin middleware route mount");
    console.log("PASS: live feature flag defaults to disabled");
    console.log("PASS: explicit per-request confirmation required");
    console.log("PASS: named browser Admin session required");
    console.log("NETWORK_CALLS=0");
    console.log("SEO_RESEARCH_ROUTE_ISOLATED_TEST_STATUS=PASS");
  } finally {
    if (oldFlag === undefined) {
      delete process.env.MIRA_SEO_RESEARCH_LIVE_ENABLED;
    } else {
      process.env.MIRA_SEO_RESEARCH_LIVE_ENABLED = oldFlag;
    }
  }
}

main().catch(error => {
  console.error("SEO_RESEARCH_ROUTE_ISOLATED_TEST_STATUS=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
