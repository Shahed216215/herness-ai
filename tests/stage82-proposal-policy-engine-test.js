"use strict";

const {
  createProposal,
  validateProposal
} = require("../proposal-schema");

const {
  evaluateProposalPolicy,
  applyPolicyCheck
} = require("../services/mira-proposal-policy-engine");

function makeProposal(overrides = {}) {
  return createProposal({
    opportunityId: "stage82-policy-test",
    clientId: "client-stage82",
    title: "Research and analysis project",
    opening:
      "I can help analyze the provided requirements and prepare a clear deliverable.",
    understanding: [
      "Requirements will be reviewed before execution.",
      "The available capabilities will be used."
    ],
    approach: [
      "Review requirements",
      "Analyze available information",
      "Prepare the requested deliverable",
      "Verify the final output"
    ],
    deliverables: [
      "Structured analysis",
      "Verified final deliverable"
    ],
    claims: [
      {
        type: "capability",
        text: "I can perform structured research.",
        status: "supported",
        verified: false,
        evidence: []
      }
    ],
    limitations: [
      "No unsupported experience or certification claims are made.",
      "External sending requires the appropriate boundary."
    ],
    ...overrides
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

console.log("\n=== STAGE 8.2 PROPOSAL POLICY ENGINE TEST ===");

const safe = makeProposal();
const safePolicy = evaluateProposalPolicy(
  safe,
  {
    title: "Research project",
    description: "Analyze information and prepare a report.",
    requirements: ["Research", "Analysis"],
    skills: ["Research"]
  }
);

console.log("SAFE DECISION:", safePolicy.decision);
console.log("SAFE ISSUES:", safePolicy.issues.length);

assert(
  safePolicy.decision === "allowed",
  "Safe proposal should be allowed."
);

assert(
  safePolicy.issues.length === 0,
  "Safe proposal should have no policy issues."
);

const credential = makeProposal({
  opening:
    "Please send me your password and API key so I can start."
});

const credentialPolicy =
  evaluateProposalPolicy(
    credential,
    {}
  );

console.log(
  "CREDENTIAL DECISION:",
  credentialPolicy.decision
);

assert(
  credentialPolicy.decision === "blocked",
  "Credential request must be blocked."
);

const contract = makeProposal({
  approach: [
    "Sign the contract and agreement",
    "Accept the legally binding terms"
  ]
});

const contractPolicy =
  evaluateProposalPolicy(
    contract,
    {}
  );

console.log(
  "CONTRACT DECISION:",
  contractPolicy.decision
);

assert(
  contractPolicy.decision ===
    "approval_required",
  "Contract commitment must require approval."
);

const payment = makeProposal({
  deliverables: [
    "Prepare the report",
    "Payment and money transfer will be handled in the proposal"
  ]
});

const paymentPolicy =
  evaluateProposalPolicy(
    payment,
    {}
  );

console.log(
  "PAYMENT DECISION:",
  paymentPolicy.decision
);

assert(
  paymentPolicy.decision ===
    "approval_required",
  "Financial content must require approval."
);

const impersonation = makeProposal({
  opening:
    "I will submit this proposal on my behalf as me."
});

const impersonationPolicy =
  evaluateProposalPolicy(
    impersonation,
    {}
  );

console.log(
  "IMPERSONATION DECISION:",
  impersonationPolicy.decision
);

assert(
  impersonationPolicy.decision === "blocked",
  "Impersonation must be blocked."
);

const unsupportedExperience =
  makeProposal({
    claims: [
      {
        type: "experience",
        text:
          "I have 10 years of professional client experience.",
        status: "supported",
        verified: false,
        evidence: []
      }
    ]
  });

const experiencePolicy =
  evaluateProposalPolicy(
    unsupportedExperience,
    {}
  );

console.log(
  "UNSUPPORTED EXPERIENCE DECISION:",
  experiencePolicy.decision
);

assert(
  experiencePolicy.decision === "blocked",
  "Unsupported experience claim must be blocked."
);

const applied =
  applyPolicyCheck(
    safe,
    {
      title: "Research project",
      description: "Analyze information and prepare a report.",
      requirements: ["Research"],
      skills: ["Research"]
    }
  );

console.log(
  "APPLIED STATUS:",
  applied.proposal.status
);

console.log(
  "APPLIED SEND BOUNDARY:",
  applied.proposal.sendBoundary
);

assert(
  applied.proposal.status === "policy_checked",
  "Safe proposal should become policy_checked."
);

assert(
  applied.proposal.sendBoundary ===
    "ready_for_review",
  "Safe proposal must remain at review boundary."
);

const blockedApplied =
  applyPolicyCheck(
    credential,
    {}
  );

console.log(
  "BLOCKED APPLIED STATUS:",
  blockedApplied.proposal.status
);

console.log(
  "BLOCKED SEND BOUNDARY:",
  blockedApplied.proposal.sendBoundary
);

assert(
  blockedApplied.proposal.status === "blocked",
  "Blocked proposal status must be blocked."
);

assert(
  blockedApplied.proposal.sendBoundary === "blocked",
  "Blocked proposal send boundary must be blocked."
);

const validation =
  validateProposal(
    applied.proposal
  );

console.log(
  "FINAL VALID:",
  validation.valid
);

console.log(
  "FINAL ERRORS:",
  validation.errors
);

assert(
  validation.valid,
  "Policy-checked safe proposal must remain schema-valid."
);

console.log(
  "STAGE 8.2 PROPOSAL POLICY ENGINE TEST: PASS"
);
