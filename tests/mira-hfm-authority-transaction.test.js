"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { executeWithConsumedAuthority, hasOperationPermission } =
  require("../services/mira-hfm-authority-transaction");

const actorId = "mira:mira.users:user-uuid";
const verifiedPrincipal = (() => {
  const now = Date.now();
  return { verified: true, issuer: "mira.users", subject: "user-uuid", actorType: "HUMAN",
    authenticationMethod: "USER_SESSION", authenticationRef: "session-ref",
    authenticatedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600000).toISOString() };
})();
const run = options => executeWithConsumedAuthority({ verifiedPrincipal, ...options });

const request = Object.freeze({
  authorityId: "auth-001",
  projectId: "project-001",
  operation: "memory.write",
  resource: "memory:item-001",
  purpose: "approved test write",
  requestId: "request-001"
});

function fixture(overrides = {}) {
  const calls = [];
  const owner = { project_id: request.projectId, owner_actor_id: "mira:mira.users:owner", status: "ACTIVE", revision: 3 };
  const membership = {
    membership_id: "member-001", project_id: request.projectId, actor_id: actorId,
    permissions: { operations: ["memory.write", "memory.read"] }, status: "ACTIVE",
    revision: 7, valid_from: "2026-11-01T00:00:00Z", expires_at: null
  };
  const authority = {
    authority_id: request.authorityId, project_id: request.projectId, actor_id: actorId,
    operation: request.operation, resource: request.resource, purpose: request.purpose,
    request_id: request.requestId, membership_revision: 7, owner_revision: 3,
    status: "ISSUED", approval_ref: "approval-001",
    valid_from: "2026-11-06T00:00:00Z", expires_at: "2026-11-07T00:00:00Z"
  };
  Object.assign(owner, overrides.owner || {});
  Object.assign(membership, overrides.membership || {});
  Object.assign(authority, overrides.authority || {});
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM mira_hfm.project_owners")) return { rows: overrides.noOwner ? [] : [owner] };
      if (sql.startsWith("SELECT (status = 'ACTIVE'")) {
        return { rows: [{ membership_valid: !overrides.membershipExpiresAtCommit }] };
      }
      if (sql.includes("FROM mira_hfm.project_memberships")) return { rows: overrides.noMembership ? [] : [membership] };
      if (sql.includes("FROM mira_hfm.operation_authorities")) return { rows: overrides.noAuthority ? [] : [authority] };
      if (sql.startsWith("UPDATE mira_hfm.operation_authorities")) {
        return { rowCount: overrides.consumeFails ? 0 : 1, rows: overrides.consumeFails ? [] : [{ authority_id: authority.authority_id }] };
      }
      if (sql.startsWith("INSERT INTO mira_hfm.authority_audit_events")) return { rowCount: 1, rows: [] };
      return { rowCount: 1, rows: [], command: "OK" };
    },
    release() { calls.push({ sql: "RELEASE" }); }
  };
  return { calls, client, pool: { async connect() { return client; } } };
}

test("permission contract denies missing or malformed operation grants", () => {
  assert.equal(hasOperationPermission({ operations: ["memory.write"] }, "memory.write"), true);
  assert.equal(hasOperationPermission({ operations: ["memory.read"] }, "memory.write"), false);
  assert.equal(hasOperationPermission({ operations: "*" }, "memory.write"), false);
  assert.equal(hasOperationPermission(null, "memory.write"), false);
});

test("authorized operation locks owner, membership, authority; consumes and audits in same transaction", async () => {
  const f = fixture();
  let callbackClient;
  const result = await run({
    pool: f.pool, request,
    async perform(client, context) {
      callbackClient = client;
      assert.equal(context.actorId, actorId);
      await client.query("INSERT INTO protected_hfm_test_table (project_id) VALUES ($1)", [context.projectId]);
      return "stored";
    }
  });
  assert.deepEqual(result, { status: "AUTHORIZED_AND_COMMITTED", value: "stored" });
  assert.equal(callbackClient, f.client);
  const sql = f.calls.filter(x => x.sql !== "RELEASE").map(x => x.sql);
  const ownerLock = sql.findIndex(x => x.includes("FROM mira_hfm.project_owners"));
  const membershipLock = sql.findIndex(x => x.includes("FROM mira_hfm.project_memberships"));
  const authorityLock = sql.findIndex(x => x.includes("FROM mira_hfm.operation_authorities"));
  const consume = sql.findIndex(x => x.startsWith("UPDATE mira_hfm.operation_authorities"));
  const audit = sql.findIndex(x => x.startsWith("INSERT INTO mira_hfm.authority_audit_events"));
  const protectedWrite = sql.findIndex(x => x.startsWith("INSERT INTO protected_hfm_test_table"));
  assert.ok(sql[0].startsWith("BEGIN ISOLATION LEVEL SERIALIZABLE"));
  assert.ok(ownerLock < membershipLock && membershipLock < authorityLock);
  assert.ok(authorityLock < consume && consume < audit && audit < protectedWrite);
  assert.ok(sql.includes("COMMIT"));
  assert.ok(sql.some(x => x.includes("valid_from <= clock_timestamp()") &&
    x.includes("(expires_at IS NULL OR expires_at > clock_timestamp())")));
  assert.ok(sql.some(x => x.includes("FOR UPDATE")));
  const finalMembershipCheck = sql.findIndex(x => x.startsWith("SELECT (status = 'ACTIVE'"));
  const commit = sql.findIndex(x => x === "COMMIT");
  assert.ok(protectedWrite < finalMembershipCheck && finalMembershipCheck < commit);
});

