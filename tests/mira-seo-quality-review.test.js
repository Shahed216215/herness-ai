"use strict";

const assert = require("node:assert/strict");
const {
  buildSeoQualityReview,
  detectDuplicates,
  buildKeywordMap,
  buildInternalLinks
} = require("../services/mira-seo-quality-review");

const brief = {
  clientId: "quality-test-client",
  clientName: "Quality Test",
  keywords: [
    "AI automation agency",
    "AI workflow automation",
    "how AI automation works",
    "unmapped keyword"
  ]
};

const marketingAssets = {
  personas: [
    {
      id: "persona-commercial-hypothesis-1",
      type: "hypothesis",
      intent: "commercial"
    },
    {
      id: "persona-informational-hypothesis-1",
      type: "hypothesis",
      intent: "informational"
    }
  ],
  contentCalendar: [
    {
      id: "content-1",
      title: "AI Automation Agency: Services, Scope, and Next Steps",
      primaryKeyword: "AI automation agency",
      secondaryKeywords: ["AI workflow automation"],
      searchIntent: "transactional",
      contentType: "service_or_conversion_page",
      purpose: "Explain service scope and engagement process.",
      callToAction: "Request a consultation",
      scheduledDate: "2026-11-02",
      personaId: "persona-commercial-hypothesis-1",
      status: "PLANNED_REQUIRES_HUMAN_REVIEW",
      publicationAuthorized: false
    },
    {
      id: "content-2",
      title: "AI Workflow Automation: A Practical Guide",
      primaryKeyword: "AI workflow automation",
      secondaryKeywords: ["AI automation agency"],
      searchIntent: "informational",
      contentType: "educational_article",
      purpose: "Explain practical workflow automation.",
      callToAction: "Read the related service guide",
      scheduledDate: "2026-11-04",
      personaId: "persona-informational-hypothesis-1",
      status: "PLANNED_REQUIRES_HUMAN_REVIEW",
      publicationAuthorized: false
    }
  ]
};

const result = buildSeoQualityReview({
  brief,
  audit: {},
  marketingAssets,
  now: "2026-11-01T00:00:00.000Z"
});

assert.equal(result.status, "QUALITY_REVIEW_GENERATED");
console.log("PASS: quality review generated");

assert.ok(result.quality.overallScore >= 0);
assert.ok(result.quality.overallScore <= 100);
assert.equal(result.quality.scale, "0-100");
console.log("PASS: bounded structural quality score");

assert.equal(result.keywordMap.length, 4);
assert.equal(result.mappingGaps.length, 2);
console.log("PASS: keyword mapping and gaps");

assert.ok(
  result.duplicateFindings.length === 0,
  "Distinct titles and keywords should not be duplicates"
);
console.log("PASS: duplicate detection baseline");

const duplicates = detectDuplicates([
  { id: "a", title: "AI Automation Agency", primaryKeyword: "AI automation agency" },
  { id: "b", title: "AI Automation Agency", primaryKeyword: "AI automation agency" }
]);
assert.equal(duplicates.length, 1);
assert.equal(duplicates[0].type, "EXACT_DUPLICATE");
console.log("PASS: exact duplicate detection");

const map = buildKeywordMap(
  [{ keyword: "alpha", intent: "commercial" }],
  [{ id: "one", primaryKeyword: "alpha", contentType: "article" }]
);
assert.equal(map[0].mapped, true);
assert.equal(map[0].targetCount, 1);
console.log("PASS: single-target keyword mapping");

const links = buildInternalLinks(marketingAssets.contentCalendar, []);
assert.ok(links.length > 0);
assert.ok(links.every(item => item.linkCreated === false));
console.log("PASS: internal links are suggestions only");

assert.equal(result.review.status, "PENDING_REVIEW");
assert.equal(result.review.approvalGranted, false);
assert.equal(result.review.decision, null);
console.log("PASS: human review remains pending");

assert.equal(result.executionBoundary.websiteModified, false);
assert.equal(result.executionBoundary.contentPublished, false);
assert.equal(result.executionBoundary.clientMessageSent, false);
console.log("PASS: no external action performed");

assert.ok(result.clientReport.methodology.includes("structural"));
assert.ok(result.clientReport.limitations.length >= 5);
console.log("PASS: client report includes methodology and limitations");

const empty = buildSeoQualityReview({
  brief: {},
  marketingAssets: {
    personas: [],
    contentCalendar: []
  },
  now: "2026-11-01T00:00:00.000Z"
});
assert.equal(empty.keywordMap.length, 0);
assert.equal(empty.review.status, "PENDING_REVIEW");
console.log("PASS: empty-input compatibility");

assert.equal(
  Object.values(result.quality.dimensions)
    .reduce((sum, item) => sum + item.weight, 0),
  100
);
console.log("PASS: quality dimension weights total 100");

console.log("SEO_QUALITY_REVIEW_TEST=PASS");
