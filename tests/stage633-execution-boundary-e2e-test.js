"use strict";

require("dotenv").config();

const assert = require("assert");
const http = require("http");
const Module = require("module");
const path = require("path");

const accessToken =
  process.env.MIRA_ACCESS_TOKEN;

if (!accessToken) {
  throw new Error(
    "MIRA_ACCESS_TOKEN is not configured."
  );
}

const aiPath =
  require.resolve(
    "../services/ai"
  );

const originalAiModule =
  require.cache[aiPath];

let generateQueue = [];
let testServer = null;

require.cache[aiPath] = {
  id: aiPath,
  filename: aiPath,
  loaded: true,
  exports: {
    generate: async (_command, _declarations, messages = []) => {
      if (generateQueue.length === 0) {
        throw new Error(
          "Stage 6.3.3 mock generate queue is empty."
        );
      }

      const response = generateQueue.shift();

      if (response && response.__stage633EchoLastToolResult === true) {
        const lastTool = [...messages]
          .reverse()
          .find(item => item && item.role === "tool");

        return {
          text: lastTool
            ? String(lastTool.content || "")
            : "No tool result was returned.",
          functionCalls: []
        };
      }

      return response;
    },

    getProviderRuntimeStatus: () => ({
      provider:
        "stage633-test",
      model:
        "stage633-test-model"
    })
  }
};

function setGenerateQueue(
  responses
) {
  generateQueue =
    Array.isArray(responses)
      ? responses.slice()
      : [];
}

function request(
  pathName,
  method = "GET",
  body = null,
  token = accessToken
) {
  return new Promise(
    (resolve, reject) => {
      const payload =
        body === null
          ? null
          : JSON.stringify(body);

      const req =
        http.request(
          {
            hostname:
              "127.0.0.1",
            port: 3000,
            path:
              pathName,
            method,
            headers: {
              Authorization:
                `Bearer ${token}`,

              ...(payload
                ? {
                    "Content-Type":
                      "application/json",
                    "Content-Length":
                      Buffer.byteLength(
                        payload
                      )
                  }
                : {})
            }
          },
          res => {
            let responseBody =
              "";

            res.on(
              "data",
              chunk => {
                responseBody += chunk;
              }
            );

            res.on(
              "end",
              () => {
                let data = null;

                try {
                  data =
                    JSON.parse(
                      responseBody
                    );
                } catch {}

                resolve({
                  status:
                    res.statusCode,
                  data
                });
              }
            );
          }
        );

      req.on(
        "error",
        reject
      );

      req.end(payload);
    }
  );
}

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

