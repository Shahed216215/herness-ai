"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function main() {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "mira-worker-test-")
  );

  try {
    process.env.MIRA_TASK_FILE = path.join(temp, "tasks.json");
    process.env.MIRA_AUDIT_FILE = path.join(temp, "audit.json");
    process.env.MIRA_WORKER_RESULTS_FILE = path.join(temp, "results.jsonl");

    const { createStoredTask, getTask } = require("../task-store");
    const { runOnce, getCalculatorExpression } =
      require("../services/mira-autonomous-worker");

    assert.strictEqual(
      getCalculatorExpression({ title: "Calculate 2 + 3" }),
      "2 + 3"
    );
    assert.strictEqual(
      getCalculatorExpression({ title: "Send payment now" }),
      null
    );

    const calc = createStoredTask({
      title: "Calculate 2 + 3",
      description: "",
      type: "automation",
      risk: "low",
      status: "new",
      source: "worker-regression-test"
    });
    assert.strictEqual(calc.ok, true);

    const risky = createStoredTask({
      title: "Restore memory",
      description: "Restore memory",
      type: "automation",
      risk: "high",
      status: "new",
      source: "worker-regression-test"
    });
    assert.strictEqual(risky.ok, true);

    const result = await runOnce();
    assert.strictEqual(result.status, "tick_completed");
    assert.strictEqual(result.processed, 1);
    assert.strictEqual(getTask(calc.task.id).status, "completed");
    assert.strictEqual(getTask(risky.task.id).status, "new");

    const lines = fs.readFileSync(
      process.env.MIRA_WORKER_RESULTS_FILE,
      "utf8"
    ).trim().split("\n").map(line => JSON.parse(line));

    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].taskId, calc.task.id);
    assert.strictEqual(lines[0].status, "completed");

    console.log("MIRA_AUTONOMOUS_WORKER_TEST=PASS");
    console.log("CALCULATOR_TASK=COMPLETED");
    console.log("HIGH_RISK_TASK=NOT_EXECUTED");
    console.log("RESULT_LEDGER=PASS");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error("MIRA_AUTONOMOUS_WORKER_TEST=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
