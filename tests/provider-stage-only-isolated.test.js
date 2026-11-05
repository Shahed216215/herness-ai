"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const sourceRoot = path.resolve(__dirname, "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "mira-provider-stage-only-"));
const copied = [
  "routes/mira-provider-evolution.js",
  "change-management.js",
  "audit-log.js",
  "mira-storage.js",
  "services/mira-provider-evolution.js",
  "services/provider-credential-store.js",
  "services/mira-json-state-store.js",
  "services/mira-store-initialization-guard.js"
];
(async () => {
  let server;
  try {
    for (const relative of copied) {
      const dest = path.join(root, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(sourceRoot, relative), dest);
    }
    fs.symlinkSync(path.join(sourceRoot, "node_modules"), path.join(root, "node_modules"), "dir");
    const original = { provider: "openai", model: "gpt-4o-mini" };
    fs.writeFileSync(path.join(root, "provider-runtime-config.json"), JSON.stringify(original) + "\n");
    process.env.MIRA_CHANGE_FILE = path.join(root, "changes.json");
    process.env.MIRA_AUDIT_FILE = path.join(root, "audit.json");
    process.env.MIRA_STORAGE_DIR = path.join(root, "storage");
    const service = require(path.join(root, "services/mira-provider-evolution.js"));
    let healthCalls = 0;
    service.testProviderHealth = async () => {
      healthCalls++;
      throw new Error("stage route must never call health");
    };
    const cm = require(path.join(root, "change-management.js"));
    const proposal = cm.createProposal({
      title: "Stage-only isolated test",
      reason: "Check staging without live runtime changes.",
      expectedBenefit: "No activation during staging.",
      category: "provider",
      risk: "medium",
      actor: "isolated-test",
      metadata: { provider: "groq", model: "llama-3.3-70b-versatile" }
    });
    cm.moveToPendingApproval(proposal.changeId, "isolated-test");
    cm.approveProposal(proposal.changeId, "isolated-test");
    const app = require("express")();
    app.use(require("express").json());
    app.use("/", require(path.join(root, "routes/mira-provider-evolution.js")));
    server = http.createServer(app);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/${proposal.changeId}/apply`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.status, "staged");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "provider-runtime-config.json"), "utf8")), original);
    assert.equal(fs.existsSync(path.join(root, "provider-runtime-rollback.json")), false);
    const staged = JSON.parse(fs.readFileSync(path.join(root, "provider-runtime-staging.json"), "utf8"));
    assert.equal(staged.changeId, proposal.changeId);
    assert.equal(staged.config.provider, "groq");
    assert.equal(healthCalls, 0);
    console.log("PASS: apply stages approved config without changing live runtime");
    console.log("PASS: no rollback snapshot or health call during staging");
    console.log("ISOLATED_STAGE_ONLY_TEST=PASS");
    console.log("LIVE_PROVIDER_REQUESTS=0");
    console.log("EXTERNAL_NETWORK_REQUESTS=0");
  } catch (error) {
    console.error("ISOLATED_STAGE_ONLY_TEST=FAIL");
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    try { fs.rmSync(root, { recursive: true, force: true }); }
    catch (_) { console.error("TEMP_CLEANUP=INCOMPLETE"); process.exitCode = 1; }
  }
})();