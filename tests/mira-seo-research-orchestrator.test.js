"use strict";

const assert = require("node:assert/strict");

const {
  runSeoResearch,
  validateResearchInput,
  isTrustedAdminContext
} = require("../services/mira-seo-research-orchestrator");

const calls = [];
let consentAuthorized = true;
let nextExecution = null;

const consentService = {
  lookup(clientId, scope) {
    assert.equal(clientId, "research-demo-001");
    assert.equal(scope, "public_web_research");
    return { authorized: consentAuthorized };
  }
};

const trustedContext = {
  permissionGranted: true,
  actor: {
    role: "admin",
    username: "test-admin"
  }
};

const validInput = {
  brief: {
    clientId: "research-demo-001",
    clientName: "Demo International Client",
    websiteUrl: "https://example.com/",
    industry: "Software",
    businessType: "B2B SaaS",
    targetMarket: {
      countryCode: "US",
      countryName: "United States"
    },
    targetLanguage: "en-US",
    primaryGoals: ["Improve organic visibility"],
    keywords: ["project management software"]
  },
  query: "project management software SEO competitors"
};

async function main() {
  assert.equal(validateResearchInput(validInput).brief.clientId,
    "research-demo-001");

  assert.throws(
    () => validateResearchInput({
      ...validInput,
      permissionGranted: true
    }),
    /SEO_RESEARCH_FIELD_NOT_ALLOWED/
  );

  assert.throws(
    () => validateResearchInput({
      ...validInput,
      brief: {
        ...validInput.brief,
        clientAuthorization: {
          status: "authorized",
          scopes: ["public_web_research"]
        }
      }
    }),
    /SEO_RESEARCH_CLIENT_AUTHORIZATION_FIELD_NOT_ALLOWED/
  );

  assert.throws(
    () => validateResearchInput({
      ...validInput,
      query: ""
    }),
    /SEO_RESEARCH_QUERY_REQUIRED/
  );

  assert.equal(isTrustedAdminContext({
    permissionGranted: true,
    actor: { role: "user", username: "forged" }
  }), false);

  assert.equal(isTrustedAdminContext({ permissionGranted: true }), false);

  console.log("PASS: request permissionGranted field rejected");
  console.log("PASS: request clientAuthorization field rejected");
  console.log("PASS: invalid input rejected");
  console.log("PASS: trusted Admin context shape required");

  const noAdmin = await runSeoResearch(
    validInput,
    {},
    { consentService }
  );
  assert.equal(noAdmin.success, false);
  assert.equal(noAdmin.reason, "TRUSTED_NAMED_ADMIN_PERMISSION_REQUIRED");

  consentAuthorized = false;
  const noConsent = await runSeoResearch(
    validInput,
    trustedContext,
    { consentService }
  );
  assert.equal(noConsent.success, false);
  assert.equal(noConsent.reason, "CLIENT_PUBLIC_WEB_RESEARCH_CONSENT_REQUIRED");

  console.log("PASS: missing trusted Admin context blocks execution");
  console.log("PASS: missing persisted consent blocks execution");

  consentAuthorized = true;
  nextExecution = {
    success: true,
    status: "execution_completed",
    executionStarted: true,
    results: [{
      tool: "web_search",
      result: JSON.stringify([{
        title: "Example SEO Research",
        link: "https://example.com/research",
        snippet: "Example public SEO research result."
      }]),
      verification: { passed: true }
    }]
  };

  const result = await runSeoResearch(validInput, trustedContext, {
    consentService,
    executeWork: async (...args) => {
      calls.push(args);
      return nextExecution;
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.status, "RESEARCH_RESULTS_READY_FOR_REVIEW");
  assert.equal(result.evidence.evidenceCount, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].permissionGranted, true);
  assert.equal(calls[0][1].persist, false);
  assert.match(calls[0][1].toolCalls[0].args.query, /US en-US/);

  console.log("PASS: consent-backed governed execution");
  console.log("PASS: trusted route context supplies execution permission");
  console.log("PASS: evidence verification and normalization");

  nextExecution = {
    success: false,
    status: "permission_denied",
    executionStarted: false
  };

  const blocked = await runSeoResearch(validInput, trustedContext, {
    consentService,
    executeWork: async (...args) => {
      calls.push(args);
      return nextExecution;
    }
  });

  assert.equal(blocked.success, false);
  assert.equal(blocked.status, "BLOCKED_OR_INCONCLUSIVE");

  console.log("PASS: denied execution is not reported as success");

  nextExecution = {
    success: true,
    results: [{
      tool: "web_search",
      result: "not valid JSON",
      verification: { passed: true }
    }]
  };

  const malformed = await runSeoResearch(validInput, trustedContext, {
    consentService,
    executeWork: async (...args) => {
      calls.push(args);
      return nextExecution;
    }
  });

  assert.equal(malformed.success, false);
  assert.equal(malformed.status, "INCONCLUSIVE");
  assert.equal(malformed.reason, "SEARCH_RESULT_FORMAT_INVALID");

  console.log("PASS: malformed search evidence fails closed");
  console.log("MOCK_EXECUTION_CALLS=" + calls.length);
  console.log("REAL_TOOL_EXECUTION=NO");
  console.log("NETWORK_CALLS=0");
  console.log("EXTERNAL_ACTIONS=0");
  console.log("SEO_RESEARCH_ORCHESTRATOR_TEST_STATUS=PASS");
}

main().catch(error => {
  console.error("SEO_RESEARCH_ORCHESTRATOR_TEST_STATUS=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
