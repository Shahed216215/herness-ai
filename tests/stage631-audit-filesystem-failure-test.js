"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = process.cwd();
const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-stage631-audit-")
);

const outcome = {
  test: "stage631-audit-filesystem-failure",
  tempDirectoryUsed: true,
  productionSourceModified: false,
  networkUsed: false,
  realToolExecuted: false,
  auditWriteFailureObserved: false,
  result: "INCONCLUSIVE",
  details: []
};

const auditPath = path.join(root, "audit-log.js");
const approvalPath = path.join(root, "autonomous-approval-audit.js");
const enginePath = path.join(
  root, "services/mira-work-execution-engine.js"
);

const savedEnv = {
  audit: process.env.MIRA_AUDIT_FILE,
  key: process.env.MIRA_AUDIT_HMAC_KEY,
  session: process.env.MIRA_SESSION_SECRET
};

const savedCache = new Map();
for (const file of [auditPath, approvalPath, enginePath]) {
  savedCache.set(file, require.cache[file]);
}

try {
  /*
   * Load the real audit module against a temporary audit path.
   * Create a directory at the target filename: writing/renaming
   * the audit file there should fail without touching the real log.
   */
  process.env.MIRA_AUDIT_FILE = path.join(temp, "audit-target");
  delete process.env.MIRA_AUDIT_HMAC_KEY;
  delete process.env.MIRA_SESSION_SECRET;

  fs.mkdirSync(process.env.MIRA_AUDIT_FILE);

  delete require.cache[auditPath];
  const audit = require(auditPath);

  let thrown = null;
  try {
    audit.recordAudit({
      actorRole: "system",
      action: "stage631_filesystem_failure_probe",
      resource: "test",
      resourceId: "isolated-temp-only",
      status: "failed",
      details: { testOnly: true }
    });
  } catch (error) {
    thrown = error;
  }

  if (thrown) {
    outcome.auditWriteFailureObserved = true;
    outcome.details.push(
      `Real audit module threw on isolated target: ${String(thrown.message)}`
    );
  } else {
    outcome.details.push(
      "Audit module did not throw; target failure injection was insufficient."
    );
  }

  /*
   * Exercise the actual audit helper with a mocked audit logger
   * that throws. No production audit stream or tool runner is used.
   */
  delete require.cache[approvalPath];
  const approval = require(approvalPath);

  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (
      parent &&
      parent.filename === approvalPath &&
      request === "./audit-log"
    ) {
      return {
        recordAudit() {
          throw new Error("STAGE631_TEMP_AUDIT_WRITE_FAILURE");
        }
      };
    }
    if (
      parent &&
      parent.filename === approvalPath &&
      request === "./autonomous-policy-gate"
    ) {
      return {
        checkPolicyGate() {
          return { ok: true, allowed: true, operation: "test" };
        },
        authorizeOperation() {
          return { ok: true, allowed: true, operation: "test" };
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    approval.authorizeAndAuditOperation({
      actorRole: "system",
      operation: "test",
      permissionGranted: true,
      approved: false,
      resource: "task",
      resourceId: "stage631-temp-test"
    });
    outcome.details.push("Expected helper exception did not occur.");
  } catch (error) {
    if (String(error.message).includes("STAGE631_TEMP_AUDIT_WRITE_FAILURE")) {
      outcome.details.push("Approval/audit helper propagated injected audit failure.");
    } else {
      outcome.details.push(`Helper threw: ${String(error.message)}`);
    }
  } finally {
    Module._load = originalLoad;
  }

  if (outcome.auditWriteFailureObserved) {
    outcome.result = "PASS_TEMP_FILESYSTEM_FAILURE_OBSERVED";
  }
} catch (error) {
  outcome.details.push(`Test error: ${String(error.stack || error)}`);
} finally {
  for (const [key, value] of Object.entries({
    MIRA_AUDIT_FILE: savedEnv.audit,
    MIRA_AUDIT_HMAC_KEY: savedEnv.key,
    MIRA_SESSION_SECRET: savedEnv.session
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  for (const file of [auditPath, approvalPath, enginePath]) {
    const previous = savedCache.get(file);
    if (previous) require.cache[file] = previous;
    else delete require.cache[file];
  }

  fs.rmSync(temp, { recursive: true, force: true });
  console.log(JSON.stringify(outcome, null, 2));
  if (outcome.result.startsWith("PASS_")) process.exitCode = 0;
  else process.exitCode = 2;
}
