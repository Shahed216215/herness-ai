"use strict";
const assert = require("node:assert/strict");
const {
  runMarketingWorkflow,
  validateWorkflowInput
} = require("../services/mira-marketing-workflow-orchestrator");
const { validateRequestBody } = require("../routes/mira-marketing-workflow");

const brief = {
  clientId: "test-client",
  clientName: "Test Client",
  websiteUrl: "https://example.test/",
  industry: "Software",
  businessType: "SaaS",
  targetMarket: { countryCode: "BD", countryName: "Bangladesh" },
  targetLanguage: "bn-BD",
  primaryGoals: [],
  keywords: []
};
const request = {
  brief,
  query: "primary query",
  competitorQueries: ["extra query"],
  confirmedCompetitorDomains: ["example.org"]
};

async function main() {
  const result = validateWorkflowInput(request, { getClientProfile: () => null });
  assert.deepEqual(result.competitorQueries, ["extra query"]);
  assert.deepEqual(result.confirmedCompetitorDomains, ["example.org"]);

  const routeInput = validateRequestBody({
    ...request,
    confirmLiveResearch: true
  });
  assert.deepEqual(routeInput.competitorQueries, ["extra query"]);
  assert.deepEqual(routeInput.confirmedCompetitorDomains, ["example.org"]);

  assert.throws(() => validateWorkflowInput({
    ...request,
    competitorQueries: new Array(6).fill("x")
  }, { getClientProfile: () => null }), /COMPETITOR_QUERIES_INVALID/);

  let forwarded = null;
  const response = await runMarketingWorkflow(request, {
    permissionGranted: true,
    actor: { role: "admin", username: "test-admin" }
  }, {
    getClientProfile: () => null,
    consentService: {
      lookup: () => ({ authorized: true })
    },
    runMarketingAudit: () => ({ success: true }),
    runSeoResearch: async input => {
      forwarded = input;
      return { success: false, status: "INCONCLUSIVE" };
    }
  });
  assert.equal(response.status, "PARTIAL");
  assert.deepEqual(forwarded.competitorQueries, ["extra query"]);
  assert.deepEqual(forwarded.confirmedCompetitorDomains, ["example.org"]);
  console.log("MARKETING_WORKFLOW_COMPETITOR_VALIDATION=PASS");
  console.log("MARKETING_WORKFLOW_COMPETITOR_ROUTE_FORWARDING=PASS");
  console.log("MARKETING_WORKFLOW_COMPETITOR_ORCHESTRATOR_FORWARDING=PASS");
  console.log("MARKETING_WORKFLOW_COMPETITOR_INPUT_TEST_STATUS=PASS");
}
main().catch(error => {
  console.error("MARKETING_WORKFLOW_COMPETITOR_INPUT_TEST_STATUS=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
