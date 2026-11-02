/* Offline regression tests for opt-in, transient-only provider fallback. */
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mira-provider-fallback-"));

function write(file, content) {
  const full = path.join(temp, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
function config(value) {
  write("provider-runtime-config.json", JSON.stringify(value));
}
function stub(name, body) {
  write("providers/" + name + ".js", '"use strict";\n' + body + "\n");
}
function clearRuntime() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(temp, "providers"))) delete require.cache[key];
  }
}
async function run() {
  try {
    fs.mkdirSync(path.join(temp, "providers"), { recursive: true });
    write("audit-log.js", 'module.exports = { recordAudit: () => ({}) };');
    fs.copyFileSync(
      path.join(repo, "providers", "index.js"),
      path.join(temp, "providers", "index.js")
    );

    stub("groq", 'module.exports = { generate: async () => { const e = new Error("temporary outage"); e.status = 503; throw e; } };');
    stub("openai", 'module.exports = { generate: async (prompt, options) => ({ provider: "openai", prompt, model: options.model }) };');
    stub("gemini", 'module.exports = { generate: async () => ({ provider: "gemini" }) };');

    config({
      provider: "groq", model: "primary-model",
      fallbackEnabled: true, fallbackProvider: "openai", fallbackModel: "backup-model"
    });
    clearRuntime();
    let runtime = require(path.join(temp, "providers", "index.js"));
    let result = await runtime.generate("offline test");
    assert.deepStrictEqual(result, {
      provider: "openai", prompt: "offline test", model: "backup-model"
    });

    // Generic secure-transport HTTP errors must still permit transient fallback.
    stub("groq", 'module.exports = { generate: async () => { throw new Error("Provider request failed with HTTP 503"); } };');
    clearRuntime();
    runtime = require(path.join(temp, "providers", "index.js"));
    result = await runtime.generate("offline HTTP 503 test");
    assert.strictEqual(result.provider, "openai");
    assert.strictEqual(result.model, "backup-model");

    // Generic HTTP 401 errors must not trigger fallback.
    stub("groq", 'module.exports = { generate: async () => { throw new Error("Provider request failed with HTTP 401"); } };');
    clearRuntime();
    runtime = require(path.join(temp, "providers", "index.js"));
    await assert.rejects(() => runtime.generate("offline HTTP 401 test"), /HTTP 401/);

    // Authentication failures must not trigger fallback, even with retryable status.
    stub("groq", 'module.exports = { generate: async () => { const e = new Error("unauthorized"); e.status = 503; throw e; } };');
    clearRuntime();
    runtime = require(path.join(temp, "providers", "index.js"));
    await assert.rejects(() => runtime.generate("offline test"), /unauthorized/);

    // Fallback disabled means the primary error is preserved.
    stub("groq", 'module.exports = { generate: async () => { const e = new Error("temporary outage"); e.status = 503; throw e; } };');
    config({ provider: "groq", model: "primary-model" });
    clearRuntime();
    runtime = require(path.join(temp, "providers", "index.js"));
    await assert.rejects(() => runtime.generate("offline test"), /temporary outage/);

    // Connection reset is transient; fallback gets its configured model.
    stub("groq", 'module.exports = { generate: async () => { const e = new Error("socket reset"); e.code = "ECONNRESET"; throw e; } };');
    config({
      provider: "groq", model: "primary-model",
      fallbackEnabled: true, fallbackProvider: "openai", fallbackModel: "backup-model"
    });
    clearRuntime();
    runtime = require(path.join(temp, "providers", "index.js"));
    result = await runtime.generate("offline test");
    assert.strictEqual(result.provider, "openai");
    assert.strictEqual(result.model, "backup-model");

    assert.strictEqual(runtime.isTransientProviderError({ status: 400 }), false);
    assert.strictEqual(runtime.isTransientProviderError({ status: 401 }), false);
    assert.strictEqual(runtime.isTransientProviderError({ status: 429 }), true);
    console.log("PROVIDER_FALLBACK_RUNTIME_TEST=PASS");
    console.log("LIVE_PROVIDER_REQUESTS=0");
    console.log("EXTERNAL_NETWORK_REQUESTS=0");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
run().catch(error => {
  console.error("PROVIDER_FALLBACK_RUNTIME_TEST=FAIL");
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
