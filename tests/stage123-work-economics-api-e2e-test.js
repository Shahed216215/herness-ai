"use strict";

const assert = require("assert");
require("dotenv").config({ quiet: true });
const ADMIN_TOKEN = process.env.MIRA_ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  throw new Error("MIRA_ADMIN_TOKEN is required; value is not printed");
}
const http = require("http");
const { spawn } = require("child_process");

const PORT =
  39000 + Math.floor(
    Math.random() * 1000
  );

function request(path) {
  return new Promise(
    (resolve, reject) => {
      const req =
        http.request(
          {
            host: "127.0.0.1",
            port: PORT,
            path,
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${ADMIN_TOKEN}`
            }
          },
          res => {
            let body = "";

            res.on(
              "data",
              chunk => {
                body += chunk;
              }
            );

            res.on(
              "end",
              () => {
                let json;

                try {
                  json =
                    JSON.parse(body);
                } catch (error) {
                  return reject(
                    new Error(
                      "API response was not valid JSON"
                    )
                  );
                }

                resolve({
                  status:
                    res.statusCode,
                  body: json
                });
              }
            );
          }
        );

      req.on(
        "error",
        reject
      );

      req.end();
    }
  );
}

function waitForServer(child) {
  return new Promise(
    (resolve, reject) => {
      let settled = false;
      let output = "";

      const timer =
        setTimeout(
          () => {
            if (!settled) {
              settled = true;
              reject(
                new Error(
                  "Server did not start within timeout.\n" +
                  output.slice(-4000)
                )
              );
            }
          },
          12000
        );

      child.stdout.on(
        "data",
        chunk => {
          output += chunk.toString();

          if (
            !settled &&
            output.includes(
              "AI Agent Dashboard running"
            )
          ) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        }
      );

      child.stderr.on(
        "data",
        chunk => {
          output += chunk.toString();
        }
      );

      child.on(
        "exit",
        code => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(
              new Error(
                `Server exited before startup. code=${code}\n` +
                output.slice(-4000)
              )
            );
          }
        }
      );
    }
  );
}

async function main() {
  console.log(
    "\n=== STAGE 12.3 WORK ECONOMICS API E2E ==="
  );

  const child =
    spawn(
      process.execPath,
      ["server.js"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: String(PORT)
        },
        stdio: [
          "ignore",
          "pipe",
          "pipe"
        ]
      }
    );

  try {
    await waitForServer(child);

    const result =
      await request(
        "/api/admin/work-economics"
      );

    assert.strictEqual(
      result.status,
      200
    );

    const body =
      result.body;

    assert.ok(body);

    assert.strictEqual(
      body.ok,
      true
    );

    assert.strictEqual(
      body.engine,
      "mira-work-economics"
    );

    assert.strictEqual(
      body.version,
      "12.3.0"
    );

    assert.strictEqual(
      body.accountingOnly,
      true
    );

    assert.strictEqual(
      body.moneyTransferEnabled,
      false
    );

    assert.strictEqual(
      body.financialCommitmentEnabled,
      false
    );

    assert.ok(
      Number.isInteger(
        body.recordCount
      )
    );

    assert.ok(
      body.dataCoverage &&
      typeof body.dataCoverage ===
        "object"
    );

    for (
      const field of [
        "workTypes",
        "skills",
        "tools",
        "outcomes",
        "insights"
      ]
    ) {
      assert.ok(
        Array.isArray(body[field]),
        `${field} must be an array`
      );
    }

    assert.ok(
      body.rework &&
      typeof body.rework === "object" &&
      !Array.isArray(body.rework),
      "rework must be an object"
    );

    assert.ok(
      Number.isInteger(body.rework.totalWork),
      "rework.totalWork must be an integer"
    );

    assert.ok(
      Number.isInteger(body.rework.totalRework),
      "rework.totalRework must be an integer"
    );

    assert.ok(
      Array.isArray(body.rework.byWorkType),
      "rework.byWorkType must be an array"
    );

    console.log(
      "API_STATUS: PASS"
    );

    console.log(
      "API_CONTRACT: PASS"
    );

    console.log(
      "WORK_ECONOMICS_PAYLOAD: PASS"
    );

    console.log(
      "ACCOUNTING_ONLY: PASS"
    );

    console.log(
      "NO_MONEY_TRANSFER: PASS"
    );

    console.log(
      "NO_FINANCIAL_COMMITMENT: PASS"
    );

    console.log(
      "STAGE12_3_API_E2E: PASS"
    );
  } finally {
    child.kill("SIGTERM");

    await new Promise(
      resolve => {
        const timer =
          setTimeout(
            () => {
              try {
                child.kill(
                  "SIGKILL"
                );
              } catch (_) {}
              resolve();
            },
            2000
          );

        child.on(
          "exit",
          () => {
            clearTimeout(timer);
            resolve();
          }
        );
      }
    );
  }
}

main().catch(
  error => {
    console.error(
      "STAGE12_3_API_E2E: FAIL"
    );

    console.error(
      error.stack || error
    );

    process.exitCode = 1;
  }
);
