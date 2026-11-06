"use strict";

const assert = require("node:assert/strict");
const runtime = require("../services/mira-hfm-project-selection-read-runtime");

const env = {
  MIRA_HFM_PROJECT_READ_ENABLED: "true",
  MIRA_HFM_PROJECT_READ_DATABASE_URL: "postgresql://reader:secret@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require",
  MIRA_HFM_PROJECT_READ_ROLE: "mira_hfm_project_reader_login"
};
const config = runtime.getProjectReadConfig(env);
assert.equal(config.enabled, true);
assert.equal(config.expectedRole, "mira_hfm_project_reader_login");
assert.equal(config.databaseName, "neondb");
assert.equal(Object.hasOwn(config, "connectionString"), false);
console.log("PROJECT_READ_CONFIG_SECRET_NOT_EXPOSED=PASS");

assert.equal(runtime.getProjectReadConfig({}).enabled, false);
assert.throws(() => runtime.getProjectReadConfig({
  ...env, MIRA_HFM_PROJECT_READ_ROLE: "Bad Role"
}), error => error.code === "PROJECT_READ_ROLE_CONFIG_INVALID");
console.log("PROJECT_READ_CONFIG_FAILS_CLOSED=PASS");

const good = {
  current_role: "mira_hfm_project_reader_login",
  database_name: "neondb",
  is_superuser: false,
  bypasses_rls: false,
  can_login: true,
  has_project_reader_group: true,
  role_membership_isolated: true,
  reader_group_has_no_parent_roles: true,
  reader_group_no_login: true,
  reader_group_noinherit: true,
  reader_group_no_superuser: true,
  reader_group_no_createdb: true,
  reader_group_no_createrole: true,
  reader_group_no_replication: true,
  reader_group_no_bypassrls: true,
  reader_group_owns_no_objects: true,
  schema_usage: true,
  schema_create: false,
  owners_select: true,
  memberships_select: true,
  owners_insert: false,
  owners_update: false,
  owners_delete: false,
  owners_truncate: false,
  owners_references: false,
  owners_trigger: false,
  owners_column_insert: false,
  owners_column_update: false,
  owners_column_references: false,
  memberships_insert: false,
  memberships_update: false,
  memberships_delete: false,
  memberships_truncate: false,
  memberships_references: false,
  memberships_trigger: false,
  memberships_column_insert: false,
  memberships_column_update: false,
  memberships_column_references: false,
  project_rls_forced: true,
  project_policies_present: true
};
const report = runtime.verifyProjectReadPreflight(good, config);
assert.equal(report.readOnly, true);
assert.equal(report.writePrivileges, false);
assert.equal(report.rowLevelSecurityForced, true);
console.log("PROJECT_READ_ROLE_LEAST_PRIVILEGE_PREFLIGHT=PASS");

for (const patch of [
  { is_superuser: true },
  { bypasses_rls: true },
  { role_membership_isolated: false },
  { reader_group_has_no_parent_roles: false },
  { reader_group_no_login: false },
  { reader_group_noinherit: false },
  { reader_group_no_superuser: false },
  { reader_group_no_createdb: false },
  { reader_group_no_createrole: false },
  { reader_group_no_replication: false },
  { reader_group_no_bypassrls: false },
  { reader_group_owns_no_objects: false },
  { owners_insert: true },
  { owners_update: true },
  { owners_delete: true },
  { owners_truncate: true },
  { owners_references: true },
  { owners_trigger: true },
  { owners_column_insert: true },
  { owners_column_update: true },
  { owners_column_references: true },
  { memberships_insert: true },
  { memberships_update: true },
  { memberships_delete: true },
  { memberships_truncate: true },
  { memberships_references: true },
  { memberships_trigger: true },
  { memberships_column_insert: true },
  { memberships_column_update: true },
  { memberships_column_references: true },
  { project_rls_forced: false },
  { project_policies_present: false },
  { owners_select: false },
  { current_role: "wrong_role" },
  { database_name: "production" }
]) {
  assert.throws(() => runtime.verifyProjectReadPreflight({ ...good, ...patch }, config));
}
console.log("PROJECT_READ_PREFLIGHT_REJECTS_UNSAFE_ROLE_RLS_AND_ALL_NONSELECT_PRIVILEGES=PASS");

