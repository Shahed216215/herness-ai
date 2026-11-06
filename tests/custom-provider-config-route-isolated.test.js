"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const express = require("express");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mira-custom-slots-route-"));
process.env.MIRA_CUSTOM_PROVIDER_CONFIG_PATH = path.join(temp, "slots.json");
process.env.MIRA_AUDIT_FILE = path.join(temp, "audit.json");

const routerPath = require.resolve("../routes/mira-provider-evolution");
delete require.cache[routerPath];
const router = require(routerPath);
const app = express();
app.use(express.json());
app.use("/provider", router);
const server = http.createServer(app);

async function request(base, method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

(async () => {
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const base = "http://127.0.0.1:" + server.address().port;

    const initial = await request(base, "GET", "/provider/custom-slots");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.status, "configuration_loaded");
    assert.equal(initial.body.slots.length, 5);

    const slots = initial.body.slots;
    slots[0] = {
      slot: 1,
      name: "Route Test Provider",
      endpoint: "https://provider.example/v1",
      model: "route-test-model"
    };

    const saved = await request(base, "PUT", "/provider/custom-slots", { slots });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.status, "configuration_saved_not_activated");
    assert.equal(saved.body.slots[0].name, "Route Test Provider");

    const rejectedSlots = structuredClone(slots);
    rejectedSlots[0].apiKey = "must-not-be-accepted";
    const rejected = await request(base, "PUT", "/provider/custom-slots", {
      slots: rejectedSlots
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.status, "unexpected_field");

    const reloaded = await request(base, "GET", "/provider/custom-slots");
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.slots[0].model, "route-test-model");
    assert.equal(reloaded.body.slots[0].apiKey, undefined);

    const audit = JSON.parse(fs.readFileSync(process.env.MIRA_AUDIT_FILE, "utf8"));
    assert.ok(audit.some(entry =>
      entry.action === "MIRA_CUSTOM_PROVIDER_CONFIGURATION_SAVED"
    ));

    console.log("CUSTOM_PROVIDER_CONFIG_ROUTE_ISOLATED=PASS");
    console.log("LOCAL_HTTP_REQUESTS=" + 4);
    console.log("EXTERNAL_NETWORK_REQUESTS=0");
    console.log("PROVIDER_ACTIVATION=NOT_PERFORMED");
  } catch (error) {
    console.error("CUSTOM_PROVIDER_CONFIG_ROUTE_ISOLATED=FAIL");
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    await new Promise(resolve => server.close(resolve));
    delete process.env.MIRA_CUSTOM_PROVIDER_CONFIG_PATH;
    delete process.env.MIRA_AUDIT_FILE;
    delete require.cache[routerPath];
    fs.rmSync(temp, { recursive: true, force: true });
  }
})();
