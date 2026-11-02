"use strict";
const assert = require("node:assert/strict");
const { secureSdkFetch, ALLOWED_HOSTS } =
  require("../services/security/secure-sdk-fetch");

(async () => {
  assert(ALLOWED_HOSTS.has("api.openai.com"));
  assert(ALLOWED_HOSTS.has("api.groq.com"));
  assert(ALLOWED_HOSTS.has("generativelanguage.googleapis.com"));

  for (const url of [
    "http://api.openai.com/v1/responses",
    "https://127.0.0.1/v1/responses",
    "https://localhost/v1/responses",
    "https://attacker.example/v1/responses",
    "https://api.openai.com.evil.example/v1/responses",
    "https://user:pass@api.openai.com/v1/responses"
  ]) {
    await assert.rejects(
      () => secureSdkFetch(url, { method: "POST", body: "{}" }),
      undefined,
      `Expected blocked destination: ${url}`
    );
  }

  await assert.rejects(
    () => secureSdkFetch("https://api.openai.com/v1/responses", {
      method: "PUT",
      body: "{}"
    }),
    /method blocked/
  );

  await assert.rejects(
    () => secureSdkFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      redirect: "follow",
      body: "{}"
    }),
    /redirects are disabled/
  );

  console.log("SECURE_SDK_FETCH_POLICY_TESTS=PASS");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
