"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');
const crypto = require("crypto");

const PROJECT_ROOT = path.resolve(__dirname);

const PROFILE_FILE = process.env.MIRA_CAPABILITY_PROFILE_FILE || storagePath("data/capability-profile.json");

const MAX_CAPABILITIES = 2000;
const MAX_SKILLS = 5000;

const MATURITY_LEVELS = Object.freeze([
  "unknown",
  "novice",
  "developing",
  "competent",
  "proficient",
  "expert"
]);

const VERIFICATION_STATES = Object.freeze([
  "unverified",
  "pending",
  "verified",
  "failed"
]);

const CAPABILITY_STATUSES = Object.freeze([
  "active",
  "blocked",
  "deprecated"
]);

function now() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(6)
    .toString("hex")}`;
}

function cleanText(value, field, max = 500) {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new Error(`${field} is required.`);
  }

  const result = value.trim();

  if (result.length > max) {
    throw new Error(
      `${field} exceeds maximum length.`
    );
  }

  return result;
}

function cleanList(value, field, maxItems = 50) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array.`);
  }

  const result = [
    ...new Set(
      value
        .map(item => String(item).trim())
        .filter(Boolean)
    )
  ];

  if (result.length > maxItems) {
    throw new Error(
      `${field} exceeds maximum item count.`
    );
  }

  return result;
}

function normalizeKey(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function emptyProfile() {
  return {
    version: 1,
    updatedAt: now(),
    capabilities: [],
    skills: []
  };
}

function ensureStore() {
  const directory =
    path.dirname(PROFILE_FILE);

  fs.mkdirSync(directory, {
    recursive: true
  });

  if (!fs.existsSync(PROFILE_FILE)) {
    fs.writeFileSync(
      PROFILE_FILE,
      JSON.stringify(
        emptyProfile(),
        null,
        2
      ) + "\n",
      "utf8"
    );
  }
}

function loadProfile() {
  ensureStore();

  const raw =
    fs.readFileSync(
      PROFILE_FILE,
      "utf8"
    );

  if (!raw.trim()) {
    return emptyProfile();
  }

  const parsed = JSON.parse(raw);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray(parsed.capabilities) ||
    !Array.isArray(parsed.skills)
  ) {
    throw new Error(
      "Capability profile store is invalid."
    );
  }

  return parsed;
}

function saveProfile(profile) {
  profile.updatedAt = now();

  fs.writeFileSync(
    PROFILE_FILE,
    JSON.stringify(
      profile,
      null,
      2
    ) + "\n",
    "utf8"
  );

  return profile;
}

function createCapability(input = {}) {
  const profile = loadProfile();

  const name =
    cleanText(
      input.name,
      "capability name",
      200
    );

  const key =
    normalizeKey(name);

  const duplicate =
    profile.capabilities.find(
      item =>
        item.key === key
    );

  if (duplicate) {
    return {
      ok: false,
      status: "duplicate",
      capability: duplicate
    };
  }

  const capability = {
    capabilityId:
      createId("cap"),
    key,
    name,
    description:
      cleanText(
        input.description,
        "capability description",
        2000
      ),
    category:
      cleanText(
        input.category || "general",
        "category",
        100
      ),
    skills:
      cleanList(
        input.skills,
        "skills"
      ),
    toolRequirements:
      cleanList(
        input.toolRequirements,
        "toolRequirements"
      ),
    dependencies:
      cleanList(
        input.dependencies,
        "dependencies"
      ),
    supportedTasks:
      cleanList(
        input.supportedTasks,
        "supportedTasks"
      ),
    unsupportedTasks:
      cleanList(
        input.unsupportedTasks,
        "unsupportedTasks"
      ),
    maturity:
      input.maturity || "unknown",
    verification:
      "unverified",
    status:
      "active",
    evidence: [],
    createdAt: now(),
    updatedAt: now()
  };

  if (
    !MATURITY_LEVELS.includes(
      capability.maturity
    )
  ) {
    throw new Error(
      `Invalid maturity level: ${capability.maturity}`
    );
  }

  profile.capabilities.push(
    capability
  );

  if (
    profile.capabilities.length >
    MAX_CAPABILITIES
  ) {
    throw new Error(
      "Capability registry limit exceeded."
    );
  }

  saveProfile(profile);

  return {
    ok: true,
    status: "created",
    capability
  };
}

function getCapability(capabilityId) {
  const profile = loadProfile();

  return (
    profile.capabilities.find(
      item =>
        item.capabilityId ===
        capabilityId
    ) || null
  );
}

function listCapabilities(options = {}) {
  const profile = loadProfile();

  return profile.capabilities.filter(
    item => {
      if (
        options.status &&
        item.status !== options.status
      ) {
        return false;
      }

      if (
        options.verification &&
        item.verification !==
          options.verification
      ) {
        return false;
      }

      if (
        options.category &&
        item.category !== options.category
      ) {
        return false;
      }

      return true;
    }
  );
}

