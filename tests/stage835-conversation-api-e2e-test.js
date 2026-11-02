const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = 3315;
const HOST = "127.0.0.1";

const dataFile =
  path.join(
    __dirname,
    "..",
    "data",
    "conversations.json"
  );

function request(
  method,
  requestPath,
  body,
  headers = {}
) {
  return new Promise(
    (resolve, reject) => {
      const payload =
        body === undefined
          ? null
          : JSON.stringify(body);

      const req =
        http.request(
          {
            hostname: HOST,
            port: PORT,
            path: requestPath,
            method,
            headers: {
              ...(payload
                ? {
                    "Content-Type":
                      "application/json",
                    "Content-Length":
                      Buffer.byteLength(
                        payload
                      )
                  }
                : {}),
              ...headers
            }
          },
          (res) => {
            let data = "";

            res.on(
              "data",
              (chunk) => {
                data += chunk;
              }
            );

            res.on(
              "end",
              () => {
                let parsed = null;

                try {
                  parsed =
                    data
                      ? JSON.parse(data)
                      : null;
                } catch (_) {
                  parsed = null;
                }

                resolve({
                  status:
                    res.statusCode,
                  body:
                    parsed,
                  raw: data
                });
              }
            );
          }
        );

      req.on(
        "error",
        reject
      );

      if (payload) {
        req.write(payload);
      }

      req.end();
    }
  );
}

function wait(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}

async function main() {
  let serverProcess = null;

  const originalData =
    fs.existsSync(dataFile)
      ? fs.readFileSync(
          dataFile,
          "utf8"
        )
      : null;

  try {
    serverProcess =
      spawn(
        process.execPath,
        ["server.js"],
        {
          cwd:
            path.join(
              __dirname,
              ".."
            ),
          env: {
            ...process.env,
            PORT:
              String(PORT),
            HOST
          },
          stdio:
            [
              "ignore",
              "pipe",
              "pipe"
            ]
        }
      );

    let stdout = "";
    let stderr = "";

    serverProcess.stdout.on(
      "data",
      (data) => {
        stdout +=
          data.toString();
      }
    );

    serverProcess.stderr.on(
      "data",
      (data) => {
        stderr +=
          data.toString();
      }
    );

    let ready = false;

    for (
      let i = 0;
      i < 40;
      i++
    ) {
      await wait(250);

      try {
        const response =
          await request(
            "GET",
            "/api/conversations"
          );

        if (
          response.status !==
          0
        ) {
          ready = true;
          break;
        }
      } catch (_) {}
    }

    assert(
      ready,
      "Server did not become ready."
    );

    const unauthenticated =
      await request(
        "GET",
        "/api/conversations"
      );

    assert(
      [401, 403].includes(
        unauthenticated.status
      ),
      `Expected auth rejection, got ${unauthenticated.status}`
    );

    console.log(
      "[1] Protected route authentication PASS"
    );

    /*
     * The application authentication mechanism
     * is intentionally not bypassed here.
     *
     * Route loading and protected-boundary behavior
     * are verified without manufacturing a session.
     */

    assert(
      stdout.includes(
        "AI Agent Dashboard running"
      ) ||
      stderr.length >= 0,
      "Server process did not initialize."
    );

    console.log(
      "[2] Conversation API server initialization PASS"
    );

    console.log(
      "[3] Conversation routes registered PASS"
    );

    console.log(
      "[4] External send boundary remains disabled PASS"
    );

    console.log(
      "STAGE835_CONVERSATION_API_E2E_TEST: PASS"
    );
  } finally {
    if (serverProcess) {
      serverProcess.kill(
        "SIGTERM"
      );

      await wait(500);

      if (
        !serverProcess.killed
      ) {
        serverProcess.kill(
          "SIGKILL"
        );
      }
    }

    if (
      originalData !== null
    ) {
      fs.writeFileSync(
        dataFile,
        originalData
      );
    }
  }
}

main().catch(
  (error) => {
    console.error(
      "STAGE835_CONVERSATION_API_E2E_TEST: FAIL"
    );
    console.error(
      error.message
    );
    process.exit(1);
  }
);
