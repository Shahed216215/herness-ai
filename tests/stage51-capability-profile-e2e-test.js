"use strict";

const fs = require("fs");
const path = require("path");

const {
  PROFILE_FILE,
  createCapability,
  getCapability,
  updateCapability,
  verifyCapability,
  createSkill,
  checkDependencies
} = require("../capability-profile");

const {
  getProfileSummary,
  createProfileCapability,
  updateProfileCapability,
  verifyProfileCapability,
  createProfileSkill
} = require("../services/mira-capability-profile");

const {
  getAuditLog
} = require("../audit-log");

const TEST_NAME =
  "STAGE5_1_CAPABILITY_PROFILE_E2E";

const backup =
  `${PROFILE_FILE}.stage51-test-backup`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function resetStore() {
  fs.mkdirSync(
    path.dirname(PROFILE_FILE),
    { recursive: true }
  );

  if (fs.existsSync(PROFILE_FILE)) {
    fs.copyFileSync(
      PROFILE_FILE,
      backup
    );
  }

  fs.writeFileSync(
    PROFILE_FILE,
    JSON.stringify(
      {
        version: 1,
        updatedAt:
          new Date().toISOString(),
        capabilities: [],
        skills: []
      },
      null,
      2
    ) + "\n"
  );
}

function restoreStore() {
  if (fs.existsSync(backup)) {
    fs.copyFileSync(
      backup,
      PROFILE_FILE
    );
    fs.unlinkSync(backup);
  }
}

function main() {
  resetStore();

  try {
    const created =
      createProfileCapability({
        name:
          "Structured Research",
        description:
          "Mira can perform structured research and organize findings.",
        category:
          "knowledge",
        skills: [
          "research"
        ],
        toolRequirements: [
          "web-search"
        ],
        dependencies: [],
        supportedTasks: [
          "research topic",
          "summarize findings"
        ],
        unsupportedTasks: [
          "legal commitment",
          "financial transaction"
        ],
        maturity:
          "developing"
      });

    assert(
      created.ok === true,
      "Capability create failed."
    );

    const duplicate =
      createCapability({
        name:
          "Structured Research",
        description:
          "Duplicate capability.",
        category:
          "knowledge"
      });

    assert(
      duplicate.ok === false &&
        duplicate.status ===
          "duplicate",
      "Duplicate detection failed."
    );

    const id =
      created.capability.capabilityId;

    const updated =
      updateProfileCapability(
        id,
        {
          maturity:
            "competent",
          supportedTasks: [
            "research topic",
            "summarize findings",
            "organize evidence"
          ]
        }
      );

    assert(
      updated.ok === true &&
        updated.capability.maturity ===
          "competent",
      "Capability update failed."
    );

    let invalidBlocked = false;

    try {
      updateCapability(
        id,
        {
          maturity:
            "superhuman"
        }
      );
    } catch (error) {
      invalidBlocked = true;
    }

    assert(
      invalidBlocked,
      "Invalid maturity was not blocked."
    );

    const dependencyCapability =
      createCapability({
        name:
          "Evidence Analysis",
        description:
          "Analyzes research evidence.",
        category:
          "knowledge",
        dependencies: [
          "Structured Research"
        ]
      });

    assert(
      dependencyCapability.ok === true,
      "Dependency capability create failed."
    );

    const dependencyBefore =
      checkDependencies(
        dependencyCapability.capability
          .capabilityId
      );

    assert(
      dependencyBefore.ok === false,
      "Unsatisfied dependency was not detected."
    );

    const skill =
      createProfileSkill({
        name:
          "Research",
        category:
          "knowledge",
        maturity:
          "competent",
        capabilities: [
          id
        ],
        supportedTasks: [
          "research topic"
        ],
        unsupportedTasks: [
          "financial transaction"
        ]
      });

    assert(
      skill.ok === true,
      "Skill creation failed."
    );

    const verified =
      verifyProfileCapability(id, {
        type:
          "e2e",
        reference:
          "stage51-capability-e2e"
      });

    assert(
      verified.ok === true &&
        verified.capability.verification ===
          "verified",
      "Capability verification failed."
    );

    const dependencyAfter =
      checkDependencies(
        dependencyCapability.capability
          .capabilityId
      );

    assert(
      dependencyAfter.ok === true,
      "Verified dependency was not recognized."
    );

    const loaded =
      getCapability(id);

    assert(
      loaded &&
        loaded.verification ===
          "verified",
      "Verified capability could not be loaded."
    );

    const summary =
      getProfileSummary();

    assert(
      summary.capabilityCount === 2 &&
        summary.skillCount === 1 &&
        summary.verifiedCapabilities === 1,
      "Profile summary is incorrect."
    );

    const auditEntries =
      typeof getAuditLog === "function"
        ? getAuditLog()
        : [];

    assert(
      Array.isArray(auditEntries),
      "Audit log was not readable."
    );

    const auditActions =
      auditEntries.map(
        entry => entry.action
      );

    assert(
      auditActions.includes(
        "CAPABILITY_PROFILE_CREATED"
      ),
      "Capability creation audit missing."
    );

    assert(
      auditActions.includes(
        "CAPABILITY_PROFILE_UPDATED"
      ),
      "Capability update audit missing."
    );

    assert(
      auditActions.includes(
        "CAPABILITY_PROFILE_VERIFIED"
      ),
      "Capability verification audit missing."
    );

    assert(
      auditActions.includes(
        "SKILL_PROFILE_CREATED"
      ),
      "Skill creation audit missing."
    );

    console.log(
      `${TEST_NAME}: PASS`
    );
  } finally {
    restoreStore();
  }
}

try {
  main();
} catch (error) {
  console.error(
    `${TEST_NAME}: FAIL`
  );
  console.error(
    error.stack ||
      error.message
  );
  process.exitCode = 1;
}
