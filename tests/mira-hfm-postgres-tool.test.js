"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const tool = require("../tools/hfm-database-status");

test("database status tool rejects missing and non-admin trusted context", async () => {
  for (const context of [
    null,
    { status: "IDENTITY_UNAVAILABLE", actor: null },
    { status: "ACTOR_RESOLVED", actor: { role: "user", actorId: "mira:user:1" } },
    { status: "ACTOR_RESOLVED", actor: { role: "admin", actorId: "not-canonical" } }
  ]) {
    const result = JSON.parse(await tool.execute({}, context));
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.dataAccessed, false);
  }
});

test("verified admin receives only a safe unavailable status when DB is not configured", async () => {
  const context = {
    status: "ACTOR_RESOLVED",
    actor: {
      role: "admin",
      actorId: "mira:mira.admins:00000000-0000-4000-8000-000000000001",
      principal: { actorType: "HUMAN" }
    }
  };
  const result = JSON.parse(await tool.execute({}, context));
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.readOnly, true);
  assert.equal(JSON.stringify(result).includes("DATABASE_URL_NOT_CONFIGURED"), true);
});

console.log("HFM_DATABASE_STATUS_TOOL_TEST=PASS");
