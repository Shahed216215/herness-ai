"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const adapter = require("../services/mira-hfm-postgres");
const { executeWithConsumedAuthority } = require("../services/mira-hfm-authority-transaction");

const ENV_KEY = "MIRA_HFM_AUTHORITY_TEST_DATABASE_URL";
const EXPECTED_HOST = "ep-square-river-a1m3fhob.ap-southeast-1.aws.neon.tech";
const EXPECTED_ROLE = "mira_hfm_it_runner";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function newId(prefix) {
  return prefix + crypto.randomUUID().replace(/-/g, "");
}

function principal(subject) {
  const now = Date.now();
  return {
    verified: true,
    issuer: "mira.users",
    subject,
    actorType: "HUMAN",
    authenticationMethod: "USER_SESSION",
    authenticationRef: "hfm-neon-integration-" + subject,
    authenticatedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 3600000).toISOString()
  };
}

async function seedFixture(pool, label) {
  const suffix = crypto.randomUUID().replace(/-/g, "");
  const projectId = "hfm-it-" + label + "-" + suffix;
  const subject = "hfm-it-user-" + suffix;
  const actorId = "mira:mira.users:" + subject;
  const authorityId = newId("hfm-auth-");
  const membershipId = newId("hfm-member-");
  const requestId = newId("hfm-request-");
  const operation = "memory.write";
  const resource = "memory:" + projectId;
  const purpose = "HFM disposable Neon authority integration test";
  const approvalRef = "hfm-it-approval-" + suffix;

  await pool.query(
    "INSERT INTO mira_hfm.project_owners " +
    "(project_id, owner_actor_id, status, revision, assignment_evidence_ref, approval_ref, " +
    "assigned_by_actor_id, assigned_at, updated_at) " +
    "VALUES ($1, $2, 'ACTIVE', 1, $3, $4, $2, clock_timestamp(), clock_timestamp())",
    [projectId, actorId, "synthetic:" + suffix, approvalRef]
  );

  await pool.query(
    "INSERT INTO mira_hfm.project_memberships " +
    "(membership_id, project_id, actor_id, membership_role, permissions, status, revision, " +
    "valid_from, expires_at, granted_by_actor_id, approval_ref) " +
    "VALUES ($1, $2, $3, 'MEMBER', $4::jsonb, 'ACTIVE', 1, " +
    "clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 hour', $3, $5)",
    [membershipId, projectId, actorId, JSON.stringify({ operations: [operation] }), approvalRef]
  );

  await pool.query(
    "INSERT INTO mira_hfm.operation_authorities " +
    "(authority_id, project_id, actor_id, operation, resource, purpose, request_id, " +
    "membership_revision, owner_revision, status, issued_by_actor_id, approval_ref, valid_from, expires_at) " +
    "VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 1, 'ISSUED', $3, $8, " +
    "clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 hour')",
    [authorityId, projectId, actorId, operation, resource, purpose, requestId, approvalRef]
  );

  return {
    projectId,
    actorId,
    verifiedPrincipal: principal(subject),
    request: { authorityId, projectId, operation, resource, purpose, requestId }
  };
}

async function countAudit(pool, requestId) {
  const result = await pool.query(
    "SELECT count(*)::int AS count FROM mira_hfm.authority_audit_events WHERE request_id = $1",
    [requestId]
  );
  return result.rows[0].count;
}

async function cleanupFixture(pool, fixture) {
  await pool.query("DELETE FROM mira_hfm.operation_authorities WHERE project_id = $1", [fixture.projectId]);
  await pool.query("DELETE FROM mira_hfm.project_memberships WHERE project_id = $1", [fixture.projectId]);
  await pool.query("DELETE FROM mira_hfm.project_owners WHERE project_id = $1", [fixture.projectId]);
  // Successful audit events are append-only by design and intentionally remain synthetic.
}

