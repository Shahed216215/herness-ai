"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const isolatedRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-run-agent-http-auth-")
);
const storageRoot = path.join(isolatedRoot, "storage");
fs.mkdirSync(storageRoot, { recursive: true });
fs.writeFileSync(path.join(storageRoot, "knowledge.json"), "[]", "utf8");

process.env.NODE_ENV = "test";
process.env.MIRA_STORAGE_DIR = storageRoot;
process.env.MIRA_MEMORY_FILE = path.join(isolatedRoot, "memory.json");
process.env.MIRA_AUDIT_FILE = path.join(isolatedRoot, "audit-log.json");
process.env.MIRA_SESSION_SECRET = "isolated-http-test-session-secret-71";
process.env.MIRA_ADMIN_TOKEN = "isolated-admin-token-71";
process.env.MIRA_ACCESS_TOKEN = "isolated-user-token-71";
process.env.MIRA_AUTONOMOUS_WORKER_ENABLED = "false";

const PRIVATE_PROMPT = "PRIVATE_HTTP_TASK_PROMPT_MARKER_71";
const PRIVATE_ARGUMENT = "PRIVATE_HTTP_TOOL_ARGUMENT_MARKER_71";
const PRIVATE_SECRET = "PRIVATE_HTTP_SECRET_MARKER_71";

const ai = require("../services/ai");
let generateCalls = 0;
ai.generate = async () => {
  generateCalls += 1;
  if (generateCalls === 1) {
    return {
      text: "",
      functionCalls: [{
        id: "run-agent-http-tool-health-71",
        name: "tool_health",
        args: {
          probe: PRIVATE_ARGUMENT,
          apiKey: PRIVATE_SECRET
        }
      }]
    };
  }
  return {
    text: "Tool health request blocked pending approval.",
    functionCalls: []
  };
};

const planner = require("../services/mira-task-planner");
const taskPlan = {
  taskId: "run-agent-http-authorization-integration-71",
  goal: "Inspect registered tool health",
  status: "validated",
  feasibility: "feasible",
  subtasks: [
    { id: "subtask-1", dependencies: [] }
  ],
  executionPlan: [{
    step: 1,
    subtaskId: "subtask-1",
    action: "Inspect tool health",
    expectedOutput: "Tool health inspection result"
  }],
  deliverable: {
    description: "Tool health inspection result",
    acceptanceCriteria: ["Authorization is enforced before execution."]
  },
  verificationPlan: [{ checkId: "check-1", required: true }],
  executionAllowed: false,
  planningOnly: true
};
planner.createTaskPlan = async input => ({
  success: true,
  plan: taskPlan,
  taskUnderstanding: {
    task: {
      title: "HTTP Tool Health approval integration test",
      description: String(input),
      type: "inspection",
      risk: "medium"
    }
  },
  executionAllowed: false,
  planningOnly: true
});

const { tools } = require("../tools");
const toolHealth = tools.tool_health;
const originalToolHealthExecute = toolHealth.execute;
let toolExecutionCount = 0;
toolHealth.execute = async (...args) => {
  toolExecutionCount += 1;
  return originalToolHealthExecute(...args);
};

const { app } = require("../server");

async function main() {
  let httpServer;
  try {
    httpServer = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      httpServer.once("listening", resolve);
      httpServer.once("error", reject);
    });

    const address = httpServer.address();
    const endpoint = `http://127.0.0.1:${address.port}/api/agent`;

    const unauthenticated = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: PRIVATE_PROMPT })
    });
    assert.equal(unauthenticated.status, 401);
    assert.equal(generateCalls, 0);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer isolated-admin-token-71"
      },
      body: JSON.stringify({
        command: PRIVATE_PROMPT
      })
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.role, "admin");
    assert.equal(payload.execution.toolCallCount, 1);
    assert.equal(payload.execution.trace.length, 1);

    const trace = payload.execution.trace[0];
    assert.equal(trace.tool, "tool_health");
    assert.equal(trace.executionPath, "MIRA_WORK_EXECUTION_ENGINE");
    assert.equal(trace.status, "approval_required");
    assert.equal(trace.success, false);
    assert.equal(trace.verified, false);

    const diagnostic = trace.authorizationDiagnostic;
    assert.ok(diagnostic);
    assert.equal(diagnostic.version, 1);
    assert.equal(diagnostic.decisionStage, "work_authorization");
    assert.equal(diagnostic.reasonCode, "TASK_RISK_REQUIRES_APPROVAL");
    assert.equal(diagnostic.category, "medium_risk");
    assert.equal(diagnostic.risk, "medium");
    assert.equal(diagnostic.approvalRequired, true);
    assert.deepEqual(
      Object.keys(diagnostic).sort(),
      [
        "approvalRequired",
        "category",
        "decisionStage",
        "operation",
        "reasonCode",
        "risk",
        "version"
      ].sort()
    );

    assert.equal(toolExecutionCount, 0);
    assert.equal(generateCalls, 2);

    const persistedAudit = JSON.parse(
      fs.readFileSync(process.env.MIRA_AUDIT_FILE, "utf8")
    );
    assert.ok(Array.isArray(persistedAudit));
    const blockedEntry = persistedAudit.find(entry =>
      entry.action === "task_execution" &&
      entry.resourceId === taskPlan.taskId
    );
    assert.ok(blockedEntry);
    assert.equal(blockedEntry.status, "blocked");
    assert.equal(
      blockedEntry.details?.workAuthDiagnostic?.reasonCode,
      "TASK_RISK_REQUIRES_APPROVAL"
    );
    assert.equal(
      blockedEntry.details?.workAuthDiagnostic?.decisionStage,
      "work_authorization"
    );

    const sensitiveOutput = JSON.stringify({
      diagnostic,
      audit: blockedEntry
    });
    for (const marker of [PRIVATE_PROMPT, PRIVATE_ARGUMENT, PRIVATE_SECRET]) {
      assert.equal(sensitiveOutput.includes(marker), false);
    }
    assert.equal(sensitiveOutput.includes("apiKey"), false);

    console.log("PASS run-agent-http-authorization-integration");
  } finally {
    if (httpServer) {
      await new Promise(resolve => httpServer.close(resolve));
    }
    toolHealth.execute = originalToolHealthExecute;
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
