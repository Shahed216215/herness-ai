"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const tool = require("../tools/marketing-client-context");
const { getToolPolicy } =
  require("../services/mira-work-execution-engine");

async function main() {
  let lookupCalls = 0;

  const profile = {
    id: "client-test-001",
    name: "Example Client",
    requirements: [
      {
        type: "marketing_profile",
        websiteUrl: "",
        industry: "AI Automation",
        businessType: "Agency",
        targetMarket: {
          countryCode: "US",
          countryName: "United States"
        },
        targetLanguage: "en-US",
        goals: ["Increase organic traffic"],
        keywords: ["AI automation agency"]
      }
    ]
  };

  const consentService = {
    lookup(clientId, scope) {
      lookupCalls++;
      assert.equal(clientId, "client-test-001");
      return {
        authorized: scope === "seo_audit",
        event: null
      };
    }
  };

  const execute = tool.createMarketingClientContextExecutor({
    getClientProfile(id) {
      assert.equal(id, "client-test-001");
      return profile;
    },
    consentService
  });

  const result = JSON.parse(await execute({
    clientId: "client-test-001"
  }));

  assert.equal(result.success, true);
  assert.equal(result.status, "MISSING_PROFILE_FIELDS");
  assert.deepEqual(result.missingProfileFields, ["websiteUrl"]);
  assert.deepEqual(result.consents, {
    seo_audit: true,
    public_web_research: false
  });
  assert.deepEqual(result.missingConsents, ["public_web_research"]);
  assert.equal(result.liveResearchStarted, false);
  assert.equal(result.profileModified, false);
  assert.equal(result.consentModified, false);
  assert.equal(lookupCalls, 2);
  console.log("PASS: client profile and consent are read-only");

  const missing = tool.createMarketingClientContextExecutor({
    getClientProfile: () => null,
    consentService
  });

  const notFound = JSON.parse(await missing({
    clientId: "unknown-client"
  }));

  assert.equal(notFound.status, "NOT_FOUND");
  console.log("PASS: unknown client fails closed");

  const invalid = JSON.parse(await execute({
    clientId: "client-test-001",
    permissionGranted: true
  }));

  assert.equal(invalid.status, "INVALID_INPUT");
  assert.equal(invalid.reason, "CLIENT_CONTEXT_FIELD_NOT_ALLOWED");
  console.log("PASS: injected permission fields rejected");

  const noId = JSON.parse(await execute({}));
  assert.equal(noId.reason, "CLIENT_ID_REQUIRED");
  console.log("PASS: missing client ID rejected");

  const policy = getToolPolicy("marketing_client_context");
  assert.ok(policy);
  assert.equal(policy.operation, "inspect");
  assert.equal(policy.autonomous, true);
  assert.equal(policy.humanApprovalRequired, false);
  assert.equal(policy.explicitConfirmation, false);
  console.log("PASS: tool has inspect-only execution policy");

  const serverSource = fs.readFileSync(
    require.resolve("../server"),
    "utf8"
  );

  assert.ok(serverSource.includes(
    'toolName !== "marketing_client_context"'
  ));
  assert.ok(serverSource.includes(
    'req.session.username.trim().length > 0'
  ));
  assert.ok(serverSource.includes(
    'NAMED_ADMIN_BROWSER_SESSION_REQUIRED'
  ));
  console.log("PASS: General Agent enforces named Admin browser session");

  console.log("RESULT=PASS");
}

main().catch(error => {
  console.error("RESULT=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
