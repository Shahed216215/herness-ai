"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");

async function main() {
  const originalLoad = Module._load;
  const captured = [];

  Module._load = function(request, parent, isMain) {
    if (request === "./secure-provider-request" &&
        parent &&
        parent.filename.endsWith("/services/security/secure-sdk-fetch.js")) {
      return {
        secureProviderRequest: async (url, config, policy) => {
          captured.push({ url, config, policy });
          return {
            status: 200,
            data: { mock: "ok" },
            body: '{"mock":"ok"}'
          };
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let secureSdkFetch;
  try {
    delete require.cache[require.resolve("../services/security/secure-sdk-fetch")];
    ({ secureSdkFetch } = require("../services/security/secure-sdk-fetch"));
  } finally {
    Module._load = originalLoad;
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent?key=mock";
  const response = await secureSdkFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: "mock" }),
    redirect: "error"
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { mock: "ok" });
  assert.equal(captured.length, 1);
  assert.equal(new URL(captured[0].url).hostname,
    "generativelanguage.googleapis.com");
  assert.equal(captured[0].config.method, "POST");
  assert.equal(captured[0].policy.allowHttpErrors, true);

  await assert.rejects(
    secureSdkFetch("http://generativelanguage.googleapis.com/test", {
      method: "POST",
      redirect: "error"
    })
  );
  await assert.rejects(
    secureSdkFetch("https://example.invalid/test", {
      method: "POST",
      redirect: "error"
    })
  );

  console.log("GEMINI_HOST_TRANSPORT_ADAPTER=PASS");
  console.log("HTTP_REJECTION=PASS");
  console.log("UNAPPROVED_HOST_REJECTION=PASS");
  console.log("MOCK_TRANSPORT_EXTERNAL_REQUESTS=0");
}

main().catch(error => {
  console.error("SECURE_SDK_FETCH_TRANSPORT_TEST=FAIL");
  console.error(error.stack || error);
  process.exitCode = 1;
});
