"use strict";

const assert = require("node:assert/strict");
const { createReport, validateReportInput } =
  require("../routes/mira-seo-report");

const competitorIntelligence = {
  searchCount: 1,
  competitorDomainCount: 1,
  freshness: { status: "UNKNOWN" },
  competitorDomains: [{
    domain: "competitor.example",
    competitorClassification: "UNCONFIRMED_RESEARCH_CANDIDATE",
    queryCoverageCount: 1,
    resultCount: 1
  }],
  queryReports: [{
    query: "seo audit service",
    ownDomainVisible: false,
    sources: [{
      domain: "competitor.example",
      title: "Competitor audit service",
      url: "https://competitor.example/audit"
    }]
  }]
};

function main() {
  assert.throws(() => validateReportInput({
    unknown: true
  }), /FIELD_NOT_ALLOWED/);
  assert.throws(() => validateReportInput({
    targetKeywords: ["keyword"], ownDomain: "example.test"
  }), /CONTENT_GAP_EVIDENCE_REQUIRED/);
  assert.throws(() => validateReportInput({
    targetKeywords: new Array(31).fill("keyword"),
    ownDomain: "example.test",
    competitorIntelligence
  }), /TARGET_KEYWORDS_INVALID/);

  const report = createReport({
    siteName: "Example",
    siteUrl: "https://example.test",
    targetKeywords: ["seo audit service", "unsearched phrase"],
    ownDomain: "example.test",
    competitorIntelligence,
    seoAudit: {
      onPage: {
        checklistScore: 75,
        checks: [{ passed: true }, { passed: false }],
        findings: [{ severity: "HIGH", code: "TITLE_MISSING", message: "Title missing" }]
      }
    },
    searchConsoleCsv: [
      "Top queries,Clicks,Impressions,CTR,Position",
      "seo audit service,12,800,1.5%,9"
    ].join("\n")
  });
  assert.equal(report.success, true);
  assert.equal(report.networkAccess, false);
  assert.equal(report.contentGapAnalysis.candidateGapCount, 1);
  assert.match(report.markdown, /SEO Research Report/);
  assert.match(report.markdown, /Competitor audit service/);
  assert.match(report.markdown, /seo audit service/);
  assert.match(report.markdown, /Search Console performance/);
  assert.match(report.markdown, /800/);
  assert.match(report.markdown, /call paid APIs/);
  const offlineOnly = createReport({ siteName: "Audit only" });
  assert.equal(offlineOnly.success, true);
  assert.match(offlineOnly.markdown, /No competitor intelligence/);
  console.log("SEO_REPORT_ROUTE_VALIDATION=PASS");
  console.log("SEO_REPORT_ROUTE_CONTENT_GAP=PASS");
  console.log("SEO_REPORT_ROUTE_CSV_IMPORT=PASS");
  console.log("SEO_REPORT_ROUTE_OFFLINE_ONLY=PASS");
  console.log("SEO_REPORT_ROUTE_TEST_STATUS=PASS");
}
try { main(); } catch (error) {
  console.error("SEO_REPORT_ROUTE_TEST_STATUS=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
