"use strict";

const { audit } = require("./mira-seo-engine");
const {
  assertSeoAuditAuthorized
} = require("./mira-marketing-brief-schema");

function runMarketingAudit(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("MARKETING_INPUT_OBJECT_REQUIRED");
  }

  const brief = assertSeoAuditAuthorized(input.brief);

  const suppliedAuditInput = input.auditInput || {};

  if (
    !suppliedAuditInput ||
    typeof suppliedAuditInput !== "object" ||
    Array.isArray(suppliedAuditInput)
  ) {
    throw new TypeError("SEO_AUDIT_INPUT_INVALID");
  }

  const auditInput = {
    ...suppliedAuditInput,
    keywords:
      suppliedAuditInput.keywords === undefined
        ? [...brief.keywords]
        : suppliedAuditInput.keywords
  };

  const seoResult = audit(auditInput);

  if (!seoResult || seoResult.success !== true) {
    throw new Error("SEO_AUDIT_FAILED");
  }

  return {
    success: true,
    product: "Mira Marketing Orchestrator",
    version: "0.1.0",
    workflow: "offline_seo_research_and_audit",
    client: {
      id: brief.clientId || null,
      name: brief.clientName,
      website: brief.websiteUrl,
      industry: brief.industry,
      businessType: brief.businessType || null
    },
    market: {
      countryCode: brief.targetMarket.countryCode,
      countryName: brief.targetMarket.countryName || null,
      language: brief.targetLanguage
    },
    goals: [...brief.primaryGoals],
    report: {
      generatedAt: new Date().toISOString(),
      audit: seoResult,
      evidenceMode: "user_supplied_data_only",
      recommendationsAreRankingGuarantees: false
    },
    executionBoundary: {
      networkAccess: false,
      externalActions: false,
      websiteModified: false,
      contentPublished: false,
      clientMessageSent: false,
      advertisingActivated: false,
      dataPersisted: false
    },
    limitations: [
      "No live search results or competitor data were collected.",
      "No website URL was fetched; only supplied HTML was analyzed.",
      "No Google Search Console or Analytics data was accessed.",
      "Keyword intent classification is heuristic, not live SERP validation.",
      "Recommendations are diagnostic and do not guarantee rankings."
    ]
  };
}

module.exports = {
  runMarketingAudit
};
