"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const assert = require("assert");

const servicePath = path.resolve(
  process.cwd(),
  "services/mira-research-governance.js"
);
const fixedDate = "2026-10-25T12:00:00.000Z";
const childCount = 20;

if (process.argv[2] === "--child") {
  try {
    const governance = require(process.argv[5]);
    const result = governance.reserveResearchBudget(
      { taskId: "concurrency-" + process.argv[4], urgent: false },
      { file: process.argv[3], now: new Date(fixedDate) }
    );
    process.stdout.write("RESULT=" + JSON.stringify(result) + "\n");
  } catch (error) {
    console.error("CHILD_ERROR=" + String(error.message || error));
    process.exitCode = 2;
  }
} else {
  (async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "mira-governance-concurrency-")
    );

    try {
      const ledger = path.join(root, "ledger.json");

      const outcomes = await Promise.all(
        Array.from({ length: childCount }, (_, i) =>
          new Promise(resolve => {
            const child = spawn(
              process.execPath,
              [__filename, "--child", ledger, String(i), servicePath],
              { stdio: ["ignore", "pipe", "pipe"] }
            );

            let stdout = "";
            let stderr = "";
            let settled = false;

            const finish = result => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve(result);
            };

            const timer = setTimeout(() => {
              child.kill("SIGKILL");
              finish({ code: -1, stdout, stderr: "TIMEOUT" });
            }, 10000);

            child.stdout.on("data", chunk => stdout += chunk);
            child.stderr.on("data", chunk => stderr += chunk);
            child.on("error", error =>
              finish({ code: -1, stdout, stderr: String(error) })
            );
            child.on("close", code => finish({ code, stdout, stderr }));
          })
        )
      );

      const results = [];
      const errors = [];

      for (const outcome of outcomes) {
        const line = outcome.stdout
          .split(/\r?\n/)
          .find(value => value.startsWith("RESULT="));

        if (outcome.code !== 0 || !line) {
          errors.push(outcome.stderr || "Missing child result");
          continue;
        }
        results.push(JSON.parse(line.slice("RESULT=".length)));
      }

      assert.strictEqual(errors.length, 0, "Child process failures");
      const allowed = results.filter(item => item.allowed === true).length;
      const denied = results.filter(item => item.allowed !== true).length;
      const state = JSON.parse(fs.readFileSync(ledger, "utf8"));
      const usage = state.dailyUsage[fixedDate.slice(0, 10)];

      console.log("CHILDREN=" + childCount);
      console.log("ALLOWED=" + allowed);
      console.log("DENIED=" + denied);
      console.log("CHILD_ERRORS=" + errors.length);
      console.log("STORED_NORMAL_COUNT=" + usage.normalCount);

      assert.strictEqual(allowed, 3, "Expected exactly 3 reservations");
      assert.strictEqual(denied, 17, "Expected exactly 17 denials");
      assert.strictEqual(usage.normalCount, 3, "Stored count exceeded limit");
      console.log("GOVERNANCE_CONCURRENCY=PASS");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  })().catch(error => {
    console.error("GOVERNANCE_CONCURRENCY=FAIL");
    console.error(String(error.stack || error));
    process.exitCode = 1;
  });
}
