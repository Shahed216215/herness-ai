"use strict";

const assert = require("node:assert/strict");
const {
  generateMarketingAssets
} = require("../services/mira-marketing-assets");

const now = "2026-11-01T00:00:00.000Z";

const result = generateMarketingAssets({
  now,
  brief: {
    keywords: [
      "AI automation agency",
      "how to automate business workflows",
      "AI automation pricing",
      "AI automation agency comparison",
      "official login"
    ]
  },
  audit: {
    keywordAnalysis: [
      { keyword: "workflow automation guide", intent: "informational" }
    ]
  },
  research: {
    results: [{
      title: "Example research source",
      url: "https://example.com/research",
      evidenceStatus: "source_reference_complete"
    }]
  }
});

assert.ok(result.personas.length <= 3);
assert.ok(result.contentCalendar.length <= 12);
assert.ok(result.personas.length > 0);
assert.ok(result.contentCalendar.length > 0);

for (const p of result.personas) {
  assert.equal(p.type, "hypothesis");
  assert.equal(p.confidence, "low");
  assert.equal(
    p.evidenceUse,
    "market_context_only_not_customer_validation"
  );
  assert.ok(!("age" in p));
  assert.ok(!("income" in p));
  assert.ok(!("companySize" in p));
}

for (const item of result.contentCalendar) {
  assert.equal(item.publicationAuthorized, false);
  assert.equal(item.status, "PLANNED_REQUIRES_HUMAN_REVIEW");
  assert.ok(item.scheduledDate >= "2026-11-01");
  assert.ok(item.scheduledDate <= "2026-12-01");
  assert.notEqual(item.searchIntent, "navigational");
}

assert.equal(
  result.personas[0].evidenceRefs[0].use,
  "market_context_only_not_customer_validation"
);

const empty = generateMarketingAssets({
  now,
  brief: { keywords: [] },
  audit: {},
  research: {}
});
assert.deepEqual(empty.personas, []);
assert.deepEqual(empty.contentCalendar, []);

console.log("MARKETING_ASSET_TEST=PASS");
console.log("PERSONA_HYPOTHESIS_LIMIT=PASS");
console.log("NO_INVENTED_DEMOGRAPHICS=PASS");
console.log("CALENDAR_DATE_BOUNDARY=PASS");
console.log("PUBLICATION_GOVERNANCE=PASS");
console.log("EMPTY_INPUT_COMPATIBILITY=PASS");
