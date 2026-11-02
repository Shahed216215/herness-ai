"use strict";

require("dotenv").config();

const assert = require("assert");
const http = require("http");

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

    req.end(payload);
  });
}

async function main() {
  // 1. Stage 5.2 HTTP regression
  const understanding =
    await request(
      "/api/admin/task-understanding/understand",
      "POST",
      {
        input:
          "Write a short research summary."
      }
    );

  assert.strictEqual(
    understanding.status,
    200
  );
  assert.strictEqual(
    understanding.data.success,
    true
  );
  assert.ok(
    understanding.data.task
  );

  // 2. Stage 5.3 simple planning
  const simple =
    await request(
      "/api/admin/task-planning/plan",
      "POST",
      {
        input:
          "Write a short research summary."
      }
    );

  assert.strictEqual(
    simple.status,
    200
  );
  assert.strictEqual(
    simple.data.success,
    true
  );
  assert.strictEqual(
    simple.data.decision,
    "PLAN_VALID"
  );
  assert.ok(
    simple.data.plan
  );
  assert.ok(
    simple.data.plan.subtasks.length >= 1
  );
  assert.strictEqual(
    simple.data.executionAllowed,
    false
  );
  assert.strictEqual(
    simple.data.planningOnly,
    true
  );

  // 3. Multi-step planning
  const multi =
    await request(
      "/api/admin/task-planning/plan",
      "POST",
      {
        input:
          "Research cybersecurity careers and then organize the findings into a report. Create a research summary and report."
      }
    );

  assert.strictEqual(
    multi.status,
    200
  );
  assert.strictEqual(
    multi.data.success,
    true
  );
  assert.ok(
    multi.data.plan.subtasks.length >= 3
  );
  assert.ok(
    multi.data.plan.subtasks.some(
      item =>
        item.dependencies.length > 0
    )
  );

  // 4. Missing requirement
  const missing =
    await request(
      "/api/admin/task-planning/plan",
      "POST",
      {
        input:
          "Analyze the dataset and create a report."
      }
    );

  assert.strictEqual(
    missing.status,
    200
  );
  assert.strictEqual(
    missing.data.decision,
    "BLOCK"
  );
  assert.strictEqual(
    missing.data.plan.feasibility,
    "blocked_missing_requirements"
  );
  assert.ok(
    missing.data.plan.missingRequirements.length >
      0
  );

  // 5. Impossible task
  const impossible =
    await request(
      "/api/admin/task-planning/plan",
      "POST",
      {
        input:
          "Teleport to another country and return the result."
      }
    );

  assert.strictEqual(
    impossible.status,
    200
  );
  assert.strictEqual(
    impossible.data.decision,
    "REJECT"
  );
  assert.strictEqual(
    impossible.data.plan.feasibility,
    "infeasible"
  );
  assert.strictEqual(
    impossible.data.executionAllowed,
    false
  );

  // 6. Validate endpoint
  const validation =
    await request(
      "/api/admin/task-planning/validate",
      "POST",
      {
        plan: multi.data.plan
      }
    );

  assert.strictEqual(
    validation.status,
    200
  );
  assert.strictEqual(
    validation.data.success,
    true
  );
  assert.strictEqual(
    validation.data.validation.valid,
    true
  );

  // 7. Invalid dependency
  const invalidPlan =
    JSON.parse(
      JSON.stringify(
        multi.data.plan
      )
    );

  invalidPlan.subtasks[1].dependencies = [
    "does-not-exist"
  ];

  const invalid =
    await request(
      "/api/admin/task-planning/validate",
      "POST",
      {
        plan: invalidPlan
      }
    );

  assert.strictEqual(
    invalid.status,
    400
  );
  assert.strictEqual(
    invalid.data.success,
    false
  );
  assert.strictEqual(
    invalid.data.validation.valid,
    false
  );
  assert.ok(
    invalid.data.validation.errors.some(
      error =>
        error.includes(
          "unknown dependency"
        )
    )
  );

  // 8. Re-planning
  const replanned =
    await request(
      "/api/admin/task-planning/replan",
      "POST",
      {
        input:
          "Research cybersecurity careers and create a report.",
        failureContext: {
          previousPlanId:
            multi.data.plan.id,
          previousVersion:
            multi.data.plan.version,
          failure:
            "The first research source was unavailable.",
          newInformation:
            "Use another reliable source instead."
        }
      }
    );

  assert.strictEqual(
    replanned.status,
    200
  );
  assert.strictEqual(
    replanned.data.success,
    true
  );
  assert.strictEqual(
    replanned.data.plan.version,
    2
  );
  assert.strictEqual(
    replanned.data.plan.parentPlanId,
    multi.data.plan.id
  );
  assert.strictEqual(
    replanned.data.executionAllowed,
    false
  );

  // 9. Explicit authorization boundary
  assert.strictEqual(
    simple.data.plan.executionAllowed,
    false
  );
  assert.strictEqual(
    multi.data.plan.executionAllowed,
    false
  );
  assert.strictEqual(
    replanned.data.plan.executionAllowed,
    false
  );

  console.log(
    "STAGE5_3_TASK_PLANNING_HTTP_E2E: PASS"
  );
}

main().catch(error => {
  console.error(
    "STAGE5_3_TASK_PLANNING_HTTP_E2E: FAIL"
  );
  console.error(
    error.stack || error
  );
  process.exitCode = 1;
});
