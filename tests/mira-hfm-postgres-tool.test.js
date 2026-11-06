"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const tool = require("../tools/hfm-database-status");

const validAdminContext = {
  status: "ACTOR_RESOLVED",
  actor: {
    role: "admin",
    actorId: "mira:mira.admins:00000000-0000-4000-8000-000000000001",
    principal: {
      actorId: "mira:mira.admins:00000000-0000-4000-8000-000000000001",
      actorType: "HUMAN",
      authenticationMethod: "ADMIN_SUBJECT"
    }
  }
};

test("database status tool rejects missing and non-admin trusted context", async () => {
  for (const context of [
    null,
    { status: "IDENTITY_UNAVAILABLE", actor: null },
    { status: "ACTOR_RESOLVED", actor: { role: "user", actorId: "mira:mira.users:00000000-0000-4000-8000-000000000001" } },
    { status: "ACTOR_RESOLVED", actor: { role: "admin", actorId: "not-canonical" } }
  ]) {
    const result = JSON.parse(await tool.execute({}, context));
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.dataAccessed, false);
  }
});

test("database status tool requires the canonical admin issuer and authentication method", async () => {
  const rejected = [
    {
      ...validAdminContext,
      actor: {
        ...validAdminContext.actor,
        actorId: "mira:mira.users:00000000-0000-4000-8000-000000000001"
      }
    },
    {
      ...validAdminContext,
      actor: {
        ...validAdminContext.actor,
        principal: {
          ...validAdminContext.actor.principal,
          authenticationMethod: "USER_SESSION"
        }
      }
    },
    {
      ...validAdminContext,
      actor: {
        ...validAdminContext.actor,
        principal: {
          ...validAdminContext.actor.principal,
          actorType: "SERVICE"
        }
      }
    },
    {
      ...validAdminContext,
      actor: {
        ...validAdminContext.actor,
        principal: {
          ...validAdminContext.actor.principal,
          actorId: "mira:mira.users:00000000-0000-4000-8000-000000000001"
        }
      }
    }
  ];

  for (const context of rejected) {
    const result = JSON.parse(await tool.execute({}, context));
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.dataAccessed, false);
  }
});

test("verified canonical admin receives only a safe unavailable status when DB is not configured", async () => {
  const result = JSON.parse(await tool.execute({}, validAdminContext));
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.readOnly, true);
  assert.equal(JSON.stringify(result).includes("DATABASE_URL_NOT_CONFIGURED"), true);
});

console.log("HFM_DATABASE_STATUS_TOOL_TEST=PASS");
