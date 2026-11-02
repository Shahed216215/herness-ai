"use strict";

const profileService = require("../services/client-profile-service");

function cleanString(value, max = 500) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

function getDefaultConsentService() {
  const { createConsentService } =
    require("../services/mira-client-consent-service");
  const { recordAudit, verifyAuditIntegrity } =
    require("../audit-log");

  return createConsentService({
    recordAudit,
    verifyAuditIntegrity
  });
}

function createMarketingClientContextExecutor(dependencies = {}) {
  const getClientProfile =
    dependencies.getClientProfile || profileService.getClientProfile;

  const consentService =
    dependencies.consentService || getDefaultConsentService();

  return async function execute(args = {}) {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return JSON.stringify({
        success: false,
        status: "INVALID_INPUT",
        reason: "CLIENT_CONTEXT_ARGUMENTS_INVALID"
      });
    }

    if (Object.keys(args).some(key => key !== "clientId")) {
      return JSON.stringify({
        success: false,
        status: "INVALID_INPUT",
        reason: "CLIENT_CONTEXT_FIELD_NOT_ALLOWED"
      });
    }

    const clientId = cleanString(args.clientId, 160);

    if (!clientId) {
      return JSON.stringify({
        success: false,
        status: "INVALID_INPUT",
        reason: "CLIENT_ID_REQUIRED"
      });
    }

    let profile;

    try {
      profile = getClientProfile(clientId);
    } catch {
      return JSON.stringify({
        success: false,
        status: "INCONCLUSIVE",
        reason: "CLIENT_PROFILE_LOOKUP_FAILED"
      });
    }

    if (!profile) {
      return JSON.stringify({
        success: false,
        status: "NOT_FOUND",
        reason: "CLIENT_PROFILE_NOT_FOUND",
        clientId
      });
    }

    const requirements = Array.isArray(profile.requirements)
      ? profile.requirements
      : [];

    const marketing = requirements.find(item =>
      item &&
      typeof item === "object" &&
      item.type === "marketing_profile"
    ) || {};

    const targetMarket =
      marketing.targetMarket &&
      typeof marketing.targetMarket === "object"
        ? {
            countryCode: cleanString(marketing.targetMarket.countryCode, 2)
              .toUpperCase(),
            countryName: cleanString(marketing.targetMarket.countryName, 100)
          }
        : {
            countryCode: "",
            countryName: ""
          };

    const context = {
      clientId: cleanString(profile.id, 160),
      clientName: cleanString(profile.name, 160),
      websiteUrl: cleanString(marketing.websiteUrl, 2048),
      industry: cleanString(marketing.industry, 120),
      businessType: cleanString(marketing.businessType, 120),
      targetMarket,
      targetLanguage: cleanString(marketing.targetLanguage, 20),
      goals: Array.isArray(marketing.goals)
        ? marketing.goals.slice(0, 10).map(x => cleanString(x, 300)).filter(Boolean)
        : [],
      keywords: Array.isArray(marketing.keywords)
        ? marketing.keywords.slice(0, 30).map(x => cleanString(x, 120)).filter(Boolean)
        : []
    };

    const requiredFields = [
      ["websiteUrl", context.websiteUrl],
      ["industry", context.industry],
      ["targetMarket.countryCode", targetMarket.countryCode],
      ["targetMarket.countryName", targetMarket.countryName],
      ["targetLanguage", context.targetLanguage]
    ];

    const missingFields = requiredFields
      .filter(([, value]) => !value)
      .map(([field]) => field);

    let consents;

    try {
      const seoAudit = consentService.lookup(
        clientId,
        "seo_audit"
      );
      const publicResearch = consentService.lookup(
        clientId,
        "public_web_research"
      );

      consents = {
        seo_audit: seoAudit.authorized === true,
        public_web_research: publicResearch.authorized === true
      };
    } catch {
      return JSON.stringify({
        success: false,
        status: "INCONCLUSIVE",
        reason: "CLIENT_CONSENT_LOOKUP_FAILED",
        client: context,
        missingProfileFields: missingFields
      });
    }

    const missingConsents = Object.entries(consents)
      .filter(([, authorized]) => !authorized)
      .map(([scope]) => scope);

    const fieldGuidance = {
      websiteUrl: {
        label: "Website URL",
        reason: "Required to identify the website being audited.",
        expectedFormat: "A valid public HTTP or HTTPS website URL."
      },
      industry: {
        label: "Industry",
        reason: "Required to make keyword, competitor and content research relevant.",
        expectedFormat: "A concise description of the client's business industry."
      },
      "targetMarket.countryCode": {
        label: "Target country code",
        reason: "Required to define the geographic SEO market.",
        expectedFormat: "Two-letter ISO 3166-1 alpha-2 country code."
      },
      "targetMarket.countryName": {
        label: "Target country name",
        reason: "Required to identify the selected target market clearly.",
        expectedFormat: "The full country name corresponding to the country code."
      },
      targetLanguage: {
        label: "Target language",
        reason: "Required to prepare research and deliverables in the intended language.",
        expectedFormat: "A supported language code such as en-US, en-GB, en-CA or en-AU."
      }
    };

    const consentGuidance = {
      seo_audit: {
        requiredFor: "Reviewing the client's website and SEO configuration.",
        meaning: "The client must authorize the SEO audit scope."
      },
      public_web_research: {
        requiredFor: "External public-web market, keyword and competitor research.",
        meaning: "The client must authorize public web research."
      }
    };

    const onboarding = {
      mode: "READ_ONLY_GUIDANCE",
      profile: {
        complete: missingFields.length === 0,
        missingFields: missingFields.map(field => ({
          field,
          ...(fieldGuidance[field] || {})
        }))
      },
      consent: {
        complete: missingConsents.length === 0,
        missingScopes: missingConsents.map(scope => ({
          scope,
          ...(consentGuidance[scope] || {})
        })),
        instruction: "Only an authorized administrator may register client consent through the existing consent process."
      },
      readiness: {
        ready: missingFields.length === 0 && missingConsents.length === 0,
        status: missingFields.length
          ? "PROFILE_INFORMATION_REQUIRED"
          : missingConsents.length
            ? "CLIENT_CONSENT_REQUIRED"
            : "READY_FOR_EXPLICIT_WORKFLOW_CONFIRMATION"
      },
      nextActions: [
        ...(missingFields.length
          ? ["Ask the authorized administrator to obtain and complete the missing client marketing information."]
          : []),
        ...(missingConsents.length
          ? ["Explain the required consent scopes to the client and ask an authorized administrator to register consent through the existing process."]
          : []),
        ...(missingFields.length === 0 && missingConsents.length === 0
          ? ["Use the existing Marketing Workflow interface and obtain explicit confirmation before live research."]
          : [])
      ],
      prohibitedActions: [
        "Do not modify the client profile.",
        "Do not grant or revoke consent.",
        "Do not start live research.",
        "Do not publish content or modify a client website."
      ]
    };

    return JSON.stringify({
      success: true,
      status: missingFields.length
        ? "MISSING_PROFILE_FIELDS"
        : missingConsents.length
          ? "CONSENT_REQUIRED"
          : "PROFILE_AND_CONSENT_READY",
      client: context,
      onboarding,
      missingProfileFields: missingFields,
      consents,
      missingConsents,
      liveResearchStarted: false,
      profileModified: false,
      consentModified: false,
      externalActions: false,
      nextStep: missingFields.length
        ? "Ask the administrator to complete the missing client profile fields."
        : missingConsents.length
          ? "Obtain and record client consent through the existing authorized consent process."
          : "The profile and persisted consent checks are ready. Use the existing approved Marketing Workflow interface for explicit live-research confirmation."
    });
  };
}

module.exports = {
  name: "marketing_client_context",
  declaration: {
    name: "marketing_client_context",
    description:
      "Read a client marketing profile and persisted SEO consent status. " +
      "Admin named browser session only. Read-only; never grants consent or starts live research.",
    parameters: {
      type: "object",
      properties: {
        clientId: {
          type: "string",
          description: "Exact saved client profile ID."
        }
      },
      required: ["clientId"],
      additionalProperties: false
    }
  },
  execute: createMarketingClientContextExecutor(),
  createMarketingClientContextExecutor
};
