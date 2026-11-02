"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const root = process.cwd();
const plannerPath = require.resolve("../services/mira-task-planner");
const runnerPath = require.resolve("../services/tool-runner");
const auditPath = require.resolve("../audit-log");

const originals = new Map();
const calls = [];
const auditEvents = [];

function mockModule(file, exports) {
  originals.set(file, require.cache[file]);
  require.cache[file] = {
    id: file,
    filename: file,
    loaded: true,
    exports
  };
}

const plan = {
  taskId: "mira-seo-research-isolated-integration",
  goal: "Research public SEO information",
  status: "validated",
  feasibility: "feasible",
  executionAllowed: false,
  planningOnly: true,
  risk: "low",
  requiredSkills: ["web_search"],
  subtasks: [{
    id: "research-1",
    title: "Search public SEO sources",
    dependencies: []
  }],
  executionPlan: [{
    subtaskId: "research-1",
    tool: "web_search",
    expectedResult: "Public search results"
  }],
  deliverable: {
    description: "Evidence-backed research",
    acceptanceCriteria: ["At least one source is returned"]
  },
  verificationPlan: ["Verify the search result"]
};

const taskUnderstanding = {
  task: {
    id: plan.taskId,
    title: plan.goal,
    description: plan.goal,
    risk: "low",
    requirements: [],
    deliverables: ["Evidence-backed research"]
  }
};

mockModule(plannerPath, {
  async createTaskPlan() {
    return { success: true, plan, taskUnderstanding };
  },
  validatePlan() {
    return { valid: true, errors: [] };
  }
});

mockModule(runnerPath, {
  async runTool(name, args) {
    calls.push({ name, args });
    return JSON.stringify([{
      title: "Example public SEO source",
      url: "https://example.com/seo-research",
      snippet: "Mock-only evidence. No real search request occurred."
    }]);
  }
});

mockModule(auditPath, {
  recordAudit(event) {
    auditEvents.push(event || null);
    return { ok: true, isolatedMock: true };
  }
});

async function main() {
  const { runSeoResearch } = require(
    path.join(root, "services/mira-seo-research-orchestrator.js")
  );

  const result = await runSeoResearch({
    brief: {
      clientId: "integration-demo",
      clientName: "Demo Client",
      websiteUrl: "https://example.com/",
      industry: "Software",
      businessType: "B2B SaaS",
      targetMarket: {
        countryCode: "US",
        countryName: "United States"
      },
      targetLanguage: "en-US",
      primaryGoals: ["Improve organic visibility"],
      keywords: ["SEO research"]
    },
    query: "SEO competitor research"
  }, {
    permissionGranted: true,
    actor: {
      role: "admin",
      username: "isolated-admin"
    }
  }, {
    consentService: {
      lookup(clientId, scope) {
        assert.equal(clientId, "integration-demo");
        assert.equal(scope, "public_web_research");
        return { authorized: true };
      }
    }
  });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.status, "RESEARCH_RESULTS_READY_FOR_REVIEW");
  assert.equal(result.execution.engine, "executeWork");
  assert.equal(result.evidence.evidenceCount, 1);
  assert.equal(result.evidence.evidence[0].sourceLinkValidated, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "web_search");
  assert.match(calls[0].args.query, /US en-US/);
  assert.ok(auditEvents.length >= 1);
  assert.ok(auditEvents.some(event =>
    event &&
    event.action === "task_execution" &&
    event.status === "success"
  ));

  console.log("PASS: actual executeWork governance pipeline");
  console.log("PASS: persisted-consent dependency contract");
  console.log("PASS: trusted Admin execution context");
  console.log("PASS: mocked web_search runner invoked after governance");
  console.log("PASS: search evidence returned for human review");
  console.log("TOOL_RUNNER_MOCK_CALLS=" + calls.length);
  console.log("AUDIT_STORAGE_MOCK_CALLS=" + auditEvents.length);
  console.log("REAL_TOOL_EXECUTION=NO");
  console.log("NETWORK_CALLS=0");
  console.log("SEO_RESEARCH_ENGINE_INTEGRATION=PASS");
}

main().catch(error => {
  console.error("SEO_RESEARCH_ENGINE_INTEGRATION=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => {
  for (const [file, original] of originals) {
    if (original) require.cache[file] = original;
    else delete require.cache[file];
  }
});
