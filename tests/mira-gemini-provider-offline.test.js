"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");

let capturedRequest = null;
let capturedClientOptions = null;

class MockGoogleGenAI {
  constructor(options) {
    capturedClientOptions = options;
    this.models = {
      generateContent: async request => {
        capturedRequest = request;
        return {
          text: "Tool result received.",
          functionCalls: [{
            name: "knowledge_search",
            args: { query: "Mira deployment" }
          }]
        };
      }
    };
  }
}

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "@google/genai") {
    return { GoogleGenAI: MockGoogleGenAI };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let provider;
try {
  provider = require("../providers/gemini");
} finally {
  Module._load = originalLoad;
}

(async () => {
  const result = await provider.generate("fallback prompt", {
    model: "offline-test-model",
    systemInstruction: "Mira system rules",
    tools: [{
      name: "knowledge_search",
      description: "Search stored knowledge",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } }
      }
    }],
    messages: [
      { role: "user", content: "Find Mira deployment notes." },
      {
        role: "assistant",
        content: "",
        functionCalls: [{
          id: "prior-call",
          name: "knowledge_search",
          args: { query: "Mira" }
        }]
      },
      {
        role: "tool",
        tool_call_id: "prior-call",
        name: "knowledge_search",
        content: "{\"success\":true,\"count\":2}"
      },
      { role: "user", content: "Now summarize those notes." }
    ]
  });

  assert.ok(capturedClientOptions);
  assert.equal(capturedRequest.model, "offline-test-model");
  assert.equal(capturedRequest.contents.length, 4);
  assert.equal(capturedRequest.contents[1].role, "model");
  assert.equal(capturedRequest.contents[2].parts[0].functionResponse.name, "knowledge_search");
  assert.equal(capturedRequest.contents[2].parts[0].functionResponse.response.count, 2);
  assert.equal(capturedRequest.config.systemInstruction, "Mira system rules");
  assert.equal(capturedRequest.config.tools[0].functionDeclarations[0].name, "knowledge_search");
  assert.equal(result.text, "Tool result received.");
  assert.equal(result.functionCalls[0].name, "knowledge_search");
  assert.ok(result.functionCalls[0].id.startsWith("gemini-response-"));

  console.log("PASS: Gemini provider receives the complete multi-turn conversation.");
  console.log("PASS: Gemini provider returns normalized function calls without live network access.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
