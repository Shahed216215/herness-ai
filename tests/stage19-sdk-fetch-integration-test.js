"use strict";
const assert = require("node:assert/strict");
const OpenAI = require("openai");
const Groq = require("groq-sdk");
const { secureSdkFetch } =
  require("../services/security/secure-sdk-fetch");

function fakeFetch() {
  throw new Error("Network must not be used in this wiring test");
}

for (const [name, SDK, options] of [
  ["OpenAI", OpenAI, { apiKey: "test-key", maxRetries: 0 }],
  ["Groq", Groq, { apiKey: "test-key", maxRetries: 0 }]
]) {
  const client = new SDK({ ...options, fetch: secureSdkFetch });
  assert.equal(client.fetch, secureSdkFetch);
  console.log(`${name}_CUSTOM_FETCH_WIRING=PASS`);
}

// Verify the SDK accepts a custom fetch callback independently of the
// production transport, without making an external request.
const openaiMock = new OpenAI({
  apiKey: "test-key",
  maxRetries: 0,
  fetch: fakeFetch
});
const groqMock = new Groq({
  apiKey: "test-key",
  maxRetries: 0,
  fetch: fakeFetch
});
assert.equal(openaiMock.fetch, fakeFetch);
assert.equal(groqMock.fetch, fakeFetch);
console.log("SDK_CUSTOM_FETCH_OVERRIDE=PASS");
console.log("EXTERNAL_NETWORK_REQUESTS=0");
