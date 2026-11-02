"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-research-worker-test-")
);

process.env.MIRA_AUTONOMOUS_RESEARCH_ENABLED = "true";
process.env.MIRA_WORKER_RESULTS_FILE = path.join(temp, "results.jsonl");

const worker = require("../services/mira-autonomous-worker");

const task = {
  id: "research-test-001",
  title: "Research cybersecurity careers",
  description: "Summarize career paths using reliable public sources.",
  type: "research",
  risk: "low",
  status: "new"
};

async function main() {
  let calls = 0;
  const statuses = [];
  const reportRoot = path.join(temp, "storage");

  const dependencies = {
    listTasksFn: () => [{ ...task }],
    updateTaskStatusFn: (id, status) => statuses.push({ id, status }),
    executeWorkFn: async (input, options) => {
      calls += 1;
      assert.equal(options.toolCalls.length, 1);
      assert.equal(options.toolCalls[0].name, "web_search");
      assert.equal(typeof options.toolCalls[0].args.query, "string");
      return {
        success: true,
        results: [{
          result: JSON.stringify([{
            title: "Example career resource",
            link: "https://example.com/careers",
            snippet: "Public career information."
          }])
        }]
      };
    },
    storagePathFn: (...parts) => path.join(reportRoot, ...parts),
    budgetFile: path.join(temp, "budget.json"),
    governanceFile: path.join(temp, "governance-initial.json")
  };

  // Opt-in off: the mock execution function must not be called.
  process.env.MIRA_AUTONOMOUS_RESEARCH_ENABLED = "false";
  const disabled = await worker.runOnce(dependencies);
  assert.equal(disabled.status, "research_opt_in_required");
  assert.equal(calls, 0);

  // Opt-in on: a single bounded mocked search produces a local report.
  process.env.MIRA_AUTONOMOUS_RESEARCH_ENABLED = "true";
  const result = await worker.runOnce(dependencies);
  assert.equal(result.status, "research_completed");
  assert.equal(result.sourceCount, 1);
  assert.equal(calls, 1);
  assert.ok(fs.existsSync(result.reportPath));
  assert.match(fs.readFileSync(result.reportPath, "utf8"), /example\.com\/careers/);
  assert.deepEqual(statuses.map(item => item.status), ["active", "completed"]);

  // Use a fresh isolated ledger to test migration of a full legacy budget.
  dependencies.governanceFile = path.join(temp, "governance-exhausted.json");

  // Exhausted budget: no additional tool execution.
  fs.writeFileSync(
    dependencies.budgetFile,
    JSON.stringify({
      day: new Date().toISOString().slice(0, 10),
      count: 3
    })
  );
  statuses.length = 0;
  const exhausted = await worker.runOnce(dependencies);
  assert.equal(exhausted.status, "research_budget_exhausted");
  assert.equal(calls, 1);
  assert.equal(statuses.length, 0);

  // Corrupted legacy budget must fail closed in a fresh isolated ledger.
  dependencies.governanceFile = path.join(temp, "governance-corrupt.json");
  fs.writeFileSync(dependencies.budgetFile, "{invalid-json");
  await assert.rejects(
    worker.runOnce(dependencies),
    /Legacy research budget unavailable or invalid; refusing research/
  );
  assert.equal(calls, 1);
  assert.equal(statuses.length, 0);

  // Reject suspicious or incorrectly typed tasks.
  assert.equal(worker.getResearchQuery({
    ...task,
    title: "Teleport to another country and return the result"
  }), null);
  assert.equal(worker.getResearchQuery({
    ...task,
    type: "writing"
  }), null);

  // Reject non-HTTP source URLs.
  assert.deepEqual(worker.extractSources({
    success: true,
    results: [{
      result: JSON.stringify([{
        title: "Bad source",
        link: "file:///etc/passwd",
        snippet: "must be rejected"
      }])
    }]
  }), []);

  console.log("MIRA_AUTONOMOUS_RESEARCH_MOCK_TEST=PASS");
  console.log("NETWORK_REQUESTS=0");
  console.log("OPT_IN_GATE=PASS");
  console.log("DAILY_BUDGET_GATE=PASS");
  console.log("REPORT_SOURCE_CAPTURE=PASS");
  console.log("UNSAFE_TASK_FILTER=PASS");
}

main()
  .catch(error => {
    console.error("MIRA_AUTONOMOUS_RESEARCH_MOCK_TEST=FAIL");
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(temp, { recursive: true, force: true });
  });
