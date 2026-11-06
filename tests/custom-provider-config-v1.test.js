"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mira-custom-slots-v1-"));
process.env.MIRA_CUSTOM_PROVIDER_CONFIG_PATH = path.join(temp, "slots.json");

const service = require("../services/custom-provider-config");
const validSlots = service.emptySlots();
validSlots[0] = {
  slot: 1,
  name: "Example Provider",
  endpoint: "https://provider.example/v1",
  model: "example-model"
};

try {
  assert.equal(service.validateSlots({ slots: validSlots }).ok, true);
  assert.equal(service.validateEndpoint("http://provider.example").status, "https_required");
  assert.equal(service.validateEndpoint("https://user:pass@provider.example").status,
    "endpoint_contains_prohibited_data");
  assert.equal(service.validateEndpoint("https://localhost/api").status,
    "endpoint_host_not_allowed");
  assert.equal(service.validateEndpoint("https://192.168.1.10/api").status,
    "endpoint_host_not_allowed");
  assert.equal(service.validateSlots({ slots: validSlots.slice(0, 4) }).status,
    "exactly_five_slots_required");

  const withSecret = structuredClone(validSlots);
  withSecret[0].apiKey = "must-not-be-accepted";
  assert.equal(service.validateSlots({ slots: withSecret }).status, "unexpected_field");

  const saved = service.writeConfig({ slots: validSlots });
  assert.equal(saved.version, 1);
  assert.equal(saved.slots[0].name, "Example Provider");
  assert.deepEqual(service.readConfig(), saved);

  const disk = JSON.parse(fs.readFileSync(process.env.MIRA_CUSTOM_PROVIDER_CONFIG_PATH, "utf8"));
  assert.equal(disk.version, 1);
  assert.equal(Object.hasOwn(disk.slots[0], "apiKey"), false);
  console.log("CUSTOM_PROVIDER_CONFIG_V1=PASS");
  console.log("VALIDATION_AND_SAFE_PERSISTENCE=PASS");
  console.log("CREDENTIAL_FIELDS=REJECTED");
} finally {
  delete process.env.MIRA_CUSTOM_PROVIDER_CONFIG_PATH;
  fs.rmSync(temp, { recursive: true, force: true });
}
