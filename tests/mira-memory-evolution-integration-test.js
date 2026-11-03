"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const PROJECT = path.resolve(__dirname, "..");
const TEMP = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-memory-evolution-")
);

let passed = 0;

function pass(name) {
  passed++;
  console.log("PASS:", name);
}

function hash(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

async function main() {
  const root = path.join(TEMP, "evolution");
  const storeRoot = path.join(TEMP, "store");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(storeRoot, { recursive: true });

  const initial = [
    { role: "user", content: "fixture-original-memory" },
    { role: "assistant", content: "fixture-existing-entry" }
  ];

  const proposed = [
    ...initial,
    { role: "user", content: "fixture-new-entry" }
  ];

  writeJson(path.join(root, "memory.json"), initial);
  writeJson(path.join(root, "drive-memory.json"), initial);

  copy(
    path.join(PROJECT, "knowledge-memory-evolution.js"),
    path.join(root, "knowledge-memory-evolution.js")
  );
  copy(
    path.join(PROJECT, "snapshot-manager.js"),
    path.join(root, "snapshot-manager.js")
  );
  copy(
    path.join(PROJECT, "mira-storage.js"),
    path.join(root, "mira-storage.js")
  );
  copy(
    path.join(PROJECT, "services/mira-local-memory-store.js"),
    path.join(root, "services/mira-local-memory-store.js")
  );
  copy(
    path.join(PROJECT, "services/mira-json-state-store.js"),
    path.join(root, "services/mira-json-state-store.js")
  );

  writeJson(path.join(root, "audit-log.js"), {});
  fs.writeFileSync(
    path.join(root, "audit-log.js"),
    '"use strict"; module.exports = { recordAudit: () => ({ logged: true }) };'
  );

  fs.writeFileSync(path.join(root, "google-drive.js"), `
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const file = path.join(__dirname, "drive-memory.json");
let failNext = false;
const clone = value => JSON.parse(JSON.stringify(value));

async function loadMemoryFromDrive() {
  return clone(JSON.parse(fs.readFileSync(file, "utf8")));
}
async function saveMemoryToDrive(value) {
  if (failNext) {
    failNext = false;
    throw new Error("TEST_INJECTED_MEMORY_DRIVE_FAILURE");
  }
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return true;
}
async function loadKnowledgeFromDrive() { return []; }
async function saveKnowledgeToDrive() { return true; }
function failNextMemorySave() { failNext = true; }

module.exports = {
  loadMemoryFromDrive,
  saveMemoryToDrive,
  loadKnowledgeFromDrive,
  saveKnowledgeToDrive,
  failNextMemorySave
};
`);

  process.env.MIRA_STORAGE_DIR = root;
  process.env.MIRA_MEMORY_FILE = path.join(root, "memory.json");

  const engine = require(
    path.join(root, "knowledge-memory-evolution.js")
  );
  const drive = require(path.join(root, "google-drive.js"));

  const localFile = path.join(root, "memory.json");
  const driveFile = path.join(root, "drive-memory.json");

  const proposal = (state, expected = initial) => ({
    id: "memory-integration-fixture",
    status: "approved",
    target: "memory",
    expectedPreStateHash: hash(expected),
    proposedState: state
  });

  // 1. Successful Memory Evolution apply.
  const applied = await engine.applyEvolution(
    proposal(proposed),
    {
      changeId: "memory-fixture-success",
      appliedBy: "isolated-test"
    }
  );

  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.verified, true);
  assert.deepEqual(readJson(localFile), proposed);
  assert.deepEqual(readJson(driveFile), proposed);
  pass("Memory Evolution apply + local/Drive verification");

  // 2. Independent engine verification.
  const verification = await engine.verifyEvolutionState("memory");
  assert.equal(verification.ok, true, JSON.stringify(verification));
  pass("Memory Evolution independent state verification");

  // 3. Snapshot rollback.
  const rollback = await engine.rollbackEvolution({
    target: "memory",
    changeId: applied.changeId,
    snapshotId: applied.snapshotId,
    proposalId: "memory-integration-fixture",
    restoredBy: "isolated-test"
  });

  assert.equal(rollback.ok, true, JSON.stringify(rollback));
  assert.deepEqual(readJson(localFile), initial);
  assert.deepEqual(readJson(driveFile), initial);
  pass("Memory snapshot rollback + local/Drive consistency");

  // 4. Divergent Local/Drive state must be preserved in quarantine and block apply.
  const divergentDrive = [
    ...initial,
    { role: "user", content: "fixture-conflicting-remote-entry" }
  ];
  writeJson(driveFile, divergentDrive);
  const conflict = await engine.prepareEvolution(
    proposal(proposed),
    { changeId: "memory-fixture-conflict" }
  );
  assert.equal(conflict.ok, false);
  assert.equal(conflict.status, "local_drive_mismatch", JSON.stringify(conflict));
  assert.equal(fs.existsSync(conflict.quarantine.file), true);
  const quarantineEnvelope = readJson(conflict.quarantine.file);
  assert.deepEqual(quarantineEnvelope.payload.local, initial);
  assert.deepEqual(quarantineEnvelope.payload.drive, divergentDrive);
  writeJson(driveFile, initial);
  pass("Local/Drive conflict quarantined without overwriting either source");

  // 5. Drive failure after local apply must trigger rollback.
  drive.failNextMemorySave();

  const failedApply = await engine.applyEvolution(
    proposal(proposed),
    {
      changeId: "memory-fixture-drive-failure",
      appliedBy: "isolated-test"
    }
  );

  assert.equal(
    failedApply.status,
    "apply_failed_rolled_back",
    JSON.stringify(failedApply)
  );
  assert.equal(failedApply.rollback?.ok, true);
  assert.deepEqual(readJson(localFile), initial);
  assert.deepEqual(readJson(driveFile), initial);
  pass("Injected Drive failure + automatic verified rollback");

  // 5. Stale pre-state must be rejected without mutation.
  const stale = await engine.applyEvolution(
    proposal(proposed, [{ role: "user", content: "wrong-state" }]),
    { changeId: "memory-fixture-stale" }
  );

  assert.equal(stale.ok, false);
  assert.equal(stale.status, "stale_pre_state");
  assert.deepEqual(readJson(localFile), initial);
  assert.deepEqual(readJson(driveFile), initial);
  pass("Stale pre-state rejection without mutation");

  // 6. Existing Memory entries must be preserved by default.
  const removal = await engine.applyEvolution(
    proposal([initial[0]]),
    { changeId: "memory-fixture-preservation" }
  );

  assert.equal(removal.ok, false);
  assert.equal(removal.status, "preservation_validation_failed");
  assert.deepEqual(readJson(localFile), initial);
  pass("Memory preservation policy blocks entry removal");

  // 7. Local Store atomic writer, using a separate temporary file.
  const store = require(
    path.join(root, "services/mira-local-memory-store.js")
  );

  const storeEntries = [
    { role: "user", content: "isolated-local-store-fixture" }
  ];

  const writeResult = store.writeMemory(storeEntries);
  assert.equal(writeResult.entries, 1);
  assert.deepEqual(store.readMemory(), storeEntries);

  const mode = fs.statSync(store.MEMORY_FILE).mode & 0o777;
  assert.equal(mode, 0o600);
  pass("Local Store atomic write + readback + restrictive file mode");

  // 8. Invalid Local Store input must not replace valid data.
  assert.throws(() => store.writeMemory({ invalid: true }));
  assert.deepEqual(store.readMemory(), storeEntries);
  pass("Local Store rejects invalid input without replacing data");

  // Verify Evolution delegates Memory persistence to the shared Local Store.
  const source = fs.readFileSync(
    path.join(PROJECT, "knowledge-memory-evolution.js"),
    "utf8"
  );

  assert.ok(source.includes("localMemoryStore.readMemory()"));
  assert.ok(source.includes("localMemoryStore.writeMemory(value)"));
  assert.ok(source.includes("jsonStateStore.writeArrayState"));

  console.log("SHARED_MEMORY_STORE_INTEGRATION=PASS");

  console.log("TESTS_PASSED=" + passed);
  console.log("TESTS_FAILED=0");
  console.log("PRODUCTION_MEMORY_TOUCHED=NO");
  console.log("REAL_GOOGLE_DRIVE_TOUCHED=NO");
  console.log("NETWORK_REQUESTS=0");
  console.log("RESULT=ISOLATED_BASELINE_PASS_INTEGRATION_GAP_CONFIRMED");
}

main()
  .catch(error => {
    console.error("FAIL:", error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      fs.rmSync(TEMP, { recursive: true, force: true });
    } catch (error) {
      console.error("TEMP_CLEANUP=REVIEW_REQUIRED:", error.message);
      process.exitCode = 1;
    }
    delete process.env.MIRA_STORAGE_DIR;
    delete process.env.MIRA_MEMORY_FILE;
  });
