"use strict";

const {
  PROPOSAL_STATUSES,
  PROPOSAL_POLICY_DECISIONS,
  PROPOSAL_SEND_BOUNDARY_STATUSES,
  createProposal,
  validateProposal
} = require("../proposal-schema");

const {
  getOpportunity
} = require("../opportunity-store");

const {
  getCapabilityProfile
} = require("./mira-capability-profile");

const {
  understandTask,
  createPlan
} = require("./mira-task-planner");

function cleanText(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function cleanList(value) {
  return Array.isArray(value)
    ? value
        .filter(item => typeof item === "string")
        .map(item => item.trim())
        .filter(Boolean)
    : [];
}

function extractRequirements(opportunity) {
  const understanding =
    opportunity &&
    opportunity.understanding;

  if (
    understanding &&
    Array.isArray(understanding.requirements)
  ) {
    return cleanList(
      understanding.requirements
    );
  }

  return cleanList(
    opportunity.requirements
  );
}

function extractSkills(opportunity) {
  const understanding =
    opportunity &&
    opportunity.understanding;

  if (
    understanding &&
    Array.isArray(understanding.skills)
  ) {
    return cleanList(
      understanding.skills
    );
  }

  return cleanList(
    opportunity.skills
  );
}

function buildRequirementSummary(requirements) {
  if (!requirements.length) {
    return "The available opportunity information does not contain explicit requirements.";
  }

  return requirements
    .map(
      (item, index) =>
        `${index + 1}. ${item}`
    )
    .join("\n");
}

function buildApproach(requirements, skills) {
  const approach = [];

  if (requirements.length) {
    approach.push(
      "Review and confirm the stated requirements before execution."
    );
  } else {
    approach.push(
      "Review the available project information and clarify any missing requirements."
    );
  }

  if (skills.length) {
    approach.push(
      `Apply the available capabilities relevant to: ${skills.join(", ")}.`
    );
  } else {
    approach.push(
      "Use only capabilities that are verified or otherwise supported by Mira's capability profile."
    );
  }

  approach.push(
    "Prepare the requested work according to the agreed scope."
  );

  approach.push(
    "Verify the resulting deliverable against the requirements before delivery."
  );

  return approach;
}

function buildDeliverables(opportunity, requirements) {
  const title =
    cleanText(opportunity.title) ||
    "Requested deliverable";

  if (requirements.length) {
    return [
      `${title} completed according to the stated requirements.`,
      "Verified final output aligned with the available requirements."
    ];
  }

  return [
    `${title} prepared according to the available project information.`,
    "Final output reviewed against the information available at proposal time."
  ];
}

function buildSafeClaims({
  requirements,
  skills,
  capabilityProfile
}) {
  const claims = [];

  claims.push({
    type: "approach",
    text:
      "I will review the requirements, prepare the requested work, and verify the final output."
  });

  if (skills.length) {
    for (const skill of skills) {
      const capabilityText =
        cleanText(skill);

      if (!capabilityText) {
        continue;
      }

      const matched =
        capabilityProfile &&
        Array.isArray(
          capabilityProfile.capabilities
        )
          ? capabilityProfile.capabilities.find(
              capability => {
                const name =
                  cleanText(
                    capability.name
                  ).toLowerCase();

                return (
                  name ===
                  capabilityText.toLowerCase()
                );
              }
            )
          : null;

      if (matched) {
        claims.push({
          type: "skill",
          text:
            `I can work with ${capabilityText} based on the available capability profile.`,
          status:
            matched.verified === true
              ? "verified"
              : "supported",
          verified:
            matched.verified === true,
          evidence:
            matched.verified === true
              ? [
                  `Capability profile entry: ${capabilityText}`
                ]
              : []
        });
      }
    }
  }

  return claims;
}

function generateProposal(input = {}) {
  const suppliedOpportunity =
    input.opportunity &&
    typeof input.opportunity === "object"
      ? input.opportunity
      : null;

  const opportunityId =
    cleanText(
      input.opportunityId ||
      (suppliedOpportunity &&
        suppliedOpportunity.opportunityId)
    );

  if (!opportunityId) {
    const error = new Error(
      "opportunityId is required."
    );

    error.code =
      "OPPORTUNITY_ID_REQUIRED";

    throw error;
  }

  const opportunity =
    input.opportunity ||
    getOpportunity(opportunityId);

  if (!opportunity) {
    const error = new Error(
      `Opportunity not found: ${opportunityId}`
    );

    error.code =
      "OPPORTUNITY_NOT_FOUND";

    throw error;
  }

  const requirements =
    extractRequirements(
      opportunity
    );

  const skills =
    extractSkills(
      opportunity
    );

  let capabilityProfile =
    input.capabilityProfile ||
    null;

  if (!capabilityProfile) {
    try {
      capabilityProfile =
        getCapabilityProfile();
    } catch (error) {
      capabilityProfile = null;
    }
  }

  let workPlan = null;

  if (
    input.workPlan &&
    typeof input.workPlan === "object"
  ) {
    workPlan =
      input.workPlan;
  } else {
    try {
      const taskText =
        [
          cleanText(
            opportunity.title
          ),
          ...requirements
        ]
          .filter(Boolean)
          .join(". ");

      if (taskText) {
        const task =
          understandTask(taskText);

        workPlan =
          createPlan(task);
      }
    } catch (error) {
      workPlan = null;
    }
  }

  const title =
    cleanText(opportunity.title) ||
    "Project Proposal";

  const opening =
    cleanText(input.opening) ||
    `I can help with ${title.toLowerCase()} based on the requirements and capabilities currently available.`;

  const approach =
    buildApproach(
      requirements,
      skills
    );

  const deliverables =
    buildDeliverables(
      opportunity,
      requirements
    );

  const claims =
    buildSafeClaims({
      requirements,
      skills,
      capabilityProfile
    });

  const proposal =
    createProposal({
      opportunityId,
      clientId:
        cleanText(
          input.clientId ||
          opportunity.clientId
        ),
      status:
        PROPOSAL_STATUSES.DRAFT,
      policyDecision:
        PROPOSAL_POLICY_DECISIONS.UNKNOWN,
      sendBoundary:
        PROPOSAL_SEND_BOUNDARY_STATUSES.NOT_READY,
      title,
      opening,
      understanding: [
        buildRequirementSummary(
          requirements
        ),
        skills.length
          ? `Relevant skills identified: ${skills.join(", ")}.`
          : "No explicit skill requirements were identified."
      ],
      approach,
      deliverables,
      claims,
      limitations: [
        "No unsupported experience, result, certification, or project-history claim is made.",
        "Proposal generation does not authorize external sending.",
        "External communication remains subject to the send/approval boundary."
      ],
      workPlan,
      accuracyCheck: {
        passed: false,
        checkedClaims: 0,
        blockedClaims: 0,
        issues: [],
        checkedAt: null
      },
      policyCheck: {
        decision:
          PROPOSAL_POLICY_DECISIONS.UNKNOWN,
        issues: [],
        checkedAt: null
      },
      approval: {
        required: true,
        approved: false,
        approvedAt: null
      }
    });

  const validation =
    validateProposal(proposal);

  if (!validation.valid) {
    const error = new Error(
      "Generated proposal validation failed."
    );

    error.code =
      "GENERATED_PROPOSAL_INVALID";

    error.validation =
      validation;

    throw error;
  }

  return {
    proposal,
    opportunity,
    requirements,
    skills,
    capabilityProfile,
    workPlan,
    validation
  };
}

module.exports = {
  generateProposal,
  extractRequirements,
  extractSkills,
  buildRequirementSummary,
  buildApproach,
  buildDeliverables,
  buildSafeClaims
};
