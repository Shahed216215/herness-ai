"use strict";

/**
 * Stage 8.2
 * Proposal Policy Check Engine
 *
 * Flow:
 * Opportunity
 *   -> Proposal
 *   -> Policy Check
 *   -> allowed | restricted | approval_required | blocked
 *   -> Send/Approval Boundary
 *
 * This engine does NOT send proposals, accept work,
 * create contracts, make payments, access credentials,
 * or perform external actions.
 */

const {
  evaluatePolicy: evaluateOpportunityPolicy
} = require("./mira-opportunity-risk-policy-engine");

const POLICY_DECISIONS = Object.freeze([
  "allowed",
  "restricted",
  "approval_required",
  "blocked"
]);

const DECISION_PRIORITY = Object.freeze({
  allowed: 0,
  restricted: 1,
  approval_required: 2,
  blocked: 3
});

const CONTENT_PATTERNS = Object.freeze({
  credential_request: [
    /\b(?:password|passcode|otp|one[-\s]?time\s+password)\b/i,
    /\b(?:api|access)\s+key\b/i,
    /\b(?:login|sign[-\s]?in)\s+(?:credentials|details)\b/i,
    /\b(?:username|email)\s+and\s+password\b/i,
    /\b(?:secret|token)\s+(?:key|value)\b/i
  ],

  financial_commitment: [
    /\b(?:payment|pay|refund|money|price|fee|deposit|transfer)\b/i,
    /\b(?:bank|card)\s+details\b/i,
    /\b(?:crypto|bitcoin|usdt|wallet)\b/i
  ],

  contractual_commitment: [
    /\b(?:sign|accept)\s+(?:the\s+)?(?:contract|agreement|terms)\b/i,
    /\b(?:contract|agreement|terms)\s+(?:is|are)\s+(?:binding|accepted)\b/i,
    /\blegally\s+binding\b/i
  ],

  legal_commitment: [
    /\b(?:legal|law|liability|liable|guarantee)\b/i,
    /\b(?:legally|legally\s+binding)\b/i
  ],

  impersonation: [
    /\b(?:as\s+me|on\s+my\s+behalf)\b/i,
    /\b(?:impersonat|pretend\s+to\s+be)\b/i
  ],

  irreversible_action: [
    /\b(?:delete|close\s+account|cancel\s+permanently)\b/i
  ]
});

function now() {
  return new Date().toISOString();
}

function cleanText(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function unique(values) {
  return [...new Set(values)];
}

function buildProposalText(proposal = {}) {
  const values = [
    proposal.title,
    proposal.opening,
    ...(Array.isArray(proposal.understanding)
      ? proposal.understanding
      : []),
    ...(Array.isArray(proposal.approach)
      ? proposal.approach
      : []),
    ...(Array.isArray(proposal.deliverables)
      ? proposal.deliverables
      : []),
    ...(Array.isArray(proposal.limitations)
      ? proposal.limitations
      : [])
  ];

  if (Array.isArray(proposal.claims)) {
    for (const claim of proposal.claims) {
      if (claim && typeof claim === "object") {
        values.push(claim.text);
      }
    }
  }

  return values
    .filter(value => value !== undefined && value !== null)
    .map(String)
    .join(" ");
}

function detectContentFindings(text) {
  const findings = [];

  for (const [category, patterns] of Object.entries(
    CONTENT_PATTERNS
  )) {
    const matches = [];

    for (const pattern of patterns) {
      const match = text.match(pattern);

      if (match) {
        matches.push(match[0]);
      }
    }

    if (matches.length > 0) {
      findings.push({
        category,
        matches: unique(matches)
      });
    }
  }

  return findings;
}

function evaluateClaimPolicy(proposal = {}) {
  const findings = [];

  const claims = Array.isArray(proposal.claims)
    ? proposal.claims
    : [];

  for (const claim of claims) {
    if (!claim || typeof claim !== "object") {
      findings.push({
        category: "invalid_claim",
        decision: "blocked",
        reason: "Invalid proposal claim."
      });
      continue;
    }

    const type =
      cleanText(claim.type);

    const status =
      cleanText(claim.status);

    const verified =
      claim.verified === true;

    if (
      [
        "experience",
        "skill",
        "result",
        "certification"
      ].includes(type) &&
      (
        status !== "verified" ||
        !verified
      )
    ) {
      findings.push({
        category: `unsupported_${type}_claim`,
        decision: "blocked",
        reason:
          `Unsupported ${type} claim cannot pass proposal policy.`
      });
    }
  }

  return findings;
}

function evaluateProposalPolicy(
  proposal = {},
  opportunity = {}
) {
  const opportunityPolicy =
    evaluateOpportunityPolicy(
      opportunity || {}
    );

  const proposalText =
    buildProposalText(
      proposal || {}
    );

  const contentFindings =
    detectContentFindings(
      proposalText
    );

  const claimFindings =
    evaluateClaimPolicy(
      proposal || {}
    );

  const findings = [];

  for (const finding of opportunityPolicy.findings || []) {
    findings.push({
      source: "opportunity",
      ...finding
    });
  }

  for (const finding of contentFindings) {
    const decision =
      [
        "credential_request",
        "impersonation",
        "irreversible_action"
      ].includes(finding.category)
        ? "blocked"
        : "approval_required";

    findings.push({
      source: "proposal",
      category: finding.category,
      decision,
      matches: finding.matches
    });
  }

  for (const finding of claimFindings) {
    findings.push({
      source: "proposal_claim",
      ...finding
    });
  }

  let decision = "allowed";

  for (const finding of findings) {
    const findingDecision =
      finding.decision || "allowed";

    if (
      DECISION_PRIORITY[findingDecision] >
      DECISION_PRIORITY[decision]
    ) {
      decision = findingDecision;
    }
  }

  const issues =
    findings.map(finding => ({
      source: finding.source,
      category: finding.category,
      decision: finding.decision,
      reason:
        finding.reason ||
        `${finding.category} policy finding detected.`,
      matches: finding.matches || []
    }));

  return {
    decision,
    policyChecked: true,
    issues,
    findings,
    governance: {
      externalSendAllowed: false,
      executionAllowed: false,
      acceptanceAllowed: false,
      paymentAllowed: false,
      contractAllowed: false,
      credentialAccessAllowed: false
    },
    checkedAt: now()
  };
}

function applyPolicyCheck(
  proposal,
  opportunity = {}
) {
  const policyCheck =
    evaluateProposalPolicy(
      proposal,
      opportunity
    );

  const updated = {
    ...proposal,
    policyDecision:
      policyCheck.decision,
    policyCheck
  };

  if (
    policyCheck.decision === "blocked"
  ) {
    updated.status = "blocked";
    updated.sendBoundary = "blocked";
  } else if (
    policyCheck.decision ===
    "approval_required"
  ) {
    updated.status = "approval_required";
    updated.sendBoundary =
      "approval_required";
  } else {
    updated.status = "policy_checked";
    updated.sendBoundary =
      "ready_for_review";
  }

  return {
    proposal: updated,
    policyCheck
  };
}

module.exports = {
  POLICY_DECISIONS,
  DECISION_PRIORITY,
  buildProposalText,
  detectContentFindings,
  evaluateClaimPolicy,
  evaluateProposalPolicy,
  applyPolicyCheck
};
