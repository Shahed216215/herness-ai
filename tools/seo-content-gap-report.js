"use strict";

const {
  analyzeContentGaps,
  generateSeoReport
} = require("../services/mira-seo-content-gap-report");

module.exports = {
  name: "seo_content_gap_report",
  declaration: {
    name: "seo_content_gap_report",
    description: "Analyse evidence-backed candidate content gaps and generate a deterministic Markdown SEO report from supplied SEO audit, Search Console CSV analysis and competitor intelligence. No network access, paid API, Google login, crawling, website changes or publication.",
    parameters: {
      type: "object",
      properties: {
        targetKeywords: {
          type: "array",
          items: { type: "string" },
          description: "1–30 exact target keywords that were also used as exact competitor research queries."
        },
        ownDomain: {
          type: "string",
          description: "Client website domain used to compare with research source URLs."
        },
        siteName: { type: "string" },
        siteUrl: { type: "string" },
        generatedAt: { type: "string" },
        competitorIntelligence: {
          type: "object",
          description: "Output from governed competitor research, including queryReports with source URL/title evidence."
        },
        seoAudit: {
          type: "object",
          description: "Optional output from seo_audit."
        },
        searchPerformance: {
          type: "object",
          description: "Optional locally parsed Search Console CSV analysis."
        }
      },
      additionalProperties: false
    }
  },
  execute: async (args = {}) => {
    try {
      const contentGapAnalysis = args.targetKeywords
        ? analyzeContentGaps({
            targetKeywords: args.targetKeywords,
            ownDomain: args.ownDomain,
            competitorIntelligence: args.competitorIntelligence
          })
        : null;
      const report = generateSeoReport({
        siteName: args.siteName,
        siteUrl: args.siteUrl,
        generatedAt: args.generatedAt,
        seoAudit: args.seoAudit,
        competitorIntelligence: args.competitorIntelligence,
        contentGapAnalysis,
        searchPerformance: args.searchPerformance
      });
      return JSON.stringify({ ...report, contentGapAnalysis }, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: error.message });
    }
  }
};
