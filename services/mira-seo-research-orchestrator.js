"use strict";

const { executeWork } =
  require("./mira-work-execution-engine");

const {
  validateMarketingBrief
} = require("./mira-marketing-brief-schema");

const {
  extractSearchEvidence
} = require("./mira-seo-research-evidence");

const MAX_QUERY_LENGTH = 500;

function validateResearchInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("SEO_RESEARCH_INPUT_OBJECT_REQUIRED");
  }

  const allowed = new Set(["brief", "query"]);

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new TypeError(`SEO_RESEARCH_FIELD_NOT_ALLOWED:${key}`);
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
      "SEO_RESEARCH_CLIENT_AUTHORIZATION_FIELD_NOT_ALLOWED"
    );
  }

  /*
   * The existing marketing brief schema requires an authorization
   * object for other workflows. Supply a fixed internal placeholder
   * only for structural validation. It is never treated as consent.
   */
  const brief = validateMarketingBrief({
    ...input.brief,
    clientAuthorization: {
      status: "pending",
      scopes: []
    }
  });

  if (!brief.clientId) {
    throw new TypeError("SEO_RESEARCH_CLIENT_ID_REQUIRED");
  }

  if (typeof input.query !== "string" || !input.query.trim()) {
    throw new TypeError("SEO_RESEARCH_QUERY_REQUIRED");
  }

  const query = input.query.trim();

  if (query.length > MAX_QUERY_LENGTH) {
    throw new RangeError("SEO_RESEARCH_QUERY_TOO_LONG");
  }

  return { brief, query };
}

function isTrustedAdminContext(context) {
  return Boolean(
    context &&
    context.permissionGranted === true &&
    context.actor &&
    context.actor.role === "admin" &&
    typeof context.actor.username === "string" &&
    context.actor.username.trim()
  );
}

function getConsentService(dependencies = {}) {
  if (dependencies.consentService) {
    return dependencies.consentService;
  }

  const { createConsentService } =
    require("./mira-client-consent-service");

  const {
    recordAudit,
    verifyAuditIntegrity
  } = require("../audit-log");

  return createConsentService({
    recordAudit,
    verifyAuditIntegrity
  });
}

async function runSeoResearch(
  input = {},
  trustedContext = {},
  dependencies = {}
) {
  const validated = validateResearchInput(input);

  /*
   * This context is supplied by the protected server route.
   * It must never be populated from request-body authorization fields.
   */
  if (!isTrustedAdminContext(trustedContext)) {
    return {
      success: false,
      status: "BLOCKED",
      reason: "TRUSTED_NAMED_ADMIN_PERMISSION_REQUIRED",
      networkAccess: "NOT_STARTED",
      externalActions: false
    };
  }

  let consent;

  try {
    consent = getConsentService(dependencies).lookup(
      validated.brief.clientId,
      "public_web_research"
    );
  } catch {
    return {
      success: false,
      status: "INCONCLUSIVE",
      reason: "CLIENT_CONSENT_LOOKUP_FAILED",
      networkAccess: "NOT_STARTED",
      externalActions: false
    };
  }

  if (!consent || consent.authorized !== true) {
    return {
      success: false,
      status: "BLOCKED",
      reason: "CLIENT_PUBLIC_WEB_RESEARCH_CONSENT_REQUIRED",
      networkAccess: "NOT_STARTED",
      externalActions: false
    };
  }

  const marketContext =
    `${validated.brief.targetMarket.countryCode} ` +
    `${validated.brief.targetLanguage}`;

  const searchQuery =
    `${validated.query} ${marketContext}`;

  const taskDescription =
    `Research public SEO information for ${marketContext}: ` +
    validated.query;

  let execution;

  try {
    const execute = dependencies.executeWork || executeWork;

    execution = await execute(taskDescription, {
      toolCalls: [{
        name: "web_search",
        args: { query: searchQuery }
      }],
      permissionGranted: true,
      persist: false
    });
  } catch (error) {
    return {
      success: false,
      status: "INCONCLUSIVE",
      reason: "GOVERNED_EXECUTION_ERROR",
      message: error.message,
      networkAccess: "NOT_CONFIRMED",
      externalActions: false
    };
  }

  if (!execution || execution.success !== true) {
    return {
      success: false,
      status: "BLOCKED_OR_INCONCLUSIVE",
      executionStatus: execution?.status || "UNKNOWN",
      executionStage: execution?.stage || null,
      toolExecutionStarted: execution?.executionStarted === true,
      networkAccess: "NOT_CONFIRMED",
      externalActions: false
    };
  }

  const toolResult = Array.isArray(execution.results)
    ? execution.results.find(item => item?.tool === "web_search")
    : null;

  if (!toolResult || toolResult.verification?.passed !== true) {
    return {
      success: false,
      status: "INCONCLUSIVE",
      reason: "SEARCH_RESULT_VERIFICATION_MISSING",
      networkAccess: "NOT_CONFIRMED",
      externalActions: false
    };
  }

  const evidence = extractSearchEvidence(toolResult.result, validated.query);

  if (!evidence.success || evidence.evidence.length === 0) {
    return {
      success: false,
      status: "INCONCLUSIVE",
      reason: evidence.reason || "NO_USABLE_SEARCH_EVIDENCE",
      evidence,
      networkAccess: "SEARCH_TOOL_EXECUTED",
      externalActions: false
    };
  }

  return {
    success: true,
    status: "RESEARCH_RESULTS_READY_FOR_REVIEW",
    workflow: "governed_public_seo_research",
    client: {
      id: validated.brief.clientId,
      name: validated.brief.clientName
    },
    market: {
      countryCode: validated.brief.targetMarket.countryCode,
      language: validated.brief.targetLanguage
    },
    query: validated.query,
    evidence,
    execution: {
      engine: "executeWork",
      tool: "web_search",
      verificationPassed: true,
      planPersistenceRequested: false
    },
    limitations: [
      "Client public web research consent was checked from the server-side consent store.",
      "Admin permission was supplied by the protected named-session route.",
      "The search provider may not support precise country, language or date filtering.",
      "A source URL does not independently prove factual accuracy.",
      "Search results require human review before client delivery or publication."
    ],
    externalActions: false,
    websiteModified: false,
    contentPublished: false,
    clientMessageSent: false,
    advertisingActivated: false
  };
}

module.exports = {
  runSeoResearch,
  validateResearchInput,
  isTrustedAdminContext
};
