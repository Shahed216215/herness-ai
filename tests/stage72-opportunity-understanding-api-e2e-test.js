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
  const response = await fetch(
    `${BASE_URL}${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const body = await response.json();

  return {
    status: response.status,
    body
  };
}

async function main() {
  console.log(
    "STAGE 7.2 OPPORTUNITY UNDERSTANDING API E2E TEST"
  );

  const sourceId =
    `stage72-api-${Date.now()}`;

  const discovery =
    await request(
      "/api/admin/opportunities/discover",
      {
        method: "POST",
        body: JSON.stringify({
          source: "manual",
          sourceId,
          sourceUrl:
            `https://example.com/opportunity/${sourceId}`,
          title:
            "Research evidence analysis task",
          description:
            "Research a topic, analyze evidence, organize findings, and prepare a summary.",
          requirements: [
            "Research the topic",
            "Analyze evidence",
            "Organize findings"
          ],
          skills: [
            "Research"
          ]
        })
      }
    );

  assert.strictEqual(
    discovery.status,
    201
  );
  assert.strictEqual(
    discovery.body.success,
    true
  );

  const opportunity =
    discovery.body.opportunity;

  assert.ok(
    opportunity &&
    opportunity.opportunityId
  );

  console.log(
    "PASS: opportunity discovery API"
  );

  const before =
    await request(
      `/api/admin/opportunities/${opportunity.opportunityId}`
    );

  assert.strictEqual(
    before.status,
    200
  );

  const beforeOpportunity =
    before.body.opportunity;

  console.log(
    "PASS: opportunity detail before understanding"
  );

  const understanding =
    await request(
      `/api/admin/opportunities/${opportunity.opportunityId}/understand`,
      {
        method: "POST",
        body: "{}"
      }
    );

  assert.strictEqual(
    understanding.status,
    200
  );
  assert.strictEqual(
    understanding.body.success,
    true
  );

  const result =
    understanding.body;

  assert.strictEqual(
    result.opportunityId,
    opportunity.opportunityId
  );

  assert.ok(
    result.understanding
  );

  console.log(
    "PASS: opportunity understanding API"
  );

  const analyzed =
    result.understanding;

  assert.ok(
    Array.isArray(
      analyzed.requirements
    )
  );

  assert.ok(
    analyzed.requirements.length > 0
  );

  assert.ok(
    analyzed.requirementsAnalysis
  );

  assert.ok(
    analyzed.requirementsAnalysis.count >= 1
  );

  console.log(
    "PASS: requirements analysis"
  );

  assert.ok(
    Array.isArray(
      analyzed.skills
    )
  );

  assert.ok(
    analyzed.skills.length > 0
  );

  assert.ok(
    analyzed.skills.every(
      item =>
        typeof item.skill === "string" &&
        typeof item.status === "string"
    )
  );

  console.log(
    "PASS: skills analysis"
  );

  assert.ok(
    analyzed.effort
  );

  assert.ok(
    [
      "small",
      "medium",
      "large",
      "unknown"
    ].includes(
      analyzed.effort.level
    )
  );

  console.log(
    "PASS: effort analysis"
  );

  assert.ok(
    analyzed.difficulty
  );

  assert.ok(
    [
      "easy",
      "moderate",
      "hard",
      "very_hard",
      "unknown"
    ].includes(
      analyzed.difficulty.level
    )
  );

  console.log(
    "PASS: difficulty analysis"
  );

  assert.ok(
    analyzed.risk
  );

  assert.ok(
    [
      "low",
      "medium",
      "high",
      "critical",
      "unknown"
    ].includes(
      analyzed.risk.level
    )
  );

  assert.strictEqual(
    typeof analyzed.risk.requiresHumanApproval,
    "boolean"
  );

  console.log(
    "PASS: risk analysis"
  );

  assert.ok(
    analyzed.compatibilityProfile
  );

  assert.ok(
    [
      "compatible",
      "partially_compatible",
      "incompatible",
      "unknown"
    ].includes(
      analyzed.compatibilityProfile.status
    )
  );

  assert.strictEqual(
    typeof analyzed.compatibilityProfile.verified,
    "boolean"
  );

  console.log(
    "PASS: compatibility profile"
  );

  assert.ok(
    Array.isArray(
      analyzed.compatibilityProfile.matchedCapabilities
    )
  );

  assert.ok(
    Array.isArray(
      analyzed.compatibilityProfile.matchedSkills
    )
  );

  assert.ok(
    Array.isArray(
      analyzed.compatibilityProfile.missingCapabilities
    )
  );

  assert.ok(
    Array.isArray(
      analyzed.compatibilityProfile.missingSkills
    )
  );

  console.log(
    "PASS: compatibility details"
  );

  assert.strictEqual(
    result.executionAllowed,
    false
  );

  assert.strictEqual(
    result.understandingOnly,
    true
  );

  console.log(
    "PASS: understanding-only execution boundary"
  );

  const after =
    await request(
      `/api/admin/opportunities/${opportunity.opportunityId}`
    );

  assert.strictEqual(
    after.status,
    200
  );

  const afterOpportunity =
    after.body.opportunity;

  assert.strictEqual(
    afterOpportunity.opportunityId,
    beforeOpportunity.opportunityId
  );

  assert.strictEqual(
    afterOpportunity.title,
    beforeOpportunity.title
  );

  assert.strictEqual(
    afterOpportunity.description,
    beforeOpportunity.description
  );

  assert.strictEqual(
    afterOpportunity.sourceId,
    beforeOpportunity.sourceId
  );

  console.log(
    "PASS: understanding does not mutate core opportunity data"
  );

  console.log(
    "STAGE 7.2 OPPORTUNITY UNDERSTANDING API E2E PASS"
  );
}

main().catch(error => {
  console.error(
    "FAIL:",
    error.stack || error.message
  );
  process.exit(1);
});
