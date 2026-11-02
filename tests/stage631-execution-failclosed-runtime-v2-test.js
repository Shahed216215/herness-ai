"use strict";

const path = require("node:path");
const Module = require("node:module");

const root = process.cwd();
const engineFile = path.join(root, "services/mira-work-execution-engine.js");
const originalLoad = Module._load;

const result = {
  test: "stage631-execution-failclosed-runtime-v2",
  envFileRead: false,
  networkUsed: false,
  productionSourceModified: false,
  executeWorkReached: false,
  auditFailureInjected: false,
  runToolCalls: 0,
  status: "INCONCLUSIVE",
  evidence: []
};

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
        throw new Error("TEST_TOOL_SHOULD_NOT_RUN");
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

  return originalLoad.call(this, request, parent, isMain);
};

(async () => {
  try {
    delete require.cache[engineFile];
    const engine = require(engineFile);
    if (typeof engine.executeWork !== "function") {
      throw new Error("executeWork export missing");
    }

    result.executeWorkReached = true;

    const value = await engine.executeWork(
      "stage631 isolated audit failure test",
      { persist: false, permissionGranted: true }
    );

    result.evidence.push(
      "executeWork returned: " +
      (value === null ? "null" : typeof value)
    );
  } catch (error) {
    result.evidence.push(
      "Execution error: " + String(error && error.message)
    );
  } finally {
    if (result.auditFailureInjected && result.runToolCalls === 0) {
      if (result.evidence.some(x =>
        x.includes("STAGE631_INJECTED_AUDIT_FAILURE")
      )) {
        result.status = "PASS_AUDIT_FAILURE_BLOCKED_TOOL";
      } else {
        result.status = "BOUNDARY_REACHED_EXCEPTION_NOT_CONFIRMED";
      }
    } else if (!result.auditFailureInjected) {
      result.status = "INCONCLUSIVE_AUDIT_BOUNDARY_NOT_REACHED";
    } else {
      result.status = "FAIL_TOOL_CALL_OBSERVED";
    }

    console.log(JSON.stringify(result, null, 2));
    process.exitCode =
      result.status === "PASS_AUDIT_FAILURE_BLOCKED_TOOL" ? 0 : 2;
  }
})().finally(() => {
  Module._load = originalLoad;
});