async function main() {
  const raw = process.env[ENV_KEY];
  if (!raw) fail("AUTHORITY_TEST_SECRET_NOT_CONFIGURED");

  let parsed;
  try { parsed = new URL(raw); } catch (_error) { fail("AUTHORITY_TEST_URL_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) fail("AUTHORITY_TEST_PROTOCOL_INVALID");
  if (parsed.hostname.toLowerCase() !== EXPECTED_HOST) fail("AUTHORITY_TEST_HOST_NOT_DISPOSABLE");
  if (decodeURIComponent(parsed.pathname.slice(1)) !== "neondb") fail("AUTHORITY_TEST_DATABASE_MISMATCH");
  if (decodeURIComponent(parsed.username) !== EXPECTED_ROLE) fail("AUTHORITY_TEST_ROLE_MISMATCH");
  if (!["require", "verify-full"].includes(parsed.searchParams.get("sslmode"))) fail("AUTHORITY_TEST_SSL_REQUIRED");

  const config = adapter.resolveDatabaseConfig({ MIRA_HFM_DATABASE_URL: raw });
  if (config.host !== EXPECTED_HOST || config.databaseName !== "neondb") fail("AUTHORITY_TEST_ADAPTER_CONFIG_MISMATCH");

  const pool = adapter.createPool({
    env: { MIRA_HFM_DATABASE_URL: raw },
    readOnly: false,
    allowWrites: true
  });
  const fixtures = [];
  let failed = false;

  try {
    const identity = await pool.query(
      "SELECT current_database() AS database_name, current_user AS database_role"
    );
    assert.equal(identity.rows[0].database_name, "neondb");
    assert.equal(identity.rows[0].database_role, EXPECTED_ROLE);
    console.log("HFM_AUTHORITY_TEST_DATABASE_IDENTITY=PASS");

    const schema = await pool.query(
      "SELECT count(*)::int AS count FROM information_schema.tables " +
      "WHERE table_schema = 'mira_hfm' AND table_name IN " +
      "('project_owners','project_memberships','operation_authorities','authority_audit_events')"
    );
    assert.equal(schema.rows[0].count, 4);
    const privileges = await pool.query(
      "SELECT " +
      "has_schema_privilege(current_user, 'mira_hfm', 'CREATE') AS schema_create, " +
      "has_table_privilege(current_user, 'mira_hfm.project_owners', 'INSERT') AS fixture_insert, " +
      "has_table_privilege(current_user, 'mira_hfm.project_owners', 'DELETE') AS fixture_cleanup_delete, " +
      "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'INSERT') AS audit_insert, " +
      "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'UPDATE') AS audit_update, " +
      "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'DELETE') AS audit_delete, " +
      "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'TRUNCATE') AS audit_truncate, " +
      "has_database_privilege(current_user, current_database(), 'TEMP') AS temp_allowed"
    );
    const grants = privileges.rows[0];
    assert.equal(grants.schema_create, false);
    assert.equal(grants.fixture_insert, true);
    assert.equal(grants.fixture_cleanup_delete, true);
    assert.equal(grants.audit_insert, true);
    assert.equal(grants.audit_update, false);
    assert.equal(grants.audit_delete, false);
    assert.equal(grants.audit_truncate, false);
    assert.equal(grants.temp_allowed, true);
    console.log("HFM_AUTHORITY_TEST_ROLE_LEAST_PRIVILEGE=PASS");
    console.log("HFM_AUTHORITY_TEST_SCHEMA=PASS");

    const success = await seedFixture(pool, "commit");
    fixtures.push(success);
    const result = await executeWithConsumedAuthority({
      pool,
      verifiedPrincipal: success.verifiedPrincipal,
      request: success.request,
      async perform(client, context) {
        await client.query(
          "CREATE TEMP TABLE hfm_authority_probe (project_id text, actor_id text) ON COMMIT DROP ON COMMIT DROP"
        );
        await client.query(
          "INSERT INTO pg_temp.hfm_authority_probe (project_id, actor_id) VALUES ($1, $2)",
          [context.projectId, context.actorId]
        );
        const probe = await client.query("SELECT project_id, actor_id FROM pg_temp.hfm_authority_probe");
        assert.equal(probe.rows[0].project_id, context.projectId);
        assert.equal(probe.rows[0].actor_id, success.actorId);
        return "synthetic-write-committed";
      }
    });
    assert.deepEqual(result, { status: "AUTHORIZED_AND_COMMITTED", value: "synthetic-write-committed" });
    const consumed = await pool.query(
      "SELECT status, consumed_at FROM mira_hfm.operation_authorities WHERE authority_id = $1",
      [success.request.authorityId]
    );
    assert.equal(consumed.rows[0].status, "CONSUMED");
    assert.ok(consumed.rows[0].consumed_at);
    assert.equal(await countAudit(pool, success.request.requestId), 1);
    console.log("HFM_AUTHORITY_REAL_POSTGRES_COMMIT_AND_AUDIT=PASS");

    await assert.rejects(
      executeWithConsumedAuthority({
        pool,
        verifiedPrincipal: success.verifiedPrincipal,
        request: success.request,
        perform: async () => fail("REPLAY_CALLBACK_MUST_NOT_RUN")
      }),
      error => error.code === "HFM_AUTHORITY_MISSING_OR_ALREADY_USED"
    );
    assert.equal(await countAudit(pool, success.request.requestId), 1);
    console.log("HFM_AUTHORITY_REPLAY_REJECTED=PASS");

    const rollback = await seedFixture(pool, "rollback");
    fixtures.push(rollback);
    await assert.rejects(
      executeWithConsumedAuthority({
        pool,
        verifiedPrincipal: rollback.verifiedPrincipal,
        request: rollback.request,
        async perform(client) {
          await client.query("CREATE TEMP TABLE hfm_authority_rollback_probe (value text) ON COMMIT DROP");
          await client.query("INSERT INTO pg_temp.hfm_authority_rollback_probe VALUES ('must-rollback')");
          throw new Error("HFM_SYNTHETIC_CALLBACK_ABORT");
        }
      }),
      /HFM_SYNTHETIC_CALLBACK_ABORT/
    );
    const afterRollback = await pool.query(
      "SELECT status FROM mira_hfm.operation_authorities WHERE authority_id = $1",
      [rollback.request.authorityId]
    );
    assert.equal(afterRollback.rows[0].status, "ISSUED");
    assert.equal(await countAudit(pool, rollback.request.requestId), 0);
    console.log("HFM_AUTHORITY_CONSUMPTION_AND_AUDIT_ROLLBACK=PASS");

    const concurrent = await seedFixture(pool, "concurrency");
    fixtures.push(concurrent);
    const runConcurrent = () => executeWithConsumedAuthority({
      pool,
      verifiedPrincipal: concurrent.verifiedPrincipal,
      request: concurrent.request,
      async perform(client) {
        await client.query("CREATE TEMP TABLE hfm_authority_concurrency_probe (value integer) ON COMMIT DROP");
        await client.query("INSERT INTO pg_temp.hfm_authority_concurrency_probe VALUES (1)");
        await new Promise(resolve => setTimeout(resolve, 150));
        return "concurrent-write";
      }
    });
    const outcomes = await Promise.allSettled([runConcurrent(), runConcurrent()]);
    const fulfilled = outcomes.filter(item => item.status === "fulfilled");
    const rejected = outcomes.filter(item => item.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const concurrentState = await pool.query(
      "SELECT status FROM mira_hfm.operation_authorities WHERE authority_id = $1",
      [concurrent.request.authorityId]
    );
    assert.equal(concurrentState.rows[0].status, "CONSUMED");
    assert.equal(await countAudit(pool, concurrent.request.requestId), 1);
    console.log("HFM_AUTHORITY_CONCURRENT_SINGLE_CONSUMPTION=PASS");

    console.log("HFM_AUTHORITY_NEON_INTEGRATION=PASS");
  } catch (error) {
    failed = true;
    console.error("HFM_AUTHORITY_NEON_INTEGRATION=FAIL");
    console.error("REASON=" + (typeof error?.code === "string" ? error.code.slice(0, 64) : "ASSERTION_OR_RUNTIME_FAILURE"));
    throw error;
  } finally {
    for (const fixture of fixtures.reverse()) {
      try {
        await cleanupFixture(pool, fixture);
      } catch (_error) {
        failed = true;
        console.error("HFM_AUTHORITY_SYNTHETIC_ROW_CLEANUP=REVIEW_REQUIRED");
      }
    }
    await pool.end();
    if (!failed) console.log("HFM_AUTHORITY_SYNTHETIC_ROW_CLEANUP=PASS");
  }
}

main().catch(() => {
  process.exitCode = 1;
});
