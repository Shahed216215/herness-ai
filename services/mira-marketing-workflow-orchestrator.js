"use strict";

const {
  validateMarketingBrief
} = require("./mira-marketing-brief-schema");

const {
  runMarketingAudit
} = require("./mira-marketing-orchestrator");

const {
  runSeoResearch,
  isTrustedAdminContext
} = require("./mira-seo-research-orchestrator");

function validateWorkflowInput(input, dependencies = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("MARKETING_WORKFLOW_INPUT_OBJECT_REQUIRED");
  }

  const allowed = new Set([
    "brief", "query", "auditInput",
    "competitorQueries", "confirmedCompetitorDomains"
  ]);

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new TypeError("MARKETING_WORKFLOW_FIELD_NOT_ALLOWED:" + key);
    }
  }

  if (!input.brief || typeof input.brief !== "object" ||
      Array.isArray(input.brief)) {
    throw new TypeError("MARKETING_BRIEF_OBJECT_REQUIRED");
  }

  if (Object.prototype.hasOwnProperty.call(
    input.brief,
    "clientAuthorization"
  )) {
    throw new TypeError(
      "MARKETING_WORKFLOW_CLIENT_AUTHORIZATION_NOT_ALLOWED"
    );
  }

  let profileBrief = {};

  if (
    typeof input.brief.clientId === "string" &&
    input.brief.clientId.trim()
  ) {
    try {
      const getProfile = dependencies.getClientProfile ||
        require("./client-profile-service").getClientProfile;

      const profile = getProfile(input.brief.clientId.trim());

      if (profile) {
        const requirements = Array.isArray(profile.requirements)
          ? profile.requirements
          : [];

        const marketing = requirements.find(item =>
          item &&
          typeof item === "object" &&
          item.type === "marketing_profile"
        ) || {};

        profileBrief = {
          clientId: profile.id,
          clientName: profile.name,
          websiteUrl: marketing.websiteUrl,
          industry: marketing.industry,
          businessType: marketing.businessType,
          targetMarket: marketing.targetMarket,
          targetLanguage: marketing.targetLanguage,
          primaryGoals: marketing.goals,
          keywords: marketing.keywords
        };
      }
    } catch (error) {
      const wrapped = new Error("CLIENT_PROFILE_LOOKUP_FAILED");
      wrapped.cause = error;
      throw wrapped;
    }
  }

  const supplied = input.brief;
  const merged = {
    ...profileBrief,
    ...supplied,
    targetMarket: {
      ...(profileBrief.targetMarket || {}),
      ...(supplied.targetMarket || {})
    }
  };

  const brief = validateMarketingBrief({
    ...merged,
    clientAuthorization: {
      status: "pending",
      scopes: []
    }
  });

  if (!brief.clientId) {
    throw new TypeError("MARKETING_WORKFLOW_CLIENT_ID_REQUIRED");
  }

  if (typeof input.query !== "string" || !input.query.trim()) {
    throw new TypeError("MARKETING_WORKFLOW_QUERY_REQUIRED");
  }

  const competitorQueries = input.competitorQueries === undefined
    ? []
    : input.competitorQueries;
  if (!Array.isArray(competitorQueries) || competitorQueries.length > 5) {
    throw new TypeError("MARKETING_WORKFLOW_COMPETITOR_QUERIES_INVALID");
  }
  const cleanCompetitorQueries = competitorQueries.map((value, index) => {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 500) {
      throw new TypeError("MARKETING_WORKFLOW_COMPETITOR_QUERY_INVALID:" + index);
    }
    return value.trim();
  });
  if (new Set([input.query.trim(), ...cleanCompetitorQueries]
      .map(value => value.toLocaleLowerCase())).size !==
      1 + cleanCompetitorQueries.length) {
    throw new TypeError("MARKETING_WORKFLOW_COMPETITOR_QUERIES_MUST_BE_UNIQUE");
  }

  const confirmedCompetitorDomains = input.confirmedCompetitorDomains === undefined
    ? []
    : input.confirmedCompetitorDomains;
  if (!Array.isArray(confirmedCompetitorDomains) ||
      confirmedCompetitorDomains.length > 10 ||
      confirmedCompetitorDomains.some(value =>
        typeof value !== "string" || !value.trim() || value.trim().length > 253
      )) {
    throw new TypeError("MARKETING_WORKFLOW_CONFIRMED_COMPETITOR_DOMAINS_INVALID");
  }

  const auditInput = input.auditInput === undefined
    ? {}
    : input.auditInput;

  if (!auditInput || typeof auditInput !== "object" ||
      Array.isArray(auditInput)) {
    throw new TypeError("MARKETING_WORKFLOW_AUDIT_INPUT_INVALID");
  }

  return {
    brief,
    query: input.query.trim(),
    competitorQueries: cleanCompetitorQueries,
    confirmedCompetitorDomains: confirmedCompetitorDomains.map(value => value.trim()),
    auditInput
  };
}

