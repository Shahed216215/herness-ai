"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mira-provider-execution-audit-"));

function write(file, content) {
  const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function config(value) {
  write("provider-runtime-config.json", JSON.stringify(value));
}

function stub(name, body) {
  write(`providers/${name}.js`, `"use strict";\n${body}\n`);
}

function clearRuntime() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(temp, "providers"))) {
      delete require.cache[key];
    }
  }
}

async function run() {
  try {
    fs.mkdirSync(path.join(temp, "providers"), { recursive: true });
    fs.copyFileSync(
      path.join(repo, "providers", "index.js"),
      path.join(temp, "providers", "index.js")
    );

    write("audit-log.js", `
      "use strict";
      module.exports = {
        recordAudit(entry) {
          global.__miraProviderAuditRecords.push(entry);
          if (global.__miraProviderAuditFail) {
            throw new Error("offline audit sink failure");
          }
          return entry;
        }
      };
    `);

    global.__miraProviderAuditRecords = [];
    global.__miraProviderAuditFail = false;

    stub("groq", `
      module.exports = {
        generate: async () => {
          const error = new Error("private prompt and secret must not be logged");
          error.status = 503;
          error.code = "SERVICE_UNAVAILABLE";
          throw error;
        }
      };
    `);

    stub("openai", `
      module.exports = {
        generate: async (prompt, options) => ({
          provider: "openai",
          model: options.model,
          prompt
        })
      };
    `);

    config({
      provider: "groq",
      model: "primary-model",
      fallbackEnabled: true,
      fallbackProvider: "openai",
      fallbackModel: "fallback-model"
    });

    clearRuntime();
    let runtime = require(path.join(temp, "providers", "index.js"));

    const fallbackResult = await runtime.generate(
      "PRIVATE_PROMPT_SHOULD_NOT_ENTER_AUDIT",
      { requestId: "offline-request-001" }
    );

    assert.equal(fallbackResult.provider, "openai");
    assert.equal(fallbackResult.model, "fallback-model");

    let records = global.__miraProviderAuditRecords;
    assert.equal(records.length, 2);
    assert.equal(records[0].action, "provider_execution_attempt");
    assert.equal(records[0].status, "failure");
    assert.equal(records[0].details.attemptType, "primary");
    assert.equal(records[0].details.fallbackUsed, false);
    assert.equal(records[0].details.errorCode, "SERVICE_UNAVAILABLE");
    assert.equal(records[0].details.httpStatus, 503);

    assert.equal(records[1].status, "success");
    assert.equal(records[1].details.attemptType, "fallback");
    assert.equal(records[1].details.fallbackUsed, true);
    assert.equal(records[1].details.attempt, 2);

    assert.equal(records[0].resourceId, "offline-request-001");
    assert.equal(records[1].resourceId, "offline-request-001");
    assert.equal(records[0].details.requestId, records[1].details.requestId);

    const serialized = JSON.stringify(records);
    assert.equal(serialized.includes("PRIVATE_PROMPT_SHOULD_NOT_ENTER_AUDIT"), false);
    assert.equal(serialized.includes("private prompt and secret"), false);

    // Primary success produces exactly one successful attempt record.
    global.__miraProviderAuditRecords = [];
    stub("groq", `
      module.exports = {
        generate: async (prompt, options) => ({
          provider: "groq",
          model: options.model
        })
      };
    `);
    clearRuntime();
    runtime = require(path.join(temp, "providers", "index.js"));

    const primaryResult = await runtime.generate("offline", {
      requestId: "offline-primary-002"
    });
    assert.equal(primaryResult.provider, "groq");
    assert.equal(global.__miraProviderAuditRecords.length, 1);
    assert.equal(global.__miraProviderAuditRecords[0].status, "success");
    assert.equal(global.__miraProviderAuditRecords[0].details.attemptType, "primary");

    // Audit storage failure must not trigger another provider call or fail success.
    global.__miraProviderAuditRecords = [];
    global.__miraProviderAuditFail = true;
    let providerCalls = 0;

    stub("groq", `
      module.exports = {
        generate: async () => {
          global.__miraProviderCalls = (global.__miraProviderCalls || 0) + 1;
          return { provider: "groq" };
        }
      };
    `);
    global.__miraProviderCalls = 0;
    clearRuntime();
    runtime = require(path.join(temp, "providers", "index.js"));

    const auditFailureResult = await runtime.generate("offline");
    assert.equal(auditFailureResult.provider, "groq");
    assert.equal(global.__miraProviderCalls, 1);

    console.log("PROVIDER_EXECUTION_AUDIT_TEST=PASS");
    console.log("PRIMARY_AND_FALLBACK_CORRELATION=PASS");
    console.log("PROMPT_AND_ERROR_REDACTION=PASS");
    console.log("AUDIT_FAILURE_DOES_NOT_RETRY_PROVIDER=PASS");
    console.log("LIVE_PROVIDER_REQUESTS=0");
    console.log("EXTERNAL_NETWORK_REQUESTS=0");
  } finally {
    delete global.__miraProviderAuditRecords;
    delete global.__miraProviderAuditFail;
    delete global.__miraProviderCalls;
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error("PROVIDER_EXECUTION_AUDIT_TEST=FAIL");
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
