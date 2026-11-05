"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawnSync } = require("node:child_process");

const sourceRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-provider-rollback-test-")
);

const files = [
  "routes/mira-provider-evolution.js",
  "change-management.js",
  "audit-log.js",
  "mira-storage.js",
  "services/mira-provider-evolution.js"
  , "services/provider-credential-store.js",
  "services/mira-json-state-store.js",
  "services/mira-store-initialization-guard.js"
];

function prepareCopy(root) {
  for (const relative of files) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, relative), destination);
  }

  fs.symlinkSync(
    path.join(sourceRoot, "node_modules"),
    path.join(root, "node_modules"),
    "dir"
  );
}

async function runCase(removeSnapshotDuringHealthCheck) {
  const root = fs.mkdtempSync(
    path.join(tempRoot, "case-")
  );
  prepareCopy(root);

  process.env.MIRA_CHANGE_FILE = path.join(root, "changes.json");
  process.env.MIRA_AUDIT_FILE = path.join(root, "audit-log.json");
  process.env.MIRA_STORAGE_DIR = path.join(root, "storage");

  const servicePath = path.join(
    root, "services", "mira-provider-evolution.js"
  );
  const service = require(servicePath);

  const originalConfig = {
    provider: "openai",
    model: "gpt-4o-mini"
  };

  const proposedConfig = {
    provider: "groq",
    model: "llama-3.3-70b-versatile"
  };

  const validation = service.validateProviderConfiguration(
    proposedConfig
  );

  assert.equal(
    validation.ok,
    true,
    "Test provider/model must pass the real configuration validator"
  );

  service.testProviderHealth = async () => {
    if (removeSnapshotDuringHealthCheck) {
      const snapshot = path.join(
        root, "provider-runtime-rollback.json"
      );
      if (fs.existsSync(snapshot)) fs.unlinkSync(snapshot);
    }

    return {
      ok: false,
      status: "mock_health_failure",
      responseReceived: false
    };
  };

  fs.writeFileSync(
    path.join(root, "provider-runtime-config.json"),
    JSON.stringify(originalConfig, null, 2) + "\n"
  );

  const changeModule = require(path.join(root, "change-management.js"));
  const proposal = changeModule.createProposal({
    title: "Isolated rollback test",
    reason: "Verify rollback handling in a temporary test directory.",
    expectedBenefit: "Ensure rollback failure is reported safely.",
    category: "provider",
    risk: "medium",
    actor: "isolated-test",
    metadata: {
      provider: proposedConfig.provider,
      model: proposedConfig.model
    }
  });

  changeModule.moveToPendingApproval(proposal.changeId, "isolated-test");
  changeModule.approveProposal(proposal.changeId, "isolated-test");
  fs.writeFileSync(
    path.join(root, "provider-runtime-staging.json"),
    JSON.stringify({
      changeId: proposal.changeId,
      config: { provider: proposedConfig.provider, model: proposedConfig.model }
    }) + "\n"
  );

  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use("/", require(path.join(root, "routes/mira-provider-evolution.js")));

  const server = http.createServer(app);

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/${proposal.changeId}/activate`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
    );
    const body = await response.json();

    const runtimePath = path.join(root, "provider-runtime-config.json");
    const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
    const snapshotPath = path.join(root, "provider-runtime-rollback.json");

    if (!removeSnapshotDuringHealthCheck) {
      assert.equal(response.status, 409);
      assert.equal(body.status, "rolled_back");
      assert.equal(body.rollback, "completed");
      assert.deepEqual(runtime, originalConfig);
      assert.equal(fs.existsSync(snapshotPath), false);
      console.log("PASS: mock health failure restores original config and removes snapshot");
    } else {
      assert.equal(response.status, 500);
      assert.equal(body.status, "rollback_failed");
      assert.equal(body.rollback, "failed");
      assert.equal(body.recoveryRequired, true);
      assert.deepEqual(runtime, proposedConfig);
      console.log("PASS: missing snapshot reports rollback_failed and recoveryRequired");
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  try {
    await runCase(false);
    await runCase(true);
    console.log("ISOLATED_ROUTE_RUNTIME_TEST=PASS");
    console.log("LIVE_PROVIDER_REQUESTS=0");
  } catch (error) {
    console.error("ISOLATED_ROUTE_RUNTIME_TEST=FAIL");
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
