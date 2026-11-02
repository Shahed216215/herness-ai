"use strict";

const assert = require("assert");
require("dotenv").config();

const token = process.env.MIRA_ADMIN_TOKEN;

if (!token) {
  throw new Error(
    "MIRA_ADMIN_TOKEN is not configured."
  );
}

const BASE_URL = "http://127.0.0.1:3000";

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const body = await response.json();

  return {
    status: response.status,
    body
  };
}

async function main() {
  console.log("STAGE 7.1-F OPPORTUNITY API E2E TEST");

  const listBefore =
    await request("/api/admin/opportunities");

  assert.strictEqual(listBefore.status, 200);
  assert.strictEqual(listBefore.body.success, true);

  console.log("PASS: opportunity list API");

  const sourceId = `stage71-api-${Date.now()}`;

  const discovery =
    await request("/api/admin/opportunities/discover", {
      method: "POST",
      body: JSON.stringify({
        source: "manual",
        sourceId,
        sourceUrl:
          `https://example.com/opportunity/${sourceId}`,
        title: "Research data analysis task",
        description:
          "Analyze research data and prepare findings.",
        requirements: [
          "Research",
          "Data analysis"
        ],
        skills: [
          "Research",
          "Data"
        ]
      })
    });

  assert.strictEqual(discovery.status, 201);
  assert.strictEqual(discovery.body.success, true);

  const opportunity =
    discovery.body.opportunity;

  assert.ok(opportunity && opportunity.opportunityId);

  console.log("PASS: opportunity discovery API");

  const duplicate =
    await request("/api/admin/opportunities/discover", {
      method: "POST",
      body: JSON.stringify({
        source: "manual",
        sourceId,
        sourceUrl: opportunity.sourceUrl,
        title: opportunity.title,
        description: opportunity.description,
        requirements: opportunity.requirements,
        skills: opportunity.skills
      })
    });

  assert.strictEqual(duplicate.status, 409);
  assert.strictEqual(
    duplicate.body.code,
    "DUPLICATE_OPPORTUNITY"
  );

  console.log("PASS: duplicate discovery protection");

  const get =
    await request(
      `/api/admin/opportunities/${opportunity.opportunityId}`
    );

  assert.strictEqual(get.status, 200);
  assert.strictEqual(
    get.body.opportunity.id,
    opportunity.id
  );

  console.log("PASS: opportunity detail API");

  const evaluation =
    await request(
      `/api/admin/opportunities/${opportunity.opportunityId}/evaluate`,
      {
        method: "POST",
        body: "{}"
      }
    );

  assert.strictEqual(evaluation.status, 200);

  const evaluated =
    evaluation.body.opportunity;

  assert.strictEqual(
    evaluated.status,
    "risk_evaluated"
  );

  assert.ok(evaluated.capabilityMatch);
  assert.ok(evaluated.risk);

  console.log(
    "PASS: capability match and risk evaluation API"
  );

  assert.strictEqual(
    evaluated.governance.externalActionAllowed,
    false
  );
  assert.strictEqual(
    evaluated.governance.executionAllowed,
    false
  );
  assert.strictEqual(
    evaluated.governance.acceptanceAllowed,
    false
  );
  assert.strictEqual(
    evaluated.governance.paymentAllowed,
    false
  );
  assert.strictEqual(
    evaluated.governance.contractAllowed,
    false
  );

  console.log(
    "PASS: opportunity governance boundary"
  );

  const listAfter =
    await request("/api/admin/opportunities");

  assert.strictEqual(listAfter.status, 200);

  assert.ok(
    listAfter.body.opportunities.some(
      item => item.opportunityId === opportunity.opportunityId
    )
  );

  console.log(
    "PASS: evaluated opportunity persisted"
  );

  console.log(
    "STAGE 7.1-F OPPORTUNITY API E2E PASS"
  );
}

main().catch(error => {
  console.error("FAIL:", error.message);
  process.exit(1);
});
