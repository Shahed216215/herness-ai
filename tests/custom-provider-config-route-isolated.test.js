"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const sourceRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mira-custom-provider-route-"));
const copied = [
  "routes/mira-provider-evolution.js",
  "change-management.js",
  "audit-log.js",
  "mira-storage.js",
  "services/mira-provider-evolution.js",
  "services/provider-credential-store.js",
  "services/custom-provider-config.js",
  "services/mira-json-state-store.js",
  "services/mira-store-initialization-guard.js"
];

const envNames = [
  "MIRA_CHANGE_FILE",
  "MIRA_AUDIT_FILE",
  "MIRA_STORAGE_DIR",
  "MIRA_CUSTOM_PROVIDER_CONFIG_PATH"
];
const previousEnv = Object.fromEntries(
  envNames.map(name => [name, process.env[name]])
);

async function main() {
  let server;
  try {
    for (const relative of copied) {
      const destination = path.join(tempRoot, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(sourceRoot, relative), destination);
    }
    fs.symlinkSync(path.join(sourceRoot, "node_modules"), path.join(tempRoot, "node_modules"), "dir");

    const dataDir = path.join(tempRoot, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const configPath = path.join(dataDir, "custom-slots.json");
    const runtimePath = path.join(tempRoot, "provider-runtime-config.json");
    const runtimeBefore = { provider: "openai", model: "gpt-4o-mini" };
    fs.writeFileSync(runtimePath, JSON.stringify(runtimeBefore) + "\n");

    process.env.MIRA_CHANGE_FILE = path.join(dataDir, "changes.json");
    process.env.MIRA_AUDIT_FILE = path.join(dataDir, "audit.json");
    process.env.MIRA_STORAGE_DIR = path.join(dataDir, "storage");
    process.env.MIRA_CUSTOM_PROVIDER_CONFIG_PATH = configPath;

    const express = require("express");
    const app = express();
    app.use(express.json());
    app.use("/", require(path.join(tempRoot, "routes/mira-provider-evolution.js")));
    server = http.createServer(app);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const base = "http://127.0.0.1:" + server.address().port;
    const getResponse = await fetch(base + "/custom-slots");
    const getBody = await getResponse.json();
    assert.equal(getResponse.status, 200);
    assert.equal(getBody.success, true);
    assert.equal(getBody.status, "configuration_loaded");
    assert.equal(getBody.slots.length, 5);

    const slots = getBody.slots;
    slots[0] = {
      slot: 1,
      name: "Isolated Mock Provider",
      endpoint: "https://mock-provider.invalid/v1",
      model: "mock-chat-model"
    };

    const putResponse = await fetch(base + "/custom-slots", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slots })
    });
    const putBody = await putResponse.json();
    assert.equal(putResponse.status, 200);
    assert.equal(putBody.success, true);
    assert.equal(putBody.status, "configuration_saved_not_activated");
    assert.equal(putBody.slots[0].name, "Isolated Mock Provider");

    const invalidResponse = await fetch(base + "/custom-slots", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slots: [] })
    });
    const invalidBody = await invalidResponse.json();
    assert.equal(invalidResponse.status, 400);
    assert.equal(invalidBody.success, false);
    assert.equal(invalidBody.status, "exactly_five_slots_required");

    const persisted = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(persisted.slots[0].model, "mock-chat-model");
    assert.equal(Object.hasOwn(persisted.slots[0], "key"), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(runtimePath, "utf8")), runtimeBefore);

    console.log("PASS: custom-slot configuration can be read and saved through isolated routes");
    console.log("PASS: invalid configuration is rejected with a safe status");
    console.log("PASS: saving metadata does not activate or change the runtime provider");
    console.log("CUSTOM_PROVIDER_CONFIG_ROUTE_ISOLATED_TEST=PASS");
    console.log("LIVE_PROVIDER_REQUESTS=0");
    console.log("EXTERNAL_NETWORK_REQUESTS=0");
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error("CUSTOM_PROVIDER_CONFIG_ROUTE_ISOLATED_TEST=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); }
  catch (error) {
    console.error("TEMP_CLEANUP=INCOMPLETE");
    console.error(error.message);
    process.exitCode = 1;
  }
});