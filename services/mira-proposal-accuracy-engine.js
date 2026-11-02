"use strict";

const {
  PROPOSAL_CLAIM_TYPES,
  PROPOSAL_CLAIM_STATUSES
} = require("../proposal-schema");

const {
  listCapabilities,
  listSkills
} = require("../capability-profile");

function now() {
  return new Date().toISOString();
}

function cleanText(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

const SENSITIVE_CLAIM_TYPES = new Set([
  "experience",
  "skill",
  "result",
  "certification"
]);

function isVerifiedClaim(claim) {
  return (
    claim &&
    claim.status === "verified"
  );
}

function findVerifiedCapability(
  claim
) {
  const text =
    cleanText(claim.text).toLowerCase();

  if (!text) {
    return null;
  }

  const capabilities =
    listCapabilities();

  return capabilities.find(
    capability =>
      capability &&
      capability.status === "active" &&
      capability.verification === "verified" &&
      (
        text.includes(
          cleanText(
            capability.name
          ).toLowerCase()
        ) ||
        text.includes(
          cleanText(
            capability.key
          ).toLowerCase()
        )
      )
  ) || null;
}

function findVerifiedSkill(
  claim
) {
  const text =
    cleanText(claim.text).toLowerCase();

  if (!text) {
    return null;
  }

  const skills =
    listSkills();

  return skills.find(
    skill =>
      skill &&
      skill.status === "active" &&
      skill.verification === "verified" &&
      (
        text.includes(
          cleanText(
            skill.name
          ).toLowerCase()
        ) ||
        text.includes(
          cleanText(
            skill.key
          ).toLowerCase()
        )
      )
  ) || null;
}

function checkClaim(claim) {
  const issues = [];

  if (!claim || typeof claim !== "object") {
    return {
      passed: false,
      blocked: true,
      issues: [
        "Claim must be an object."
      ]
    };
  }

  const type =
    cleanText(claim.type);

  const text =
    cleanText(claim.text);

  if (!text) {
    issues.push(
      "Claim text is required."
    );
  }

  if (
    isVerifiedClaim(claim) &&
    claim.verified !== true
  ) {
    issues.push(
      `Verified ${type || "claim"} is not supported by verified evidence.`
    );
  }

  if (
    isVerifiedClaim(claim) &&
    (
      !Array.isArray(claim.evidence) ||
      claim.evidence.length === 0
    )
  ) {
    issues.push(
      `Verified ${type || "claim"} must contain evidence.`
    );
  }

  if (
    SENSITIVE_CLAIM_TYPES.has(type)
  ) {
    const explicitlyVerified =
      claim.verified === true &&
      isVerifiedClaim(claim);

    if (!explicitlyVerified) {
      issues.push(
        `Sensitive ${type} claims require explicit verification and cannot be asserted as factual without verified support.`
      );
    }

    if (
      explicitlyVerified &&
      type === "skill"
    ) {
      const verifiedSkill =
        findVerifiedSkill(claim);

      const verifiedCapability =
        findVerifiedCapability(claim);

      if (
        !verifiedSkill &&
        !verifiedCapability
      ) {
        issues.push(
          "Verified skill claim does not match an active verified capability or skill in the capability profile."
        );
      }
    }
  }

  return {
    passed:
      issues.length === 0,
    blocked:
      issues.length > 0,
    issues
  };
}

function checkProposalAccuracy(
  proposal
) {
  if (
    !proposal ||
    typeof proposal !== "object"
  ) {
    return {
      passed: false,
      checkedClaims: 0,
      blockedClaims: 1,
      issues: [
        {
          claimId: null,
          issue:
            "Proposal is required."
        }
      ],
      checkedAt: now()
    };
  }

  const claims =
    Array.isArray(proposal.claims)
      ? proposal.claims
      : [];

  const issues = [];
  let blockedClaims = 0;

  for (const claim of claims) {
    const result =
      checkClaim(claim);

    if (!result.passed) {
      blockedClaims += 1;

      for (const issue of result.issues) {
        issues.push({
          claimId:
            claim &&
            claim.claimId
              ? claim.claimId
              : null,
          issue
        });
      }
    }
  }

  return {
    passed:
      blockedClaims === 0,
    checkedClaims:
      claims.length,
    blockedClaims,
    issues,
    checkedAt: now()
  };
}

function applyAccuracyCheck(
  proposal
) {
  const result =
    checkProposalAccuracy(
      proposal
    );

  const updated = {
    ...proposal,
    accuracyCheck: result
  };

  if (!result.passed) {
    updated.status = "draft";
    updated.sendBoundary = "blocked";
  } else {
    updated.status = "accuracy_checked";
  }

  return {
    proposal: updated,
    accuracyCheck: result
  };
}

module.exports = {
  checkClaim,
  checkProposalAccuracy,
  applyAccuracyCheck
};
