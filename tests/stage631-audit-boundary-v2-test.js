"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mira-stage631-v2-"));
const engineFile = path.join(root, "services/mira-work-execution-engine.js");
const auditFile = path.join(root, "audit-log.js");
const approvalFile = path.join(root, "autonomous-approval-audit.js");
const plannerFile = path.join(root, "services/mira-task-planner.js");
const originalLoad = Module._load;

const result = {
  test: "stage631-audit-boundary-v2",
  dotenvRead: false,
  networkUsed: false,
  productionSourceModified: false,
  realAuditLogger: false,
  realApprovalHelper: false,
  executeWorkReached: false,
  fixtureValid: false,
  enginePolicyGateCalls: 0,
  approvalHelperCalls: 0,
  helperAuditFailureObserved: false,
  runToolCalls: 0,
  status: "INCONCLUSIVE",
  evidence: []
};

const savedEnv = {
  audit: process.env.MIRA_AUDIT_FILE,
  key: process.env.MIRA_AUDIT_HMAC_KEY,
  session: process.env.MIRA_SESSION_SECRET
};

const files = [engineFile, auditFile, approvalFile, plannerFile];
const savedCache = new Map(files.map(f => [f, require.cache[f]]));

(async () => {
  try {
    // Isolated audit target: it is a directory, not the project's audit file.
    process.env.MIRA_AUDIT_FILE = temp;
    delete process.env.MIRA_AUDIT_HMAC_KEY;
    delete process.env.MIRA_SESSION_SECRET;

    Module._load = function(request, parent, isMain) {
      const from = parent && parent.filename;

      if (request === "dotenv" || request === "dotenv/config") {
        return { config: () => ({ parsed: Object.create(null) }) };
      }

      // Mock engine-only policy gate so earlier policy state cannot stop the test.
      if (from === engineFile && request === "../autonomous-policy-gate") {
        return {
          checkPolicyGate: () => {
            result.enginePolicyGateCalls++;
            return { allowed: true, status: "allowed" };
          }
        };
      }

      // Never permit a real tool to execute.
      if (from === engineFile && request === "./tool-runner") {
        return {
          runTool: async () => {
            result.runToolCalls++;
            throw new Error("UNEXPECTED_TOOL_RUNNER_CALL");
          }
        };
      }

      // Preserve the real helper and real logger, instrument only the helper call.
      if (from === engineFile && request === "../autonomous-approval-audit") {
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
                result.helperAuditFailureObserved = true;
              }
              throw error;
            }
          }
        };
      }

      return originalLoad.call(this, request, parent, isMain);
    };

    for (const f of files) delete require.cache[f];

    const audit = require(auditFile);
    result.realAuditLogger = typeof audit.recordAudit === "function";

    const planner = require(plannerFile);
    const plan = {
      taskId: "stage631-boundary-v2",
      id: "stage631-boundary-v2",
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
          id: "stage631-boundary-v2",
          title: "Calculate 2 + 3",
          description: "Calculate 2 + 3",
          risk: "low",
          requirements: ["Calculate 2 + 3"],
          deliverables: ["Calculation result"]
        }
      }
    };

    const validation = planner.validatePlan(plan);
    result.fixtureValid = validation.valid === true;
    result.evidence.push(
      "Fixture validation: " +
      JSON.stringify({ valid: validation.valid, errors: validation.errors })
    );

    if (!result.fixtureValid) {
      result.status = "INCONCLUSIVE_INVALID_FIXTURE";
      return;
    }

    const engine = require(engineFile);
    result.executeWorkReached = typeof engine.executeWork === "function";
    if (!result.executeWorkReached) throw new Error("executeWork missing");

    try {
      await engine.executeWork("Calculate 2 + 3", {
        plan,
        toolCalls: [{
          name: "calculator",
          args: { expression: "2 + 3" }
        }],
        persist: false,
        permissionGranted: true
      });
      result.evidence.push("executeWork returned without throwing");
    } catch (error) {
      result.evidence.push("executeWork error: " + String(error.message));
      result.filesystemFailureObserved = /Failed to load audit log|EISDIR|ENOTDIR/.test(String(error.message));
    }

    if (
      result.realAuditLogger &&
      result.fixtureValid &&
      result.filesystemFailureObserved &&
      result.runToolCalls === 0
    ) {
      result.status = "PASS_PRIMARY_AUDIT_FAILURE_BLOCKED_TOOL";
    } else {
      result.status = "INCONCLUSIVE_BOUNDARY_NOT_PROVEN";
    }
  } catch (error) {
    result.evidence.push("Harness error: " + String(error.stack || error));
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

    for (const f of files) {
      const previous = savedCache.get(f);
      if (previous) require.cache[f] = previous;
      else delete require.cache[f];
    }

    fs.rmSync(temp, { recursive: true, force: true });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "PASS_PRIMARY_AUDIT_FAILURE_BLOCKED_TOOL") {
      process.exitCode = 2;
    }
  }
})();
