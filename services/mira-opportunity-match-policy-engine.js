"use strict";

const {
  listCapabilities,
  listSkills
} = require("./mira-capability-profile");

const {
  OPPORTUNITY_RISKS
} = require("../opportunity-schema");

const {
  getOpportunity,
  updateOpportunity
} = require("../opportunity-store");

const HUMAN_APPROVAL_KEYWORDS = Object.freeze([
  "contract",
  "agreement",
  "legal",
  "payment",
  "pay",
  "financial",
  "money",
  "invoice",
  "purchase",
  "accept offer",
  "accept job",
  "sign",
  "irreversible",
  "delete account",
  "close account",
  "credential",
  "password",
  "secret",
  "high risk"
]);

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function unique(values) {
  return [...new Set(values)];
}

function getCapabilityName(capability) {
  return (
    capability.name ||
    capability.key ||
    capability.capability ||
    ""
  );
}

function getSkillName(skill) {
  return (
    skill.name ||
    skill.key ||
    skill.skill ||
    ""
  );
}

function buildOpportunityText(opportunity) {
  return [
    opportunity.title,
    opportunity.description,
    ...(opportunity.requirements || []),
    ...(opportunity.skills || []),
    opportunity.category,
    opportunity.domain
  ]
    .map(normalize)
    .filter(Boolean)
    .join(" ");
}

function matchCapabilities(opportunity) {
  const capabilities =
    listCapabilities() || [];

  const skills =
    listSkills() || [];

  const requiredTerms = unique([
    ...(opportunity.requirements || []),
    ...(opportunity.skills || []),
    opportunity.domain
  ]
    .map(normalize)
    .filter(Boolean));

  const matchedCapabilities = [];
  const missingCapabilities = [];

  for (const requirement of requiredTerms) {
    const capabilityMatch =
      capabilities.find(capability => {
        const name =
          normalize(
            getCapabilityName(capability)
          );

        const supportedTasks =
          Array.isArray(
            capability.supportedTasks
          )
            ? capability.supportedTasks
                .map(normalize)
            : [];

        const capabilitySkills =
          Array.isArray(
            capability.skills
          )
            ? capability.skills.map(normalize)
            : [];

        return (
          name === requirement ||
          name.includes(requirement) ||
          requirement.includes(name) ||
          supportedTasks.some(
            task =>
              task.includes(requirement) ||
              requirement.includes(task)
          ) ||
          capabilitySkills.some(
            skill =>
              skill.includes(requirement) ||
              requirement.includes(skill)
          )
        );
      });

    if (capabilityMatch) {
      matchedCapabilities.push(
        getCapabilityName(capabilityMatch)
      );
    } else {
      missingCapabilities.push(
        requirement
      );
    }
  }

  const matchedSkills = [];

  for (const requiredSkill of (
    opportunity.skills || []
  )) {
    const target =
      normalize(requiredSkill);

    const skillMatch =
      skills.find(skill => {
        const name =
          normalize(
            getSkillName(skill)
          );

        return (
          name === target ||
          name.includes(target) ||
          target.includes(name)
        );
      });

    if (skillMatch) {
      matchedSkills.push(
        getSkillName(skillMatch)
      );
    }
  }

  const total =
    requiredTerms.length;

  const matched =
    matchedCapabilities.length;

  const score =
    total === 0
      ? 0
      : Number((matched / total).toFixed(2));

  let status = "unknown";

  if (total > 0 && score >= 0.8) {
    status = "matched";
  } else if (total > 0 && score > 0) {
    status = "partially_matched";
  } else if (total > 0) {
    status = "not_matched";
  }

  return {
    status,
    score,
    matchedCapabilities:
      unique(matchedCapabilities),
    matchedSkills:
      unique(matchedSkills),
    missingCapabilities:
      unique(missingCapabilities),
    missingSkills: (
      opportunity.skills || []
    ).filter(skill => {
      const target = normalize(skill);

      return !skills.some(item => {
        const name =
          normalize(getSkillName(item));

        return (
          name === target ||
          name.includes(target) ||
          target.includes(name)
        );
      });
    })
  };
}

function evaluateRisk(opportunity) {
  const text =
    buildOpportunityText(opportunity);

  const reasons = [];

  for (const keyword of HUMAN_APPROVAL_KEYWORDS) {
    if (text.includes(keyword)) {
      reasons.push(
        `contains sensitive action: ${keyword}`
      );
    }
  }

  if (
    opportunity.type === "job" &&
    text.includes("accept")
  ) {
    reasons.push(
      "job acceptance may create external commitment"
    );
  }

  if (
    opportunity.type === "freelance" ||
    opportunity.type === "project"
  ) {
    if (
      text.includes("client") &&
      (
        text.includes("contract") ||
        text.includes("payment")
      )
    ) {
      reasons.push(
        "client commitment or financial action detected"
      );
    }
  }

  let level = "low";

  if (
    reasons.some(reason =>
      reason.includes("contract") ||
      reason.includes("legal") ||
      reason.includes("financial") ||
      reason.includes("payment") ||
      reason.includes("irreversible")
    )
  ) {
    level = "critical";
  } else if (
    reasons.length > 0
  ) {
    level = "high";
  }

  return {
    level,
    reasons: unique(reasons),
    requiresHumanApproval:
      level === "high" ||
      level === "critical"
  };
}

function buildGovernance() {
  return {
    externalActionAllowed: false,
    executionAllowed: false,
    acceptanceAllowed: false,
    paymentAllowed: false,
    contractAllowed: false
  };
}

function evaluateOpportunity(opportunityId) {
  const opportunity =
    getOpportunity(opportunityId);

  if (!opportunity) {
    throw new Error(
      `Opportunity not found: ${opportunityId}`
    );
  }

  const capabilityMatch =
    matchCapabilities(opportunity);

  const risk =
    evaluateRisk(opportunity);

  return updateOpportunity(
    opportunityId,
    {
      status: "risk_evaluated",

      capabilityMatch,

      risk,

      governance:
        buildGovernance(),

      provenance: {
        ...(opportunity.provenance || {}),
        matchedAt:
          opportunity.provenance?.matchedAt ||
          new Date().toISOString(),
        riskEvaluatedAt:
          new Date().toISOString()
      }
    }
  );
}

module.exports = {
  HUMAN_APPROVAL_KEYWORDS,
  normalize,
  matchCapabilities,
  evaluateRisk,
  buildGovernance,
  evaluateOpportunity
};