function updateCapability(
  capabilityId,
  input = {}
) {
  const profile = loadProfile();

  const index =
    profile.capabilities.findIndex(
      item =>
        item.capabilityId ===
        capabilityId
    );

  if (index === -1) {
    throw new Error(
      "Capability not found."
    );
  }

  const current =
    profile.capabilities[index];

  if (
    input.name !== undefined
  ) {
    const name =
      cleanText(
        input.name,
        "capability name",
        200
      );

    const key =
      normalizeKey(name);

    const duplicate =
      profile.capabilities.find(
        item =>
          item.capabilityId !==
            capabilityId &&
          item.key === key
      );

    if (duplicate) {
      return {
        ok: false,
        status: "duplicate",
        capability: duplicate
      };
    }

    current.name = name;
    current.key = key;
  }

  if (
    input.description !== undefined
  ) {
    current.description =
      cleanText(
        input.description,
        "capability description",
        2000
      );
  }

  if (
    input.category !== undefined
  ) {
    current.category =
      cleanText(
        input.category,
        "category",
        100
      );
  }

  for (
    const field of [
      "skills",
      "toolRequirements",
      "dependencies",
      "supportedTasks",
      "unsupportedTasks"
    ]
  ) {
    if (input[field] !== undefined) {
      current[field] =
        cleanList(
          input[field],
          field
        );
    }
  }

  if (
    input.maturity !== undefined
  ) {
    if (
      !MATURITY_LEVELS.includes(
        input.maturity
      )
    ) {
      throw new Error(
        `Invalid maturity level: ${input.maturity}`
      );
    }

    current.maturity =
      input.maturity;
  }

  current.updatedAt = now();

  profile.capabilities[index] =
    current;

  saveProfile(profile);

  return {
    ok: true,
    status: "updated",
    capability: current
  };
}

function addEvidence(
  capabilityId,
  evidence = {}
) {
  const profile = loadProfile();

  const capability =
    profile.capabilities.find(
      item =>
        item.capabilityId ===
        capabilityId
    );

  if (!capability) {
    throw new Error(
      "Capability not found."
    );
  }

  const type =
    cleanText(
      evidence.type || "test",
      "evidence type",
      100
    );

  const reference =
    cleanText(
      evidence.reference ||
        "stage51",
      "evidence reference",
      500
    );

  capability.evidence.push({
    evidenceId:
      createId("evidence"),
    type,
    reference,
    result:
      evidence.result === "passed"
        ? "passed"
        : "failed",
    recordedAt: now()
  });

  capability.updatedAt = now();

  saveProfile(profile);

  return capability;
}

function verifyCapability(
  capabilityId,
  evidence = {}
) {
  const profile = loadProfile();

  const capability =
    profile.capabilities.find(
      item =>
        item.capabilityId ===
        capabilityId
    );

  if (!capability) {
    throw new Error(
      "Capability not found."
    );
  }

  if (
    !capability.dependencies.every(
      dependency => {
        const found =
          profile.capabilities.find(
            item =>
              item.key ===
                normalizeKey(
                  dependency
                ) ||
              item.capabilityId ===
                dependency
          );

        return (
          found &&
          found.status === "active" &&
          found.verification ===
            "verified"
        );
      }
    )
  ) {
    capability.verification =
      "failed";

    capability.updatedAt = now();

    saveProfile(profile);

    return {
      ok: false,
      status:
        "dependency_verification_failed",
      capability
    };
  }

  const record =
    addEvidence(
      capabilityId,
      {
        type:
          evidence.type ||
          "verification",
        reference:
          evidence.reference ||
          "stage51-verification",
        result: "passed"
      }
    );

  const refreshed =
    loadProfile();

  const target =
    refreshed.capabilities.find(
      item =>
        item.capabilityId ===
        capabilityId
    );

  target.verification =
    "verified";

  target.updatedAt = now();

  saveProfile(refreshed);

  return {
    ok: true,
    status: "verified",
    capability: target,
    evidenceCount:
      record.evidence.length
  };
}


function verifySkill(
  skillIdOrKey,
  evidence = {}
) {
  const profile = loadProfile();

  const skill =
    profile.skills.find(
      item =>
        item.skillId ===
          skillIdOrKey ||
        item.key ===
          normalizeKey(skillIdOrKey)
    );

  if (!skill) {
    throw new Error(
      "Skill not found."
    );
  }

  if (skill.status !== "active") {
    skill.verification = "failed";
    skill.updatedAt = now();
    saveProfile(profile);

    return {
      ok: false,
      status: "skill_not_active",
      skill
    };
  }

  const declaredCapabilities =
    Array.isArray(skill.capabilities)
      ? skill.capabilities
      : [];

  const missingCapabilities = [];
  const unverifiedCapabilities = [];

  if (declaredCapabilities.length === 0) {
    skill.verification = "failed";
    skill.updatedAt = now();

    saveProfile(profile);

    return {
      ok: false,
      status:
        "capability_verification_failed",
      reason:
        "no_declared_capabilities",
      skill,
      missingCapabilities: [],
      unverifiedCapabilities: []
    };
  }

  for (
    const capabilityRef
    of declaredCapabilities
  ) {
    const capability =
      profile.capabilities.find(
        item =>
          item.capabilityId ===
            capabilityRef ||
          item.key ===
            normalizeKey(
              capabilityRef
            )
      );

    if (!capability) {
      missingCapabilities.push(
        capabilityRef
      );
      continue;
    }

    if (
      capability.status !==
        "active" ||
      capability.verification !==
        "verified"
    ) {
      unverifiedCapabilities.push(
        {
          capabilityId:
            capability.capabilityId,
          key:
            capability.key,
          verification:
            capability.verification,
          status:
            capability.status
        }
      );
    }
  }

  if (
    missingCapabilities.length >
      0 ||
    unverifiedCapabilities.length >
      0
  ) {
    skill.verification = "failed";
    skill.updatedAt = now();

    saveProfile(profile);

    return {
      ok: false,
      status:
        "capability_verification_failed",
      skill,
      missingCapabilities,
      unverifiedCapabilities
    };
  }

  const evidenceRecord = {
    evidenceId:
      createId("skill-evidence"),
    type:
      cleanText(
        evidence.type ||
          "verification",
        "evidence type",
        100
      ),
    reference:
      cleanText(
        evidence.reference ||
          "skill-verification",
        "evidence reference",
        500
      ),
    result: "passed",
    recordedAt: now()
  };

  if (!Array.isArray(skill.evidence)) {
    skill.evidence = [];
  }

  skill.evidence.push(
    evidenceRecord
  );

  skill.verification =
    "verified";

  skill.updatedAt = now();

  saveProfile(profile);

  return {
    ok: true,
    status: "verified",
    skill,
    evidence:
      evidenceRecord,
    verifiedCapabilities:
      declaredCapabilities.length
  };
}

