"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");

async function main() {
  process.env.GEMINI_API_KEY = "stage19-test-key";

  const { secureSdkFetch } =
    require("../services/security/secure-sdk-fetch");

  const originalLoad = Module._load;
  let capturedOptions;
  let generateArgs;

  class MockGoogleGenAI {
    constructor(options) {
      capturedOptions = options;
      this.models = {
        generateContent: async args => {
          generateArgs = args;
          return { mock: true };
        }
      };
    }
  }

  Module._load = function(request, parent, isMain) {
    if (request === "@google/genai") {
      return { GoogleGenAI: MockGoogleGenAI };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let provider;
  try {
    delete require.cache[require.resolve("../providers/gemini")];
    provider = require("../providers/gemini");
  } finally {
    Module._load = originalLoad;
  }

  assert.equal(capturedOptions.httpOptions.timeout, 30000);
  assert.equal(capturedOptions.httpOptions.fetch, secureSdkFetch);
  const result = await provider.generate("stage19 local mock");
  assert.equal(result.mock, true);
  assert.equal(generateArgs.contents, "stage19 local mock");

  console.log("GEMINI_DOCUMENTED_FETCH_OPTION=PASS");
  console.log("GEMINI_PROVIDER_WIRING=PASS");
  console.log("GEMINI_GENERATE_MOCK=PASS");
}

main().catch(error => {
  console.error("GEMINI_WIRING_TEST=FAIL");
  console.error(error.stack || error);
  process.exitCode = 1;
});
