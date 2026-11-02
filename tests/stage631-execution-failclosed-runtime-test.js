"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = process.cwd();
const engineFile = path.join(
  root, "services/mira-work-execution-engine.js"
);
const approvalFile = path.join(root, "autonomous-approval-audit.js");
const auditFile = path.join(root, "audit-log.js");
const policyGateFile = path.join(root, "autonomous-policy-gate.js");
const runnerFile = path.join(root, "services/tool-runner.js");

const result = {
  test: "stage631-execution-failclosed-runtime",
  productionSourceModified: false,
  networkUsed: false,
  realToolExecuted: false,
  auditFailureInjected: false,
  executeWorkReached: false,
  runToolCalls: 0,
  status: "INCONCLUSIVE",
  evidence: []
};

const oldLoad = Module._load;
const oldEnv = {
  audit: process.env.MIRA_AUDIT_FILE,
  key: process.env.MIRA_AUDIT_HMAC_KEY,
  session: process.env.MIRA_SESSION_SECRET
};
const cacheFiles = [
  engineFile, approvalFile, auditFile, policyGateFile, runnerFile
];
const oldCache = new Map(
  cacheFiles.map(file => [file, require.cache[file]])
);

try {
  /*
   * Intercept environment-file loading. No .env values are read.
   * Replace only dependencies at the engine's import boundary.
   */
  Module._load = function(request, parent, isMain) {
    const from = parent && parent.filename;

    if (request === "dotenv/config") return {};
    if (request === "dotenv") return { config: () => ({ parsed: Object.create(null) }) };

    if (from === engineFile && request === "./tool-runner") {
      return {
        runTool: async () => {
          result.runToolCalls++;
          throw new Error("TEST_FAILURE: tool execution must not happen");
        }
      };
    }

    if (from === engineFile && request === "../autonomous-approval-audit") {
      return {
        authorizeAndAuditOperation() {
          result.auditFailureInjected = true;
          throw new Error("STAGE631_INJECTED_AUDIT_FAILURE");
        }
      };
    }

    return oldLoad.call(this, request, parent, isMain);
  };

  delete require.cache[engineFile];
  const engine = require(engineFile);

  if (!engine || typeof engine.executeWork !== "function") {
    throw new Error("executeWork export not found");
  }

  result.executeWorkReached = true;

  /*
   * Deliberately pass a minimal input. The expected boundary is:
   * audit failure must prevent any tool invocation.
   * If validation stops execution before the injected boundary,
   * this test remains INCONCLUSIVE rather than reporting PASS.
   */
  Promise.resolve(
    engine.executeWork("stage631 audit failure isolation", {
      persist: false,
      permissionGranted: true
    })
  ).then(value => {
    result.evidence.push(
      "executeWork returned without propagating the injected audit exception."
    );
    result.evidence.push(
      `Returned result type: ${value === null ? "null" : typeof value}`
    );
  }).catch(error => {
    result.evidence.push(`executeWork exception: ${String(error.message)}`);
  }).finally(() => {
    if (
      result.auditFailureInjected &&
      result.runToolCalls === 0 &&
      result.evidence.some(x =>
        x.includes("STAGE631_INJECTED_AUDIT_FAILURE")
      )
    ) {
      result.status = "PASS_AUDIT_FAILURE_BLOCKED_TOOL";
    } else if (
      result.auditFailureInjected &&
      result.runToolCalls === 0
    ) {
      result.status = "BOUNDARY_REACHED_BUT_EXCEPTION_NOT_CONFIRMED";
    } else if (!result.auditFailureInjected) {
      result.status = "INCONCLUSIVE_PRECONDITION_OR_VALIDATION_BLOCKED";
    } else {
      result.status = "FAIL_TOOL_CALLED_OR_BOUNDARY_BYPASSED";
    }

    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "PASS_AUDIT_FAILURE_BLOCKED_TOOL" ? 0 : 2;
  });
} catch (error) {
  result.evidence.push(`Harness error: ${String(error.stack || error)}`);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 2;
} finally {
  Module._load = oldLoad;
  for (const [key, value] of Object.entries({
    MIRA_AUDIT_FILE: oldEnv.audit,
    MIRA_AUDIT_HMAC_KEY: oldEnv.key,
    MIRA_SESSION_SECRET: oldEnv.session
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const file of cacheFiles) {
    const prior = oldCache.get(file);
    if (prior) require.cache[file] = prior;
    else delete require.cache[file];
  }
}