function createSkill(input = {}) {
  const profile = loadProfile();

  const name =
    cleanText(
      input.name,
      "skill name",
      200
    );

  const key =
    normalizeKey(name);

  const duplicate =
    profile.skills.find(
      item =>
        item.key === key
    );

  if (duplicate) {
    return {
      ok: false,
      status: "duplicate",
      skill: duplicate
    };
  }

  const maturity =
    input.maturity || "unknown";

  if (
    !MATURITY_LEVELS.includes(
      maturity
    )
  ) {
    throw new Error(
      `Invalid maturity level: ${maturity}`
    );
  }

  const skill = {
    skillId:
      createId("skill"),
    key,
    name,
    category:
      cleanText(
        input.category || "general",
        "category",
        100
      ),
    maturity,
    verification:
      "unverified",
    capabilities:
      cleanList(
        input.capabilities,
        "capabilities"
      ),
    toolRequirements:
      cleanList(
        input.toolRequirements,
        "toolRequirements"
      ),
    supportedTasks:
      cleanList(
        input.supportedTasks,
        "supportedTasks"
      ),
    unsupportedTasks:
      cleanList(
        input.unsupportedTasks,
        "unsupportedTasks"
      ),
    knowledge:
      cleanList(
        input.knowledge,
        "knowledge"
      ),
    tools:
      cleanList(
        input.tools,
        "tools"
      ),
    examples:
      cleanList(
        input.examples,
        "examples"
      ),
    exampleContracts:
      Array.isArray(input.exampleContracts)
        ? input.exampleContracts.map(contract => ({
            example:
              cleanText(
                contract.example,
                "example contract example",
                300
              ),
            requiredTests:
              cleanList(
                contract.requiredTests,
                "requiredTests"
              )
          }))
        : [],
    tests:
      cleanList(
        input.tests,
        "tests"
      ),
    qualityThreshold:
      input.qualityThreshold || null,
    failureHistory: [],
    learningHistory: [],
    status:
      input.status || "active",
    evidence: [],
    createdAt: now(),
    updatedAt: now()
  };

  profile.skills.push(skill);

  if (
    profile.skills.length >
    MAX_SKILLS
  ) {
    throw new Error(
      "Skill registry limit exceeded."
    );
  }

  saveProfile(profile);

  return {
    ok: true,
    status: "created",
    skill
  };
}


function normalizeSkillLearningRecord(
  learningInput = {}
) {
  const input =
    learningInput &&
    typeof learningInput === "object" &&
    !Array.isArray(learningInput)
      ? learningInput
      : {};

  const lesson =
    typeof input.lesson === "string"
      ? input.lesson.trim().slice(0, 1000)
      : "";

  const learningType =
    typeof input.learningType === "string"
      ? input.learningType.trim().slice(0, 100)
      : "";

  const source =
    typeof input.source === "string"
      ? input.source.trim().slice(0, 200)
      : "";

  const evidence =
    Array.isArray(input.evidence)
      ? input.evidence
          .filter(
            item =>
              typeof item === "string"
          )
          .map(
            item =>
              item.trim().slice(0, 500)
          )
          .filter(Boolean)
          .slice(0, 20)
      : [];

  const improvement =
    typeof input.improvement === "string"
      ? input.improvement.trim().slice(0, 1000)
      : "";

  return {
    learningId:
      typeof input.learningId === "string" &&
      input.learningId.trim()
        ? input.learningId.trim().slice(0, 200)
        : `learning-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}`,

    taskId:
      typeof input.taskId === "string"
        ? input.taskId.trim().slice(0, 200)
        : "",

    executionId:
      typeof input.executionId === "string"
        ? input.executionId.trim().slice(0, 200)
        : "",

    learningType,

    lesson,

    evidence,

    source,

    improvement,

    timestamp:
      typeof input.timestamp === "string" &&
      input.timestamp.trim()
        ? input.timestamp.trim().slice(0, 100)
        : now()
  };
}

