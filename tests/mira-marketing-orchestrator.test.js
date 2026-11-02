"use strict";

const assert = require("node:assert/strict");

const {
  validateMarketingBrief,
  assertSeoAuditAuthorized
} = require("../services/mira-marketing-brief-schema");

const {
  runMarketingAudit
} = require("../services/mira-marketing-orchestrator");

const validBrief = {
  clientId: "demo-client-001",
  clientName: "Demo International Client",
  websiteUrl: "https://example.com/",
  industry: "Software",
  businessType: "B2B SaaS",
  targetMarket: {
    countryCode: "US",
    countryName: "United States"
  },
  targetLanguage: "en-US",
  primaryGoals: [
    "Improve organic visibility",
    "Identify on-page SEO issues"
  ],
  keywords: [
    "project management software",
    "project management tools"
  ],
  clientAuthorization: {
    status: "authorized",
    scopes: ["seo_audit"]
  }
};

function main() {
  const brief = validateMarketingBrief(validBrief);

  assert.equal(brief.targetMarket.countryCode, "US");
  assert.equal(brief.targetLanguage, "en-US");
  assert.equal(brief.clientAuthorization.status, "authorized");

  assert.throws(
    () => validateMarketingBrief({
      ...validBrief,
      targetMarket: { countryCode: "XX" }
    }),
    /TARGET_COUNTRY_NOT_SUPPORTED/
  );

  assert.throws(
    () => validateMarketingBrief({
      ...validBrief,
      targetLanguage: "fr-FR"
    }),
    /TARGET_LANGUAGE_NOT_SUPPORTED/
  );

  assert.throws(
    () => validateMarketingBrief({
      ...validBrief,
      unexpectedSecret: "must-not-be-accepted"
    }),
    /MARKETING_BRIEF_FIELD_NOT_ALLOWED/
  );

  assert.throws(
    () => validateMarketingBrief({
      ...validBrief,
      websiteUrl: "javascript:alert(1)"
    }),
    /WEBSITE_URL_INVALID/
  );

  assert.throws(
    () => assertSeoAuditAuthorized({
      ...validBrief,
      clientAuthorization: {
        status: "pending",
        scopes: ["seo_audit"]
      }
    }),
    /CLIENT_SEO_AUDIT_AUTHORIZATION_REQUIRED/
  );

  assert.throws(
    () => assertSeoAuditAuthorized({
      ...validBrief,
      clientAuthorization: {
        status: "authorized",
        scopes: []
      }
    }),
    /CLIENT_SEO_AUDIT_AUTHORIZATION_REQUIRED/
  );

  const result = runMarketingAudit({
    brief: validBrief,
    auditInput: {
      html: [
        "<html><head>",
        "<title>Project Management Software Guide</title>",
        '<meta name="description" content="A practical guide to project management software and tools for modern teams.">',
        '<link rel="canonical" href="https://example.com/">',
        "</head><body>",
        "<h1>Project Management Software</h1>",
        '<img src="example.jpg" alt="Project management dashboard">',
        "<p>Compare project management software for teams.</p>",
        "</body></html>"
      ].join(""),
      robotsTxt: "User-agent: *\nAllow: /",
      sitemapXml:
        "<urlset><url><loc>https://example.com/</loc></url></urlset>"
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.workflow, "offline_seo_research_and_audit");
  assert.equal(result.market.countryCode, "US");
  assert.equal(result.market.language, "en-US");
  assert.equal(result.report.audit.networkAccess, false);
  assert.equal(result.report.audit.keywordAnalysis.length, 2);
  assert.equal(result.executionBoundary.networkAccess, false);
  assert.equal(result.executionBoundary.websiteModified, false);
  assert.equal(result.executionBoundary.contentPublished, false);
  assert.equal(result.executionBoundary.clientMessageSent, false);
  assert.equal(result.executionBoundary.dataPersisted, false);

  assert.throws(
    () => runMarketingAudit({
      brief: {
        ...validBrief,
        clientAuthorization: {
          status: "pending",
          scopes: ["seo_audit"]
        }
      }
    }),
    /CLIENT_SEO_AUDIT_AUTHORIZATION_REQUIRED/
  );

  assert.throws(
    () => runMarketingAudit({
      brief: validBrief,
      auditInput: { keywords: "not-an-array" }
    }),
    /keywords/
  );

  console.log("PASS: marketing brief validation");
  console.log("PASS: target country and language restrictions");
  console.log("PASS: unexpected and unsafe input rejection");
  console.log("PASS: client authorization and scope enforcement");
  console.log("PASS: offline SEO audit orchestration");
  console.log("PASS: execution boundary and no external actions");
  console.log("PASS: invalid SEO audit input rejection");
  console.log("NETWORK_CALLS=0");
  console.log("EXTERNAL_ACTIONS=0");
  console.log("MARKETING_ORCHESTRATOR_TEST_STATUS=PASS");
}

try {
  main();
} catch (error) {
  console.error("MARKETING_ORCHESTRATOR_TEST_STATUS=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