test("scope mismatch, stale revisions, missing rows and ungranted operation fail closed", async t => {
  const cases = [
    [{ noOwner: true }, request, "HFM_PROJECT_OWNER_NOT_ACTIVE"],
    [{ noMembership: true }, request, "HFM_PROJECT_MEMBERSHIP_NOT_ACTIVE"],
    [{ membership: { permissions: { operations: ["memory.read"] } } }, request, "HFM_OPERATION_NOT_GRANTED"],
    [{ authority: { operation: "knowledge.read" } }, request, "HFM_AUTHORITY_SCOPE_MISMATCH"],
    [{ authority: { resource: "memory:other" } }, request, "HFM_AUTHORITY_SCOPE_MISMATCH"],
    [{ authority: { purpose: "different purpose" } }, request, "HFM_AUTHORITY_SCOPE_MISMATCH"],
    [{ owner: { revision: 4 } }, request, "HFM_AUTHORITY_REVISION_STALE"],
    [{ membership: { revision: 8 } }, request, "HFM_AUTHORITY_REVISION_STALE"],
    [{ noAuthority: true }, request, "HFM_AUTHORITY_MISSING_OR_ALREADY_USED"],
    [{ authority: { status: "CONSUMED" } }, request, "HFM_AUTHORITY_MISSING_OR_ALREADY_USED"]
  ];
  for (const [overrides, req, code] of cases) {
    await t.test(code + " " + JSON.stringify(overrides), async () => {
      const f = fixture(overrides);
      await assert.rejects(
        run({ pool: f.pool, request: req, perform: async () => "must-not-run" }),
        error => error.code === code
      );
      assert.ok(f.calls.some(x => x.sql === "ROLLBACK"));
      assert.equal(f.calls.some(x => x.sql.startsWith("INSERT INTO protected_hfm_test_table")), false);
    });
  }
});

test("failed atomic consume blocks protected callback and rolls back", async () => {
  const f = fixture({ consumeFails: true });
  let called = false;
  await assert.rejects(
    run({
      pool: f.pool, request,
      async perform() { called = true; }
    }),
    error => error.code === "HFM_AUTHORITY_EXPIRED_OR_ALREADY_USED"
  );
  assert.equal(called, false);
  assert.ok(f.calls.some(x => x.sql === "ROLLBACK"));
  assert.equal(f.calls.some(x => x.sql.startsWith("INSERT INTO mira_hfm.authority_audit_events")), false);
});

test("protected callback failure rolls back authority consumption and audit together", async () => {
  const f = fixture();
  await assert.rejects(
    run({
      pool: f.pool, request,
      async perform() { throw new Error("synthetic protected write failure"); }
    }),
    /synthetic protected write failure/
  );
  assert.ok(f.calls.some(x => x.sql.startsWith("UPDATE mira_hfm.operation_authorities")));
  assert.ok(f.calls.some(x => x.sql.startsWith("INSERT INTO mira_hfm.authority_audit_events")));
  assert.ok(f.calls.some(x => x.sql === "ROLLBACK"));
  assert.equal(f.calls.some(x => x.sql === "COMMIT"), false);
});

test("membership expiry during protected work aborts commit", async () => {
  const f = fixture({ membershipExpiresAtCommit: true });
  let called = false;
  await assert.rejects(
    run({
      pool: f.pool, request,
      async perform() { called = true; return "written"; }
    }),
    error => error.code === "HFM_MEMBERSHIP_EXPIRED_DURING_OPERATION"
  );
  assert.equal(called, true);
  assert.ok(f.calls.some(x => x.sql.startsWith("SELECT (status = 'ACTIVE'")));
  assert.ok(f.calls.some(x => x.sql === "ROLLBACK"));
  assert.equal(f.calls.some(x => x.sql === "COMMIT"), false);
});

test("missing or unverified server principal is rejected", async () => {
  const f = fixture();
  await assert.rejects(
    run({ pool: f.pool, request, verifiedPrincipal: { ...verifiedPrincipal, verified: false }, perform: async () => null }),
    error => error.code === "HFM_TRUSTED_ACTOR_REQUIRED"
  );
  assert.equal(f.calls.some(x => x.sql.startsWith("BEGIN")), false);
});

test("invalid request and missing transaction executor are rejected before authorization", async () => {
  await assert.rejects(
    run({ pool: { connect: async () => ({ query: async () => ({}) }) }, request: { ...request, authorityId: "" }, perform: async () => null }),
    error => error.code === "HFM_AUTHORITY_INPUT_INVALID"
  );
  await assert.rejects(
    run({ request, perform: async () => null }),
    error => error.code === "HFM_AUTHORITY_EXECUTOR_NOT_CONFIGURED"
  );
});

console.log("HFM_AUTHORITY_TRANSACTION_CONTRACT_TEST=PASS");
