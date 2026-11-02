"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function main() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "mira-seo-persistence-")
  );

  process.env.MIRA_STORAGE_DIR = tempRoot;

  try {
    const schema = require("../services/mira-marketing-brief-schema");
    const orchestrator =
      require("../services/mira-marketing-workflow-orchestrator");
    const store = require("../services/mira-seo-workflow-store");

    const validBrief = {
      clientId: "client-bd-001",
      clientName: "Bangladesh Test Client",
      websiteUrl: "https://example.com/",
      industry: "Education",
      businessType: "Local service",
      targetMarket: {
        countryCode: "BD",
        countryName: "Bangladesh"
      },
      targetLanguage: "bn-BD",
      primaryGoals: ["Increase organic traffic"],
      keywords: ["বাংলা শিক্ষা"],
      clientAuthorization: {
        status: "pending",
        scopes: []
      }
    };

    assert(schema.ALLOWED_COUNTRIES.has("BD"));
    assert(schema.ALLOWED_LANGUAGES.has("bn-BD"));
    schema.validateMarketingBrief(validBrief);
    console.log("PASS: Bangladesh and Bengali schema validation");

    const profile = {
      id: "client-bd-001",
      name: "Profile Client",
      requirements: [{
        type: "marketing_profile",
        websiteUrl: "https://profile.example/",
        industry: "Retail",
        businessType: "Online store",
        targetMarket: {
          countryCode: "BD",
          countryName: "Bangladesh"
        },
        targetLanguage: "bn-BD",
        goals: ["Increase sales"],
        keywords: ["বাংলাদেশি পণ্য"]
      }]
    };

    const getClientProfile = id =>
      id === profile.id ? profile : null;

    const fromProfile = orchestrator.validateWorkflowInput({
      brief: { clientId: profile.id },
      query: "বাংলাদেশের অনলাইন স্টোর SEO"
    }, { getClientProfile });

    assert.equal(fromProfile.brief.clientName, "Profile Client");
    assert.equal(fromProfile.brief.industry, "Retail");
    assert.equal(fromProfile.brief.targetMarket.countryCode, "BD");
    assert.equal(fromProfile.brief.targetLanguage, "bn-BD");
    assert.deepEqual(
      [...fromProfile.brief.primaryGoals],
      ["Increase sales"]
    );
    console.log("PASS: Client Profile marketing fallback");

    const override = orchestrator.validateWorkflowInput({
      brief: {
        clientId: profile.id,
        industry: "Explicit Industry",
        targetMarket: {
          countryCode: "BD",
          countryName: "Bangladesh"
        }
      },
      query: "explicit override test"
    }, { getClientProfile });

    assert.equal(override.brief.industry, "Explicit Industry");
    assert.equal(override.brief.websiteUrl, "https://profile.example/");
    console.log("PASS: Explicit brief values take precedence");

    assert.throws(
      () => orchestrator.validateWorkflowInput({
        brief: {
          clientId: profile.id,
          clientAuthorization: {
            status: "authorized",
            scopes: ["seo_audit"]
          }
        },
        query: "authorization injection test"
      }, { getClientProfile }),
      /CLIENT_AUTHORIZATION_NOT_ALLOWED/
    );
    console.log("PASS: Request-supplied authorization rejected");

    const consentService = {
      lookup(clientId, scope) {
        assert.equal(clientId, profile.id);
        assert.ok(
          scope === "seo_audit" ||
          scope === "public_web_research"
        );
        return { authorized: true };
      }
    };

    const trustedContext = {
      permissionGranted: true,
      actor: {
        role: "admin",
        username: "isolated-test-admin"
      }
    };

    const result = await orchestrator.runMarketingWorkflow(
      {
        brief: { clientId: profile.id },
        query: "বাংলাদেশ SEO integration test"
      },
      trustedContext,
      {
        getClientProfile,
        consentService,
        runMarketingAudit: () => ({
          success: true,
          status: "AUDIT_VERIFIED"
        }),
        runSeoResearch: async () => ({
          success: true,
          status: "RESEARCH_COMPLETED",
          networkAccess: "NOT_STARTED",
          findings: ["Mock research evidence"]
        })
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.persistence.saved, true);
    console.log("PASS: Successful workflow persistence");

    const records =
      orchestrator.listPersistedSeoWorkflows(profile.id);

    assert.equal(records.length, 1);
    assert.equal(records[0].query, "বাংলাদেশ SEO integration test");
    assert.equal(records[0].brief.clientAuthorization, undefined);
    assert.equal(records[0].checkpoint.status, "AWAITING_HUMAN_REVIEW");
    console.log("PASS: Client-scoped retrieval and authorization omission");

    fs.mkdirSync(store.LOCK_DIR, { mode: 0o700 });

    assert.throws(
      () => store.appendWorkflowRecord({
        clientId: profile.id,
        brief: {},
        query: "lock test"
      }),
      /STORE_LOCKED/
    );

    fs.rmdirSync(store.LOCK_DIR);
    console.log("PASS: Concurrent writer lock fails closed");

    const stat = fs.statSync(store.STORE_FILE);
    assert.equal(stat.mode & 0o077, 0);
    console.log("PASS: Persistence file owner-only permissions");

    console.log("SEO_PERSISTENCE_INTEGRATION_TEST=PASS");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error("SEO_PERSISTENCE_INTEGRATION_TEST=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
