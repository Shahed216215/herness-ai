"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const engineSource = path.join(projectRoot, "knowledge-memory-evolution.js");
const snapshotSource = path.join(projectRoot, "snapshot-manager.js");
const tempRoots = [];

function hash(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function makeEnvironment(initial) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "mira-stage19-evolution-")
  );
  tempRoots.push(root);

  fs.copyFileSync(engineSource, path.join(root, "knowledge-memory-evolution.js"));
  fs.copyFileSync(path.join(projectRoot, "mira-storage.js"), path.join(root, "mira-storage.js"));
  fs.copyFileSync(snapshotSource, path.join(root, "snapshot-manager.js"));
  fs.writeFileSync(path.join(root, "knowledge.json"), JSON.stringify(initial, null, 2));
  fs.writeFileSync(path.join(root, "drive-knowledge.json"), JSON.stringify(initial));
  fs.writeFileSync(path.join(root, "memory.json"), "[]");

  fs.writeFileSync(path.join(root, "google-drive.js"), `
"use strict";
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "drive-knowledge.json");
let failNext = false;
const clone = x => JSON.parse(JSON.stringify(x));
async function loadKnowledgeFromDrive() {
  return clone(JSON.parse(fs.readFileSync(file, "utf8")));
}
async function saveKnowledgeToDrive(data) {
  if (failNext) {
    failNext = false;
    throw new Error("TEST_INJECTED_DRIVE_SAVE_FAILURE");
  }
  fs.writeFileSync(file, JSON.stringify(data));
  return true;
}
async function loadMemoryFromDrive() { return []; }
async function saveMemoryToDrive() { return true; }
function failNextKnowledgeSave() { failNext = true; }
module.exports = {
  loadKnowledgeFromDrive, saveKnowledgeToDrive,
  loadMemoryFromDrive, saveMemoryToDrive,
  failNextKnowledgeSave
};
`);

  fs.writeFileSync(path.join(root, "audit-log.js"), `
"use strict";
module.exports = {
  recordAudit: () => ({ logged: true })
};
`);

  const engine = require(path.join(root, "knowledge-memory-evolution.js"));
  const drive = require(path.join(root, "google-drive.js"));

  return { root, engine, drive, initial };
}

function fixture(initial, proposedState, expectedPreStateHash = hash(initial)) {
  return {
    id: "stage19-fixture",
    status: "approved",
    target: "knowledge",
    expectedPreStateHash,
    proposedState
  };
}

function readLocal(env) {
  return JSON.parse(
    fs.readFileSync(path.join(env.root, "knowledge.json"), "utf8")
  );
}

function readDrive(env) {
  return JSON.parse(
    fs.readFileSync(path.join(env.root, "drive-knowledge.json"), "utf8")
  );
}