function getConsentService(dependencies = {}) {
  if (dependencies.consentService) {
    return dependencies.consentService;
  }

  const {
    createConsentService
  } = require("./mira-client-consent-service");

  const {
    recordAudit,
    verifyAuditIntegrity
  } = require("../audit-log");

  return createConsentService({
    recordAudit,
    verifyAuditIntegrity
  });
}

function blocked(reason, status = "BLOCKED") {
  return {
    success: false,
    status,
    reason,
    networkAccess: "NOT_STARTED",
    externalActions: false
  };
}

async function runMarketingWorkflow(
  input = {},
  trustedContext = {},
  dependencies = {}
) {
  const validated = validateWorkflowInput(input, dependencies);

  if (!isTrustedAdminContext(trustedContext)) {
    return blocked("TRUSTED_NAMED_ADMIN_PERMISSION_REQUIRED");
  }

  let consentService;
  let seoAuditConsent;
  let researchConsent;

  try {
    consentService = getConsentService(dependencies);

    seoAuditConsent = consentService.lookup(
      validated.brief.clientId,
      "seo_audit"
    );

    researchConsent = consentService.lookup(
      validated.brief.clientId,
      "public_web_research"
    );
  } catch {
    return blocked("CLIENT_CONSENT_LOOKUP_FAILED", "INCONCLUSIVE");
  }

  if (!seoAuditConsent || seoAuditConsent.authorized !== true) {
    return blocked("CLIENT_SEO_AUDIT_CONSENT_REQUIRED");
  }

  if (!researchConsent || researchConsent.authorized !== true) {
    return blocked("CLIENT_PUBLIC_WEB_RESEARCH_CONSENT_REQUIRED");
  }

  /*
   * This authorization object is generated internally only after
   * the persisted seo_audit consent check. Request-body authorization
   * is rejected by validateWorkflowInput().
   */
  const auditBrief = {
    ...validated.brief,
    clientAuthorization: {
      status: "authorized",
      scopes: ["seo_audit"]
    }
  };

  let audit;

  try {
    const auditRunner =
      dependencies.runMarketingAudit || runMarketingAudit;

    audit = auditRunner({
      brief: auditBrief,
      auditInput: validated.auditInput
    });
  } catch (error) {
    return {
      ...blocked("OFFLINE_SEO_AUDIT_FAILED", "INCONCLUSIVE"),
      message: error.message
    };
  }

  if (!audit || audit.success !== true) {
    return {
      ...blocked("OFFLINE_SEO_AUDIT_NOT_VERIFIED", "INCONCLUSIVE"),
      audit
    };
  }

  /*
   * Recheck public research consent inside runSeoResearch immediately
   * before governed execution. This reduces the stale-consent window.
   */
  const researchBrief = { ...validated.brief };
  delete researchBrief.clientAuthorization;

  let research;

  try {
    const researchRunner =
      dependencies.runSeoResearch || runSeoResearch;

    const researchDependencies = {
      ...(dependencies.researchDependencies || {}),
      consentService
    };

    if (typeof dependencies.executeWork === "function") {
      researchDependencies.executeWork = dependencies.executeWork;
    }

    research = await researchRunner(
      {
        brief: researchBrief,
        query: validated.query,
        competitorQueries: validated.competitorQueries,
        confirmedCompetitorDomains: validated.confirmedCompetitorDomains
      },
      trustedContext,
      researchDependencies
    );
  } catch (error) {
    return {
      success: false,
      status: "PARTIAL",
      reason: "SEO_RESEARCH_WORKFLOW_FAILED",
      audit,
      research: {
        success: false,
        status: "INCONCLUSIVE",
        message: error.message
      },
      networkAccess: "NOT_CONFIRMED",
      externalActions: false
    };
  }

  if (!research || research.success !== true) {
    return {
      success: false,
      status: "PARTIAL",
      reason: "SEO_RESEARCH_NOT_COMPLETED",
      audit,
      research: research || null,
      networkAccess: research?.networkAccess || "NOT_CONFIRMED",
      externalActions: false
    };
  }

  let marketingAssets;
  let qualityReview;

  try {
    const { generateMarketingAssets } =
      require("./mira-marketing-assets");

    marketingAssets = generateMarketingAssets({
      brief: validated.brief,
      audit,
      research
    });

    const { buildSeoQualityReview } =
      require("./mira-seo-quality-review");

    qualityReview = buildSeoQualityReview({
      brief: validated.brief,
      audit,
      marketingAssets
    });
  } catch (error) {
    return {
      success: false,
      status: "PARTIAL",
      reason: "SEO_MARKETING_ASSET_GENERATION_FAILED",
      audit,
      research,
      assetGeneration: {
        status: "FAILED",
        message: error.message
      },
      networkAccess: research.networkAccess || "NOT_CONFIRMED",
      externalActions: false
    };
  }

  const persistedBrief = { ...validated.brief };
  delete persistedBrief.clientAuthorization;

  let persistence;

  try {
    const store = require("./mira-seo-workflow-store");
    persistence = store.appendWorkflowRecord({
      clientId: validated.brief.clientId,
      brief: persistedBrief,
      query: validated.query,
      audit,
      research,
      personas: marketingAssets.personas,
      contentCalendar: marketingAssets.contentCalendar,
      assetGeneration: marketingAssets.assetGeneration,
      qualityReview
    });
  } catch (error) {
    return {
      success: false,
      status: "PARTIAL",
      reason: "SEO_WORKFLOW_PERSISTENCE_FAILED",
      audit,
      research,
      persistence: {
        saved: false,
        message: error.message
      },
      networkAccess: research.networkAccess || "NOT_CONFIRMED",
      externalActions: false
    };
  }

  return {
    success: true,
    status: "MARKETING_WORKFLOW_READY_FOR_REVIEW",
    workflow: "persisted-consent-governed-marketing",
    client: {
      id: validated.brief.clientId,
      name: validated.brief.clientName
    },
    persistence,
    audit,
    research,
    personas: marketingAssets.personas,
    contentCalendar: marketingAssets.contentCalendar,
    assetGeneration: marketingAssets.assetGeneration,
    qualityReview,
    reviewRequired: true,
    executionBoundary: {
      websiteModified: false,
      contentPublished: false,
      clientMessageSent: false,
      advertisingActivated: false,
      externalActions: false
    },
    limitations: [
      "Both SEO audit and public web research consent were checked from the server-side consent store.",
      "SEO research uses the governed executeWork pipeline.",
      "The SEO audit analyzes supplied data and does not fetch the client website.",
      "Research evidence requires human review before delivery or publication.",
      "Consent checks and workflow execution are not one atomic transaction; a concurrent revocation may occur between steps.",
      "Personas are hypotheses and require customer validation.",
      "Content calendar entries are plans only; publication is not authorized.",
      "Saved workflow retrieval is available through the named-Admin Run Agent history tool.",
      "Quality scoring is structural and does not predict search rankings or traffic.",
      "Quality review remains pending until a human reviewer evaluates the deliverables.",
      "Keyword mapping, duplicate findings, and internal links are recommendations only."
    ]
  };
}

function listPersistedSeoWorkflows(clientId) {
  if (typeof clientId !== "string" || !clientId.trim()) {
    throw new TypeError("SEO_WORKFLOW_CLIENT_ID_REQUIRED");
  }

  const { listWorkflowRecords } =
    require("./mira-seo-workflow-store");

  return listWorkflowRecords(clientId.trim());
}

module.exports = {
  runMarketingWorkflow,
  validateWorkflowInput,
  listPersistedSeoWorkflows
};
