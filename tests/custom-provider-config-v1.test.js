"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mira-custom-provider-v1-"));
const configPath = path.join(temp, "slots.json");
const previous = process.env.MIRA_CUSTOM_PROVIDER_CONFIG_PATH;

try {
  process.env.MIRA_CUSTOM_PROVIDER_CONFIG_PATH = configPath;
  const modulePath = require.resolve("../services/custom-provider-config");
  delete require.cache[modulePath];
  const config = require("../services/custom-provider-config");

  assert.equal(config.emptySlots().length, 5);
  assert.equal(config.readConfig().version, 1);
  assert.equal(config.readConfig().slots.length, 5);

  const validEndpoint = config.validateEndpoint("https://api.example.com/v1");
  assert.equal(validEndpoint.ok, true);
  assert.equal(validEndpoint.endpoint, "https://api.example.com/v1");

  for (const endpoint of [
    "http://api.example.com/v1",
    "https://localhost/v1",
    "https://service.local/v1",
    "https://127.0.0.1/v1",
    "https://10.0.0.8/v1",
    "https://192.168.1.5/v1",
    "https://172.16.0.1/v1",
    "https://user:pass@api.example.com/v1",
    "https://api.example.com/v1?token=x",
    "https://api.example.com/v1#fragment",
    "https://[::1]/v1",
    "https://[fc00::1]/v1"
  ]) {
    assert.equal(config.validateEndpoint(endpoint).ok, false, endpoint);
  }

  const slots = config.emptySlots();
  slots[0] = {
    slot: 1,
    name: "Example Compatible Provider",
    endpoint: "https://api.example.com/v1",
    model: "example-chat-model"
  };

  const checked = config.validateSlots({ slots });
  assert.equal(checked.ok, true);
  assert.equal(checked.slots[0].name, "Example Compatible Provider");

  const saved = config.writeConfig({ slots });
  assert.equal(saved.version, 1);
  assert.equal(config.readConfig().slots[0].model, "example-chat-model");

  const persisted = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(persisted.version, 1);
  assert.equal(Object.hasOwn(persisted.slots[0], "key"), false);
  assert.equal(Object.hasOwn(persisted.slots[0], "apiKey"), false);
  assert.equal(fs.existsSync(configPath + "." + process.pid + ".tmp"), false);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  }

  const invalidCases = [
    { slots: [] },
    { slots: slots.slice(1) },
    { slots: [{ ...slots[0], slot: 2 }, ...slots.slice(1)] },
    { slots: [{ ...slots[0], unexpected: true }, ...slots.slice(1)] },
    { slots: [{ slot: 1, name: "Incomplete", endpoint: "", model: "" }, ...slots.slice(1)] },
    { slots: [{ ...slots[0], endpoint: "http://api.example.com" }, ...slots.slice(1)] },
    { slots: [{ ...slots[0], name: "Bad\nName" }, ...slots.slice(1)] }
  ];
  for (const value of invalidCases) {
    assert.equal(config.validateSlots(value).ok, false);
  }

  assert.throws(
    () => config.writeConfig({ slots: [{ slot: 1 }] }),
    /exactly_five_slots_required/
  );

  console.log("CUSTOM_PROVIDER_CONFIG_V1_SCHEMA=PASS");
  console.log("CUSTOM_PROVIDER_CONFIG_ENDPOINT_POLICY=PASS");
  console.log("CUSTOM_PROVIDER_CONFIG_ATOMIC_PERSISTENCE=PASS");
  console.log("CUSTOM_PROVIDER_CONFIG_SECRET_EXCLUSION=PASS");
  console.log("CUSTOM_PROVIDER_CONFIG_V1_TEST=PASS");
  console.log("LIVE_PROVIDER_REQUESTS=0");
  console.log("EXTERNAL_NETWORK_REQUESTS=0");
} catch (error) {
  console.error("CUSTOM_PROVIDER_CONFIG_V1_TEST=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  if (previous === undefined) delete process.env.MIRA_CUSTOM_PROVIDER_CONFIG_PATH;
  else process.env.MIRA_CUSTOM_PROVIDER_CONFIG_PATH = previous;
  try { fs.rmSync(temp, { recursive: true, force: true }); }
  catch (error) {
    console.error("TEMP_CLEANUP=INCOMPLETE");
    console.error(error.message);
    process.exitCode = 1;
  }
}