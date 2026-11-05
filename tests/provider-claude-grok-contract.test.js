"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const envNames = ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "XAI_API_KEY", "XAI_MODEL"];
const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const securePath = require.resolve("../services/security/secure-provider-request");
const previousSecureModule = require.cache[securePath];
const providerPaths = [
  require.resolve("../providers/anthropic"),
  require.resolve("../providers/xai")
];
const previousProviders = new Map(providerPaths.map(file => [file, require.cache[file]]));

async function main() {
  const calls = [];
  require.cache[securePath] = {
    id: securePath,
    filename: securePath,
    loaded: true,
    exports: {
      secureProviderRequest: async (url, options) => {
        calls.push({ url, options });
        if (url === "https://api.anthropic.com/v1/messages") {
          return { data: { content: [{ type: "text", text: "Claude " }, { type: "image", text: "ignored" }, { type: "text", text: "mock" }] } };
        }
        if (url === "https://api.x.ai/v1/chat/completions") {
          return { data: { choices: [{ message: { content: "Grok mock" } }] } };
        }
        throw new Error("unexpected_provider_endpoint");
      }
    }
  };

  for (const file of providerPaths) delete require.cache[file];

  process.env.ANTHROPIC_API_KEY = "test-anthropic-key-not-real";
  process.env.ANTHROPIC_MODEL = "claude-test-model";
  process.env.XAI_API_KEY = "test-xai-key-not-real";
  process.env.XAI_MODEL = "grok-test-model";

  const anthropic = require("../providers/anthropic");
  const xai = require("../providers/xai");

  assert.equal(anthropic.name, "anthropic");
  assert.equal(xai.name, "xai");
  assert.equal(typeof anthropic.generate, "function");
  assert.equal(typeof xai.generate, "function");

  const claudeResult = await anthropic.generate("fallback prompt", {
    systemInstruction: "Be concise.",
    messages: [
      { role: "user", content: "Hello" },
      { role: "system", content: "must be filtered from messages" },
      { role: "assistant", content: "Previous answer" },
      { role: "tool", content: "must be filtered" }
    ]
  });
  assert.deepEqual(claudeResult, { text: "Claude mock" });

  const grokResult = await xai.generate("fallback prompt", {
    systemInstruction: "Use system context.",
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Previous answer" },
      { role: "tool", content: "must be filtered" }
    ]
  });
  assert.deepEqual(grokResult, { text: "Grok mock" });

  assert.equal(calls.length, 2);
  const claudeCall = calls[0];
  assert.equal(claudeCall.url, "https://api.anthropic.com/v1/messages");
  assert.equal(claudeCall.options.method, "POST");
  assert.equal(claudeCall.options.headers["x-api-key"], "test-anthropic-key-not-real");
  assert.equal(claudeCall.options.headers["anthropic-version"], "2023-06-01");
  assert.equal(claudeCall.options.data.model, "claude-test-model");
  assert.equal(claudeCall.options.data.max_tokens, 1024);
  assert.equal(claudeCall.options.data.system, "Be concise.");
  assert.deepEqual(claudeCall.options.data.messages, [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Previous answer" }
  ]);

  const grokCall = calls[1];
  assert.equal(grokCall.url, "https://api.x.ai/v1/chat/completions");
  assert.equal(grokCall.options.method, "POST");
  assert.equal(grokCall.options.headers.Authorization, "Bearer test-xai-key-not-real");
  assert.equal(grokCall.options.data.model, "grok-test-model");
  assert.deepEqual(grokCall.options.data.messages, [
    { role: "system", content: "Use system context." },
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Previous answer" }
  ]);

  process.env.ANTHROPIC_API_KEY = "";
  await assert.rejects(
    () => anthropic.generate("no credentials"),
    /ANTHROPIC_API_KEY is not configured/
  );
  process.env.XAI_API_KEY = "";
  await assert.rejects(
    () => xai.generate("no credentials"),
    /XAI_API_KEY is not configured/
  );

  console.log("CLAUDE_PROVIDER_REQUEST_CONTRACT=PASS");
  console.log("GROK_PROVIDER_REQUEST_CONTRACT=PASS");
  console.log("PROVIDER_CREDENTIAL_REQUIRED=PASS");
  console.log("PROVIDER_CLAUDE_GROK_CONTRACT_TEST=PASS");
  console.log("MOCK_SECURE_PROVIDER_CALLS=" + calls.length);
  console.log("LIVE_PROVIDER_REQUESTS=0");
  console.log("EXTERNAL_NETWORK_REQUESTS=0");
}

main().catch(error => {
  console.error("PROVIDER_CLAUDE_GROK_CONTRACT_TEST=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const [file, cached] of previousProviders) {
    delete require.cache[file];
    if (cached) require.cache[file] = cached;
  }
  delete require.cache[securePath];
  if (previousSecureModule) require.cache[securePath] = previousSecureModule;
});