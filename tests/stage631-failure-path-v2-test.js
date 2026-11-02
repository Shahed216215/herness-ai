"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = process.cwd();
const engineFile = path.resolve(root, "services/mira-work-execution-engine.js");
const auditFile = path.resolve(root, "audit-log.js");
const approvalFile = path.resolve(root, "autonomous-approval-audit.js");
const plannerFile = path.resolve(root, "services/mira-task-planner.js");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "stage631-v4-"));
const originalLoad = Module._load;

const result = {
  test: "stage631-failure-path-v2",
  sourceModified: false,
  networkUsed: false,
  realToolExecuted: false,
  fixtureValid: false,
  realAuditLogger: false,
  realApprovalHelper: false,
  executeWorkAvailable: false,
  enginePolicyGateCalls: 0,
  engineRecordAuditCalls: 0,
  engineAuditFailureObserved: false,
  approvalHelperCalls: 0,
  helperPolicyAuthorizeCalls: 0,
  helperAuditFailure: false,
  runToolCalls: 0,
  status: "INCONCLUSIVE",
  evidence: []
};

const envBefore = {
  audit: process.env.MIRA_AUDIT_FILE,
  key: process.env.MIRA_AUDIT_HMAC_KEY,
  session: process.env.MIRA_SESSION_SECRET
};
const cacheFiles = [
  engineFile, auditFile, approvalFile, plannerFile
];
const cacheBefore = new Map(
  cacheFiles.map(file => [file, require.cache[file]])
);

(async () => {
  try {
    // A directory at this path makes the real logger fail on read.
    process.env.MIRA_AUDIT_FILE = temp;
    delete process.env.MIRA_AUDIT_HMAC_KEY;
    delete process.env.MIRA_SESSION_SECRET;

    Module._load = function(request, parent, isMain) {
      const from = parent && parent.filename
        ? path.resolve(parent.filename)
        : "";

      if (request === "dotenv" || request === "dotenv/config") {
        return { config: () => ({ parsed: Object.create(null) }) };
      }

      if (from === engineFile && request === "../audit-log") {
        const actual = originalLoad.call(this, request, parent, isMain);
        result.realAuditLogger =
          typeof actual.recordAudit === "function";
        return {
          ...actual,
          recordAudit(input) {
            result.engineRecordAuditCalls++;
            try {
              return actual.recordAudit(input);
            } catch (error) {
              if (/Failed to load audit log|EISDIR|ENOTDIR/.test(String(error && error.message))) {
                result.engineAuditFailureObserved = true;
              }
              throw error;
            }
          }
        };
      }


      if (
        from === engineFile &&
        request === "../autonomous-policy-gate"
      ) {
        return {
          checkPolicyGate() {
            result.enginePolicyGateCalls++;
            return { ok: true, allowed: true, status: "policy_gate_passed" };
          }
        };
      }

      if (from === engineFile && request === "./tool-runner") {
        return {
          async runTool() {
            result.runToolCalls++;
            throw new Error("UNEXPECTED_REAL_TOOL_BOUNDARY");
          }
        };
      }

      if (
        from === approvalFile &&
        request === "./autonomous-policy-gate"
      ) {
        return {
          checkPolicyGate() {
            return { ok: true, allowed: true, status: "policy_gate_passed" };
          },
          authorizeOperation(operation) {
            result.helperPolicyAuthorizeCalls++;
            return {
              ok: true,
              allowed: true,
              status: "operation_authorized",
              operation
            };
          }
        };
      }

      if (
        from === engineFile &&
        request === "../autonomous-approval-audit"
      ) {
        const actual = originalLoad.call(this, request, parent, isMain);
        result.realApprovalHelper =
          typeof actual.authorizeAndAuditOperation === "function";

        return {
          ...actual,
          authorizeAndAuditOperation(args) {
            result.approvalHelperCalls++;
            try {
              return actual.authorizeAndAuditOperation(args);
            } catch (error) {
              const message = String(error && error.message);
              if (/Failed to load audit log|EISDIR|ENOTDIR/.test(message)) {
                result.helperAuditFailure = true;
              }
              throw error;
            }
          }
        };
      }

      return originalLoad.call(this, request, parent, isMain);
    };

    for (const file of cacheFiles) delete require.cache[file];

    const audit = require(auditFile);
    result.realAuditLogger = typeof audit.recordAudit === "function";

    const planner = require(plannerFile);
    const plan = {
      taskId: "stage631-boundary-v4",
      id: "stage631-boundary-v4",
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
        description: "Calculation result",
        acceptanceCriteria: ["Numeric result is verified"]
      },
      verificationPlan: ["Verify numeric result"],
      requiredSkills: [],
      taskUnderstanding: {
        task: {
          id: "stage631-boundary-v4",
          title: "Calculate 2 + 3",
          description: "Calculate 2 + 3",
          risk: "high",
          requirements: ["Calculate 2 + 3"],
          deliverables: ["Calculation result"]
        }
      }
    };

    const validation = planner.validatePlan(plan);
    result.fixtureValid = validation.valid === true;
    result.evidence.push(
      "Fixture: " + JSON.stringify({
        valid: validation.valid,
        errors: validation.errors
      })
    );

    if (!result.fixtureValid) {
      result.status = "INCONCLUSIVE_INVALID_FIXTURE";
    } else {
      const engine = require(engineFile);
      result.executeWorkAvailable = typeof engine.executeWork === "function";

      try {
        await engine.executeWork("Calculate 2 + 3", {
          plan,
          toolCalls: [{
            name: "calculator",
            args: { expression: "2 + 3" }
          }],
          persist: false,
          taskUnderstanding: plan.taskUnderstanding,
          permissionGranted: true
        });
        result.evidence.push("executeWork returned without throwing");
      } catch (error) {
        result.evidence.push("executeWork error: " + String(error.message));
      }

      if (
        result.realAuditLogger &&
        result.executeWorkAvailable &&
        result.fixtureValid &&
        result.engineRecordAuditCalls === 1 &&
        result.engineAuditFailureObserved &&
        result.approvalHelperCalls === 0 &&
        result.runToolCalls === 0
      ) {
        result.status = "PASS_FAILURE_AUDIT_BLOCKED_TOOL";
      } else {
        result.status = "INCONCLUSIVE_FAILURE_AUDIT_BOUNDARY";
      }
    }
  } catch (error) {
    result.evidence.push("Harness error: " + String(error.stack || error));
  } finally {
    Module._load = originalLoad;

    const restore = {
      MIRA_AUDIT_FILE: envBefore.audit,
      MIRA_AUDIT_HMAC_KEY: envBefore.key,
      MIRA_SESSION_SECRET: envBefore.session
    };
    for (const [key, value] of Object.entries(restore)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    for (const file of cacheFiles) {
      const previous = cacheBefore.get(file);
      if (previous) require.cache[file] = previous;
      else delete require.cache[file];
    }

    fs.rmSync(temp, { recursive: true, force: true });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "PASS_FAILURE_AUDIT_BLOCKED_TOOL") {
      process.exitCode = 2;
    }
  }
})();
