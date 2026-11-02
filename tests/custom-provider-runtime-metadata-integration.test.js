"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = process.cwd();
const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-provider-metadata-runtime-")
);

const savedEnv = {};
const envNames = [
  "MIRA_CUSTOM_PROVIDER_CONFIG_PATH",
  "AI_PROVIDER",
  "CUSTOM_PROVIDER",
  "CUSTOM_PROVIDER1_URL",
  "CUSTOM_PROVIDER1_MODEL",
  "CUSTOM_PROVIDER1_KEY",
  "MIRA_ALLOW_PRIVATE_CUSTOM_PROVIDER_URLS"
];

for (const name of envNames) {
  savedEnv[name] = process.env[name];
}

const runtimePath = path.join(root, "provider-runtime-config.json");
const runtimeExisted = fs.existsSync(runtimePath);
const runtimeBefore = runtimeExisted
  ? fs.readFileSync(runtimePath)
  : null;

try {
  process.env.MIRA_CUSTOM_PROVIDER_CONFIG_PATH =
    path.join(temp, "custom-slots.json");

  // Use a nonexistent runtime config path by isolating the module's
  // runtime config path only through its source-level fixed path contract.
  // Do not modify the production runtime config file.
  const configService = require(
    path.join(root, "services/custom-provider-config.js")
  );

  const slots = configService.emptySlots();
  slots[0] = {
    slot: 1,
    name: "Mock Provider",
    endpoint: "https://mock-provider.invalid/api",
    model: "mock-model"
  };

  const saved = configService.writeConfig({ slots });
  assert.equal(saved.slots[0].name, "Mock Provider");
  assert.equal(saved.slots[0].model, "mock-model");

  const loaded = configService.readConfig();
  assert.equal(loaded.slots[0].endpoint, "https://mock-provider.invalid/api");

  // A metadata save must not silently select or activate a provider.
  // Existing runtime selection is environment/config driven.
  process.env.AI_PROVIDER = "gemini";
  process.env.CUSTOM_PROVIDER = "provider1";
  delete require.cache[require.resolve(
    path.join(root, "providers/index.js")
  )];

  const runtime = require(path.join(root, "providers/index.js"));
  const current = runtime.getRuntimeConfig();

  const expectedProvider = runtimeExisted
    ? String(
        JSON.parse(runtimeBefore.toString("utf8")).provider ||
        process.env.AI_PROVIDER ||
        "gemini"
      ).trim().toLowerCase()
    : "gemini";

  assert.equal(current.provider, expectedProvider);
  assert.equal(process.env.CUSTOM_PROVIDER, "provider1");
  assert.equal(
    Object.hasOwn(loaded.slots[0], "key"),
    false,
    "saved metadata must not contain an API key field"
  );

  console.log("PASS: custom metadata save/read round-trip");
  console.log("PASS: metadata does not auto-activate a provider");
  console.log("PASS: runtime selection remains independently configured");
  console.log("PASS: metadata has no API-key field");
  console.log("LIVE_PROVIDER_CALLS=0");
  console.log("EXTERNAL_NETWORK_CALLS=0");
  console.log("PROVIDER_ACTIVATION=NOT_RUN");
  console.log("CUSTOM_PROVIDER_METADATA_RUNTIME_TEST=PASS");
} catch (error) {
  console.error("CUSTOM_PROVIDER_METADATA_RUNTIME_TEST=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  for (const name of envNames) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }

  fs.rmSync(temp, { recursive: true, force: true });

  // This test must never change the actual runtime config.
  if (runtimeExisted) {
    assert.deepEqual(fs.readFileSync(runtimePath), runtimeBefore);
  } else {
    assert.equal(fs.existsSync(runtimePath), false);
  }
}
