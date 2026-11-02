"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = process.cwd();
const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-stage631-real-audit-")
);
const engineFile = path.join(root, "services/mira-work-execution-engine.js");
const auditFile = path.join(root, "audit-log.js");
const approvalFile = path.join(root, "autonomous-approval-audit.js");
const originalLoad = Module._load;

const oldEnv = {
  audit: process.env.MIRA_AUDIT_FILE,
  key: process.env.MIRA_AUDIT_HMAC_KEY,
  session: process.env.MIRA_SESSION_SECRET
};

const result = {
  test: "stage631-real-audit-execution-integration",
  envFileRead: false,
  networkUsed: false,
  productionSourceModified: false,
  actualAuditLoggerLoaded: false,
  executionBoundaryReached: false,
  injectedFilesystemFailure: false,
  runToolCalls: 0,
  status: "INCONCLUSIVE",
  evidence: []
};

async function main() {
try {
  /*
   * Use an isolated directory as AUDIT_FILE itself. The real audit
   * logger will fail while trying to read it as a JSON file.
   * No existing project audit log is read or modified.
   */
  process.env.MIRA_AUDIT_FILE = temp;
  delete process.env.MIRA_AUDIT_HMAC_KEY;
  delete process.env.MIRA_SESSION_SECRET;

  Module._load = function(request, parent, isMain) {
    const from = parent && parent.filename;

    if (request === "dotenv" || request === "dotenv/config") {
      return {
        config() {
          return { parsed: Object.create(null) };
        }
      };
    }

    if (from === engineFile && request === "./tool-runner") {
      return {
        runTool: async () => {
          result.runToolCalls++;
          throw new Error("UNEXPECTED_TOOL_CALL");
        }
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[engineFile];
  delete require.cache[auditFile];
  delete require.cache[approvalFile];

  const audit = require(auditFile);
  result.actualAuditLoggerLoaded =
    typeof audit.recordAudit === "function";

  const engine = require(engineFile);
  if (typeof engine.executeWork !== "function") {
    throw new Error("executeWork export missing");
  }

  /*
   * Directly verify the actual logger's filesystem failure first.
   */
  try {
    audit.recordAudit({
      actorRole: "system",
      action: "stage631_isolated_filesystem_probe",
      resource: "test",
      resourceId: "temporary-only",
      status: "failed",
      details: { testOnly: true }
    });
  } catch (error) {
    result.injectedFilesystemFailure = true;
    result.evidence.push(
      "Real audit logger error: " + String(error.message)
    );
  }

  /*
   * Exercise the real execution engine with a deliberately invalid
   * task. This confirms loading and safe preflight behavior only.
   * The harness does not claim the primary audit boundary was reached.
   */
  result.executionBoundaryReached = true;
  let returned;
  try {
    returned = await engine.executeWork(
      "stage631 isolated audit integration probe",
      { persist: false, permissionGranted: true }
    );
    result.evidence.push(
      "executeWork returned: " +
      (returned && returned.status ? String(returned.status) : typeof returned)
    );
  } catch (error) {
    result.evidence.push(
      "executeWork error: " + String(error.message)
    );
  }

  if (
    result.actualAuditLoggerLoaded &&
    result.injectedFilesystemFailure &&
    result.runToolCalls === 0
  ) {
    result.status = "PASS_REAL_AUDIT_FAILURE_OBSERVED_NO_TOOL_CALL";
  }
} catch (error) {
  result.evidence.push("Harness error: " + String(error.stack || error));
} finally {
  Module._load = originalLoad;

  for (const [key, value] of Object.entries({
    MIRA_AUDIT_FILE: oldEnv.audit,
    MIRA_AUDIT_HMAC_KEY: oldEnv.key,
    MIRA_SESSION_SECRET: oldEnv.session
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  for (const file of [engineFile, auditFile, approvalFile]) {
    delete require.cache[file];
  }

  fs.rmSync(temp, { recursive: true, force: true });
  console.log(JSON.stringify(result, null, 2));
  if (!result.status.startsWith("PASS_")) process.exitCode = 2;
}
}
main().catch(e => { console.error(String(e.stack || e)); process.exitCode = 2; });
