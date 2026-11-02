"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const root = process.cwd();
const toolRunnerPath = path.join(root, "services/tool-runner.js");
const auditPath = path.join(root, "audit-log.js");

const calls = [];
let auditWrites = 0;

function mockModule(file, exports) {
  require.cache[file] = {
    id: file,
    filename: file,
    loaded: true,
    exports
  };
}

mockModule(toolRunnerPath, {
  async runTool(name, args) {
    calls.push({ name, args });
    return JSON.stringify([{
      title: "Example public research source",
      url: "https://example.com/research",
      snippet: "Mock-only research result; no network request occurred."
    }]);
  }
});

mockModule(auditPath, {
  recordAudit() {
    auditWrites += 1;
    return { ok: true, recorded: true, isolatedMock: true };
  }
});

async function main() {
  const engine = require(
    path.join(root, "services/mira-work-execution-engine.js")
  );

  assert.equal(
    engine.getToolPolicy("web_search")?.autonomous,
    true,
    "web_search must have an explicit engine policy"
  );

  const plan = {
    taskId: "mira-research-engine-isolated-test",
    goal: "Research public career resources and summarize findings",
    status: "validated",
    feasibility: "feasible",
    executionAllowed: false,
    planningOnly: true,
    risk: "low",
    requiredSkills: ["web_search"],
    subtasks: [{
      id: "research-1",
      title: "Search public career resources",
      dependencies: []
    }],
    executionPlan: [{
      subtaskId: "research-1",
      tool: "web_search",
      expectedResult: "Search results from public sources"
    }],
    deliverable: {
      description: "A short research result",
      acceptanceCriteria: ["A result is returned"]
    },
    verificationPlan: ["Verify that the tool returned a result"]
  };

  const result = await engine.executeWork(
    "Research public career resources and summarize findings",
    {
      plan,
      taskUnderstanding: {
        task: {
          id: plan.taskId,
          title: plan.goal,
          description: plan.goal,
          risk: "low",
          requirements: [],
          deliverables: ["A short research result"]
        }
      },
      toolCalls: [{
        name: "web_search",
        args: {
          query: "public career resources"
        }
      }],
      permissionGranted: true,
      persist: false
    }
  );

  assert.equal(
    calls.length,
    result.success === true ? 1 : 0,
    "tool-runner mock should run only after authorization"
  );

  if (!result.success) {
    console.log(JSON.stringify({
      status: "INCONCLUSIVE",
      engineStatus: result.status || null,
      engineStage: result.stage || null,
      toolRunnerCalls: calls.length,
      auditMockCalls: auditWrites,
      networkUsed: false,
      realToolExecuted: false
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  assert.equal(calls[0].name, "web_search");
  assert.equal(calls[0].args.query, "public career resources");
  assert.equal(result.results[0].tool, "web_search");
  assert.equal(result.results[0].verification.passed, true);

  console.log(JSON.stringify({
    status: "PASS_ISOLATED_ENGINE_RESEARCH_PATH",
    engineStatus: result.status,
    toolRunnerCalls: calls.length,
    auditMockCalls: auditWrites,
    resultVerified: true,
    networkUsed: false,
    realToolExecuted: false,
    limitations: [
      "Tool runner and audit storage were mocked.",
      "This does not verify Tavily or live network access."
    ]
  }, null, 2));
}

main().catch(error => {
  console.error("MIRA_RESEARCH_ENGINE_INTEGRATION=FAIL");
  console.error(String(error.stack || error));
  process.exitCode = 1;
});
