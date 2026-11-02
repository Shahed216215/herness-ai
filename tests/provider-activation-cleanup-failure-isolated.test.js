"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const sourceRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-provider-cleanup-failure-")
);

const copiedFiles = [
  "routes/mira-provider-evolution.js",
  "change-management.js",
  "audit-log.js",
  "mira-storage.js",
  "services/mira-provider-evolution.js",
  "services/provider-credential-store.js"
];

const originalConfig = { provider: "openai", model: "gpt-4o-mini" };
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
  fs.symlinkSync(path.join(sourceRoot, "node_modules"),
    path.join(root, "node_modules"), "dir");
  fs.writeFileSync(
    path.join(root, "provider-runtime-config.json"),
    JSON.stringify(originalConfig, null, 2) + "\n"
  );
}

async function main() {
  const root = path.join(tempRoot, "case");
  fs.mkdirSync(root);
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
    return {
      ok: true,
      status: "mock_health_passed",
      responseReceived: false
    };
  };

  const changeModule = require(path.join(root, "change-management.js"));
  const proposal = changeModule.createProposal({
    title: "Isolated staging cleanup failure regression",
    reason: "Ensure cleanup failure cannot misreport verified activation.",
    expectedBenefit: "Keep successful mocked activation status accurate.",
    category: "provider",
    risk: "medium",
    actor: "isolated-test",
    metadata: proposedConfig
  });
  changeModule.moveToPendingApproval(proposal.changeId, "isolated-test");
  changeModule.approveProposal(proposal.changeId, "isolated-test");

  const stagingPath = path.join(root, "provider-runtime-staging.json");
  const snapshotPath = path.join(root, "provider-runtime-rollback.json");
  const runtimePath = path.join(root, "provider-runtime-config.json");

  fs.writeFileSync(stagingPath, JSON.stringify({
    changeId: proposal.changeId,
    config: proposedConfig
  }) + "\n");

  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use("/", require(path.join(root, "routes/mira-provider-evolution.js")));
  const server = http.createServer(app);

  const originalReadFileSync = fs.readFileSync;
  let stagingReads = 0;
  let injected = false;

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    fs.readFileSync = function(filePath, ...args) {
      if (path.resolve(String(filePath)) === path.resolve(stagingPath)) {
        stagingReads++;
        // First read is the activation guard; inject failure only at cleanup.
        if (stagingReads === 2) {
          injected = true;
          throw new Error("injected_staging_cleanup_read_failure");
        }
      }
      return originalReadFileSync.call(this, filePath, ...args);
    };

    let response;
    let body;
    try {
      const address = server.address();
      response = await fetch(
        "http://127.0.0.1:" + address.port + "/" +
          proposal.changeId + "/activate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}"
        }
      );
      body = await response.json();
    } finally {
      fs.readFileSync = originalReadFileSync;
    }

    assert.equal(injected, true, "cleanup failure must be injected");
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.status, "applied_verified");
    assert.equal(body.verification.ok, true);
    assert.equal(healthCalls, 1);

    const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
    assert.equal(runtime.provider, proposedConfig.provider);
    assert.equal(runtime.model, proposedConfig.model);
    assert.equal(fs.existsSync(snapshotPath), false);
    assert.equal(fs.existsSync(stagingPath), true,
      "staging record should remain when its cleanup fails");

    console.log(
      "PASS: staging cleanup failure does not convert verified activation into rollback_failed"
    );
    console.log("MOCK_HEALTH_CALLS=" + healthCalls);
    console.log("STAGING_CLEANUP_FAILURE_INJECTED=YES");
    console.log("ISOLATED_MOCK_ACTIVATE_ROUTE=USED");
    console.log("EXTERNAL_NETWORK_REQUESTS=0");
    console.log("LIVE_PROVIDER_REQUESTS=0");
    console.log("ACTUAL_PROVIDER_ACTIVATION=NOT_PERFORMED");
  } finally {
    fs.readFileSync = originalReadFileSync;
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error("ACTIVATION_CLEANUP_REGRESSION=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch (error) {
    console.error("TEMP_CLEANUP=INCOMPLETE");
    console.error(tempRoot);
    process.exitCode = 1;
  }
});
