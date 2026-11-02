"use strict";

const assert = require("assert");

const {
  createOpportunity,
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_RISKS,
  OPPORTUNITY_SOURCES,
  MATCH_STATUSES
} = require("../opportunity-schema");

function baseInput() {
  return {
    source: "manual",
    sourceId: "schema-test-001",
    sourceUrl: "https://example.com/opportunity/schema-test-001",
    title: "Research task",
    description: "Analyze research data.",
    type: "task",
    category: "research",
    domain: "Research",
    requirements: ["Research"],
    skills: ["Research"],
    estimatedScope: "Small",
    status: "discovered"
  };
}

console.log(
  "STAGE 7.1-A OPPORTUNITY SCHEMA UNIT TEST"
);

const opportunity =
  createOpportunity(baseInput());

assert.ok(opportunity.opportunityId);
assert.strictEqual(
  opportunity.source,
  "manual"
);
assert.strictEqual(
  opportunity.sourceId,
  "schema-test-001"
);
assert.strictEqual(
  opportunity.status,
  "discovered"
);
assert.ok(opportunity.capabilityMatch);
assert.ok(opportunity.risk);
assert.ok(opportunity.governance);
assert.strictEqual(
  opportunity.governance.externalActionAllowed,
  false
);
assert.strictEqual(
  opportunity.governance.executionAllowed,
  false
);
assert.strictEqual(
  opportunity.governance.acceptanceAllowed,
  false
);
assert.strictEqual(
  opportunity.governance.paymentAllowed,
  false
);
assert.strictEqual(
  opportunity.governance.contractAllowed,
  false
);

console.log(
  "PASS: valid opportunity schema creation"
);

assert.ok(
  OPPORTUNITY_STATUSES.includes(
    "discovered"
  )
);
assert.ok(
  OPPORTUNITY_STATUSES.includes(
    "risk_evaluated"
  )
);
assert.ok(
  OPPORTUNITY_TYPES.includes("task")
);
assert.ok(
  OPPORTUNITY_RISKS.includes("critical")
);
assert.ok(
  OPPORTUNITY_SOURCES.includes("manual")
);
assert.ok(
  MATCH_STATUSES.includes("matched")
);

console.log(
  "PASS: opportunity schema enums"
);

assert.throws(
  () =>
    createOpportunity({
      ...baseInput(),
      title: ""
    }),
  /title/
);

assert.throws(
  () =>
    createOpportunity({
      ...baseInput(),
      source: "invalid-source"
    }),
  /source/
);

assert.throws(
  () =>
    createOpportunity({
      ...baseInput(),
      status: "invalid-status"
    }),
  /status/
);

console.log(
  "PASS: invalid opportunity rejection"
);

console.log(
  "STAGE 7.1-A SCHEMA UNIT PASS"
);
