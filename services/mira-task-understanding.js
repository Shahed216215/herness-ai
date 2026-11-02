"use strict";

const {
  parseTask
} = require("../task-parser");

const {
  listCapabilities,
  listSkills
} = require("../capability-profile");

const {
  createStoredTask
} = require("../task-store");

function cleanText(value) {
  return String(
    value === undefined ||
    value === null
      ? ""
      : value
  ).trim();
}

function normalizeSkill(value) {
  return cleanText(value).toLowerCase();
}

function getCapabilitySkillNames(capability) {
  if (!capability) {
    return [];
  }

  const skills = Array.isArray(
    capability.skills
  )
    ? capability.skills
    : [];

  return skills.map(
    normalizeSkill
  );
}

function findCapabilityForSkill(
  skill,
  capabilities,
  skills
) {
  const target =
    normalizeSkill(skill);

  /*
   * First try the capability's direct
   * skill mapping.
   */
  for (
    const capability of capabilities
  ) {
    const capabilitySkills =
      getCapabilitySkillNames(
        capability
      );

    if (
      capabilitySkills.includes(
        target
      )
    ) {
      return capability;
    }
  }

  /*
   * If the direct mapping is unavailable,
   * resolve the capability through the
   * registered skill's capabilities[] list.
   */
  if (Array.isArray(skills)) {
    const registeredSkill =
      findRegisteredSkill(
        target,
        skills
      );

    if (
      registeredSkill &&
      Array.isArray(
        registeredSkill.capabilities
      )
    ) {
      for (
        const capabilityId of
          registeredSkill.capabilities
      ) {
        const capability =
          capabilities.find(
            item =>
              item.capabilityId ===
              capabilityId ||
              item.id ===
              capabilityId
          );

        if (capability) {
          return capability;
        }
      }
    }
  }

  return null;
}

function findRegisteredSkill(
  skill,
  skills
) {
  const target =
    normalizeSkill(skill);

  return (
    skills.find(
      item =>
        normalizeSkill(
          item.name
        ) === target
    ) || null
  );
}

function isVerifiedCapability(
  capability
) {
  if (!capability) {
    return false;
  }

  return (
    capability.verification ===
      "verified"
  );
}

function isActiveCapability(
  capability
) {
  if (!capability) {
    return false;
  }

  return (
    !capability.status ||
    capability.status === "active"
  );
}

function matchRequiredSkills(
  requiredSkills,
  capabilities,
  skills
) {
  const matches = [];

  for (
    const requiredSkill of requiredSkills
  ) {
    const capability =
      findCapabilityForSkill(
        requiredSkill,
        capabilities,
        skills
      );

    const registeredSkill =
      findRegisteredSkill(
        requiredSkill,
        skills
      );

    if (!capability) {
      matches.push({
        skill: requiredSkill,
        state: "missing",
        capabilityId: null,
        capabilityName: null,
        verified: false,
        active: false,
        registeredSkill:
          Boolean(
            registeredSkill
          )
      });

      continue;
    }

    const capabilityVerified =
      isVerifiedCapability(
        capability
      );

    const skillVerified =
      Boolean(
        registeredSkill &&
        registeredSkill.verification ===
          "verified"
      );

    const active =
      isActiveCapability(
        capability
      );

    let state = "available";

    if (!active) {
      state = "inactive";
    } else if (
      !capabilityVerified ||
      !skillVerified
    ) {
      state = "unverified";
    } else {
      state = "verified";
    }

    matches.push({
      skill: requiredSkill,
      state,
      capabilityId:
        capability.capabilityId ||
        capability.id ||
        null,
      capabilityName:
        capability.name || null,
      verified:
        capabilityVerified &&
        skillVerified,
      capabilityVerified,
      skillVerified,
      active,
      registeredSkill:
        Boolean(
          registeredSkill
        )
    });
  }

  return matches;
}

function buildTaskReadiness(
  matches
) {
  if (!matches.length) {
    return {
      ready: false,
      reason:
        "No required skills were identified."
    };
  }

  const missing =
    matches.filter(
      item =>
        item.state === "missing"
    );

  if (missing.length) {
    return {
      ready: false,
      reason:
        "One or more required capabilities are missing.",
      missingSkills:
        missing.map(
          item => item.skill
        )
    };
  }

  const unverified =
    matches.filter(
      item =>
        item.state === "unverified"
    );

  if (unverified.length) {
    return {
      ready: false,
      reason:
        "One or more required skills or capabilities are not verified.",
      unverifiedSkills:
        unverified.map(
          item => item.skill
        )
    };
  }

  const inactive =
    matches.filter(
      item =>
        item.state === "inactive"
    );

  if (inactive.length) {
    return {
      ready: false,
      reason:
        "One or more required capabilities are inactive.",
      inactiveSkills:
        inactive.map(
          item => item.skill
        )
    };
  }

  return {
    ready: true,
    reason:
      "All required capabilities are verified and active."
  };
}

function understandTask(
  input,
  options = {}
) {
  const task =
    parseTask(input);

  const capabilities =
    listCapabilities();

  const skills =
    listSkills();

  const capabilityMatches =
    matchRequiredSkills(
      task.requiredSkills,
      capabilities,
      skills
    );

  const readiness =
    buildTaskReadiness(
      capabilityMatches
    );

  let storedTask = null;

  if (
    options.persist === true
  ) {
    const storedResult =
      createStoredTask({
        ...task,
        source:
          "mira-task-understanding"
      });

    if (
      storedResult &&
      storedResult.ok
    ) {
      storedTask =
        storedResult.task;
    }
  }

  return {
    task,
    storedTask,
    capabilityMatches,
    readiness,

    executionAllowed:
      false,

    understandingOnly:
      true,

    source:
      "mira-task-understanding"
  };
}

module.exports = {
  understandTask,
  matchRequiredSkills,
  buildTaskReadiness,
  findCapabilityForSkill,
  findRegisteredSkill
};
