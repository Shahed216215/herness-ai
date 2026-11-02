"use strict";

/**
 * Stage 7.4
 * Opportunity Risk & Policy Engine
 *
 * Flow:
 * Opportunity
 *   -> Policy Check
 *   -> allowed | restricted | approval_required | blocked
 *
 * This engine evaluates opportunity risk/policy only.
 * It does NOT execute external actions, accept work,
 * access credentials, make payments, or create contracts.
 */

const POLICY_DECISIONS = Object.freeze([
  "allowed",
  "restricted",
  "approval_required",
  "blocked"
]);

const POLICY_CATEGORIES = Object.freeze([
  "scam",
  "credential_request",
  "suspicious_payment",
  "unauthorized_access",
  "unsafe_instruction",
  "ownership",
  "unrealistic_requirement"
]);

const POLICY_SEVERITY = Object.freeze([
  "low",
  "medium",
  "high",
  "critical"
]);

const DECISION_PRIORITY = Object.freeze({
  allowed: 0,
  restricted: 1,
  approval_required: 2,
  blocked: 3
});

const CATEGORY_DECISIONS = Object.freeze({
  scam: "blocked",
  credential_request: "approval_required",
  suspicious_payment: "approval_required",
  unauthorized_access: "blocked",
  unsafe_instruction: "blocked",
  ownership: "approval_required",
  unrealistic_requirement: "restricted"
});

const CATEGORY_SEVERITY = Object.freeze({
  scam: "critical",
  credential_request: "high",
  suspicious_payment: "high",
  unauthorized_access: "critical",
  unsafe_instruction: "critical",
  ownership: "high",
  unrealistic_requirement: "medium"
});

const PATTERNS = Object.freeze({
  scam: [
    /\bpay\s+(?:a\s+)?(?:fee|deposit|charge)\b/i,
    /\b(?:registration|activation|processing)\s+fee\b/i,
    /\bpay\s+to\s+(?:get|receive|unlock)\b/i,
    /\bguaranteed\s+(?:income|job|profit)\b/i,
    /\b(?:send|transfer)\s+money\s+(?:first|upfront)\b/i
  ],

  credential_request: [
    /\b(?:password|passcode|otp|one[-\s]?time\s+password)\b/i,
    /\b(?:api|access)\s+key\b/i,
    /\b(?:login|sign[-\s]?in)\s+(?:credentials|details)\b/i,
    /\b(?:username|email)\s+and\s+password\b/i,
    /\b(?:secret|token)\s+(?:key|value)\b/i
  ],

  suspicious_payment: [
    /\bpay\s+(?:me|us)\s+(?:first|upfront)\b/i,
    /\b(?:crypto|bitcoin|usdt|wallet)\s+(?:payment|transfer)\b/i,
    /\b(?:gift\s+card|prepaid\s+card)\b/i,
    /\b(?:refund|reimbursement)\s+(?:through|via)\s+(?:crypto|gift\s+card)\b/i,
    /\b(?:bank|card)\s+details\b/i
  ],

  unauthorized_access: [
    /\b(?:hack|break\s+into|bypass)\b[\s\S]{0,60}\b(?:account|system|server|website)\b/i,
    /\bunauthorized\s+access\b/i,
    /\b(?:steal|dump|exfiltrate)\s+(?:data|credentials)\b/i,
    /\b(?:disable|bypass)\s+(?:authentication|security|access\s+control)\b/i,
    /\b(?:access|use)\s+(?:someone\s+else's|another\s+person's)\s+account\b/i
  ],

  unsafe_instruction: [
    /\b(?:dangerous|unsafe)\s+instruction\b/i,
    /\b(?:weapon|explosive)\b/i,
    /\b(?:harm|injure)\s+(?:someone|a\s+person)\b/i,
    /\b(?:bypass|disable)\s+safety\b/i
  ],

  ownership: [
    /\b(?:send|publish|submit|post)\s+.*\b(?:as\s+me|on\s+my\s+behalf)\b/i,
    /\b(?:impersonat|pretend\s+to\s+be)\b/i,
    /\b(?:transfer|take\s+ownership)\s+(?:of|over)\b/i,
    /\b(?:sign|accept)\s+(?:contract|agreement|terms)\b/i,
    /\b(?:accept|agree\s+to)\s+.*\b(?:legally|binding)\b/i
  ],

  unrealistic_requirement: [
    /\b(?:immediately|instantly)\s+.*\b(?:expert|professional)\b/i,
    /\b(?:24\/7|around\s+the\s+clock)\s+.*\b(?:for\s+free|unpaid)\b/i,
    /\b(?:unlimited|unrealistic)\s+(?:work|revisions|deliverables)\b/i,
    /\b(?:impossible|unreasonable)\s+(?:deadline|requirement)\b/i
  ]
});

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function unique(values) {
  return [...new Set(values)];
}

function buildOpportunityText(opportunity = {}) {
  const values = [
    opportunity.title,
    opportunity.description,
    opportunity.category,
    opportunity.domain,
    opportunity.type,
    ...(Array.isArray(opportunity.requirements)
      ? opportunity.requirements
      : []),
    ...(Array.isArray(opportunity.skills)
      ? opportunity.skills
      : [])
  ];

  return values
    .filter(value => value !== undefined && value !== null)
    .map(String)
    .join(" ");
}

function detectCategory(category, text) {
  const patterns = PATTERNS[category] || [];
  const matches = [];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      matches.push(match[0]);
    }
  }

  return matches;
}

function evaluatePolicy(opportunity = {}) {
  const text = buildOpportunityText(opportunity);
  const findings = [];

  for (const category of POLICY_CATEGORIES) {
    const matches = detectCategory(category, text);

    if (matches.length === 0) {
      continue;
    }

    const decision =
      CATEGORY_DECISIONS[category];

    const severity =
      CATEGORY_SEVERITY[category];

    findings.push({
      category,
      decision,
      severity,
      matches: unique(matches)
    });
  }

  let decision = "allowed";

  for (const finding of findings) {
    if (
      DECISION_PRIORITY[finding.decision] >
      DECISION_PRIORITY[decision]
    ) {
      decision = finding.decision;
    }
  }

  const reasons = findings.map(finding => ({
    category: finding.category,
    severity: finding.severity,
    decision: finding.decision,
    matches: finding.matches
  }));

  return {
    decision,
    policyChecked: true,
    findings,
    reasons,
    governance: {
      externalActionAllowed: false,
      executionAllowed: false,
      acceptanceAllowed: false,
      paymentAllowed: false,
      contractAllowed: false
    }
  };
}

function getPolicyDecisionForCategory(category) {
  const normalized = normalize(category);

  if (!POLICY_CATEGORIES.includes(normalized)) {
    throw new Error(
      `Unknown policy category: ${category}`
    );
  }

  return {
    category: normalized,
    decision: CATEGORY_DECISIONS[normalized],
    severity: CATEGORY_SEVERITY[normalized]
  };
}

module.exports = {
  POLICY_DECISIONS,
  POLICY_CATEGORIES,
  POLICY_SEVERITY,
  DECISION_PRIORITY,
  CATEGORY_DECISIONS,
  CATEGORY_SEVERITY,
  buildOpportunityText,
  evaluatePolicy,
  getPolicyDecisionForCategory
};
