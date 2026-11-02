"use strict";

const assert = require("assert");

const {
  generateProposal
} = require("../services/mira-proposal-generation-engine");

const {
  validateProposal
} = require("../proposal-schema");

console.log(
  "\n=== STAGE 8.2 PROPOSAL GENERATION ENGINE TEST ==="
);

const result =
  generateProposal({
    opportunity: {
      opportunityId:
        "stage82-generation-test",
      title:
        "Research Report Project",
      description:
        "Prepare a structured research report.",
      requirements: [
        "Research",
        "Evidence analysis"
      ],
      skills: [
        "Research"
      ]
    }
  });

assert(
  result.proposal,
  "Proposal must be generated."
);

assert(
  result.proposal.opportunityId ===
    "stage82-generation-test",
  "Opportunity ID must be preserved."
);

assert(
  result.proposal.status === "draft",
  "Generated proposal must start as draft."
);

assert(
  Array.isArray(
    result.proposal.understanding
  ),
  "Understanding must be an array."
);

assert(
  Array.isArray(
    result.proposal.approach
  ),
  "Approach must be an array."
);

assert(
  Array.isArray(
    result.proposal.deliverables
  ),
  "Deliverables must be an array."
);

assert(
  Array.isArray(
    result.proposal.claims
  ),
  "Claims must be an array."
);

const validation =
  validateProposal(
    result.proposal
  );

assert(
  validation.valid === true,
  "Generated proposal must be schema-valid."
);

const fabricatedVerifiedClaims =
  result.proposal.claims.filter(
    claim =>
      claim &&
      claim.verified === true &&
      [
        "experience",
        "skill",
        "result",
        "certification"
      ].includes(claim.type) &&
      !Array.isArray(claim.evidence)
        ? true
        : false
  );

assert(
  fabricatedVerifiedClaims.length === 0,
  "Generated proposal must not contain fabricated verified claims."
);

assert(
  result.proposal.approval &&
    result.proposal.approval.required === true,
  "Proposal must retain approval requirement."
);

console.log(
  "PROPOSAL:",
  result.proposal.proposalId
);
console.log(
  "STATUS:",
  result.proposal.status
);
console.log(
  "UNDERSTANDING:",
  result.proposal.understanding.length
);
console.log(
  "APPROACH:",
  result.proposal.approach.length
);
console.log(
  "DELIVERABLES:",
  result.proposal.deliverables.length
);
console.log(
  "CLAIMS:",
  result.proposal.claims.length
);
console.log(
  "VALID:",
  validation.valid
);
console.log(
  "STAGE 8.2 PROPOSAL GENERATION ENGINE TEST: PASS"
);