assert.match(runtime.PREFLIGHT_SQL, /pg_policies/);
assert.match(runtime.PREFLIGHT_SQL, /mira\.project_id/);
assert.match(runtime.PREFLIGHT_SQL, /mira\.actor_id/);
assert.match(runtime.PREFLIGHT_SQL, /has_project_reader_group/);
assert.match(runtime.PREFLIGHT_SQL, /role_membership_isolated/);
assert.match(runtime.PREFLIGHT_SQL, /reader_group_has_no_parent_roles/);
assert.match(runtime.PREFLIGHT_SQL, /reader_group_noinherit/);
assert.match(runtime.PREFLIGHT_SQL, /reader_group_owns_no_objects/);
assert.match(runtime.PREFLIGHT_SQL, /pg_shdepend/);
assert.match(runtime.PREFLIGHT_SQL, /hfm_project_reader_owner_select/);
assert.match(runtime.PREFLIGHT_SQL, /hfm_project_reader_own_membership_select/);
assert.match(runtime.PREFLIGHT_SQL, /policyname NOT IN/);
assert.match(runtime.PREFLIGHT_SQL, /'public' = ANY/);
assert.match(runtime.PREFLIGHT_SQL, /relforcerowsecurity = true/);
assert.match(runtime.PREFLIGHT_SQL, /has_table_privilege/);
assert.match(runtime.PREFLIGHT_SQL, /owners_references/);
assert.match(runtime.PREFLIGHT_SQL, /owners_trigger/);
assert.match(runtime.PREFLIGHT_SQL, /memberships_references/);
assert.match(runtime.PREFLIGHT_SQL, /memberships_trigger/);
assert.match(runtime.PREFLIGHT_SQL, /has_any_column_privilege/);
assert.match(runtime.PREFLIGHT_SQL, /owners_column_insert/);
assert.match(runtime.PREFLIGHT_SQL, /memberships_column_references/);
assert.match(runtime.PREFLIGHT_SQL, /valid_from/);
assert.match(runtime.PREFLIGHT_SQL, /expires_at/);
assert.match(runtime.PREFLIGHT_SQL, /clock_timestamp/);
assert.ok(runtime.PREFLIGHT_SQL.includes("reader_group_no_login"));
assert.ok(runtime.PREFLIGHT_SQL.includes("reader_group_no_superuser"));
assert.ok(runtime.PREFLIGHT_SQL.includes("reader_group_no_createdb"));
assert.ok(runtime.PREFLIGHT_SQL.includes("reader_group_no_createrole"));
assert.ok(runtime.PREFLIGHT_SQL.includes("reader_group_no_replication"));
assert.ok(runtime.PREFLIGHT_SQL.includes("reader_group_no_bypassrls"));
assert.ok(runtime.PREFLIGHT_SQL.includes("regexp_replace(regexp_replace(lower(qual)"));
assert.ok(runtime.PREFLIGHT_SQL.includes("((project_id=nullif(current_setting(''mira.project_id'',true),''''))and(status=''active''))"));
assert.ok(runtime.PREFLIGHT_SQL.includes("((project_id=nullif(current_setting(''mira.project_id'',true),''''))and(actor_id=nullif(current_setting(''mira.actor_id'',true),''''))and(status=''active'')and(valid_from<=clock_timestamp())and((expires_atisnull)or(expires_at>clock_timestamp())))"));
assert.match(runtime.PREFLIGHT_SQL, /relowner NOT IN/);
assert.match(runtime.PREFLIGHT_SQL, /permissive = 'PERMISSIVE'/);
console.log("PROJECT_READ_PREFLIGHT_CHECKS_COMPLETE_POLICY_SEMANTICS_AND_PRIVILEGES=PASS");

