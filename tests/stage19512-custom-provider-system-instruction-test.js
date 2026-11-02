"use strict";

const assert = require("assert");
const path = require("path");

const root = process.cwd();
const marker = "MIRA_SYSTEM_INSTRUCTION_TEST_MARKER";
const prompt = "SAFE_USER_PROMPT_TEST";
const captured = [];

const securityModule = path.join(
  root,
  "services/security/secure-provider-request.js"
);

require.cache[securityModule] = {
  id: securityModule,
  filename: securityModule,
  loaded: true,
  exports: {
    secureProviderRequest: async (url, options, policy) => {
      captured.push({ url, options, policy });
      return { data: { text: "mock-response" } };
    }
  }
};

(async () => {
  const providers = [1, 2, 3, 4, 5];

  for (const n of providers) {
    process.env[`CUSTOM_PROVIDER${n}_URL`] =
      `https://mock-provider-${n}.invalid/api`;
    delete process.env[`CUSTOM_PROVIDER${n}_KEY`];
    process.env.MIRA_ALLOW_PRIVATE_CUSTOM_PROVIDER_URLS = "false";

    const file = path.join(
      root,
      `providers/custom/provider${n}.js`
    );

    delete require.cache[require.resolve(file)];
    const provider = require(file);

    const result = await provider.generate(prompt, {
      systemInstruction: marker,
      model: "mock-model"
    });

    assert.strictEqual(result.text, "mock-response");
    assert.strictEqual(captured.length, n);

    const request = captured[n - 1];
    const data = request.options.data;

    assert.strictEqual(data.prompt, prompt);
    assert.strictEqual(data.systemInstruction, marker);
    assert.deepStrictEqual(data.messages, [
      { role: "system", content: marker },
      { role: "user", content: prompt }
    ]);

    assert.strictEqual(request.url, process.env[`CUSTOM_PROVIDER${n}_URL`]);
    assert.strictEqual(request.policy.allowPrivate, false);

    console.log(`PASS custom-provider-${n}: system instruction preserved`);
  }

  assert.strictEqual(captured.length, 5);
  console.log("MOCK_REQUEST_COUNT=5");
  console.log("EXTERNAL_API_CALLS=0");
  console.log("CUSTOM_PROVIDER_CONTRACT=PASS");
})().catch(error => {
  console.error("CUSTOM_PROVIDER_CONTRACT=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
