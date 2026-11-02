"use strict";

const {
  parseTask
} = require("../task-parser");

const {
  listCapabilities,
  listSkills
} = require("./mira-capability-profile");

const {
  createOpportunityUnderstanding,
  OPPORTUNITY_EFFORT_LEVELS,
  OPPORTUNITY_DIFFICULTY_LEVELS
} = require("../opportunity-schema");

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function unique(values = []) {
  return [
    ...new Set(
      values
        .map(value => String(value || "").trim())
        .filter(Boolean)
    )
  ];
}

function isVerified(item) {
  return item?.verification === "verified";
}

function isActive(item) {
  return (
    !item?.status ||
    item.status === "active"
  );
}

function getCapabilityName(capability) {
  return String(
    capability?.name ||
    capability?.key ||
    capability?.id ||
    ""
  ).trim();
}

function getSkillName(skill) {
  return String(
    skill?.name ||
    skill?.key ||
    skill?.skill ||
    ""
  ).trim();
}

function findRegisteredSkill(
  requiredSkill,
  skills
) {
  const target = normalize(requiredSkill);

  return (
    skills.find(
      skill =>
        normalize(
          getSkillName(skill)
        ) === target
    ) || null
  );
}

function findCapabilityForSkill(
  requiredSkill,
  capabilities,
  skills
) {
  const target = normalize(requiredSkill);

  for (const capability of capabilities) {
    const capabilitySkills =
      Array.isArray(capability.skills)
        ? capability.skills
        : [];

    if (
      capabilitySkills.some(
        skill =>
          normalize(skill) === target
      )
    ) {
      return capability;
    }
  }

  const registeredSkill =
    findRegisteredSkill(
      requiredSkill,
      skills
    );

  if (
    registeredSkill &&
    Array.isArray(
      registeredSkill.capabilities
    )
  ) {
    for (
      const capabilityRef
      of registeredSkill.capabilities
    ) {
      const capabilityId =
        capabilityRef?.capabilityId ||
        capabilityRef?.id ||
        capabilityRef;

      const capability =
        capabilities.find(
          item =>
            item.id === capabilityId ||
            item.capabilityId === capabilityId
        );

      if (capability) {
        return capability;
      }
    }
  }

  return null;
}

function analyzeSkills(
  requiredSkills,
  capabilities,
  skills
) {
  return unique(requiredSkills).map(
    requiredSkill => {
      const registeredSkill =
        findRegisteredSkill(
          requiredSkill,
          skills
        );

      const capability =
        findCapabilityForSkill(
          requiredSkill,
          capabilities,
          skills
        );

      const skillVerified =
        !!registeredSkill &&
        isVerified(registeredSkill);

      const capabilityVerified =
        !!capability &&
        isVerified(capability);

      const active =
        (!registeredSkill ||
          isActive(registeredSkill)) &&
        (!capability ||
          isActive(capability));

      let status = "missing";

      if (
        registeredSkill &&
        capabilityVerified &&
        skillVerified &&
        active
      ) {
        status = "verified";
      } else if (
        registeredSkill ||
        capability
      ) {
        status = active
          ? "unverified"
          : "inactive";
      }

      return {
        skill: requiredSkill,
        status,
        registered: !!registeredSkill,
        skillVerified,
        capabilityVerified,
        active,
        capabilityId:
          capability?.id ||
          capability?.capabilityId ||
          null,
        capabilityName:
          getCapabilityName(
            capability
          ) || null
      };
    }
  );
}

function analyzeRequirements(
  task
) {
  const requirements =
    Array.isArray(task.requirements)
      ? [...task.requirements]
      : [];

  const deliverables =
    Array.isArray(task.deliverables)
      ? [...task.deliverables]
      : [];

  return {
    items: unique(requirements),
    deliverables: unique(deliverables),
    deadline: task.deadline || "",
    count: requirements.length,
    deliverableCount:
      deliverables.length
  };
}

function estimateEffort(
  task,
  requirementsAnalysis
) {
  const requirementCount =
    requirementsAnalysis.count;

  const deliverableCount =
    requirementsAnalysis.deliverableCount;

  const hasDeadline =
    !!requirementsAnalysis.deadline;

  const difficulty =
    task.difficulty;

  let score = 0;
  const reasons = [];

  score += requirementCount * 1;

  if (requirementCount > 0) {
    reasons.push(
      `${requirementCount} requirement(s)`
    );
  }

  score += deliverableCount * 2;

  if (deliverableCount > 0) {
    reasons.push(
      `${deliverableCount} deliverable(s)`
    );
  }

  if (hasDeadline) {
    score += 1;
    reasons.push(
      "deadline is specified"
    );
  }

  if (difficulty === "medium") {
    score += 2;
    reasons.push(
      "medium difficulty"
    );
  }

  if (difficulty === "hard") {
    score += 4;
    reasons.push(
      "hard difficulty"
    );
  }

  if (difficulty === "expert") {
    score += 6;
    reasons.push(
      "expert difficulty"
    );
  }

  let level = "unknown";
  let estimatedMinutes = null;

  if (score <= 2) {
    level = "small";
    estimatedMinutes = 30;
  } else if (score <= 5) {
    level = "medium";
    estimatedMinutes = 90;
  } else {
    level = "large";
    estimatedMinutes = 180;
  }

  return {
    level,
    estimatedMinutes,
    score,
    reasons
  };
}

function normalizeDifficulty(
  task
) {
  switch (task.difficulty) {
    case "easy":
      return "easy";

    case "medium":
      return "moderate";

    case "hard":
      return "hard";

    case "expert":
      return "very_hard";

    default:
      return "unknown";
  }
}

