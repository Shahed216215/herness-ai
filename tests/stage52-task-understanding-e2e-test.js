"use strict";

const assert = require("assert");
const http = require("http");
const dotenv = require("dotenv");

dotenv.config({
  path: ".env"
});

const token = process.env.MIRA_ADMIN_TOKEN;

if (!token) {
  throw new Error(
    "MIRA_ADMIN_TOKEN is not configured."
  );
}

function request(
  path,
  method = "GET",
  body = null
) {
  return new Promise((resolve, reject) => {
    const payload =
      body === null
        ? null
        : JSON.stringify(body);

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path,
        method,
        headers: {
          Authorization:
            `Bearer ${token}`,
          ...(payload
            ? {
                "Content-Type":
                  "application/json",
                "Content-Length":
                  Buffer.byteLength(payload)
              }
            : {})
        }
      },
      res => {
        let responseBody = "";

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
                JSON.parse(responseBody);
            } catch {}

            resolve({
              status: res.statusCode,
              data
            });
          }
        );
      }
    );

    req.on("error", reject);

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

async function main() {
  const result = await request(
    "/api/admin/task-understanding/understand",
    "POST",
    {
      input:
        "Research cybersecurity careers using reliable sources and organize the findings. Create a research summary and report by tomorrow. This is a medium difficulty task."
    }
  );

  assert.strictEqual(
    result.status,
    200,
    `Expected HTTP 200, received ${result.status}`
  );

  assert.strictEqual(
    result.data?.success,
    true,
    "API success should be true."
  );

  const task = result.data?.task;

  assert.ok(
    task,
    "Structured task should exist."
  );

  assert.strictEqual(
    task.type,
    "research",
    "Task type should be research."
  );

  assert.ok(
    task.requiredSkills.includes("research"),
    "Research skill should be required."
  );

  assert.strictEqual(
    task.difficulty,
    "medium",
    "Difficulty should be medium."
  );

  assert.strictEqual(
    task.risk,
    "low",
    "Cybersecurity career research should be low risk."
  );

  assert.strictEqual(
    result.data?.executionAllowed,
    false,
    "Execution must remain disabled in Stage 5.2."
  );

  assert.strictEqual(
    result.data?.understandingOnly,
    true,
    "Stage 5.2 must remain understanding-only."
  );

  assert.strictEqual(
    result.data?.readiness?.ready,
    true,
    "Verified research capability and skill evidence should satisfy readiness; Stage 5.2 still cannot execute."
  );

  assert.ok(
    Array.isArray(
      result.data?.capabilityMatches
    ),
    "Capability matches should be returned."
  );

  const researchMatch =
    result.data.capabilityMatches.find(
      item =>
        item.skill === "research"
    );

  assert.ok(
    researchMatch,
    "Research capability match should exist."
  );

  assert.strictEqual(
    researchMatch.capabilityVerified,
    true,
    "Structured Research capability should be verified."
  );

  assert.strictEqual(
    researchMatch.skillVerified,
    true,
    "Registered Research skill has verified evidence."
  );

  assert.strictEqual(
    researchMatch.verified,
    true,
    "Research match should be verified when capability and skill evidence are verified."
  );

  console.log(
    "STAGE5_2_TASK_UNDERSTANDING_E2E: PASS"
  );
}

main().catch(error => {
  console.error(
    "STAGE5_2_TASK_UNDERSTANDING_E2E: FAIL"
  );

  console.error(error);

  process.exitCode = 1;
});
