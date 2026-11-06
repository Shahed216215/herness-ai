"use strict";

const assert = require("node:assert/strict");
const {
  analyzeCompetitorSearches,
  normalizeDomain
} = require("../services/mira-seo-competitor-intelligence");

function evidence(items) {
  return {
    success: true,
    evidence: items.map((item, index) => ({
      ...item,
      providerResultPosition: index + 1
    }))
  };
}

const searches = [
  {
    query: "project management software",
    evidence: evidence([
      { title: "Alpha PM", url: "https://alpha.example/products", sourceDomain: "alpha.example" },
      { title: "Beta PM", url: "https://www.beta.example/guide", sourceDomain: "beta.example" },
      { title: "Our product", url: "https://oursite.example/", sourceDomain: "oursite.example" }
    ])
  },
  {
    query: "best project management tools for teams",
    evidence: evidence([
      { title: "Alpha comparison", url: "https://alpha.example/compare", sourceDomain: "alpha.example" },
      { title: "Gamma review", url: "https://gamma.example/review", sourceDomain: "gamma.example" }
    ])
  }
];

const report = analyzeCompetitorSearches(
  searches,
  "https://oursite.example/",
  ["https://www.alpha.example/"]
);
assert.equal(report.success, true);
assert.equal(report.searchCount, 2);
assert.equal(report.competitorDomainCount, 3);
assert.equal(report.competitorDomains[0].domain, "alpha.example");
assert.equal(report.competitorDomains[0].queryCoverageCount, 2);
assert.equal(
  report.competitorDomains[0].competitorClassification,
  "CLIENT_CONFIRMED_COMPETITOR"
);
assert.equal(
  report.competitorDomains[1].competitorClassification,
  "UNCONFIRMED_RESEARCH_CANDIDATE"
);
assert.equal(report.queryReports[0].ownDomainVisible, true);
assert.equal(report.queryReports[1].ownDomainVisible, false);
assert.equal(report.queryReports[0].sources.length, 3);
assert.equal(report.queryReports[0].sources[0].title, "Alpha PM");
assert.equal(report.queryReports[0].sources[0].url, "https://alpha.example/products");
assert.equal(report.candidateOpportunities[1].candidateOpportunity, true);
const mismatchedDomain = analyzeCompetitorSearches([{
  query: "sample",
  evidence: {
    success: true,
    evidence: [{
      title: "Misleading declared domain",
      url: "https://actual.example/article",
      sourceDomain: "claimed-competitor.example"
    }]
  }
}]);
assert.equal(mismatchedDomain.competitorDomainCount, 0);
assert.equal(report.freshness.status, "UNKNOWN");
assert.ok(report.limitations.some(item => /not Google organic ranking/.test(item)));
assert.equal(normalizeDomain("https://www.Example.com/path"), "example.com");
assert.equal(normalizeDomain("javascript:alert(1)"), null);
assert.equal(normalizeDomain("https://user:pass@example.com"), null);
assert.equal(normalizeDomain("not a valid domain"), null);
assert.throws(() => analyzeCompetitorSearches(
  searches,
  "https://oursite.example/",
  ["not a valid domain"]
), /CONFIRMED_COMPETITOR_DOMAIN_INVALID/);
assert.throws(() => analyzeCompetitorSearches([]), /1_TO_6/);
assert.throws(() => analyzeCompetitorSearches([{
  query: "x",
  evidence: { success: false, evidence: [] }
}]), /EVIDENCE_INVALID/);

console.log("PASS: competitor domain aggregation and cross-query coverage");
console.log("PASS: own-domain sample visibility and cautious opportunity signals");
console.log("PASS: freshness and ranking limitations are explicit");
console.log("NETWORK_CALLS=0");
console.log("EXTERNAL_ACTIONS=0");
console.log("COMPETITOR_INTELLIGENCE_TEST_STATUS=PASS");
