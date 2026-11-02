"use strict";

const OPPORTUNITY_STATUSES = Object.freeze([
  "discovered",
  "normalized",
  "classified",
  "matched",
  "risk_evaluated",
  "archived"
]);

const OPPORTUNITY_TYPES = Object.freeze([
  "job",
  "freelance",
  "project",
  "task",
  "gig",
  "other"
]);

const OPPORTUNITY_RISKS = Object.freeze([
  "low",
  "medium",
  "high",
  "critical",
  "unknown"
]);

const OPPORTUNITY_SOURCES = Object.freeze([
  "manual",
  "api",
  "web",
  "connector",
  "import",
  "internal"
]);

const OPPORTUNITY_EFFORT_LEVELS = Object.freeze([
  "small",
  "medium",
  "large",
  "unknown"
]);

const OPPORTUNITY_DIFFICULTY_LEVELS = Object.freeze([
  "easy",
  "moderate",
  "hard",
  "very_hard",
  "unknown"
]);

const UNDERSTANDING_COMPATIBILITY_STATUSES = Object.freeze([
  "compatible",
  "partially_compatible",
  "incompatible",
  "unknown"
]);

const MATCH_STATUSES = Object.freeze([
  "matched",
  "partially_matched",
  "not_matched",
  "unknown"
]);

const OPPORTUNITY_POLICY_DECISIONS = Object.freeze([
  "allowed",
  "restricted",
  "approval_required",
  "blocked",
  "unknown"
]);

function assertString(value, field, required = true) {
  if (
    required &&
    (typeof value !== "string" || value.trim().length === 0)
  ) {
    throw new Error(`${field} is required`);
  }

  if (
    value !== undefined &&
    value !== null &&
    typeof value !== "string"
  ) {
    throw new Error(`${field} must be a string`);
  }
}

function assertEnum(value, allowed, field) {
  if (value !== undefined && !allowed.includes(value)) {
    throw new Error(
      `${field} must be one of: ${allowed.join(", ")}`
    );
  }
}

function assertArray(value, field) {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
}

function createOpportunityUnderstanding(input = {}) {
  const requirements =
    Array.isArray(input.requirements)
      ? [...input.requirements]
      : [];

  const requirementsAnalysis =
    input.requirementsAnalysis || {
      items: [...requirements],
      deliverables: [],
      deadline: "",
      count: requirements.length,
      deliverableCount: 0
    };

  const skills =
    Array.isArray(input.skills)
      ? [...input.skills]
      : [];

  const effort =
    input.effort || {
      level: "unknown",
      estimatedMinutes: null,
      reasons: []
    };

  const difficulty =
    input.difficulty || {
      level: "unknown",
      score: null,
      reasons: []
    };

  const risk =
    input.risk || {
      level: "unknown",
      reasons: [],
      requiresHumanApproval: false
    };

  const compatibilityProfile =
    input.compatibilityProfile || {
      status: "unknown",
      score: null,
      matchedCapabilities: [],
      matchedSkills: [],
      missingCapabilities: [],
      missingSkills: [],
      verified: false
    };

  if (!Array.isArray(requirements)) {
    throw new Error("understanding.requirements must be an array");
  }

  if (!Array.isArray(skills)) {
    throw new Error("understanding.skills must be an array");
  }

  if (
    !requirementsAnalysis ||
    typeof requirementsAnalysis !== "object"
  ) {
    throw new Error(
      "understanding.requirementsAnalysis must be an object"
    );
  }

  if (
    !effort ||
    typeof effort !== "object"
  ) {
    throw new Error("understanding.effort must be an object");
  }

  if (
    !difficulty ||
    typeof difficulty !== "object"
  ) {
    throw new Error("understanding.difficulty must be an object");
  }

  if (
    !risk ||
    typeof risk !== "object"
  ) {
    throw new Error("understanding.risk must be an object");
  }

  if (
    !compatibilityProfile ||
    typeof compatibilityProfile !== "object"
  ) {
    throw new Error(
      "understanding.compatibilityProfile must be an object"
    );
  }

  assertEnum(
    effort.level,
    OPPORTUNITY_EFFORT_LEVELS,
    "understanding.effort.level"
  );

  assertEnum(
    difficulty.level,
    OPPORTUNITY_DIFFICULTY_LEVELS,
    "understanding.difficulty.level"
  );

  assertEnum(
    risk.level,
    OPPORTUNITY_RISKS,
    "understanding.risk.level"
  );

  assertEnum(
    compatibilityProfile.status,
    UNDERSTANDING_COMPATIBILITY_STATUSES,
    "understanding.compatibilityProfile.status"
  );

  return {
    task:
      input.task || null,

    requirements,

    requirementsAnalysis,

    skills,

    effort,

    difficulty,

    risk,

    compatibilityProfile
  };
}