function assertStateEqual(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

(async () => {
  let passed = 0;
  function pass(message) {
    passed++;
    console.log("PASS:", message);
  }

  const original = [
    { title: "Fixture", topic: "Governance", content: "Original content" }
  ];
  const proposed = [
    ...original,
    { title: "Fixture addition", topic: "Governance", content: "Added content" }
  ];

  try {
    // 1. Invalid approval state must be rejected.
    {
      const env = makeEnvironment(original);
      const result = await env.engine.prepareEvolution(
        { ...fixture(original, proposed), status: "pending" }
      );
      assert.equal(result.ok, false);
      assert.equal(result.status, "proposal_validation_failed");
      assertStateEqual(readLocal(env), original, "invalid proposal changed local state");
      pass("unapproved proposal rejected without changing local state");
    }

    // 2. Stale pre-state must be rejected.
    {
      const env = makeEnvironment(original);
      const result = await env.engine.prepareEvolution(
        fixture(original, proposed, "0".repeat(64))
      );
      assert.equal(result.ok, false);
      assert.equal(result.status, "stale_pre_state");
      assertStateEqual(readLocal(env), original, "stale proposal changed local state");
      pass("stale pre-state hash rejected");
    }

    // 3. Successful apply must verify local and mocked Drive state.
    {
      const env = makeEnvironment(original);
      const result = await env.engine.applyEvolution(
        fixture(original, proposed),
        { changeId: "stage19-success", appliedBy: "isolated-test" }
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.status, "applied_verified");
      assertStateEqual(readLocal(env), proposed, "local state differs after apply");
      assertStateEqual(readDrive(env), proposed, "mock Drive differs after apply");
      const verify = await env.engine.verifyEvolutionState("knowledge");
      assert.equal(verify.ok, true, JSON.stringify(verify));
      pass("approved apply verifies local and mocked Drive state");
    }

    // 4. Rollback must restore both local and mocked Drive state.
    {
      const env = makeEnvironment(original);
      const applied = await env.engine.applyEvolution(
        fixture(original, proposed),
        { changeId: "stage19-rollback", appliedBy: "isolated-test" }
      );
      assert.equal(applied.ok, true, JSON.stringify(applied));

      const rollback = await env.engine.rollbackEvolution({
        target: "knowledge",
        changeId: applied.changeId,
        snapshotId: applied.snapshotId,
        proposalId: applied.proposalId,
        restoredBy: "isolated-test"
      });
      assert.equal(rollback.ok, true, JSON.stringify(rollback));
      assert.equal(rollback.status, "rollback_verified");
      assertStateEqual(readLocal(env), original, "rollback did not restore local state");
      assertStateEqual(readDrive(env), original, "rollback did not restore mock Drive");
      pass("rollback restores and verifies local and mocked Drive state");
    }

    // 5. One injected Drive failure must trigger a verified rollback.
    {
      const env = makeEnvironment(original);
      env.drive.failNextKnowledgeSave();

      const result = await env.engine.applyEvolution(
        fixture(original, proposed),
        { changeId: "stage19-auto-rollback", appliedBy: "isolated-test" }
      );

      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.status, "apply_failed_rolled_back", JSON.stringify(result));
      assert.equal(result.rollback && result.rollback.ok, true, JSON.stringify(result));
      assertStateEqual(readLocal(env), original, "automatic rollback did not restore local state");
      assertStateEqual(readDrive(env), original, "automatic rollback did not restore mock Drive");
      pass("injected Drive write failure triggers verified automatic rollback");
    }

    // 6. Snapshot tampering must block rollback.
    {
      const env = makeEnvironment(original);
      const applied = await env.engine.applyEvolution(
        fixture(original, proposed),
        { changeId: "stage19-tamper", appliedBy: "isolated-test" }
      );
      assert.equal(applied.ok, true, JSON.stringify(applied));

      const snapshotFile = path.join(
        env.root, "backups", "changes",
        applied.changeId, applied.snapshotId,
        "files", "knowledge.json"
      );
      assert.equal(fs.existsSync(snapshotFile), true, "snapshot fixture missing");
      fs.appendFileSync(snapshotFile, "\nTAMPERED");

      const rollback = await env.engine.rollbackEvolution({
        target: "knowledge",
        changeId: applied.changeId,
        snapshotId: applied.snapshotId,
        proposalId: applied.proposalId,
        restoredBy: "isolated-test"
      });
      assert.equal(rollback.ok, false);
      assert.equal(rollback.status, "rollback_blocked");
      assertStateEqual(readLocal(env), proposed, "blocked rollback unexpectedly changed local state");
      pass("tampered snapshot blocks rollback before restore");
    }

    console.log("STAGE19_EVOLUTION_ISOLATION_TESTS_TOTAL=6");
    console.log("STAGE19_EVOLUTION_ISOLATION_TESTS_PASSED=" + passed);
    console.log("STAGE19_EVOLUTION_ISOLATION_TESTS_FAILED=0");
    console.log("STAGE19_EVOLUTION_ISOLATION_GATE=PASS");
  } catch (error) {
    console.error("STAGE19_EVOLUTION_ISOLATION_GATE=FAIL");
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  } finally {
    for (const root of tempRoots) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch (error) {
        console.error("TEMP_CLEANUP_WARNING:", error.message);
        process.exitCode = 1;
      }
    }
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
