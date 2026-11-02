"use strict";

const assert = require("assert");

const {
  createStoredOpportunity,
  getOpportunity,
  listOpportunities,
  updateOpportunity,
  findDuplicateOpportunity,
  countOpportunities,
  getStorePath
} = require("../opportunity-store");

function testInput() {
  const suffix = Date.now();

  return {
    source: "manual",
    sourceId: `store-unit-${suffix}`,
    sourceUrl: `https://example.com/opportunity/store-unit-${suffix}`,
    title: "Store unit test opportunity",
    description: "Testing opportunity persistence.",
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
  "STAGE 7.1-B OPPORTUNITY STORE UNIT TEST"
);

const input = testInput();
const beforeCount = countOpportunities();

const created =
  createStoredOpportunity(input);

assert.ok(created.opportunityId);
assert.strictEqual(
  created.sourceId,
  input.sourceId
);

console.log(
  "PASS: opportunity store creation"
);

const loaded =
  getOpportunity(created.opportunityId);

assert.ok(loaded);
assert.strictEqual(
  loaded.opportunityId,
  created.opportunityId
);
assert.strictEqual(
  loaded.title,
  input.title
);

console.log(
  "PASS: opportunity persistence and lookup"
);

const duplicate =
  findDuplicateOpportunity(input);

assert.ok(duplicate);
assert.strictEqual(
  duplicate.opportunityId,
  created.opportunityId
);

console.log(
  "PASS: duplicate opportunity detection"
);

assert.throws(
  () =>
    createStoredOpportunity(input),
  /duplicate/i
);

console.log(
  "PASS: duplicate opportunity protection"
);

const updated =
  updateOpportunity(
    created.opportunityId,
    {
      title: "Updated store unit test opportunity",
      status: "normalized"
    }
  );

assert.strictEqual(
  updated.opportunityId,
  created.opportunityId
);
assert.strictEqual(
  updated.title,
  "Updated store unit test opportunity"
);
assert.strictEqual(
  updated.status,
  "normalized"
);

console.log(
  "PASS: opportunity update"
);

const filtered =
  listOpportunities({
    source: "manual",
    domain: "Research"
  });

assert.ok(
  filtered.some(
    item =>
      item.opportunityId ===
      created.opportunityId
  )
);

console.log(
  "PASS: opportunity filtering"
);

const afterCount = countOpportunities();

assert.strictEqual(
  afterCount,
  beforeCount + 1
);

console.log(
  "PASS: opportunity count integrity"
);

assert.ok(
  getStorePath().endsWith(
    "data/opportunities.json"
  )
);

console.log(
  "PASS: opportunity store path"
);

console.log(
  "STAGE 7.1-B STORE UNIT PASS"
);