function createOpportunity(input = {}) {
  const now = new Date().toISOString();

  const opportunity = {
    opportunityId:
      input.opportunityId ||
      `opportunity-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`,

    source: input.source || "manual",
    sourceId: input.sourceId || null,
    sourceUrl: input.sourceUrl || null,

    title: input.title || "",
    description: input.description || "",

    type: input.type || "other",
    category: input.category || "unknown",
    domain: input.domain || "unknown",

    requirements: Array.isArray(input.requirements)
      ? [...input.requirements]
      : [],

    skills: Array.isArray(input.skills)
      ? [...input.skills]
      : [],

    estimatedScope: input.estimatedScope || null,

    status: input.status || "discovered",

    capabilityMatch: input.capabilityMatch || {
      status: "unknown",
      score: null,
      matchedCapabilities: [],
      matchedSkills: [],
      missingCapabilities: [],
      missingSkills: []
    },

    risk: input.risk || {
      level: "unknown",
      reasons: [],
      requiresHumanApproval: false
    },

    policy: input.policy || {
      decision: "unknown",
      policyChecked: false,
      findings: [],
      reasons: [],
      evaluatedAt: null
    },

    governance: input.governance || {
      externalActionAllowed: false,
      executionAllowed: false,
      acceptanceAllowed: false,
      paymentAllowed: false,
      contractAllowed: false
    },

    provenance: input.provenance || {
      discoveredAt: now,
      normalizedAt: null,
      classifiedAt: null,
      matchedAt: null,
      riskEvaluatedAt: null
    },

    metadata: input.metadata || {},

    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };

  assertString(opportunity.opportunityId, "opportunityId");
  assertString(opportunity.title, "title");

  assertEnum(
    opportunity.source,
    OPPORTUNITY_SOURCES,
    "source"
  );

  assertEnum(
    opportunity.type,
    OPPORTUNITY_TYPES,
    "type"
  );

  assertEnum(
    opportunity.status,
    OPPORTUNITY_STATUSES,
    "status"
  );

  assertEnum(
    opportunity.risk.level,
    OPPORTUNITY_RISKS,
    "risk.level"
  );

  if (
    !opportunity.policy ||
    typeof opportunity.policy !== "object"
  ) {
    throw new Error("policy must be an object");
  }

  assertEnum(
    opportunity.policy.decision,
    OPPORTUNITY_POLICY_DECISIONS,
    "policy.decision"
  );

  assertArray(opportunity.policy.findings, "policy.findings");
  assertArray(opportunity.policy.reasons, "policy.reasons");

  assertEnum(
    opportunity.capabilityMatch.status,
    MATCH_STATUSES,
    "capabilityMatch.status"
  );

  assertArray(opportunity.requirements, "requirements");
  assertArray(opportunity.skills, "skills");

  return opportunity;
}

module.exports = {
  OPPORTUNITY_EFFORT_LEVELS,
  OPPORTUNITY_DIFFICULTY_LEVELS,
  UNDERSTANDING_COMPATIBILITY_STATUSES,
  createOpportunityUnderstanding,

  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_RISKS,
  OPPORTUNITY_SOURCES,
  MATCH_STATUSES,
  OPPORTUNITY_POLICY_DECISIONS,
  createOpportunity
};