function analyzeDifficulty(
  task,
  effort
) {
  const level =
    normalizeDifficulty(task);

  const reasons = [];

  if (task.difficulty !== "unknown") {
    reasons.push(
      `parser difficulty: ${task.difficulty}`
    );
  }

  if (effort.level !== "unknown") {
    reasons.push(
      `effort estimate: ${effort.level}`
    );
  }

  let score = null;

  if (level === "easy") score = 0.25;
  if (level === "moderate") score = 0.5;
  if (level === "hard") score = 0.75;
  if (level === "very_hard") score = 1;

  return {
    level,
    score,
    reasons
  };
}

function analyzeRisk(task) {
  const level =
    task.risk || "low";

  const reasons = [];

  if (level === "low") {
    reasons.push(
      "no high-risk action detected by task parser"
    );
  } else {
    reasons.push(
      `task parser classified risk as ${level}`
    );
  }

  return {
    level,
    reasons,
    requiresHumanApproval:
      level === "high" ||
      level === "critical"
  };
}

function buildCompatibilityProfile(
  skillAnalysis
) {
  const matchedSkills =
    skillAnalysis
      .filter(
        item =>
          item.status === "verified"
      )
      .map(item => item.skill);

  const missingSkills =
    skillAnalysis
      .filter(
        item =>
          item.status === "missing"
      )
      .map(item => item.skill);

  const unverifiedSkills =
    skillAnalysis
      .filter(
        item =>
          item.status === "unverified"
      )
      .map(item => item.skill);

  const inactiveSkills =
    skillAnalysis
      .filter(
        item =>
          item.status === "inactive"
      )
      .map(item => item.skill);

  const matchedCapabilities =
    unique(
      skillAnalysis
        .filter(
          item =>
            item.status === "verified"
        )
        .map(
          item =>
            item.capabilityName
        )
    );

  const availableCapabilities =
    unique(
      skillAnalysis
        .filter(
          item =>
            item.capabilityName &&
            item.status !== "missing"
        )
        .map(
          item =>
            item.capabilityName
        )
    );

  const missingCapabilities =
    unique(
      skillAnalysis
        .filter(
          item =>
            item.status === "missing"
        )
        .map(
          item =>
            item.capabilityName
        )
        .filter(Boolean)
    );

  const total =
    skillAnalysis.length;

  const verified =
    matchedSkills.length;

  const score =
    total === 0
      ? null
      : verified / total;

  let status = "unknown";

  if (total > 0) {
    const hasMissing =
      missingSkills.length > 0;

    const hasUnverified =
      unverifiedSkills.length > 0;

    const hasInactive =
      inactiveSkills.length > 0;

    if (
      score === 1 &&
      !hasMissing &&
      !hasUnverified &&
      !hasInactive
    ) {
      status = "compatible";
    } else if (
      matchedSkills.length > 0 ||
      availableCapabilities.length > 0 ||
      hasUnverified ||
      hasInactive
    ) {
      status = "partially_compatible";
    } else {
      status = "incompatible";
    }
  }

  return {
    status,
    score,
    matchedCapabilities,
    availableCapabilities,
    matchedSkills,
    missingCapabilities,
    missingSkills,
    unverifiedSkills,
    inactiveSkills,
    verified:
      total > 0 &&
      verified === total
  };
}

function understandOpportunity(
  input = {}
) {
  const rawText =
    typeof input === "string"
      ? input
      : input.text ||
        input.description ||
        input.title ||
        "";

  const task =
    parseTask(rawText);

  const opportunityRequirements =
    Array.isArray(input.requirements)
      ? [...input.requirements]
      : [];

  const opportunitySkills =
    Array.isArray(input.skills)
      ? [...input.skills]
      : [];

  if (opportunityRequirements.length > 0) {
    task.requirements = unique([
      ...(Array.isArray(task.requirements)
        ? task.requirements
        : []),
      ...opportunityRequirements
    ]);
  }

  if (opportunitySkills.length > 0) {
    task.requiredSkills = unique([
      ...(Array.isArray(task.requiredSkills)
        ? task.requiredSkills
        : []),
      ...opportunitySkills.map(normalize)
    ]);
  }

  const capabilities =
    listCapabilities();

  const skills =
    listSkills();

  const requirements =
    analyzeRequirements(task);

  const skillAnalysis =
    analyzeSkills(
      task.requiredSkills,
      capabilities,
      skills
    );

  const effort =
    estimateEffort(
      task,
      requirements
    );

  const difficulty =
    analyzeDifficulty(
      task,
      effort
    );

  const risk =
    analyzeRisk(task);

  const compatibilityProfile =
    buildCompatibilityProfile(
      skillAnalysis
    );

  const understanding =
    createOpportunityUnderstanding({
      task: {
        title: task.title,
        description: task.description,
        type: task.type,
        deliverables:
          task.deliverables,
        deadline: task.deadline
      },

      requirements:
        requirements.items,

      requirementsAnalysis:
        requirements,

      skills:
        skillAnalysis,

      effort,

      difficulty,

      risk,

      compatibilityProfile
    });

  return {
    success: true,

    understanding,

    task,

    capabilityMatches:
      skillAnalysis,

    executionAllowed: false,

    understandingOnly: true,

    source:
      "mira-opportunity-understanding"
  };
}

module.exports = {
  normalize,
  unique,
  findRegisteredSkill,
  findCapabilityForSkill,
  analyzeRequirements,
  analyzeSkills,
  estimateEffort,
  normalizeDifficulty,
  analyzeDifficulty,
  analyzeRisk,
  buildCompatibilityProfile,
  understandOpportunity
};
