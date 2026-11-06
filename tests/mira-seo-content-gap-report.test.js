"use strict";

const assert = require("assert");
const {
  analyzeContentGaps,
  generateSeoReport
} = require("../services/mira-seo-content-gap-report");
const tool = require("../tools/seo-content-gap-report");
const { tools } = require("../tools");

async function main() {
  const intelligence = {
    searchCount: 2,
    competitorDomainCount: 1,
    freshness: { status: "UNKNOWN" },
    competitorDomains: [
      { domain: "competitor-a.test", competitorClassification: "UNCONFIRMED_RESEARCH_CANDIDATE", queryCoverageCount: 2, resultCount: 3 }
    ],
    queryReports: [
      {
        query: "seo audit service",
        ownDomainVisible: false,
        domains: ["competitor-a.test"],
        sources: [
          { domain: "competitor-a.test", title: "SEO audit services", url: "https://competitor-a.test/audit" },
          { domain: "competitor-a.test", title: "SEO audit guide", url: "https://competitor-a.test/guide" }
        ]
      },
      {
        query: "technical seo checklist",
        ownDomainVisible: true,
        domains: ["example.test"],
        sources: [
          { domain: "example.test", title: "Technical SEO", url: "https://example.test/technical" }
        ]
      }
    ]
  };

  const gaps = analyzeContentGaps({
    targetKeywords: ["seo audit service", "technical seo checklist", "unsearched keyword"],
    ownDomain: "https://www.example.test/",
    competitorIntelligence: intelligence
  });
  assert.strictEqual(gaps.success, true);
  assert.strictEqual(gaps.candidateGapCount, 1);
  assert.strictEqual(gaps.insufficientEvidenceCount, 2);
  assert.strictEqual(gaps.keywordReports[0].status, "CANDIDATE_GAP");
  assert.strictEqual(gaps.keywordReports[0].evidence.length, 2);
  assert.strictEqual(gaps.keywordReports[1].candidateGap, false);
  assert.strictEqual(gaps.keywordReports[2].signal, "NO_EXACT_MATCHING_RESEARCH_QUERY");
  assert.throws(() => analyzeContentGaps({
    targetKeywords: ["x", "X"], ownDomain: "example.test",
    competitorIntelligence: intelligence
  }), /DUPLICATE_KEYWORD/);
  assert.throws(() => analyzeContentGaps({
    targetKeywords: ["x"], ownDomain: "javascript:alert(1)",
    competitorIntelligence: intelligence
  }), /OWN_DOMAIN_INVALID/);
  assert.throws(() => analyzeContentGaps({
    targetKeywords: ["x"], ownDomain: "example.test",
    competitorIntelligence: { queryReports: [], competitorDomains: [] }, extra: true
  }), /FIELD_NOT_ALLOWED/);

  const report = generateSeoReport({
    siteName: "Example Site",
    siteUrl: "https://example.test",
    generatedAt: "2026-11-06",
    seoAudit: {
      onPage: {
        checklistScore: 80,
        content: { visibleWordCount: 420 },
        checks: [{ passed: true }, { passed: false }],
        findings: [{ severity: "HIGH", code: "TITLE_MISSING", message: "Title is missing" }]
      }
    },
    competitorIntelligence: intelligence,
    contentGapAnalysis: gaps,
    searchPerformance: {
      provided: true,
      importedRows: 2,
      skippedRows: 0,
      totals: { clicks: 12, impressions: 800 },
      queries: [{ query: "seo audit service", clicks: 12, impressions: 800, ctr: 1.5, averagePosition: 9 }],
      pages: []
    }
  });
  assert.strictEqual(report.success, true);
  assert.strictEqual(report.networkAccess, false);
  assert.match(report.markdown, /SEO Research Report/);
  assert.match(report.markdown, /CANDIDATE_GAP/);
  assert.match(report.markdown, /not proof/i);
  assert.match(report.markdown, /No search volume/);
  assert.strictEqual(report.sections.contentGapKeywords, 3);

  const toolResult = JSON.parse(await tool.execute({
    targetKeywords: ["seo audit service"],
    ownDomain: "example.test",
    competitorIntelligence: intelligence
  }));
  assert.strictEqual(toolResult.success, true);
  assert.strictEqual(toolResult.contentGapAnalysis.candidateGapCount, 1);
  assert.ok(tools.seo_content_gap_report);
  console.log("SEO_CONTENT_GAP_ANALYSIS=PASS");
  console.log("SEO_MARKDOWN_REPORT_GENERATOR=PASS");
  console.log("SEO_REPORT_NO_NETWORK_OR_EXTERNAL_ACTIONS=PASS");
  console.log("SEO_CONTENT_GAP_REPORT_TEST_STATUS=PASS");
}

main().catch(error => {
  console.error("SEO_CONTENT_GAP_REPORT_TEST_STATUS=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
