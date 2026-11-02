"use strict";

const assert = require("assert");

const {
  matchCapabilities,
  evaluateRisk,
  buildGovernance
} = require("../services/mira-opportunity-match-policy-engine");

function makeOpportunity(overrides = {}) {
  return {
    opportunityId: "match-policy-unit-test",
    title: "Research task",
    description: "Analyze research information.",
    type: "task",
    category: "research",
    domain: "Research",
    requirements: ["Research"],
    skills: ["Research"],
    ...overrides
  };
}

console.log(
  "STAGE 7.1-D OPPORTUNITY MATCH/POLICY UNIT TEST"
);

const lowRiskOpportunity =
  makeOpportunity();

const match =
  matchCapabilities(lowRiskOpportunity);

assert.ok(match);
assert.ok(
  ["matched", "partially_matched", "not_matched", "unknown"]
    .includes(match.status)
);
assert.ok(
  Number.isFinite(match.score)
);
assert.ok(
  Array.isArray(match.matchedCapabilities)
);
assert.ok(
  Array.isArray(match.matchedSkills)
);
assert.ok(
  Array.isArray(match.missingCapabilities)
);
assert.ok(
  Array.isArray(match.missingSkills)
);

console.log(
  "PASS: capability matching result"
);

const lowRisk =
  evaluateRisk(lowRiskOpportunity);

assert.strictEqual(
  lowRisk.level,
  "low"
);
assert.strictEqual(
  lowRisk.requiresHumanApproval,
  false
);

console.log(
  "PASS: low-risk opportunity policy evaluation"
);

const sensitiveOpportunity =
  makeOpportunity({
    title: "Contract payment opportunity",
    description:
      "Sign a contract and receive payment."
  });

const sensitiveRisk =
  evaluateRisk(sensitiveOpportunity);

assert.ok(
  ["high", "critical"].includes(
    sensitiveRisk.level
  )
);
assert.strictEqual(
  sensitiveRisk.requiresHumanApproval,
  true
);
assert.ok(
  Array.isArray(sensitiveRisk.reasons)
);
assert.ok(
  sensitiveRisk.reasons.length > 0
);

console.log(
  "PASS: sensitive opportunity risk detection"
);

const governance =
  buildGovernance();

assert.strictEqual(
  governance.externalActionAllowed,
  false
);
assert.strictEqual(
  governance.executionAllowed,
  false
);
assert.strictEqual(
  governance.acceptanceAllowed,
  false
);
assert.strictEqual(
  governance.paymentAllowed,
  false
);
assert.strictEqual(
  governance.contractAllowed,
  false
);

console.log(
  "PASS: opportunity governance boundaries"
);

console.log(
  "STAGE 7.1-D MATCH/POLICY UNIT PASS"
);
