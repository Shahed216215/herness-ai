"use strict";

const assert = require("assert");

const {
  checkClaim,
  checkProposalAccuracy,
  applyAccuracyCheck
} = require("../services/mira-proposal-accuracy-engine");

const {
  createProposal
} = require("../proposal-schema");

console.log(
  "\n=== STAGE 8.2 PROPOSAL ACCURACY ENGINE TEST ==="
);

const safeClaim =
  checkClaim({
    type: "approach",
    text:
      "I will use a structured research workflow.",
    status: "supported",
    verified: false,
    evidence: []
  });

assert(
  safeClaim.blocked === false,
  "Safe approach claim must not be blocked."
);

const sensitiveTypes = [
  "experience",
  "skill",
  "result",
  "certification"
];

for (const type of sensitiveTypes) {
  const result =
    checkClaim({
      type,
      text:
        `I have professional ${type}.`,
      status: "supported",
      verified: false,
      evidence: []
    });

  assert(
    result.blocked === true,
    `Unsupported ${type} claim must be blocked.`
  );
}

const fabricatedProposal =
  createProposal({
    opportunityId:
      "stage82-accuracy-test",
    status: "draft",
    policyDecision: "unknown",
    sendBoundary: "not_ready",
    title: "Accuracy Test",
    opening:
      "A safe proposal opening.",
    understanding: [
      "Requirements understood."
    ],
    approach: [
      "Use evidence-based research."
    ],
    deliverables: [
      "Research report."
    ],
    claims: [
      {
        type: "experience",
        text:
          "I have extensive professional client experience.",
        status: "supported",
        verified: false,
        evidence: []
      }
    ],
    limitations: [],
    accuracyCheck: {
      passed: false,
      checkedClaims: 0,
      blockedClaims: 0,
      issues: [],
      checkedAt: null
    },
    policyCheck: {
      decision: "unknown",
      issues: [],
      checkedAt: null
    },
    approval: {
      required: true,
      approved: false,
      approvedAt: null
    }
  });

const accuracy =
  checkProposalAccuracy(
    fabricatedProposal
  );

assert(
  accuracy.passed === false,
  "Fabricated experience proposal must fail accuracy."
);

assert(
  accuracy.blockedClaims >= 1,
  "Fabricated experience must produce a blocked claim."
);

const applied =
  applyAccuracyCheck(
    fabricatedProposal
  );

assert(
  applied.accuracyCheck.passed === false,
  "Applied accuracy result must remain failed."
);

assert(
  applied.proposal.sendBoundary ===
    "blocked",
  "Failed accuracy must block sending."
);

console.log(
  "SAFE APPROACH BLOCKED:",
  safeClaim.blocked
);

for (const type of sensitiveTypes) {
  console.log(
    `UNSUPPORTED ${type.toUpperCase()} BLOCKED:`,
    checkClaim({
      type,
      text:
        `I have professional ${type}.`,
      status: "supported",
      verified: false,
      evidence: []
    }).blocked
  );
}

console.log(
  "FABRICATED PROPOSAL PASSED:",
  accuracy.passed
);
console.log(
  "FABRICATED BLOCKED CLAIMS:",
  accuracy.blockedClaims
);
console.log(
  "SEND BOUNDARY:",
  applied.proposal.sendBoundary
);
console.log(
  "STAGE 8.2 PROPOSAL ACCURACY ENGINE TEST: PASS"
);
