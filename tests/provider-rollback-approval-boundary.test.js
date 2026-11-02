"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const sourceRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-provider-approval-boundary-")
);

const copiedFiles = [
  "routes/mira-provider-evolution.js",
  "change-management.js",
  "audit-log.js",
  "mira-storage.js",
  "services/mira-provider-evolution.js",
  "services/provider-credential-store.js"
];

const originalConfig = {
  provider: "openai",
  model: "gpt-4o-mini"
};

const proposedConfig = {
  provider: "groq",
  model: "llama-3.3-70b-versatile"
};

function prepareCopy(root) {
  for (const relative of copiedFiles) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, relative), destination);
  }

  fs.symlinkSync(
    path.join(sourceRoot, "node_modules"),
    path.join(root, "node_modules"),
    "dir"
  );

  fs.writeFileSync(
    path.join(root, "provider-runtime-config.json"),
    JSON.stringify(originalConfig, null, 2) + "\n"
  );
}

async function runCase({ approved, removeSnapshot = false }) {
  const root = fs.mkdtempSync(path.join(tempRoot, "case-"));
  prepareCopy(root);

  process.env.MIRA_CHANGE_FILE = path.join(root, "changes.json");
  process.env.MIRA_AUDIT_FILE = path.join(root, "audit-log.json");
  process.env.MIRA_STORAGE_DIR = path.join(root, "storage");

  const service = require(
    path.join(root, "services/mira-provider-evolution.js")
  );

  let healthCalls = 0;

  service.testProviderHealth = async () => {
    healthCalls++;

    if (removeSnapshot) {
      const snapshotPath = path.join(
        root,
        "provider-runtime-rollback.json"
      );
      if (fs.existsSync(snapshotPath)) {
        fs.unlinkSync(snapshotPath);
      }
    }

    return {
      ok: false,
      status: "mock_health_failure",
      responseReceived: false
    };
  };

  const changeModule = require(path.join(root, "change-management.js"));
  const proposal = changeModule.createProposal({
    title: "Approval boundary isolated test",
    reason: "Verify provider apply approval and rollback gates.",
    expectedBenefit: "Prevent apply before approval and report rollback failure.",
    category: "provider",
    risk: "medium",
    actor: "isolated-test",
    metadata: proposedConfig
  });

  changeModule.moveToPendingApproval(
    proposal.changeId,
    "isolated-test"
  );

  if (approved) {
    changeModule.approveProposal(
      proposal.changeId,
      "isolated-test"
    );
    fs.writeFileSync(
      path.join(root, "provider-runtime-staging.json"),
      JSON.stringify({ changeId: proposal.changeId, config: proposedConfig }) + "\n"
    );
  }

  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use(
    "/",
    require(path.join(root, "routes/mira-provider-evolution.js"))
  );

  const server = http.createServer(app);

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/${proposal.changeId}/${approved ? "activate" : "apply"}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }
    );

    const body = await response.json();
    const runtimePath = path.join(root, "provider-runtime-config.json");
    const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
    const snapshotPath = path.join(
      root,
      "provider-runtime-rollback.json"
    );

    if (!approved) {
      assert.equal(response.status, 409);
      assert.equal(body.status, "approval_required");
      assert.deepEqual(runtime, originalConfig);
      assert.equal(healthCalls, 0);
      assert.equal(fs.existsSync(snapshotPath), false);
      console.log(
        "PASS: apply without approval is rejected before config write or health check"
      );
    } else if (removeSnapshot) {
      assert.equal(response.status, 500);
      assert.equal(body.status, "rollback_failed");
      assert.equal(body.rollback, "failed");
      assert.equal(body.recoveryRequired, true);
      assert.deepEqual(runtime, proposedConfig);
      assert.equal(healthCalls, 1);
      console.log(
        "PASS: missing rollback snapshot reports failure and recovery requirement"
      );
    } else {
      assert.equal(response.status, 409);
      assert.equal(body.status, "rolled_back");
      assert.equal(body.rollback, "completed");
      assert.deepEqual(runtime, originalConfig);
      assert.equal(fs.existsSync(snapshotPath), false);
      assert.equal(healthCalls, 1);
      console.log(
        "PASS: approved proposal with mock health failure restores original config"
      );
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  try {
    await runCase({ approved: false });
    await runCase({ approved: true });
    await runCase({ approved: true, removeSnapshot: true });
    console.log("APPROVAL_BOUNDARY_ISOLATED_TEST=PASS");
    console.log("EXTERNAL_NETWORK_REQUESTS=0");
    console.log("LIVE_PROVIDER_REQUESTS=0");
  } catch (error) {
    console.error("APPROVAL_BOUNDARY_ISOLATED_TEST=FAIL");
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      console.error("TEMP_CLEANUP=INCOMPLETE");
      console.error(tempRoot);
      process.exitCode = 1;
    }
  }
})();
