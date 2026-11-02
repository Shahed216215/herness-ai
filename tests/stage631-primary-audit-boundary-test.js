"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = process.cwd();
const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-stage631-boundary-")
);
const engineFile = path.join(
  root, "services/mira-work-execution-engine.js"
);
const auditFile = path.join(root, "audit-log.js");
const approvalFile = path.join(root, "autonomous-approval-audit.js");
const gateFile = path.join(root, "autonomous-policy-gate.js");
const runnerFile = path.join(root, "services/tool-runner.js");
const originalLoad = Module._load;

const result = {
  test: "stage631-primary-audit-boundary",
  envFileRead: false,
  networkUsed: false,
  productionSourceModified: false,
  actualAuditLogger: false,
  executeWorkReached: false,
  primaryAuditBoundaryReached: false,
  enginePolicyGateCalls: 0,
  filesystemFailureObserved: false,
  runToolCalls: 0,
  status: "INCONCLUSIVE",
  evidence: []
};

const savedEnv = {
  audit: process.env.MIRA_AUDIT_FILE,
  key: process.env.MIRA_AUDIT_HMAC_KEY,
  session: process.env.MIRA_SESSION_SECRET
};

const files = [
  engineFile, auditFile, approvalFile, gateFile, runnerFile
];
const savedCache = new Map(
  files.map(file => [file, require.cache[file]])
);

(async () => {
  try {
    // The audit path is deliberately a directory, never the real log.
    process.env.MIRA_AUDIT_FILE = temp;
    delete process.env.MIRA_AUDIT_HMAC_KEY;
    delete process.env.MIRA_SESSION_SECRET;

    Module._load = function(request, parent, isMain) {
      const from = parent && parent.filename;

      if (request === "dotenv" || request === "dotenv/config") {
        return { config: () => ({ parsed: Object.create(null) }) };
      }

      if (
        from === engineFile &&
        request === "../autonomous-policy-gate"
      ) {
        return {
          checkPolicyGate: () => {
            result.enginePolicyGateCalls++;
            return {
              ok: true,
              allowed: true,
              status: "policy_gate_passed"
            };
          }
        };
      }

      if (from === engineFile && request === "./tool-runner") {
        return {
          runTool: async () => {
            result.runToolCalls++;
            throw new Error("UNEXPECTED_TOOL_EXECUTION");
          }
        };
      }

      /*
       * Keep the real approval/audit helper and real audit logger.
       * Mock only policy authorization to allow reaching the audit write.
       */
      if (from === approvalFile && request === "./autonomous-policy-gate") {
        return {
          checkPolicyGate: () => ({ allowed: true, status: "allowed" }),
          authorizeOperation: () => {
            result.primaryAuditBoundaryReached = true;
            return { allowed: true, status: "allowed", operation: "test" };
          }
        };
      }

      return originalLoad.call(this, request, parent, isMain);
    };

    for (const file of files) delete require.cache[file];

    const audit = require(auditFile);
    result.actualAuditLogger = typeof audit.recordAudit === "function";

    const engine = require(engineFile);
    if (typeof engine.executeWork !== "function") {
      throw new Error("executeWork export missing");
    }
    result.executeWorkReached = true;

    /*
     * Use a supplied plan only if it is valid; otherwise remain
     * inconclusive. Do not run real tools or call external services.
     */
    const planner = require(path.join(root, "services/mira-task-planner.js"));
    const plan = {
      taskId: "stage631-audit-boundary-test",
      id: "stage631-audit-boundary-test",
      goal: "Calculate 2 + 3",
      status: "validated",
      feasibility: "feasible",
      executionAllowed: false,
      planningOnly: true,
      subtasks: [{
        id: "calc-1",
        title: "Calculate",
        description: "Calculate 2 + 3",
        dependencies: []
      }],
      executionPlan: [{ subtaskId: "calc-1" }],
      deliverable: {
        description: "A calculation result",
        acceptanceCriteria: ["Result is verified"]
      },
      verificationPlan: ["Verify numeric result"],
      requiredSkills: [],
      taskUnderstanding: {
        task: {
          id: "stage631-audit-boundary-test",
          title: "Calculate 2 + 3",
          description: "Calculate 2 + 3",
          risk: "low",
          requirements: ["Calculate 2 + 3"],
          deliverables: ["A calculation result"]
        }
      }
    };

    const validation = planner.validatePlan(plan);
    result.evidence.push(
      "Fixture validation: " + JSON.stringify({
        valid: validation.valid,
        errors: validation.errors
      })
    );

    if (!validation.valid) {
      result.status = "INCONCLUSIVE_PLAN_FIXTURE_INVALID";
      return;
    }

    try {
      await engine.executeWork("Calculate 2 + 3", {
        plan,
        toolCalls: [{ name: "calculator", args: { expression: "2 + 3" } }],
        persist: false,
        permissionGranted: true
      });
      result.evidence.push("executeWork returned without throwing.");
    } catch (error) {
      const message = String(error && error.message);
      result.evidence.push("executeWork error: " + message);
      if (/Failed to load audit log|EISDIR|ENOTDIR/.test(message)) {
        result.filesystemFailureObserved = true;
      }
    }

    if (
      result.actualAuditLogger &&
      result.executeWorkReached &&
      result.enginePolicyGateCalls > 0 &&
      result.primaryAuditBoundaryReached === true &&
      result.filesystemFailureObserved &&
      result.runToolCalls === 0
    ) {
      result.status = "PASS_PRIMARY_AUDIT_FAILURE_BLOCKED_TOOL";
    } else {
      result.status = "INCONCLUSIVE_BOUNDARY_OR_FIXTURE_NOT_CONFIRMED";
    }
  } catch (error) {
    result.evidence.push("Harness error: " + String(error.message));
  } finally {
    Module._load = originalLoad;

    for (const [key, value] of Object.entries({
      MIRA_AUDIT_FILE: savedEnv.audit,
      MIRA_AUDIT_HMAC_KEY: savedEnv.key,
      MIRA_SESSION_SECRET: savedEnv.session
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    for (const file of files) {
      const previous = savedCache.get(file);
      if (previous) require.cache[file] = previous;
      else delete require.cache[file];
    }

    fs.rmSync(temp, { recursive: true, force: true });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode =
      result.status === "PASS_PRIMARY_AUDIT_FAILURE_BLOCKED_TOOL" ? 0 : 2;
  }
})();
