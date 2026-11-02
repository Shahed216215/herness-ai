"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync(
  "routes/mira-provider-evolution.js",
  "utf8"
);

const restoreStart = source.indexOf("function restoreRuntimeConfig()");
assert.notEqual(restoreStart, -1, "restore helper must exist");

const restoreEnd = source.indexOf(
  "function saveRollbackSnapshot",
  restoreStart
);
assert.notEqual(restoreEnd, -1, "snapshot helper must follow restore helper");

const restore = source.slice(restoreStart, restoreEnd);
assert.match(restore, /if \(!fs\.existsSync\(ROLLBACK_CONFIG_PATH\)\)\s*(?:\{\s*return false;\s*\}|return false;)/);
assert.ok(restore.includes("writeRuntimeConfig(snapshot)"));
assert.ok(restore.includes("readRuntimeConfig()"));
assert.ok(restore.includes("runtime_config_restore_verification_failed"));
assert.ok(
  restore.indexOf("runtime_config_restore_verification_failed") <
    restore.indexOf("fs.unlinkSync(ROLLBACK_CONFIG_PATH)"),
  "snapshot must not be removed before restore verification"
);
console.log("PASS: restore verifies runtime configuration before removing snapshot");

const applyCatch = source.slice(
  source.indexOf('router.post(\n  "/:id/activate"'),
  source.indexOf('router.post(\n  "/:id/verify"')
);
assert.ok(applyCatch.includes("rollback_snapshot_missing"));
assert.ok(applyCatch.includes("MIRA_PROVIDER_CHANGE_ROLLBACK_FAILED"));
assert.ok(applyCatch.includes('status: "rollback_failed"'));
assert.ok(applyCatch.includes("recoveryRequired: true"));
assert.doesNotMatch(applyCatch, /try\s*\{\s*restoreRuntimeConfig\(\);\s*\}\s*catch\s*\(_\)\s*\{\s*\}/);
console.log("PASS: rollback failure is surfaced instead of silently ignored");
console.log("MOCK_ONLY_PROVIDER_ROLLBACK_CONTRACT=PASS");
console.log("LIVE_PROVIDER_REQUESTS=0");
