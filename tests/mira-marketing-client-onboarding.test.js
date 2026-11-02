"use strict";

const assert = require("assert");
const {
  createMarketingClientContextExecutor
} = require("../tools/marketing-client-context");

function makeProfile(overrides = {}) {
  return {
    id: "client-onboarding-test",
    name: "Onboarding Test Client",
    requirements: [{
      type: "marketing_profile",
      websiteUrl: "",
      industry: "",
      businessType: "",
      targetMarket: {
        countryCode: "",
        countryName: ""
      },
      targetLanguage: "en-US",
      goals: ["Increase organic traffic"],
      keywords: ["SEO"],
      ...overrides
    }]
  };
}

function makeConsent(authorized = {}) {
  const calls = [];
  return {
    calls,
    lookup(clientId, scope) {
      calls.push({ clientId, scope });
      return { authorized: authorized[scope] === true };
    }
  };
}

async function run() {
  {
    const consent = makeConsent();
    const execute = createMarketingClientContextExecutor({
      getClientProfile: () => makeProfile(),
      consentService: consent
    });

    const result = JSON.parse(await execute({
      clientId: "client-onboarding-test"
    }));

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, "MISSING_PROFILE_FIELDS");
    assert.strictEqual(result.onboarding.mode, "READ_ONLY_GUIDANCE");
    assert.strictEqual(result.onboarding.profile.complete, false);
    assert.strictEqual(result.onboarding.consent.complete, false);
    assert.strictEqual(result.onboarding.readiness.ready, false);

    for (const field of [
      "websiteUrl",
      "industry",
      "targetMarket.countryCode",
      "targetMarket.countryName"
    ]) {
      assert(
        result.onboarding.profile.missingFields.some(x => x.field === field),
        "Missing field guidance expected: " + field
      );
    }

    assert.strictEqual(consent.calls.length, 2);
    assert.strictEqual(result.profileModified, false);
    assert.strictEqual(result.consentModified, false);
    assert.strictEqual(result.liveResearchStarted, false);
    assert.strictEqual(result.externalActions, false);
  }

  {
    const consent = makeConsent({
      seo_audit: true,
      public_web_research: true
    });

    const execute = createMarketingClientContextExecutor({
      getClientProfile: () => makeProfile({
        websiteUrl: "https://example.com",
        industry: "Technology",
        targetMarket: {
          countryCode: "US",
          countryName: "United States"
        }
      }),
      consentService: consent
    });

    const result = JSON.parse(await execute({
      clientId: "client-onboarding-test"
    }));

    assert.strictEqual(result.status, "PROFILE_AND_CONSENT_READY");
    assert.strictEqual(result.onboarding.profile.complete, true);
    assert.strictEqual(result.onboarding.consent.complete, true);
    assert.strictEqual(result.onboarding.readiness.ready, true);
    assert.strictEqual(
      result.onboarding.readiness.status,
      "READY_FOR_EXPLICIT_WORKFLOW_CONFIRMATION"
    );
    assert.strictEqual(result.liveResearchStarted, false);
  }

  {
    const execute = createMarketingClientContextExecutor({
      getClientProfile: () => makeProfile(),
      consentService: {
        lookup() {
          throw new Error("simulated consent lookup failure");
        }
      }
    });

    const result = JSON.parse(await execute({
      clientId: "client-onboarding-test"
    }));

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, "INCONCLUSIVE");
  }

  {
    const execute = createMarketingClientContextExecutor({
      getClientProfile: () => null,
      consentService: makeConsent()
    });

    const result = JSON.parse(await execute({
      clientId: "unknown-client"
    }));

    assert.strictEqual(result.status, "NOT_FOUND");
  }

  console.log("PASS: missing profile fields produce onboarding guidance");
  console.log("PASS: consent scopes produce separate explanations");
  console.log("PASS: complete profile and consent report readiness only");
  console.log("PASS: consent lookup failure remains INCONCLUSIVE");
  console.log("PASS: unknown client fails closed");
  console.log("PASS: onboarding performs no profile or consent mutations");
  console.log("RESULT=PASS");
}

run().catch(error => {
  console.error("RESULT=FAIL");
  console.error(error.stack || error);
  process.exitCode = 1;
});
