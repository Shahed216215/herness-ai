"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const securityPath = require.resolve("../services/security/secure-provider-request");
const originalSecurityModule = require.cache[securityPath];
const requests = [];

require.cache[securityPath] = {
  id: securityPath,
  filename: securityPath,
  loaded: true,
  exports: {
    secureProviderRequest: async (url, options) => {
      requests.push({ url, options });
      if (url.includes("anthropic.com")) {
        return { data: { content: [{ type: "text", text: "claude-mock" }] } };
      }
      return { data: { choices: [{ message: { content: "grok-mock" } }] } };
    }
  }
};

const envNames = ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "XAI_API_KEY", "XAI_MODEL"];
const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));

(async () => {
  try {
    process.env.ANTHROPIC_API_KEY = "offline-placeholder";
    process.env.ANTHROPIC_MODEL = "claude-test-model";
    process.env.XAI_API_KEY = "offline-placeholder";
    process.env.XAI_MODEL = "grok-test-model";

    const anthropicPath = require.resolve("../providers/anthropic");
    const xaiPath = require.resolve("../providers/xai");
    delete require.cache[anthropicPath];
    delete require.cache[xaiPath];

    const anthropic = require(anthropicPath);
    const xai = require(xaiPath);

    const claudeResult = await anthropic.generate("hello", {
      systemInstruction: "system-test",
      model: "claude-override",
      messages: [{ role: "user", content: "hello" }]
    });
    assert.equal(claudeResult.text, "claude-mock");
    assert.equal(requests[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(requests[0].options.headers["x-api-key"], "offline-placeholder");
    assert.equal(requests[0].options.headers["anthropic-version"], "2023-06-01");
    assert.equal(requests[0].options.data.model, "claude-override");
    assert.equal(requests[0].options.data.system, "system-test");
    assert.deepEqual(requests[0].options.data.messages, [
      { role: "user", content: "hello" }
    ]);

    const grokResult = await xai.generate("hello", {
      systemInstruction: "system-test",
      model: "grok-override"
    });
    assert.equal(grokResult.text, "grok-mock");
    assert.equal(requests[1].url, "https://api.x.ai/v1/chat/completions");
    assert.equal(requests[1].options.headers.Authorization, "Bearer offline-placeholder");
    assert.equal(requests[1].options.data.model, "grok-override");
    assert.deepEqual(requests[1].options.data.messages, [
      { role: "system", content: "system-test" },
      { role: "user", content: "hello" }
    ]);

    assert.equal(requests.length, 2);
    console.log("PROVIDER_CLAUDE_GROK_CONTRACT=PASS");
    console.log("MOCK_SECURE_REQUESTS=2");
    console.log("EXTERNAL_API_CALLS=0");
  } catch (error) {
    console.error("PROVIDER_CLAUDE_GROK_CONTRACT=FAIL");
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    for (const name of envNames) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
    delete require.cache[require.resolve("../providers/anthropic")];
    delete require.cache[require.resolve("../providers/xai")];
    if (originalSecurityModule) require.cache[securityPath] = originalSecurityModule;
    else delete require.cache[securityPath];
  }
})();
