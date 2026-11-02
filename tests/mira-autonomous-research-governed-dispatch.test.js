"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const root = process.cwd();
const plannerPath = path.join(root, "services/mira-task-planner.js");
const runnerPath = path.join(root, "services/tool-runner.js");
const auditPath = path.join(root, "audit-log.js");
const enginePath = path.join(root, "services/mira-work-execution-engine.js");
const researchPath = path.join(root, "autonomous-learning-engine.js");

const state = {
  risk: "low",
  toolResult: null,
  calls: [],
  auditWrites: 0
};

function mockModule(file, exports) {
  require.cache[file] = {
    id: file,
    filename: file,
    loaded: true,
    exports
  };
}

/*
 * Keep the real planner validation function.
 * Only task-plan creation is isolated and deterministic.
 */
const realPlanner = require(plannerPath);

mockModule(plannerPath, {
  ...realPlanner,

  async createTaskPlan(input) {
    const risk = state.risk;

    const task = {
      id: "mira-governed-research-test",
      title: String(input),
      description: String(input),
      risk,
      requirements: [],
      deliverables: ["Verified public research sources"]
    };

    const plan = {
      taskId: task.id,
      goal: String(input),
      status: "validated",
      feasibility: "feasible",
      executionAllowed: false,
      planningOnly: true,
      risk,
      requiredSkills: ["web_search"],
      subtasks: [{
        id: "research-1",
        title: "Search public sources",
        dependencies: []
      }],
      executionPlan: [{
        subtaskId: "research-1",
        tool: "web_search",
        expectedResult: "Public search results"
      }],
      deliverable: {
        description: "Verified public research sources",
        acceptanceCriteria: ["A result is returned"]
      },
      verificationPlan: [
        "Verify that the tool returned a result"
      ]
    };

    return {
      success: true,
      plan,
      taskUnderstanding: {
        task,
        capabilityMatches: []
      },
      executionAllowed: false,
      planningOnly: true
    };
  }
});

mockModule(runnerPath, {
  async runTool(name, args) {
    state.calls.push({ name, args });
    return state.toolResult;
  }
});

mockModule(auditPath, {
  recordAudit() {
    state.auditWrites++;
    return {
      ok: true,
      recorded: true,
      isolatedMock: true
    };
  }
});

delete require.cache[enginePath];
delete require.cache[researchPath];

async function main() {
  const research = require(researchPath);

  /*
   * CASE 1: LOW-RISK GOVERNED SEARCH
   * The real execution engine must authorize and verify
   * before the mocked tool runner returns its result.
   */
  state.risk = "low";
  state.toolResult = JSON.stringify([
    {
      title: "Alpha public research source",
      url: "https://research-alpha.example.com/article",
      snippet: "Mock-only public research result."
    },
    {
      title: "Beta public research source",
      url: "https://research-beta.example.org/article",
      snippet: "Second mock-only independent source."
    }
  ]);

  const successful = await research.searchPublicWeb(
    "governed dispatch regression"
  );

  assert.equal(successful.sources.length, 2);
  assert.equal(successful.domains.length, 2);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].name, "web_search");
  assert.equal(
    state.calls[0].args.query,
    "governed dispatch regression fundamentals"
  );

  const successfulCalls = state.calls.length;

  /*
   * CASE 2: HIGH-RISK TASK
   * Authorization must reject before runTool.
   */
  state.risk = "high";

  await assert.rejects(
    () => research.searchPublicWeb(
      "high risk governed dispatch regression"
    ),
    /Governed web search failed/
  );

  assert.equal(
    state.calls.length,
    successfulCalls,
    "High-risk work must not reach tool-runner."
  );

  /*
   * CASE 3: TOOL RESULT VERIFICATION FAILURE
   * The real engine must reject a failed tool result.
   */
  state.risk = "low";
  state.toolResult = {
    success: false,
    error: "MOCK_TOOL_FAILURE"
  };

  await assert.rejects(
    () => research.searchPublicWeb(
      "verification failure regression"
    ),
    /Governed web search failed/
  );

  assert.equal(state.calls.length, successfulCalls + 1);

  console.log(JSON.stringify({
    test: "mira-autonomous-research-governed-dispatch",
    status: "PASS",
    cases: {
      lowRiskGovernedSearch: "PASS",
      highRiskBlockedBeforeToolRunner: "PASS",
      failedToolResultRejected: "PASS"
    },
    toolRunnerCalls: state.calls.length,
    auditMockCalls: state.auditWrites,
    realExecutionEngine: true,
    realAuthorizationService: true,
    realPlannerValidation: true,
    mocked: [
      "task plan creation",
      "tool runner",
      "audit storage"
    ],
    networkUsed: false,
    realToolExecuted: false
  }, null, 2));
}

main().catch(error => {
  console.error("MIRA_GOVERNED_DISPATCH_TEST=FAIL");
  console.error(String(error.stack || error));
  process.exitCode = 1;
});
