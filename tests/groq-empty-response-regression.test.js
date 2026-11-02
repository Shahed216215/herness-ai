"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
const originalApiKey = process.env.GROQ_API_KEY;

const responses = [];
let apiCallCount = 0;

class MockGroq {
  constructor() {
    this.chat = {
      completions: {
        create: async () => {
          apiCallCount++;
          if (responses.length === 0) {
            throw new Error("Unexpected mock request");
          }
          const next = responses.shift();
          if (next instanceof Error) throw next;
          return next;
        }
      }
    };
  }
}

process.env.GROQ_API_KEY = "offline-test-key-not-real";

Module._load = function (request, parent, isMain) {
  if (request === "groq-sdk") return MockGroq;

  if (
    request === "../services/security/secure-sdk-fetch" &&
    parent &&
    parent.filename.endsWith("/providers/groq.js")
  ) {
    return async function forbiddenNetworkFetch() {
      throw new Error("Network forbidden in offline test");
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

let groq;

try {
  groq = require("../providers/groq");
} finally {
  Module._load = originalLoad;
}

function queueResponse(response) {
  responses.push(response);
}

function completion(message) {
  return { choices: [{ message }] };
}

async function runCase(name, fn) {
  await fn();
  console.log("PASS:", name);
}

(async () => {
  try {
    await runCase("normal text response", async () => {
      queueResponse(completion({ content: "MIRA_OK" }));
      const result = await groq.generate("test", { maxTokens: 10 });
      assert.equal(result.text, "MIRA_OK");
      assert.deepEqual(result.functionCalls, []);
    });

    await runCase("null content becomes empty text", async () => {
      queueResponse(completion({ content: null }));
      const result = await groq.generate("test", { maxTokens: 10 });
      assert.equal(result.text, "");
      assert.deepEqual(result.functionCalls, []);
    });

    await runCase("empty content without tool calls", async () => {
      queueResponse(completion({ content: "" }));
      const result = await groq.generate("test", { maxTokens: 10 });
      assert.equal(result.text, "");
      assert.deepEqual(result.functionCalls, []);
    });

    await runCase("empty content preserves tool calls", async () => {
      queueResponse(completion({
        content: null,
        tool_calls: [{
          id: "call_offline_1",
          function: {
            name: "offline_test_tool",
            arguments: '{"ok":true}'
          }
        }]
      }));

      const result = await groq.generate("test", { maxTokens: 10 });
      assert.equal(result.text, "");
      assert.equal(result.functionCalls.length, 1);
      assert.equal(result.functionCalls[0].name, "offline_test_tool");
      assert.deepEqual(result.functionCalls[0].args, { ok: true });
    });

    await runCase("missing choices/message throws clear error", async () => {
      queueResponse({ choices: [] });
      await assert.rejects(
        () => groq.generate("test", { maxTokens: 10 }),
        /Groq returned no message/
      );

      queueResponse({ choices: [{ message: null }] });
      await assert.rejects(
        () => groq.generate("test", { maxTokens: 10 }),
        /Groq returned no message/
      );
    });

    assert.equal(apiCallCount, 6);
    assert.equal(responses.length, 0);
    console.log("MOCK_REQUEST_COUNT:", apiCallCount);
    console.log("EXTERNAL_API_CALLS: 0");
    console.log("PROVIDER_CONFIG_CHANGED: NO");
    console.log("RESULT: PASS");
  } catch (error) {
    console.error("RESULT: FAIL");
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.GROQ_API_KEY;
    } else {
      process.env.GROQ_API_KEY = originalApiKey;
    }
  }
})();