const sessionId = "project-selection-session-001";
const principal = {
  verified: true,
  issuer: "mira.users",
  subject: "11111111-1111-4111-8111-111111111111",
  actorType: "HUMAN",
  authenticationMethod: "USER_SESSION",
  authenticationRef: sessionId,
  authenticatedAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 60 * 60_000).toISOString()
};
const req = {
  role: "user",
  sessionID: sessionId,
  session: {
    authenticated: true,
    role: "user",
    hfmPrincipal: principal
  },
  body: { actorId: "mira:attacker:forged", projectId: "mira-project-evil" }
};
const expectedActorId = "mira:mira.users:11111111-1111-4111-8111-111111111111";
const fakeCalls = [];
const fakeClient = {
  async query(sql, params) {
    fakeCalls.push({ sql, params });
    if (sql === "BEGIN READ ONLY" || sql.startsWith("SET LOCAL") ||
        sql.startsWith("SELECT set_config") || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [{
      project_id: "mira-project-001",
      owner_revision: "1",
      membership_id: "membership-001",
      membership_revision: "1",
      membership_role: "ADMIN",
      permissions: { operations: ["memory.read"] }
    }], rowCount: 1 };
  },
  release() {}
};
const fakePool = { async connect() { return fakeClient; } };

(async () => {
  await assert.rejects(
    runtime.findActiveProjectMembership({ pool: fakePool, req: { ...req, session: { authenticated: false } }, projectId: "mira-project-001" }),
    error => error.code === "PROJECT_READ_TRUSTED_ACTOR_REQUIRED"
  );
  await assert.rejects(
    runtime.findActiveProjectMembership({ pool: fakePool, req, projectId: "?" }),
    error => error.code === "PROJECT_READ_PROJECT_HINT_INVALID"
  );
  const result = await runtime.findActiveProjectMembership({
    pool: fakePool, req, projectId: "mira-project-001"
  });
  assert.equal(result.status, "ACTIVE_MEMBERSHIP_VERIFIED");
  assert.equal(result.projectId, "mira-project-001");
  assert.ok(fakeCalls.some(call => call.sql === "BEGIN READ ONLY"));
  assert.ok(fakeCalls.some(call => call.sql.includes("membership.actor_id = $2") &&
    call.params[0] === "mira-project-001" && call.params[1] === expectedActorId));
  assert.ok(fakeCalls.some(call => call.sql.startsWith("SELECT set_config('mira.project_id', $1, true)")));
  assert.ok(fakeCalls.some(call => call.sql.startsWith("SELECT set_config('mira.actor_id', $1, true)") && call.params[0] === expectedActorId));
  assert.ok(fakeCalls.some(call => call.sql === "COMMIT"));
  console.log("PROJECT_MEMBERSHIP_LOOKUP_IS_READ_ONLY_AND_SESSION_ACTOR_SCOPED=PASS");
  console.log("REQUEST_BODY_CANNOT_OVERRIDE_TRUSTED_ACTOR=PASS");

  const noMembershipPool = {
    async connect() {
      return { ...fakeClient, async query(sql) {
        if (sql === "BEGIN READ ONLY" || sql.startsWith("SET LOCAL") ||
            sql.startsWith("SELECT set_config") || sql === "COMMIT" || sql === "ROLLBACK") {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }};
    }
  };
  const denied = await runtime.findActiveProjectMembership({
    pool: noMembershipPool, req, projectId: "mira-project-001"
  });
  assert.equal(denied.status, "PROJECT_ACCESS_NOT_AVAILABLE");
  console.log("MISSING_OR_RLS_HIDDEN_MEMBERSHIP_FAILS_CLOSED=PASS");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
