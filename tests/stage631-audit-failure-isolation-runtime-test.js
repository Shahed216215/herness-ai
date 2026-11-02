"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const enginePath = path.join(
  root, "services/mira-work-execution-engine.js"
);
const plannerPath = path.join(
  root, "services/mira-task-planner.js"
);
const authPath = path.join(
  root, "services/mira-autonomous-work-authorization.js"
);
const approvalPath = path.join(
  root, "autonomous-approval-audit.js"
);
const auditPath = path.join(root, "audit-log.js");
const toolRunnerPath = path.join(
  root, "services/tool-runner.js"
);
const operationPolicyPath = path.join(
  root, "autonomous-operations-policy.js"
);
const policyGatePath = path.join(
  root, "autonomous-policy-gate.js"
);
const capabilityPath = path.join(root, "capability-profile.js");
const toolsPath = path.join(root, "tools.js");

const outcome = {
  test: "stage631-audit-failure-isolation-runtime",
  mode: "offline-isolated-dependencies",
  productionSourceModified: false,
  networkUsed: false,
  realToolExecuted: false,
  auditFailureInjected: false,
  runToolCalls: 0,
  result: "INCONCLUSIVE",
  details: []
};

const originalLoad = require("node:module")._load;
const Module = require("node:module");
const originalCache = new Map();

const required = [
  enginePath, plannerPath, authPath, approvalPath, auditPath,
  toolRunnerPath, operationPolicyPath, policyGatePath,
  capabilityPath
];

for (const file of required) {
  if (!fs.existsSync(file)) {
    outcome.details.push(
      `Missing dependency: ${path.relative(root, file)}`
    );
  }
}

if (outcome.details.length) {
  console.log(JSON.stringify(outcome, null, 2));
  process.exitCode = 2;
} else {
  for (const file of required) {
    originalCache.set(file, require.cache[file]);
  }

  function mock(file, exports) {
    require.cache[file] = {
      id: file,
      filename: file,
      loaded: true,
      exports
    };
  }

  /*
   * Real planner validation remains active. Authorization, global
   * policy, audit storage and the tool runner are intercepted.
   */
  mock(auditPath, {
    recordAudit() {
      outcome.auditFailureInjected = true;
      throw new Error("STAGE631_INJECTED_AUDIT_WRITE_FAILURE");
    }
  });

  mock(approvalPath, {
    authorizeAndAuditOperation() {
      outcome.auditFailureInjected = true;
      throw new Error("STAGE631_INJECTED_AUDIT_WRITE_FAILURE");
    },
    auditDecision() {
      throw new Error("STAGE631_INJECTED_AUDIT_WRITE_FAILURE");
    },
    checkAndAuditOperation() {
      throw new Error("STAGE631_INJECTED_AUDIT_WRITE_FAILURE");
    }
  });

  mock(toolRunnerPath, {
    runTool: async () => {
      outcome.runToolCalls++;
      outcome.realToolExecuted = false;
      return { ok: true, isolatedMock: true };
    }
  });

  mock(operationPolicyPath, {
    getOperationPolicy(operation) {
      return {
        ok: true,
        allowed: operation === "test",
        operation
      };
    }
  });

  mock(policyGatePath, {
    checkPolicyGate(operation) {
      return {
        ok: true,
        allowed: operation === "test",
        operation,
        status: "isolated_test_policy"
      };
    }
  });

  mock(authPath, {
    authorizeWork() {
      return {
        allowed: true,
        status: "autonomous_allowed",
        reason: "isolated test fixture"
      };
    }
  });

  mock(capabilityPath, {
    getSkillTools() {
      return ["calculator"];
    }
  });

  /*
   * Do not stub the planner or validatePlan. Use a fully specified
   * planning-only plan and explicitly supplied calculator call.
   */
  (async () => {
    try {
      const { executeWork, getToolPolicy } = require(enginePath);

      assert.equal(getToolPolicy("calculator")?.autonomous, true);

      const plan = {
        taskId: "stage631-audit-isolation",
        goal: "Calculate a harmless test expression",
        status: "validated",
        feasibility: "feasible",
        executionAllowed: false,
        planningOnly: true,
        risk: "low",
        requiredSkills: ["calculator"],
        subtasks: [
          { id: "calc-1", title: "Calculate", dependencies: [] }
        ],
        executionPlan: [
          {
            subtaskId: "calc-1",
            tool: "calculator",
            expectedResult: "numeric result"
          }
        ],
        deliverable: {
          description: "Test-only numeric result",
          acceptanceCriteria: ["Result is returned"]
        },
        verificationPlan: ["Check result"]
      };

      const result = await executeWork(
        "Calculate 2 + 3",
        {
          plan,
          taskUnderstanding: {
            task: {
              id: plan.taskId,
              title: plan.goal,
              description: plan.goal,
              risk: "low",
              requirements: [],
              deliverables: ["numeric result"]
            }
          },
          toolCalls: [
            { name: "calculator", args: { expression: "2+3" } }
          ],
          permissionGranted: true,
          persist: false
        }
      );

      outcome.details.push(
        `executeWork status: ${String(result?.status || "none")}`
      );

      if (!outcome.auditFailureInjected) {
        outcome.details.push(
          "Audit injection point was not reached; precondition gate blocked."
        );
      } else if (outcome.runToolCalls === 0) {
        outcome.result = "PASS_FAIL_CLOSED_AT_AUDIT_BOUNDARY";
        outcome.details.push(
          "Injected audit failure occurred before any tool-runner call."
        );
      } else {
        outcome.result = "FAIL_TOOL_RUNNER_REACHED_AFTER_AUDIT_FAILURE";
        outcome.details.push(
          "Tool-runner mock was reached despite the injected audit failure."
        );
      }
    } catch (error) {
      outcome.details.push(
        `Execution threw: ${String(error?.message || error)}`
      );
      if (outcome.auditFailureInjected && outcome.runToolCalls === 0) {
        outcome.result = "PASS_EXCEPTION_PROPAGATED_BEFORE_TOOL";
      }
    } finally {
      console.log(JSON.stringify(outcome, null, 2));
      if (outcome.result.startsWith("PASS_")) process.exitCode = 0;
      else process.exitCode = 2;

      for (const file of required) {
        const previous = originalCache.get(file);
        if (previous) require.cache[file] = previous;
        else delete require.cache[file];
      }
      Module._load = originalLoad;
    }
  })().catch(error => {
    console.error(String(error?.stack || error));
    process.exitCode = 2;
  });
}