function validateSkillLearningRecord(
  learningInput = {}
) {
  const input =
    learningInput &&
    typeof learningInput === "object" &&
    !Array.isArray(learningInput)
      ? learningInput
      : null;

  if (!input) {
    return {
      ok: false,
      errors: [
        "Learning record must be an object."
      ]
    };
  }

  const errors = [];

  if (
    typeof input.learningId !== "string" ||
    !input.learningId.trim()
  ) {
    errors.push(
      "learningId is required."
    );
  }

  if (
    typeof input.learningType !== "string" ||
    !input.learningType.trim()
  ) {
    errors.push(
      "learningType is required."
    );
  }

  if (
    typeof input.lesson !== "string" ||
    !input.lesson.trim()
  ) {
    errors.push(
      "lesson is required."
    );
  }

  if (
    input.evidence !== undefined &&
    !Array.isArray(input.evidence)
  ) {
    errors.push(
      "evidence must be an array."
    );
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function getSkillLearningHistory(
  skillIdOrKey
) {
  const profile =
    loadProfile();

  const normalized =
    normalizeKey(
      skillIdOrKey
    );

  const skill =
    profile.skills.find(
      item =>
        item.skillId ===
          skillIdOrKey ||
        item.key ===
          normalized
    );

  if (!skill) {
    return {
      ok: false,
      status:
        "skill_not_found",
      skillId: null,
      skillKey: null,
      learningHistory: []
    };
  }

  return {
    ok: true,
    status: "found",
    skillId:
      skill.skillId,
    skillKey:
      skill.key,
    learningHistory:
      Array.isArray(
        skill.learningHistory
      )
        ? JSON.parse(
            JSON.stringify(
              skill.learningHistory
            )
          )
        : []
  };
}

function recordSkillLearning(
  skillIdOrKey,
  learningInput = {}
) {
  const validation =
    validateSkillLearningRecord(
      learningInput
    );

  if (!validation.ok) {
    return {
      ok: false,
      saved: false,
      status:
        "invalid_learning_record",
      errors:
        validation.errors
    };
  }

  const profile =
    loadProfile();

  const normalized =
    normalizeKey(
      skillIdOrKey
    );

  const skill =
    profile.skills.find(
      item =>
        item.skillId ===
          skillIdOrKey ||
        item.key ===
          normalized
    );

  if (!skill) {
    return {
      ok: false,
      saved: false,
      status:
        "skill_not_found"
    };
  }

  if (
    !Array.isArray(
      skill.learningHistory
    )
  ) {
    skill.learningHistory = [];
  }

  const record =
    normalizeSkillLearningRecord(
      learningInput
    );

  const duplicate =
    skill.learningHistory.find(
      item =>
        item &&
        item.learningId ===
          record.learningId
    );

  if (duplicate) {
    return {
      ok: true,
      saved: false,
      duplicate: true,
      status:
        "duplicate_learning",
      skillId:
        skill.skillId,
      skillKey:
        skill.key,
      learning:
        duplicate
    };
  }

  skill.learningHistory.push(
    record
  );

  const MAX_LEARNING_HISTORY =
    100;

  if (
    skill.learningHistory.length >
    MAX_LEARNING_HISTORY
  ) {
    skill.learningHistory =
      skill.learningHistory.slice(
        skill.learningHistory.length -
          MAX_LEARNING_HISTORY
      );
  }

  skill.updatedAt = now();

  saveProfile(profile);

  return {
    ok: true,
    saved: true,
    duplicate: false,
    status:
      "learning_recorded",
    skillId:
      skill.skillId,
    skillKey:
      skill.key,
    learning:
      record,
    learningHistoryCount:
      skill.learningHistory.length
  };
}

function clearSkillLearningHistory(
  skillIdOrKey
) {
  const profile =
    loadProfile();

  const normalized =
    normalizeKey(
      skillIdOrKey
    );

  const skill =
    profile.skills.find(
      item =>
        item.skillId ===
          skillIdOrKey ||
        item.key ===
          normalized
    );

  if (!skill) {
    return {
      ok: false,
      saved: false,
      status:
        "skill_not_found"
    };
  }

  const previousCount =
    Array.isArray(
      skill.learningHistory
    )
      ? skill.learningHistory.length
      : 0;

  skill.learningHistory = [];
  skill.updatedAt = now();

  saveProfile(profile);

  return {
    ok: true,
    saved: true,
    status:
      "learning_history_cleared",
    skillId:
      skill.skillId,
    skillKey:
      skill.key,
    previousCount
  };
}

function listSkills(options = {}) {
  const profile = loadProfile();

  return profile.skills.filter(
    item => {
      if (
        options.verification &&
        item.verification !==
          options.verification
      ) {
        return false;
      }

      if (
        options.category &&
        item.category !== options.category
      ) {
        return false;
      }

      return true;
    }
  );
}

function checkDependencies(
  capabilityId
) {
  const profile = loadProfile();

  const capability =
    profile.capabilities.find(
      item =>
        item.capabilityId ===
        capabilityId
    );

  if (!capability) {
    return {
      ok: false,
      status: "not_found",
      dependencies: []
    };
  }

  const dependencies =
    capability.dependencies.map(
      dependency => {
        const found =
          profile.capabilities.find(
            item =>
              item.capabilityId ===
                dependency ||
              item.key ===
                normalizeKey(
                  dependency
                )
          );

        return {
          dependency,
          available:
            !!found &&
            found.status ===
              "active" &&
            found.verification ===
              "verified"
        };
      }
    );

  return {
    ok:
      dependencies.every(
        item =>
          item.available
      ),
    status:
      dependencies.every(
        item =>
          item.available
      )
        ? "dependencies_satisfied"
        : "dependencies_missing",
    dependencies
  };
}

function getProfileSummary() {
  const profile = loadProfile();

  const verifiedCapabilities =
    profile.capabilities.filter(
      item =>
        item.verification ===
        "verified"
    ).length;

  const verifiedSkills =
    profile.skills.filter(
      item =>
        item.verification ===
        "verified"
    ).length;

  return {
    capabilityCount:
      profile.capabilities.length,
    skillCount:
      profile.skills.length,
    verifiedCapabilities,
    verifiedSkills,
    unverifiedCapabilities:
      profile.capabilities.length -
      verifiedCapabilities,
    unverifiedSkills:
      profile.skills.length -
      verifiedSkills,
    version:
      profile.version,
    updatedAt:
      profile.updatedAt
  };
}


function getSkill(skillIdOrKey) {
  const profile = loadProfile();

  const normalized =
    normalizeKey(skillIdOrKey);

  return (
    profile.skills.find(
      item =>
        item.skillId === skillIdOrKey ||
        item.key === normalized
    ) || null
  );
}

function getSkillTools(skillIdOrKey) {
  const skill =
    getSkill(skillIdOrKey);

  if (!skill) {
    return {
      ok: false,
      status: "skill_not_found",
      tools: []
    };
  }

  return {
    ok: true,
    status: "found",
    skillId: skill.skillId,
    skillKey: skill.key,
    tools: Array.isArray(skill.tools)
      ? [...skill.tools]
      : []
  };
}

function validateSkillTools(
  skillIdOrKey,
  registeredToolNames = []
) {
  const skill =
    getSkill(skillIdOrKey);

  if (!skill) {
    return {
      ok: false,
      status: "skill_not_found",
      valid: false,
      missing: [],
      registered: []
    };
  }

  const required =
    Array.isArray(skill.tools)
      ? skill.tools
      : [];

  const registered =
    Array.isArray(registeredToolNames)
      ? registeredToolNames
      : [];

  const missing =
    required.filter(
      toolName =>
        !registered.includes(toolName)
    );

  return {
    ok: true,
    status:
      missing.length === 0
        ? "valid"
        : "missing_registered_tools",
    valid:
      missing.length === 0,
    missing,
    registered: required.filter(
      toolName =>
        registered.includes(toolName)
    )
  };
}

function updateSkillTools(
  skillIdOrKey,
  toolNames = []
) {
  const profile = loadProfile();

  const normalized =
    normalizeKey(skillIdOrKey);

  const skill =
    profile.skills.find(
      item =>
        item.skillId === skillIdOrKey ||
        item.key === normalized
    );

  if (!skill) {
    return {
      ok: false,
      status: "skill_not_found"
    };
  }

  skill.tools =
    cleanList(
      toolNames,
      "tools"
    );

  skill.updatedAt = now();

  saveProfile(profile);

  return {
    ok: true,
    status: "updated",
    skill
  };
}



function normalizeSkillFailureRecord(
  failureInput = {}
) {
  const input =
    failureInput &&
    typeof failureInput === "object" &&
    !Array.isArray(failureInput)
      ? failureInput
      : {};

  const failedChecks =
    Array.isArray(input.failedChecks)
      ? input.failedChecks
          .map(item =>
            cleanText(
              item,
              "failed check",
              200
            )
          )
          .filter(Boolean)
      : [];

  return {
    failureId:
      cleanText(
        input.failureId ||
          `failure-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}`,
        "failureId",
        200
      ),
    taskId:
      cleanText(
        input.taskId,
        "",
        200
      ),
    executionId:
      cleanText(
        input.executionId,
        "",
        200
      ),
    failureType:
      cleanText(
        input.failureType,
        "unknown_failure",
        100
      ),
    failureReason:
      cleanText(
        input.failureReason,
        "",
        500
      ),
    failedChecks,
    qualityScore:
      typeof input.qualityScore ===
      "number" &&
      Number.isFinite(
        input.qualityScore
      )
        ? input.qualityScore
        : null,
    reworkRequired:
      Boolean(
        input.reworkRequired
      ),
    recoveryRequired:
      Boolean(
        input.recoveryRequired
      ),
    resolution:
      cleanText(
        input.resolution,
        "",
        500
      ),
    timestamp:
      cleanText(
        input.timestamp || now(),
        "timestamp",
        100
      )
  };
}

function validateSkillFailureRecord(
  failureInput = {}
) {
  const input =
    failureInput &&
    typeof failureInput === "object" &&
    !Array.isArray(failureInput)
      ? failureInput
      : null;

  if (!input) {
    return {
      ok: false,
      valid: false,
      status:
        "invalid_failure_record",
      errors: [
        "Failure record must be an object."
      ]
    };
  }

  const errors = [];

  if (
      typeof input.taskId !== "string" ||
      input.taskId.trim().length === 0 ||
      input.taskId.trim().length > 200
    ) {
      errors.push(
        "taskId is required."
      );
    }

  if (
      typeof input.failureType !== "string" ||
      input.failureType.trim().length === 0 ||
      input.failureType.trim().length > 100
    ) {
      errors.push(
        "failureType is required."
      );
    }

  if (
      typeof input.failureReason !== "string" ||
      input.failureReason.trim().length === 0 ||
      input.failureReason.trim().length > 500
    ) {
      errors.push(
        "failureReason is required."
      );
    }

  if (
    input.qualityScore !==
      undefined &&
    input.qualityScore !==
      null &&
    (
      typeof input.qualityScore !==
        "number" ||
      !Number.isFinite(
        input.qualityScore
      ) ||
      input.qualityScore < 0 ||
      input.qualityScore > 1
    )
  ) {
    errors.push(
      "qualityScore must be a finite number between 0 and 1."
    );
  }

  if (
    input.failedChecks !==
      undefined &&
    !Array.isArray(
      input.failedChecks
    )
  ) {
    errors.push(
      "failedChecks must be an array."
    );
  }

  return {
    ok:
      errors.length === 0,
    valid:
      errors.length === 0,
    status:
      errors.length === 0
        ? "valid"
        : "invalid_failure_record",
    errors
  };
}

function getSkillFailureHistory(
  skillIdOrKey
) {
  const skill =
    getSkill(skillIdOrKey);

  if (!skill) {
    return {
      ok: false,
      status: "skill_not_found",
      skillId: null,
      skillKey: null,
      failureHistory: []
    };
  }

  return {
    ok: true,
    status: "found",
    skillId: skill.skillId,
    skillKey: skill.key,
    failureHistory:
      Array.isArray(
        skill.failureHistory
      )
        ? JSON.parse(
            JSON.stringify(
              skill.failureHistory
            )
          )
        : []
  };
}

function recordSkillFailure(
  skillIdOrKey,
  failureInput = {}
) {
  const validation =
    validateSkillFailureRecord(
      failureInput
    );

  if (!validation.valid) {
    return {
      ok: false,
      saved: false,
      status:
        validation.status,
      errors:
        validation.errors
    };
  }

  const profile =
    loadProfile();

  const normalized =
    normalizeKey(
      skillIdOrKey
    );

  const skill =
    profile.skills.find(
      item =>
        item.skillId ===
          skillIdOrKey ||
        item.key ===
          normalized
    );

  if (!skill) {
    return {
      ok: false,
      saved: false,
      status:
        "skill_not_found"
    };
  }

  if (
    !Array.isArray(
      skill.failureHistory
    )
  ) {
    skill.failureHistory = [];
  }

  const record =
    normalizeSkillFailureRecord(
      failureInput
    );

  const duplicate =
    skill.failureHistory.find(
      item =>
        item &&
        item.failureId ===
          record.failureId
    );

  if (duplicate) {
    return {
      ok: true,
      saved: false,
      duplicate: true,
      status:
        "duplicate_failure",
      skillId:
        skill.skillId,
      skillKey:
        skill.key,
      failure:
        duplicate
    };
  }

  skill.failureHistory.push(
    record
  );

  const MAX_FAILURE_HISTORY =
    100;

  if (
    skill.failureHistory.length >
    MAX_FAILURE_HISTORY
  ) {
    skill.failureHistory =
      skill.failureHistory.slice(
        skill.failureHistory.length -
          MAX_FAILURE_HISTORY
      );
  }

  skill.updatedAt = now();

  saveProfile(profile);

  return {
    ok: true,
    saved: true,
    duplicate: false,
    status:
      "failure_recorded",
    skillId:
      skill.skillId,
    skillKey:
      skill.key,
    failure:
      record,
    failureHistoryCount:
      skill.failureHistory.length
  };
}

function clearSkillFailureHistory(
  skillIdOrKey
) {
  const profile =
    loadProfile();

  const normalized =
    normalizeKey(
      skillIdOrKey
    );

  const skill =
    profile.skills.find(
      item =>
        item.skillId ===
          skillIdOrKey ||
        item.key ===
          normalized
    );

  if (!skill) {
    return {
      ok: false,
      saved: false,
      status:
        "skill_not_found"
    };
  }

  const previousCount =
    Array.isArray(
      skill.failureHistory
    )
      ? skill.failureHistory.length
      : 0;

  skill.failureHistory = [];
  skill.updatedAt = now();

  saveProfile(profile);

  return {
    ok: true,
    saved: true,
    status:
      "failure_history_cleared",
    skillId:
      skill.skillId,
    skillKey:
      skill.key,
    previousCount
  };
}

function getSkillContract(skillIdOrKey) {
  const skill = getSkill(skillIdOrKey);

  if (!skill) {
    return {
      ok: false,
      status: "skill_not_found",
      contract: null
    };
  }

  return {
    ok: true,
    status: "found",
    skillId: skill.skillId,
    skillKey: skill.key,
    examples: Array.isArray(skill.examples)
      ? [...skill.examples]
      : [],
    tests: Array.isArray(skill.tests)
      ? [...skill.tests]
      : [],
    qualityThreshold:
      skill.qualityThreshold || null
  };
}

function validateSkillContract(skillIdOrKey) {
  const skill = getSkill(skillIdOrKey);

  if (!skill) {
    return {
      ok: false,
      status: "skill_not_found",
      valid: false,
      errors: ["Skill not found."]
    };
  }

  const examples =
    Array.isArray(skill.examples)
      ? skill.examples
      : [];

  const tests =
    Array.isArray(skill.tests)
      ? skill.tests
      : [];

  const errors = [];

  if (examples.length === 0) {
    errors.push("Skill has no examples.");
  }

  if (tests.length === 0) {
    errors.push("Skill has no tests.");
  }

  const threshold =
    skill.qualityThreshold;

  if (
    !threshold ||
    typeof threshold.minimumScore !== "number"
  ) {
    errors.push(
      "Skill has no valid minimum quality threshold."
    );
  }

  return {
    ok: true,
    status:
      errors.length === 0
        ? "valid"
        : "invalid",
    valid: errors.length === 0,
    errors,
    exampleCount: examples.length,
    testCount: tests.length,
    minimumScore:
      threshold &&
      typeof threshold.minimumScore === "number"
        ? threshold.minimumScore
        : null
  };
}


function getSkillExampleContracts(skillIdOrKey) {
  const skill = getSkill(skillIdOrKey);

  if (!skill) {
    return {
      ok: false,
      status: "skill_not_found",
      contracts: []
    };
  }

  return {
    ok: true,
    status: "found",
    skillId: skill.skillId,
    skillKey: skill.key,
    contracts:
      Array.isArray(skill.exampleContracts)
        ? skill.exampleContracts.map(contract => ({
            example: contract.example,
            requiredTests:
              Array.isArray(contract.requiredTests)
                ? [...contract.requiredTests]
                : []
          }))
        : []
  };
}

function validateSkillExampleContracts(skillIdOrKey) {
  const skill = getSkill(skillIdOrKey);

  if (!skill) {
    return {
      ok: false,
      status: "skill_not_found",
      valid: false,
      errors: []
    };
  }

  const examples =
    Array.isArray(skill.examples)
      ? skill.examples
      : [];

  const tests =
    Array.isArray(skill.tests)
      ? skill.tests
      : [];

  const contracts =
    Array.isArray(skill.exampleContracts)
      ? skill.exampleContracts
      : [];

  const errors = [];
  const seenExamples = new Set();

  for (const contract of contracts) {
    if (
      !contract ||
      typeof contract.example !== "string" ||
      !examples.includes(contract.example)
    ) {
      errors.push(
        `Unknown example in contract: ${contract && contract.example}`
      );
      continue;
    }

    if (seenExamples.has(contract.example)) {
      errors.push(
        `Duplicate example contract: ${contract.example}`
      );
    }

    seenExamples.add(contract.example);

    if (
      !Array.isArray(contract.requiredTests) ||
      contract.requiredTests.length === 0
    ) {
      errors.push(
        `Example has no required tests: ${contract.example}`
      );
      continue;
    }

    for (const test of contract.requiredTests) {
      if (!tests.includes(test)) {
        errors.push(
          `Unknown required test "${test}" for example "${contract.example}"`
        );
      }
    }
  }

  for (const example of examples) {
    if (!seenExamples.has(example)) {
      errors.push(
        `Example has no contract: ${example}`
      );
    }
  }

  return {
    ok: true,
    status:
      errors.length === 0
        ? "valid"
        : "invalid",
    valid:
      errors.length === 0,
    errors,
    exampleCount:
      examples.length,
    contractCount:
      contracts.length,
    testCount:
      tests.length
  };
}

function updateSkillExampleContracts(
  skillIdOrKey,
  contracts = []
) {
  const profile = loadProfile();

  const skill =
    profile.skills.find(
      item =>
        item.skillId === skillIdOrKey ||
        item.key === skillIdOrKey
    );

  if (!skill) {
    return {
      ok: false,
      status: "skill_not_found"
    };
  }

  if (!Array.isArray(contracts)) {
    throw new Error(
      "contracts must be an array."
    );
  }

  skill.exampleContracts =
    contracts.map(contract => ({
      example:
        cleanText(
          contract.example,
          "example contract example",
          300
        ),
      requiredTests:
        cleanList(
          contract.requiredTests,
          "requiredTests"
        )
    }));

  skill.updatedAt = now();

  saveProfile(profile);

  return {
    ok: true,
    status: "updated",
    skill
  };
}


function getSkillQualityThreshold(skillIdOrKey) {
  const skill = getSkill(skillIdOrKey);

  if (!skill) {
    return {
      ok: false,
      status: "skill_not_found",
      threshold: null
    };
  }

  const threshold =
    skill.qualityThreshold;

  return {
    ok: true,
    status: "found",
    skillId: skill.skillId,
    skillKey: skill.key,
    threshold:
      threshold &&
      typeof threshold === "object"
        ? {
            ...threshold
          }
        : null
  };
}

function validateSkillQualityThreshold(
  skillIdOrKey
) {
  const skill = getSkill(skillIdOrKey);

  if (!skill) {
    return {
      ok: false,
      status: "skill_not_found",
      valid: false,
      errors: [
        "Skill not found."
      ]
    };
  }

  const threshold =
    skill.qualityThreshold;

  const errors = [];

  if (
    !threshold ||
    typeof threshold !== "object"
  ) {
    errors.push(
      "Quality threshold is missing."
    );
  } else {
    if (
      typeof threshold.minimumScore !==
      "number"
    ) {
      errors.push(
        "minimumScore must be a number."
      );
    } else if (
      !Number.isFinite(
        threshold.minimumScore
      )
    ) {
      errors.push(
        "minimumScore must be finite."
      );
    } else if (
      threshold.minimumScore < 0 ||
      threshold.minimumScore > 1
    ) {
      errors.push(
        "minimumScore must be between 0 and 1."
      );
    }
  }

  return {
    ok: true,
    status:
      errors.length === 0
        ? "valid"
        : "invalid",
    valid:
      errors.length === 0,
    errors,
    minimumScore:
      threshold &&
      typeof threshold.minimumScore ===
        "number"
        ? threshold.minimumScore
        : null
  };
}

function evaluateSkillQuality(
  skillIdOrKey,
  qualityScore
) {
  const validation =
    validateSkillQualityThreshold(
      skillIdOrKey
    );

  if (!validation.ok) {
    return {
      ok: false,
      status: validation.status,
      decision: "reject",
      score: qualityScore,
      minimumScore: null
    };
  }

  if (!validation.valid) {
    return {
      ok: false,
      status: "invalid_threshold",
      decision: "reject",
      score: qualityScore,
      minimumScore:
        validation.minimumScore,
      errors: validation.errors
    };
  }

  if (
    typeof qualityScore !== "number" ||
    !Number.isFinite(qualityScore)
  ) {
    return {
      ok: false,
      status: "invalid_quality_score",
      decision: "reject",
      score: qualityScore,
      minimumScore:
        validation.minimumScore,
      errors: [
        "qualityScore must be a finite number."
      ]
    };
  }

  if (
    qualityScore < 0 ||
    qualityScore > 1
  ) {
    return {
      ok: false,
      status: "invalid_quality_score",
      decision: "reject",
      score: qualityScore,
      minimumScore:
        validation.minimumScore,
      errors: [
        "qualityScore must be between 0 and 1."
      ]
    };
  }

  const minimumScore =
    validation.minimumScore;

  const passed =
    qualityScore >= minimumScore;

  return {
    ok: true,
    status:
      passed
        ? "passed"
        : "below_threshold",
    decision:
      passed
        ? "pass"
        : "fail",
    score: qualityScore,
    minimumScore,
    margin:
      qualityScore - minimumScore
  };
}


function updateSkillQualityThreshold(
  skillIdOrKey,
  qualityThreshold
) {
  const profile = loadProfile();

  const skill =
    profile.skills.find(
      item =>
        item.skillId === skillIdOrKey ||
        item.key === skillIdOrKey
    );

  if (!skill) {
    return {
      ok: false,
      status: "skill_not_found",
      saved: false
    };
  }

  const threshold =
    qualityThreshold;

  const errors = [];

  if (
    !threshold ||
    typeof threshold !== "object" ||
    Array.isArray(threshold)
  ) {
    errors.push(
      "Quality threshold must be an object."
    );
  } else if (
    typeof threshold.minimumScore !==
    "number"
  ) {
    errors.push(
      "minimumScore must be a number."
    );
  } else if (
    !Number.isFinite(
      threshold.minimumScore
    )
  ) {
    errors.push(
      "minimumScore must be finite."
    );
  } else if (
    threshold.minimumScore < 0 ||
    threshold.minimumScore > 1
  ) {
    errors.push(
      "minimumScore must be between 0 and 1."
    );
  }

  if (errors.length > 0) {
    return {
      ok: false,
      status: "invalid_threshold",
      saved: false,
      errors
    };
  }

  skill.qualityThreshold = {
    ...threshold,
    minimumScore:
      threshold.minimumScore
  };

  skill.updatedAt = now();

  saveProfile(profile);

  return {
    ok: true,
    status: "updated",
    saved: true,
    skillId: skill.skillId,
    skillKey: skill.key,
    qualityThreshold:
      skill.qualityThreshold
  };
}

module.exports = {
  updateSkillQualityThreshold,
  getSkillQualityThreshold,
  validateSkillQualityThreshold,
  evaluateSkillQuality,
  getSkillExampleContracts,
  validateSkillExampleContracts,
  updateSkillExampleContracts,
  PROFILE_FILE,
  MATURITY_LEVELS,
  VERIFICATION_STATES,
  CAPABILITY_STATUSES,
  createCapability,
  getCapability,
  listCapabilities,
  updateCapability,
  addEvidence,
  verifyCapability,
  verifySkill,
  createSkill,
  listSkills,
  getSkill,
  getSkillFailureHistory,
  validateSkillFailureRecord,
  recordSkillFailure,
  clearSkillFailureHistory,
  getSkillLearningHistory,
  validateSkillLearningRecord,
  recordSkillLearning,
  clearSkillLearningHistory,
  getSkillTools,
  validateSkillTools,
  updateSkillTools,
  getSkillContract,
  validateSkillContract,
  checkDependencies,
  getProfileSummary
};
