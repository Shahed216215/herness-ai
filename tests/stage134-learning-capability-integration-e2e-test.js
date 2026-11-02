"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const PROFILE_FILE = path.join(ROOT, "data", "capability-profile.json");
const AUDIT_FILE = path.join(ROOT, "audit-log.json");
const STAGE13_FILE = path.join(os.tmpdir(),
  "mira-stage134-learning-" + process.pid + ".json");
const INTEGRATION_FILE = path.join(os.tmpdir(),
  "mira-stage134-integration-" + process.pid + ".json");
const FIXTURE = path.join(ROOT, "tests",
  ".stage134-passing-fixture-" + process.pid + ".js");

function assert(condition, message) {
  if (!condition) throw new Error("ASSERTION_FAILED: " + message);
}
function snapshot(file) {
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}
function restore(file, bytes) {
  if (bytes === null) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
}
function clean(file) {
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
}
function main() {
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  const profileBackup = snapshot(PROFILE_FILE);
  const auditBackup = snapshot(AUDIT_FILE);
  const fixtureBackup = snapshot(FIXTURE);
  const stage13Backup = snapshot(STAGE13_FILE);
  const integrationBackup = snapshot(INTEGRATION_FILE);

  try {
    process.env.MIRA_STAGE13_STORE = STAGE13_FILE;
    process.env.MIRA_STAGE13_CAPABILITY_INTEGRATION_STORE = INTEGRATION_FILE;

    fs.writeFileSync(PROFILE_FILE, JSON.stringify({
      version: 1, updatedAt: new Date().toISOString(),
      capabilities: [], skills: []
    }, null, 2) + "\n");
    fs.writeFileSync(FIXTURE, '"use strict";\nprocess.exit(0);\n');

    const core = require("../capability-profile");
    const profileService = require("../services/mira-capability-profile");
    const learning = require("../services/mira-stage13-learning-governance");
    const integration = require("../services/mira-stage13-capability-integration");
    const audit = require("../audit-log");

    const cap = profileService.createProfileCapability({
      name: "Stage134 Research Capability",
      description: "Isolated integration test capability",
      category: "knowledge",
      skills: ["stage134-integration-skill"],
      dependencies: [],
      supportedTasks: ["test integration"]
    });
    assert(cap.ok === true, "capability created");
    const verifiedCap = profileService.verifyProfileCapability(
      cap.capability.capabilityId,
      { type: "test", reference: "stage134-e2e" }
    );
    assert(verifiedCap.ok === true, "capability verified");

    const skill = profileService.createProfileSkill({
      name: "Stage134 Integration Skill",
      category: "testing",
      capabilities: [cap.capability.key],
      supportedTasks: ["test integration"]
    });
    assert(skill.ok === true, "skill created");
    assert(core.getSkill(skill.skill.skillId).verification === "unverified",
      "skill initially unverified");

    const benchmark = learning.recordBenchmark({
      skill: skill.skill.name,
      evidenceReference: "stage134-e2e",
      minimumScore: 1,
      tests: [{ name: "passing fixture", testFile: path.relative(ROOT, FIXTURE) }]
    });
    assert(benchmark.criteriaMet === true, "actual benchmark test passed");
    assert(benchmark.profileVerificationChanged === false,
      "benchmark did not verify profile");
    assert(core.getSkill(skill.skill.skillId).verification === "unverified",
      "benchmark alone did not verify skill");
    console.log("PASS Benchmark does not auto-verify skill");

    const request = integration.prepareVerification({
      benchmarkId: benchmark.id,
      skillIdOrKey: skill.skill.skillId
    });
    assert(request.ok && request.approvalRequired && !request.autoApplied,
      "approval request created");
    assert(core.getSkill(skill.skill.skillId).verification === "unverified",
      "prepare did not mutate skill verification");
    console.log("PASS Request stays pending until approval");

    let rejected = false;
    try {
      integration.approveVerification({
        requestId: request.requestId,
        approvedBy: "E2E reviewer",
        approvalChallenge: "wrong-token",
        confirm: true
      });
    } catch (e) {
      rejected = e.message === "APPROVAL_CHALLENGE_INVALID";
    }
    assert(rejected, "wrong approval challenge rejected");
    assert(core.getSkill(skill.skill.skillId).verification === "unverified",
      "wrong challenge caused no verification");
    console.log("PASS Invalid approval challenge rejected");

    rejected = false;
    try {
      integration.approveVerification({
        requestId: request.requestId,
        approvedBy: "E2E reviewer",
        approvalChallenge: request.approvalChallenge
      });
    } catch (e) {
      rejected = e.message === "EXPLICIT_CONFIRMATION_REQUIRED";
    }
    assert(rejected, "confirmation required");
    console.log("PASS Explicit confirmation required");

    const applied = integration.approveVerification({
      requestId: request.requestId,
      approvedBy: "E2E reviewer",
      approvalChallenge: request.approvalChallenge,
      confirm: true
    });
    assert(applied.ok && applied.status === "approved_verified",
      "approved verification applied");
    assert(core.getSkill(skill.skill.skillId).verification === "verified",
      "skill verified through existing API");
    assert(applied.expertClaimAllowed === false && !applied.autoApplied,
      "no expert claim or auto apply");
    console.log("PASS Approved verification uses existing profile API");

    rejected = false;
    try {
      integration.approveVerification({
        requestId: request.requestId,
        approvedBy: "E2E reviewer",
        approvalChallenge: request.approvalChallenge,
        confirm: true
      });
    } catch (e) {
      rejected = e.message === "REQUEST_NOT_PENDING";
    }
    assert(rejected, "replay rejected");
    console.log("PASS Approval replay rejected");

    const integrity = integration.checkIntegrity();
    assert(integrity.ok, "integration hash chain valid");
    assert(learning.verifyIntegrity().ok, "learning hash chain valid");
    assert(audit.verifyAuditIntegrity().ok, "audit integrity valid");
    console.log("PASS Integration, learning and audit integrity");

    const saved = JSON.parse(fs.readFileSync(INTEGRATION_FILE, "utf8"));
    saved.requests[0].status = "tampered";
    fs.writeFileSync(INTEGRATION_FILE, JSON.stringify(saved, null, 2));
    assert(integration.checkIntegrity().ok === false, "tampering detected");
    console.log("PASS Integration request tampering detected");

    console.log("STAGE134_LEARNING_CAPABILITY_INTEGRATION_E2E: PASS");
  } finally {
    restore(PROFILE_FILE, profileBackup);
    restore(AUDIT_FILE, auditBackup);
    restore(FIXTURE, fixtureBackup);
    restore(STAGE13_FILE, stage13Backup);
    restore(INTEGRATION_FILE, integrationBackup);
    console.log("PASS Test stores and fixture restored");
  }
}

try {
  main();
} catch (error) {
  console.error("STAGE134_LEARNING_CAPABILITY_INTEGRATION_E2E: FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
