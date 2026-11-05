"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const sourceRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-provider-verify-test-")
);

const files = [
  "routes/mira-provider-evolution.js",
  "change-management.js",
  "audit-log.js",
  "mira-storage.js",
  "services/mira-provider-evolution.js",
  "services/provider-credential-store.js",
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

async function runCase(name, proposalConfig, runtimeConfig, expectedStatus, options = {}) {
  const root = fs.mkdtempSync(path.join(tempRoot, "case-"));
  prepareCopy(root);

  process.env.MIRA_CHANGE_FILE = path.join(root, "changes.json");
  process.env.MIRA_AUDIT_FILE = path.join(root, "audit-log.json");
  process.env.MIRA_STORAGE_DIR = path.join(root, "storage");

  const runtimePath = path.join(root, "provider-runtime-config.json");
  fs.writeFileSync(runtimePath, JSON.stringify(runtimeConfig, null, 2) + "\n");

  const servicePath = path.join(root, "services", "mira-provider-evolution.js");
  const service = require(servicePath);

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
    title: "Isolated Verify fallback test",
    reason: "Test runtime and proposal fallback matching.",
    expectedBenefit: "Verify mismatch fails closed without live provider calls.",
    category: "provider",
    risk: "medium",
    actor: "isolated-test",
    metadata: proposalConfig
  });

  // Normal verification cases follow the real approval/completion lifecycle.
  // The negative case intentionally leaves the proposal incomplete.
  if (options.complete !== false) {
    changeModule.moveToPendingApproval(proposal.changeId, "isolated-test");
    changeModule.approveProposal(proposal.changeId, "isolated-test");
    changeModule.completeProposal(proposal.changeId, "isolated-test");
  }

  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use("/", require(path.join(root, "routes", "mira-provider-evolution.js")));

  const server = http.createServer(app);

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/${proposal.changeId}/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }
    );
    const body = await response.json();

    assert.equal(response.status, expectedStatus, `${name}: HTTP status`);
    const expectedBodyStatus = options.expectedBodyStatus ||
      (expectedStatus === 409
        ? "runtime_configuration_mismatch"
        : "verified");
    assert.equal(
      body.status,
      expectedBodyStatus,
      `${name}: response status`
    );

    if (expectedStatus === 409) {
      assert.equal(healthCalls, 0, `${name}: mismatch must not call health check`);
    } else {
      assert.equal(healthCalls, 1, `${name}: matching config calls mock health once`);
    }

    console.log(`PASS: ${name}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const primary = { provider: "openai", model: "gpt-4o-mini" };

  const fallbackA = {
    ...primary,
    fallbackEnabled: true,
    fallbackProvider: "groq",
    fallbackModel: "llama-3.3-70b-versatile"
  };

  try {
    await runCase(
      "incomplete proposal returns 409 without health call",
      primary,
      primary,
      409,
      {
        complete: false,
        expectedBodyStatus: "proposal_not_completed"
      }
    );

    await runCase(
      "fallback provider mismatch returns 409 without health call",
      fallbackA,
      { ...fallbackA, fallbackProvider: "deepseek" },
      409
    );

    await runCase(
      "fallback enabled-state mismatch returns 409 without health call",
      primary,
      fallbackA,
      409
    );

    await runCase(
      "fallback model mismatch returns 409 without health call",
      fallbackA,
      { ...fallbackA, fallbackModel: "different-test-model" },
      409
    );

    await runCase(
      "matching fallback configuration uses mock health check",
      fallbackA,
      fallbackA,
      200
    );

    console.log("ISOLATED_VERIFY_FALLBACK_BEHAVIOR=PASS");
    console.log("LIVE_PROVIDER_REQUESTS=0");
    console.log("EXTERNAL_NETWORK_REQUESTS=0");
  } catch (error) {
    console.error("ISOLATED_VERIFY_FALLBACK_BEHAVIOR=FAIL");
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
