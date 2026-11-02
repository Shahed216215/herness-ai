"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");

const servicePath = path.resolve(
  __dirname,
  "../services/mira-research-governance.js"
);
const timeoutMs = 15000;
const childCount = 20;
const fixedDate = "2026-10-25T12:00:00.000Z";

function childMode() {
  try {
    const governance = require(servicePath);
    const file = process.argv[3];
    const date = new Date(process.argv[4]);
    const taskId = process.argv[5];

    if (!file || !taskId || Number.isNaN(date.getTime())) {
      throw new Error("Invalid child arguments");
    }

    const result = governance.reserveResearchBudget(
      { taskId, urgent: false },
      { file, now: date }
    );

    process.stdout.write("RESULT_JSON=" + JSON.stringify(result) + "\n");
  } catch (error) {
    process.stderr.write(
      "CHILD_FAILURE=" + String(error.message || error) + "\n"
    );
    process.exitCode = 2;
  }
}

function runChild(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [__filename, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, MIRA_AUTONOMOUS_WORKER_ENABLED: "false" }
    });

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
      finish({ code: null, timeout: true, stdout, stderr });
    }, timeoutMs);

    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => {
      finish({
        code: null,
        timeout: false,
        stdout,
        stderr: stderr + String(error.message || error)
      });
    });
    child.on("close", code => {
      finish({ code, timeout: false, stdout, stderr });
    });
  });
}

function parseResult(output) {
  const line = output.stdout
    .split(/\r?\n/)
    .find(value => value.startsWith("RESULT_JSON="));

  if (!line) {
    throw new Error("Child result missing: " + output.stderr);
  }
  return JSON.parse(line.slice("RESULT_JSON=".length));
}

async function main() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "mira-governance-budget-safety-")
  );

  let inconclusive = false;
  let failed = false;

  try {
    console.log("BUDGET_IMPLEMENTATION=reserveResearchBudget");
    console.log("ISOLATION=TEMPORARY_DIRECTORY");
    console.log("NETWORK_TEST=NOT_RUN");
    console.log("LIVE_API_TEST=NOT_RUN");

    const governance = require(servicePath);
    const sequentialFile = path.join(root, "sequential-ledger.json");
    const sequentialResults = [];

    for (let i = 0; i < 5; i++) {
      sequentialResults.push(
        governance.reserveResearchBudget(
          { taskId: "sequential-" + i, urgent: false },
          { file: sequentialFile, now: new Date(fixedDate) }
        )
      );
    }

    const seqAllowed = sequentialResults.filter(
      item => item.allowed === true
    ).length;
    const seqDenied = sequentialResults.filter(
      item => item.allowed !== true
    ).length;
    const seqState = JSON.parse(
      fs.readFileSync(sequentialFile, "utf8")
    );
    const seqUsage = seqState.dailyUsage[fixedDate.slice(0, 10)];

    console.log("SEQUENTIAL_ALLOWED=" + seqAllowed);
    console.log("SEQUENTIAL_DENIED=" + seqDenied);
    console.log("SEQUENTIAL_STORED_COUNT=" + seqUsage.normalCount);

    try {
      assert.equal(seqAllowed, 3);
      assert.equal(seqDenied, 2);
      assert.equal(seqUsage.normalCount, 3);
      console.log("SEQUENTIAL_TEST=PASS");
    } catch (error) {
      failed = true;
      console.log("SEQUENTIAL_TEST=FAIL");
      console.log("SEQUENTIAL_ASSERTION=" + error.message);
    }

    const raceFile = path.join(root, "concurrent-ledger.json");
    const outcomes = await Promise.all(
      Array.from({ length: childCount }, (_, i) =>
        runChild([
          "--child",
          raceFile,
          fixedDate,
          "concurrent-" + i
        ])
      )
    );

    const timedOut = outcomes.filter(item => item.timeout).length;
    const badExit = outcomes.filter(
      item => !item.timeout && item.code !== 0
    ).length;

    console.log("CONCURRENT_CHILDREN=" + childCount);
    console.log("CONCURRENT_TIMEOUTS=" + timedOut);
    console.log("CONCURRENT_CHILD_ERRORS=" + badExit);

    if (timedOut || badExit) {
      inconclusive = true;
      console.log("CONCURRENCY_TEST=INCONCLUSIVE");
    } else {
      const results = outcomes.map(parseResult);
      const allowed = results.filter(
        item => item.allowed === true
      ).length;
      const denied = results.filter(
        item => item.allowed !== true
      ).length;
      const state = JSON.parse(fs.readFileSync(raceFile, "utf8"));
      const usage = state.dailyUsage[fixedDate.slice(0, 10)];

      console.log("CONCURRENT_ALLOWED=" + allowed);
      console.log("CONCURRENT_DENIED=" + denied);
      console.log("CONCURRENT_STORED_COUNT=" + usage.normalCount);

      try {
        assert.equal(allowed, 3, "Expected exactly 3 reservations");
        assert.equal(denied, 17, "Expected exactly 17 denials");
        assert.equal(usage.normalCount, 3);
        console.log("CONCURRENCY_TEST=PASS");
      } catch (error) {
        failed = true;
        console.log("CONCURRENCY_TEST=FAIL");
        console.log("CONCURRENCY_ASSERTION=" + error.message);
      }
    }
  } catch (error) {
    inconclusive = true;
    console.log("TEST_ERROR=" + String(error.stack || error));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    console.log("TEMP_TEST_FILES_CLEANED=YES");
    console.log("SOURCE_EDIT=TEST_FILE_ONLY");
  }

  if (failed) {
    console.log("ISOLATED_SAFETY_RESULT=FAIL");
    process.exitCode = 1;
  } else if (inconclusive) {
    console.log("ISOLATED_SAFETY_RESULT=INCONCLUSIVE");
    process.exitCode = 2;
  } else {
    console.log("ISOLATED_SAFETY_RESULT=PASS");
  }
}

if (process.argv[2] === "--child") {
  childMode();
} else {
  main().catch(error => {
    console.error("ISOLATED_SAFETY_RESULT=INCONCLUSIVE");
    console.error(String(error.stack || error));
    process.exitCode = 2;
  });
}
