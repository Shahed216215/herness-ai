"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mira-fairness-test-"));
process.env.MIRA_AUTONOMOUS_RESEARCH_ENABLED = "true";
process.env.MIRA_WORKER_RESULTS_FILE = path.join(temp, "results.jsonl");

const worker = require("../services/mira-autonomous-worker");

const calculatorTask = {
  id: "fair-calc-001",
  title: "Calculate 2 + 3",
  type: "calculation",
  risk: "low",
  status: "new"
};
const researchTask = {
  id: "fair-research-001",
  title: "Research cybersecurity career paths",
  description: "Summarize public career information.",
  type: "research",
  risk: "low",
  status: "new"
};

async function main() {
  const calls = [];
  const statuses = [];
  const deps = {
    listTasksFn: () => [{ ...calculatorTask }, { ...researchTask }],
    updateTaskStatusFn: (id, status) => statuses.push({ id, status }),
    executeWorkFn: async (input, options) => {
      calls.push(options.toolCalls[0].name);
      if (options.toolCalls[0].name === "calculator") {
        return { success: true, result: "5" };
      }
      return {
        success: true,
        results: [{
          result: JSON.stringify([{
            title: "Example research source",
            link: "https://example.com/research",
            snippet: "Public information."
          }])
        }]
      };
    },
    storagePathFn: (...parts) => path.join(temp, "storage", ...parts),
    budgetFile: path.join(temp, "legacy-budget.json"),
    governanceFile: path.join(temp, "governance.json")
  };

  try {
    const first = await worker.runOnce(deps);
    assert.equal(first.status, "tick_completed");
    assert.deepEqual(calls, ["calculator"]);

    const second = await worker.runOnce(deps);
    assert.equal(second.status, "research_completed");
    assert.deepEqual(calls, ["calculator", "web_search"]);
    assert.equal(second.sourceCount, 1);

    console.log("MIXED_TASK_SCHEDULING=PASS");
    console.log("CALCULATOR_THEN_RESEARCH=PASS");
    console.log("RESEARCH_SOURCE_CAPTURE=PASS");
    console.log("NETWORK_REQUESTS=0");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error("MIRA_RESEARCH_FAIRNESS_TEST=FAIL");
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
