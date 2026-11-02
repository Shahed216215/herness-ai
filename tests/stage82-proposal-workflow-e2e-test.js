"use strict";

const {
  generateAndCheckProposal
} = require("../services/mira-proposal-workflow-engine");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runCase(name, input) {
  console.log(`\n--- ${name} ---`);

  const result =
    generateAndCheckProposal(input);

  console.log(
    "STATUS:",
    result.proposal.status
  );

  console.log(
    "ACCURACY:",
    result.accuracyCheck.passed
  );

  console.log(
    "POLICY:",
    result.policyCheck &&
    result.policyCheck.decision
  );

  console.log(
    "SEND BOUNDARY:",
    result.sendBoundary.status
  );

  console.log(
    "SEND ALLOWED:",
    result.sendBoundary.sendAllowed
  );

  console.log(
    "EXTERNAL ACTION:",
    result.externalActionPerformed
  );

  return result;
}

console.log(
  "\n=== STAGE 8.2 PROPOSAL WORKFLOW E2E TEST ==="
);

const safe =
  runCase(
    "SAFE PROPOSAL",
    {
      opportunity: {
        opportunityId:
          "stage82-safe-opportunity",
        clientId:
          "stage82-client",
        title:
          "Research and analysis project",
        description:
          "Analyze information and prepare a structured report.",
        requirements: [
          "Research",
          "Analysis"
        ],
        skills: [
          "Research"
        ]
      }
    }
  );

assert(
  safe.accuracyCheck.passed === true,
  "Safe proposal accuracy must pass."
);

assert(
  safe.policyCheck.decision === "allowed",
  "Safe proposal policy must be allowed."
);

assert(
  safe.proposal.status === "policy_checked",
  "Safe proposal must reach policy_checked."
);

assert(
  safe.sendBoundary.status ===
    "ready_for_review",
  "Safe proposal must reach review boundary."
);

assert(
  safe.sendBoundary.sendAllowed === false,
  "External sending must remain disabled."
);

assert(
  safe.externalActionPerformed === false,
  "No external action may be performed."
);

const credential =
  runCase(
    "CREDENTIAL REQUEST",
    {
      opportunity: {
        opportunityId:
          "stage82-credential-opportunity",
        title:
          "Research project",
        description:
          "Prepare a research report.",
        requirements: [
          "Research"
        ],
        skills: [
          "Research"
        ]
      },
      opening:
        "I will need your password and API key to begin."
    }
  );

assert(
  credential.accuracyCheck.passed === true,
  "Credential proposal should pass accuracy if the claim itself is not fabricated."
);

assert(
  credential.policyCheck.decision === "blocked",
  "Credential request must be blocked by policy."
);

assert(
  credential.proposal.status === "blocked",
  "Credential proposal must be blocked."
);

assert(
  credential.sendBoundary.status === "blocked",
  "Blocked proposal must have blocked send boundary."
);

assert(
  credential.sendBoundary.sendAllowed === false,
  "Blocked proposal must never be sendable."
);

const contract =
  runCase(
    "CONTRACT COMMITMENT",
    {
      opportunity: {
        opportunityId:
          "stage82-contract-opportunity",
        title:
          "Research project",
        description:
          "Prepare a research report.",
        requirements: [
          "Research"
        ],
        skills: [
          "Research"
        ]
      },
      opening:
        "I can sign the contract and accept the legally binding agreement."
    }
  );

assert(
  contract.accuracyCheck.passed === true,
  "Contract proposal should pass accuracy."
);

assert(
  contract.policyCheck.decision ===
    "approval_required",
  "Contract commitment must require approval."
);

assert(
  contract.proposal.status ===
    "approval_required",
  "Contract proposal must require approval."
);

assert(
  contract.sendBoundary.status ===
    "approval_required",
  "Contract proposal send boundary must require approval."
);

assert(
  contract.sendBoundary.sendAllowed === false,
  "Approval-required proposal must not be externally sendable."
);

const fakeExperience =
  runCase(
    "FABRICATED EXPERIENCE",
    {
      opportunity: {
        opportunityId:
          "stage82-experience-opportunity",
        title:
          "Research project",
        description:
          "Prepare a research report.",
        requirements: [
          "Research"
        ],
        skills: [
          "Research"
        ]
      }
    }
  );

assert(
  fakeExperience.accuracyCheck.passed === true,
  "Generated proposal must pass accuracy."
);

assert(
  fakeExperience.proposal.status ===
    "policy_checked",
  "Safe generated proposal must reach policy_checked."
);

assert(
  fakeExperience.sendBoundary.status ===
    "ready_for_review",
  "Safe generated proposal must stop at review boundary."
);

assert(
  fakeExperience.externalActionPerformed === false,
  "Proposal workflow must not perform external action."
);

console.log(
  "\nSAFE PIPELINE: PASS"
);

console.log(
  "CREDENTIAL BLOCK: PASS"
);

console.log(
  "CONTRACT APPROVAL BOUNDARY: PASS"
);

console.log(
  "FABRICATED EXPERIENCE BLOCK: PASS"
);

console.log(
  "\nSTAGE 8.2 PROPOSAL WORKFLOW E2E TEST: PASS"
);
