"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createConsentStore
} = require("../services/mira-client-consent-store");

const {
  createConsentService
} = require("../services/mira-client-consent-service");

const {
  runMarketingWorkflow,
  validateWorkflowInput
} = require("../services/mira-marketing-workflow-orchestrator");

const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-marketing-workflow-test-")
);

const store = createConsentStore({
  filePath: path.join(temp, "client-consents.json")
});

let auditLogCalls = 0;
let marketingAuditCalls = 0;
let researchRunnerCalls = 0;
let executeWorkCalls = 0;

const consentService = createConsentService({
  store,
  recordAudit() {
    auditLogCalls += 1;
  },
  verifyAuditIntegrity() {
    return { ok: true };
  }
});

const actor = {
  role: "admin",
  username: "stage3-test-admin",
  userId: "stage3-admin-001"
};

const trustedContext = {
  permissionGranted: true,
  actor
};

const brief = {
  clientId: "stage3-client-001",
  clientName: "Stage 3 Demo Client",
  websiteUrl: "https://example.com/",
  industry: "Software",
  businessType: "B2B SaaS",
  targetMarket: {
    countryCode: "US",
    countryName: "United States"
  },
  targetLanguage: "en-US",
  primaryGoals: ["Improve organic visibility"],
  keywords: ["SEO automation"]
};

const input = {
  brief,
  query: "SEO automation competitor research",
  auditInput: {
    html: "<html><head><title>Demo</title></head><body>SEO</body></html>"
  }
};

function grant(scope) {
  const result = consentService.grant({
    clientId: brief.clientId,
    scope,
    consentEvidenceRef: `stage3-test-${scope}`,
    consentReceivedAt: "2026-10-31T10:00:00.000Z",
    actor
  });

  assert.equal(result.success, true, `grant failed: ${scope}`);
}

function revoke(scope) {
  const result = consentService.revoke({
    clientId: brief.clientId,
    scope,
    actor
  });

  assert.equal(result.success, true, `revoke failed: ${scope}`);
}

const marketingAuditMock = ({ brief: auditBrief }) => {
  marketingAuditCalls += 1;

  assert.equal(
    auditBrief.clientAuthorization.status,
    "authorized"
  );

  assert.deepEqual(
    auditBrief.clientAuthorization.scopes,
    ["seo_audit"]
  );

  return {
    success: true,
    report: {
      evidenceMode: "isolated-test"
    }
  };
};

const executeWorkMock = async (_description, options) => {
  executeWorkCalls += 1;

  assert.equal(options.permissionGranted, true);
  assert.equal(options.persist, false);
  assert.equal(options.toolCalls[0].name, "web_search");

  return {
    success: true,
    status: "execution_completed",
    executionStarted: true,
    results: [{
      tool: "web_search",
      result: JSON.stringify([{
        title: "Mock SEO Source",
        link: "https://example.com/research",
        snippet: "Isolated test evidence."
      }]),
      verification: { passed: true }
    }]
  };
};

async function main() {
  try {
    assert.throws(
      () => validateWorkflowInput({
        ...input,
        permissionGranted: true
      }),
      /MARKETING_WORKFLOW_FIELD_NOT_ALLOWED/
    );

    assert.throws(
      () => validateWorkflowInput({
        ...input,
        brief: {
          ...brief,
          clientAuthorization: {
            status: "authorized",
            scopes: ["seo_audit", "public_web_research"]
          }
        }
      }),
      /MARKETING_WORKFLOW_CLIENT_AUTHORIZATION_NOT_ALLOWED/
    );

    console.log("PASS: request-controlled permission rejected");
    console.log("PASS: request-controlled client authorization rejected");

    const noAdmin = await runMarketingWorkflow(
      input,
      {},
      { consentService }
    );

    assert.equal(noAdmin.success, false);
    assert.equal(
      noAdmin.reason,
      "TRUSTED_NAMED_ADMIN_PERMISSION_REQUIRED"
    );

    console.log("PASS: trusted Admin context required");

    grant("seo_audit");

    const missingResearchConsent = await runMarketingWorkflow(
      input,
      trustedContext,
      {
        consentService,
        runMarketingAudit: marketingAuditMock,
        executeWork: executeWorkMock
      }
    );

    assert.equal(missingResearchConsent.success, false);
    assert.equal(
      missingResearchConsent.reason,
      "CLIENT_PUBLIC_WEB_RESEARCH_CONSENT_REQUIRED"
    );
    assert.equal(marketingAuditCalls, 0);
    assert.equal(executeWorkCalls, 0);

    console.log("PASS: missing research consent blocks the full workflow");

    grant("public_web_research");

    const result = await runMarketingWorkflow(
      input,
      trustedContext,
      {
        consentService,
        runMarketingAudit: marketingAuditMock,
        executeWork: executeWorkMock
      }
    );

    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(
      result.status,
      "MARKETING_WORKFLOW_READY_FOR_REVIEW"
    );
    assert.equal(result.audit.success, true);
    assert.equal(result.research.success, true);
    assert.equal(result.reviewRequired, true);
    assert.equal(marketingAuditCalls, 1);
    assert.equal(executeWorkCalls, 1);

    console.log("PASS: persisted consent enables combined workflow");
    console.log("PASS: SEO audit receives internally generated authorization");
    console.log("PASS: SEO research uses governed execution");
    console.log("PASS: combined report requires human review");

    revoke("public_web_research");

    const afterResearchRevoke = await runMarketingWorkflow(
      input,
      trustedContext,
      {
        consentService,
        runMarketingAudit: marketingAuditMock,
        executeWork: executeWorkMock
      }
    );

    assert.equal(afterResearchRevoke.success, false);
    assert.equal(
      afterResearchRevoke.reason,
      "CLIENT_PUBLIC_WEB_RESEARCH_CONSENT_REQUIRED"
    );
    assert.equal(marketingAuditCalls, 1);
    assert.equal(executeWorkCalls, 1);

    console.log("PASS: revoked research consent blocks workflow before audit");

    revoke("seo_audit");

    const afterAuditRevoke = await runMarketingWorkflow(
      input,
      trustedContext,
      {
        consentService,
        runMarketingAudit: marketingAuditMock,
        executeWork: executeWorkMock
      }
    );

    assert.equal(afterAuditRevoke.success, false);
    assert.equal(
      afterAuditRevoke.reason,
      "CLIENT_SEO_AUDIT_CONSENT_REQUIRED"
    );
    assert.equal(marketingAuditCalls, 1);
    assert.equal(executeWorkCalls, 1);

    console.log("PASS: revoked SEO audit consent blocks workflow");

    assert.ok(auditLogCalls >= 8);

    console.log(`CONSENT_AUDIT_MOCK_CALLS=${auditLogCalls}`);
    console.log(`MARKETING_AUDIT_MOCK_CALLS=${marketingAuditCalls}`);
    console.log(`GOVERNED_EXECUTION_MOCK_CALLS=${executeWorkCalls}`);
    console.log("REAL_TOOL_EXECUTION=NO");
    console.log("NETWORK_CALLS=0");
    console.log("EXTERNAL_ACTIONS=0");
    console.log("MIRA_MARKETING_WORKFLOW_STAGE3=PASS");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error("MIRA_MARKETING_WORKFLOW_STAGE3=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