async function main() {
  /*
   * Load the real server only after
   * replacing services/ai with the
   * deterministic Stage 6.3.3 mock.
   */
  const originalListen = http.Server.prototype.listen;
  try {
    http.Server.prototype.listen = function (...args) {
      testServer = this;
      return originalListen.apply(this, args);
    };
    require("../server");
  } finally {
    http.Server.prototype.listen = originalListen;
  }

  await sleep(250);

  if (!testServer || !testServer.listening) {
    throw new Error("Stage 6.3.3 test server did not start.");
  }

  /*
   * 1. LOW-RISK AUTONOMOUS TOOL
   *
   * The HTTP /api/agent route must reach
   * executeWork() and the calculator must
   * execute successfully.
   */
  setGenerateQueue([
    {
      text: "",
      functionCalls: [
        {
          id:
            "stage633-calculator-1",
          name:
            "calculator",
          args: {
            expression:
              "2 + 3"
          }
        }
      ],
      message: {
        role:
          "assistant",
        content:
          null,
        tool_calls: [
          {
            id:
              "stage633-calculator-1",
            type:
              "function",
            function: {
              name:
                "calculator",
              arguments:
                JSON.stringify({
                  expression:
                    "2 + 3"
                })
            }
          }
        ]
      }
    },

    {
      text:
        "The calculation is 5.",
      functionCalls: []
    }
  ]);

  const allowed =
    await request(
      "/api/agent",
      "POST",
      {
        command:
          "Calculate 2 + 3."
      }
    );

  assert.strictEqual(
    allowed.status,
    200
  );

  assert.strictEqual(
    allowed.data.success,
    true
  );

  assert.strictEqual(
    allowed.data.result,
    "The calculation is 5."
  );

  /*
   * 2. APPROVAL-REQUIRED TOOL
   *
   * The model asks for memory_restore.
   * /api/agent must NOT call the tool
   * directly. Stage 6.3.1 must deny it.
   */
  setGenerateQueue([
    {
      text: "",
      functionCalls: [
        {
          id:
            "stage633-memory-restore-1",
          name:
            "memory_restore",
          args: {}
        }
      ],
      message: {
        role:
          "assistant",
        content:
          null,
        tool_calls: [
          {
            id:
              "stage633-memory-restore-1",
            type:
              "function",
            function: {
              name:
                "memory_restore",
              arguments:
                "{}"
            }
          }
        ]
      }
    },
    {
      __stage633EchoLastToolResult: true
    }
  ]);

  const denied =
    await request(
      "/api/agent",
      "POST",
      {
        command:
          "Restore memory."
      }
    );

  /*
   * The route itself is authenticated,
   * but execution must be denied by the
   * autonomous work authorization layer.
   */
  assert.ok(
    denied.data
  );

  const serializedDenied =
    JSON.stringify(
      denied.data
    );

  assert.ok(
    serializedDenied.includes(
      "approval_required"
    ) ||
    serializedDenied.includes(
      "autonomous"
    ) ||
    serializedDenied.includes(
      "authorization"
    ),
    "Expected Stage 6.3 authorization denial."
  );

  /*
   * 3. CONFIRMATION MUST NOT BYPASS
   *    AUTONOMOUS AUTHORIZATION.
   */
  setGenerateQueue([
    {
      text: "",
      functionCalls: [
        {
          id:
            "stage633-memory-restore-2",
          name:
            "memory_restore",
          args: {
            confirm:
              true
          }
        }
      ],
      message: {
        role:
          "assistant",
        content:
          null,
        tool_calls: [
          {
            id:
              "stage633-memory-restore-2",
            type:
              "function",
            function: {
              name:
                "memory_restore",
              arguments:
                JSON.stringify({
                  confirm:
                    true
                })
            }
          }
        ]
      }
    },
    {
      __stage633EchoLastToolResult: true
    }
  ]);

  const confirmationAttempt =
    await request(
      "/api/agent",
      "POST",
      {
        command:
          "Restore memory with confirmation."
      }
    );

  assert.ok(
    confirmationAttempt.data
  );

  const serializedConfirmation =
    JSON.stringify(
      confirmationAttempt.data
    );

  assert.ok(
    serializedConfirmation.includes(
      "approval_required"
    ) ||
    serializedConfirmation.includes(
      "autonomous"
    ) ||
    serializedConfirmation.includes(
      "authorization"
    ),
    "Confirmation must not bypass Stage 6.3 authorization."
  );

  /*
   * 4. STATIC EXECUTION-BOUNDARY AUDIT
   *
   * server.js must not contain an active
   * direct runTool() call or tool-runner import.
   */
  const fs =
    require("fs");

  const serverSource =
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "server.js"
      ),
      "utf8"
    );

  assert.ok(
    !serverSource.includes(
      'require("./services/tool-runner")'
    ),
    "server.js must not import runTool directly."
  );

  assert.ok(
    !/\brunTool\s*\(/.test(
      serverSource
    ),
    "server.js must not directly invoke runTool()."
  );

  assert.ok(
    serverSource.includes(
      'require("./services/mira-work-execution-engine")'
    ),
    "server.js must use the work execution engine."
  );

  assert.ok(
    serverSource.includes(
      "await executeWork("
    ),
    "server.js must route agent tool calls through executeWork()."
  );

  console.log(
    "PASS: /api/agent autonomous tool execution passed through executeWork."
  );

  console.log(
    "PASS: approval-required tool was blocked by Stage 6.3 authorization."
  );

  console.log(
    "PASS: explicit confirmation did not bypass Stage 6.3 authorization."
  );

  console.log(
    "PASS: server.js has no direct runTool execution boundary bypass."
  );

  console.log(
    "STAGE6_3_3_EXECUTION_BOUNDARY_E2E_TEST: PASS"
  );
}

main()
  .catch(error => {
    console.error(
      "STAGE6_3_3_EXECUTION_BOUNDARY_E2E_TEST: FAIL"
    );

    console.error(
      error.stack ||
        error.message
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (testServer && testServer.listening) {
        await new Promise((resolve, reject) => {
          testServer.close(error => error ? reject(error) : resolve());
        });
        console.log("PASS: Stage 6.3.3 test server closed.");
      }
    } catch (error) {
      console.error("TEST_SERVER_CLEANUP_FAILED:", error.message);
      process.exitCode = 1;
    }

    if (
      originalAiModule
    ) {
      require.cache[aiPath] =
        originalAiModule;
    } else {
      delete require.cache[
        aiPath
      ];
    }
  });
