"use strict";

const {
  createCapability,
  getCapability,
  listCapabilities,
  updateCapability,
  verifyCapability,
  verifySkill,
  createSkill,
  listSkills,
  checkDependencies,
  getProfileSummary
} = require("../capability-profile");

const {
  recordAudit
} = require("../audit-log");

function audit(
  action,
  resourceId,
  status,
  details = {}
) {
  return recordAudit({
    actorRole: "system",
    action,
    resource:
      "capability_profile",
    resourceId:
      resourceId || "",
    status,
    details
  });
}

function createProfileCapability(
  input
) {
  const result =
    createCapability(input);

  audit(
    result.status === "created"
      ? "CAPABILITY_PROFILE_CREATED"
      : "CAPABILITY_PROFILE_CREATE_DUPLICATE",
    result.capability?.capabilityId || "",
    result.ok ? "success" : "blocked",
    {
      name:
        input?.name || "",
      status:
        result.status
    }
  );

  return result;
}

function updateProfileCapability(
  capabilityId,
  input
) {
  try {
    const result =
      updateCapability(
        capabilityId,
        input
      );

    audit(
      result.status === "updated"
        ? "CAPABILITY_PROFILE_UPDATED"
        : "CAPABILITY_PROFILE_UPDATE_DUPLICATE",
      capabilityId,
      result.ok ? "success" : "blocked",
      {
        status:
          result.status
      }
    );

    return result;
  } catch (error) {
    audit(
      "CAPABILITY_PROFILE_UPDATE_BLOCKED",
      capabilityId,
      "blocked",
      {
        reason:
          error.message
      }
    );

    throw error;
  }
}

function verifyProfileCapability(
  capabilityId,
  evidence
) {
  const result =
    verifyCapability(
      capabilityId,
      evidence
    );

  audit(
    result.ok
      ? "CAPABILITY_PROFILE_VERIFIED"
      : "CAPABILITY_PROFILE_VERIFICATION_BLOCKED",
    capabilityId,
    result.ok
      ? "success"
      : "blocked",
    {
      status:
        result.status
    }
  );

  return result;
}


function verifyProfileSkill(
  skillIdOrKey,
  evidence
) {
  const result =
    verifySkill(
      skillIdOrKey,
      evidence
    );

  audit(
    result.ok
      ? "SKILL_PROFILE_VERIFIED"
      : "SKILL_PROFILE_VERIFICATION_BLOCKED",
    result.skill?.skillId ||
      skillIdOrKey ||
      "",
    result.ok
      ? "success"
      : "blocked",
    {
      status:
        result.status,
      missingCapabilities:
        result.missingCapabilities ||
        [],
      unverifiedCapabilities:
        result.unverifiedCapabilities ||
        []
    }
  );

  return result;
}


function createProfileSkill(
  input
) {
  const result =
    createSkill(input);

  audit(
    result.status === "created"
      ? "SKILL_PROFILE_CREATED"
      : "SKILL_PROFILE_CREATE_DUPLICATE",
    result.skill?.skillId || "",
    result.ok ? "success" : "blocked",
    {
      name:
        input?.name || "",
      status:
        result.status
    }
  );

  return result;
}

module.exports = {
  createProfileCapability,
  getCapability,
  listCapabilities,
  updateProfileCapability,
  verifyProfileCapability,
  verifyProfileSkill,
  createProfileSkill,
  listSkills,
  checkDependencies,
  getProfileSummary
};
