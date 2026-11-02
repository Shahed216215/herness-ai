"use strict";

const {
  discoverOpportunity
} = require(
  "../services/mira-opportunity-discovery-engine"
);

const {
  evaluateOpportunity
} = require(
  "../services/mira-opportunity-match-policy-engine"
);

const {
  countOpportunities,
  getOpportunity
} = require("../opportunity-store");

const sourceId =
  `stage71-e2e-${Date.now()}`;

const before =
  countOpportunities();

const discovered =
  discoverOpportunity({
    source: "manual",
    sourceId,

    title:
      "Research evidence analysis task",

    description:
      "Research a topic and organize evidence.",

    requirements: [
      " research ",
      "evidence analysis"
    ],

    skills: [
      " Research "
    ]
  });

if (!discovered.opportunityId) {
  throw new Error(
    "FAIL: opportunity ID missing"
  );
}

if (
  discovered.status !==
  "classified"
) {
  throw new Error(
    `FAIL: unexpected discovery status ${discovered.status}`
  );
}

if (
  discovered.domain !==
  "Research"
) {
  throw new Error(
    `FAIL: unexpected domain ${discovered.domain}`
  );
}

if (
  discovered.type !==
  "task"
) {
  throw new Error(
    `FAIL: unexpected type ${discovered.type}`
  );
}

const evaluated =
  evaluateOpportunity(
    discovered.opportunityId
  );

if (
  evaluated.status !==
  "risk_evaluated"
) {
  throw new Error(
    `FAIL: unexpected evaluated status ${evaluated.status}`
  );
}

if (
  !evaluated.capabilityMatch
) {
  throw new Error(
    "FAIL: capability match missing"
  );
}

if (
  !evaluated.risk
) {
  throw new Error(
    "FAIL: risk evaluation missing"
  );
}

if (
  evaluated.risk.level !==
  "low"
) {
  throw new Error(
    `FAIL: expected low risk, got ${evaluated.risk.level}`
  );
}

if (
  evaluated.risk.requiresHumanApproval !==
  false
) {
  throw new Error(
    "FAIL: low-risk opportunity unexpectedly requires approval"
  );
}

const persisted =
  getOpportunity(
    discovered.opportunityId
  );

if (!persisted) {
  throw new Error(
    "FAIL: evaluated opportunity not persisted"
  );
}

if (
  persisted.status !==
  "risk_evaluated"
) {
  throw new Error(
    "FAIL: persisted status mismatch"
  );
}

if (
  persisted.sourceId !==
  sourceId
) {
  throw new Error(
    "FAIL: provenance sourceId mismatch"
  );
}

const after =
  countOpportunities();

if (
  after !== before + 1
) {
  throw new Error(
    `FAIL: unexpected opportunity count ${before} -> ${after}`
  );
}

const governance =
  persisted.governance;

const forbiddenActions = [
  "externalActionAllowed",
  "executionAllowed",
  "acceptanceAllowed",
  "paymentAllowed",
  "contractAllowed"
];

for (const action of forbiddenActions) {
  if (governance[action] !== false) {
    throw new Error(
      `FAIL: forbidden boundary enabled: ${action}`
    );
  }
}

if (
  persisted.provenance.discoveredAt === null ||
  persisted.provenance.normalizedAt === null ||
  persisted.provenance.classifiedAt === null ||
  persisted.provenance.matchedAt === null ||
  persisted.provenance.riskEvaluatedAt === null
) {
  throw new Error(
    "FAIL: pipeline provenance timestamps incomplete"
  );
}

console.log(
  "PASS: discovery -> normalization -> classification"
);

console.log(
  "PASS: classification -> capability match -> risk evaluation"
);

console.log(
  "PASS: complete opportunity persistence"
);

console.log(
  "PASS: pipeline provenance"
);

console.log(
  "PASS: low-risk governance boundary"
);

console.log(
  "PASS: no execution/acceptance/payment/contract action"
);

console.log(
  "STAGE 7.1-E INTEGRATION E2E PASS"
);
