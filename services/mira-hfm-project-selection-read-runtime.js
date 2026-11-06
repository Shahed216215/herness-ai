"use strict";

const postgres = require("./mira-hfm-postgres");
const { buildTrustedActorContext } = require("./mira-hfm-runtime-identity-context");

const ENABLED_ENV = "MIRA_HFM_PROJECT_READ_ENABLED";
const URL_ENV = "MIRA_HFM_PROJECT_READ_DATABASE_URL";
const ROLE_ENV = "MIRA_HFM_PROJECT_READ_ROLE";
const EXPECTED_READ_GROUP = "mira_hfm_project_reader";
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const ACTOR_ID_PATTERN = /^mira:[A-Za-z0-9._:-]{3,512}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function getProjectReadConfig(env = process.env) {
  if (env[ENABLED_ENV] !== "true") {
    return Object.freeze({ enabled: false, reason: "PROJECT_READ_NOT_ENABLED" });
  }
  if (typeof env[URL_ENV] !== "string" || !env[URL_ENV].trim()) {
    return Object.freeze({ enabled: false, reason: "PROJECT_READ_DATABASE_URL_NOT_CONFIGURED" });
  }
  if (typeof env[ROLE_ENV] !== "string" ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(env[ROLE_ENV])) {
    throw fail("PROJECT_READ_ROLE_CONFIG_INVALID");
  }
  const config = postgres.resolveDatabaseConfig({
    MIRA_HFM_DATABASE_URL: env[URL_ENV]
  });
  if (!config.configured) throw fail("PROJECT_READ_DATABASE_URL_NOT_CONFIGURED");
  return Object.freeze({
    enabled: true,
    host: config.host,
    databaseName: config.databaseName,
    expectedRole: env[ROLE_ENV]
  });
}

const PREFLIGHT_SQL = [
  "SELECT current_user AS current_role, current_database() AS database_name,",
  "r.rolsuper AS is_superuser, r.rolbypassrls AS bypasses_rls, r.rolcanlogin AS can_login,",
  "pg_has_role(current_user, $1, 'USAGE') AS has_project_reader_group,",
  "NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles granted ON granted.oid = m.roleid",
  "WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user) AND granted.rolname <> $1) AS role_membership_isolated,",
  "NOT EXISTS (SELECT 1 FROM pg_auth_members m",
  "WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1)) AS reader_group_has_no_parent_roles,",
  "(SELECT rolinherit = false FROM pg_roles WHERE rolname = $1) AS reader_group_noinherit,",
  "NOT EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refclassid = 'pg_authid'::regclass",
  "AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = $1) AND d.deptype = 'o') AS reader_group_owns_no_objects,",
  "has_schema_privilege(current_user, 'mira_hfm', 'USAGE') AS schema_usage,",
  "has_schema_privilege(current_user, 'mira_hfm', 'CREATE') AS schema_create,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'SELECT') AS owners_select,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'SELECT') AS memberships_select,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'INSERT') AS owners_insert,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'UPDATE') AS owners_update,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'DELETE') AS owners_delete,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'TRUNCATE') AS owners_truncate,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'REFERENCES') AS owners_references,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'TRIGGER') AS owners_trigger,",
  "has_any_column_privilege(current_user, 'mira_hfm.project_owners', 'INSERT') AS owners_column_insert,",
  "has_any_column_privilege(current_user, 'mira_hfm.project_owners', 'UPDATE') AS owners_column_update,",
  "has_any_column_privilege(current_user, 'mira_hfm.project_owners', 'REFERENCES') AS owners_column_references,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'INSERT') AS memberships_insert,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'UPDATE') AS memberships_update,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'DELETE') AS memberships_delete,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'TRUNCATE') AS memberships_truncate,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'REFERENCES') AS memberships_references,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'TRIGGER') AS memberships_trigger,",
  "has_any_column_privilege(current_user, 'mira_hfm.project_memberships', 'INSERT') AS memberships_column_insert,",
  "has_any_column_privilege(current_user, 'mira_hfm.project_memberships', 'UPDATE') AS memberships_column_update,",
  "has_any_column_privilege(current_user, 'mira_hfm.project_memberships', 'REFERENCES') AS memberships_column_references,",
  "(SELECT count(*) = 2 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace",
  "WHERE n.nspname = 'mira_hfm' AND c.relname IN ('project_owners','project_memberships')",
  "AND c.relrowsecurity = true AND c.relforcerowsecurity = true",
  "AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS project_rls_forced,",
  "(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'mira_hfm' AND tablename = 'project_owners'",
  "AND policyname = 'hfm_project_reader_owner_select' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'",
  "AND roles = ARRAY[$1]::name[] AND qual ~* 'project_id.*=.*NULLIF.*mira.project_id'",
  "AND qual ~* 'status.*=.*ACTIVE')",
  "AND (EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'mira_hfm' AND tablename = 'project_memberships'",
  "AND policyname = 'hfm_project_reader_own_membership_select' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'",
  "AND roles = ARRAY[$1]::name[] AND qual ~* 'project_id.*=.*NULLIF.*mira.project_id'",
  "AND qual ~* 'actor_id.*=.*NULLIF.*mira.actor_id' AND qual ~* 'status.*=.*ACTIVE'",
  "AND qual ~* 'valid_from.*<=.*clock_timestamp'",
  "AND qual ~* 'expires_at.*IS NULL.*OR.*expires_at.*>.*clock_timestamp')",
  "AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'mira_hfm'",
  "AND tablename IN ('project_owners','project_memberships') AND 'public' = ANY(roles))",
  "AND (SELECT count(*) = 2 FROM pg_policies WHERE schemaname = 'mira_hfm'",
  "AND tablename IN ('project_owners','project_memberships') AND $1 = ANY(roles) AND cmd = 'SELECT')",
  "AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'mira_hfm'",
  "AND tablename IN ('project_owners','project_memberships') AND $1 = ANY(roles)",
  "AND policyname NOT IN ('hfm_project_reader_owner_select','hfm_project_reader_own_membership_select'))) AS project_policies_present",
  "FROM pg_roles r WHERE r.rolname = current_user"
].join(" ");

const REQUIRED_TRUE = Object.freeze([
  "can_login", "has_project_reader_group", "role_membership_isolated",
  "reader_group_has_no_parent_roles", "reader_group_noinherit", "reader_group_owns_no_objects",
  "schema_usage", "owners_select", "memberships_select",
  "project_rls_forced", "project_policies_present"
]);
const REQUIRED_FALSE = Object.freeze([
  "is_superuser", "bypasses_rls", "schema_create",
  "owners_insert", "owners_update", "owners_delete", "owners_truncate",
  "owners_references", "owners_trigger",
  "owners_column_insert", "owners_column_update", "owners_column_references",
  "memberships_insert", "memberships_update", "memberships_delete", "memberships_truncate",
  "memberships_references", "memberships_trigger",
  "memberships_column_insert", "memberships_column_update", "memberships_column_references"
]);

function verifyProjectReadPreflight(row, config) {
  if (!row || row.current_role !== config.expectedRole ||
      row.database_name !== config.databaseName) {
    throw fail("PROJECT_READ_IDENTITY_MISMATCH");
  }
  for (const field of REQUIRED_TRUE) {
    if (row[field] !== true) throw fail("PROJECT_READ_REQUIRED_POLICY_OR_PRIVILEGE_MISSING");
  }
  for (const field of REQUIRED_FALSE) {
    if (row[field] !== false) throw fail("PROJECT_READ_EXCESS_PRIVILEGE_DETECTED");
  }
  return Object.freeze({
    status: "PROJECT_READ_READY",
    databaseName: config.databaseName,
    role: config.expectedRole,
    readOnly: true,
    rowLevelSecurityForced: true,
    ownerAndMembershipPoliciesPresent: true,
    writePrivileges: false
  });
}

async function createProjectSelectionReadRuntime(options = {}) {
  const env = options.env || process.env;
  const config = getProjectReadConfig(env);
  if (!config.enabled) {
    return Object.freeze({ status: "DISABLED", reason: config.reason, pool: null });
  }

  const pool = postgres.createPool({
    env: { MIRA_HFM_DATABASE_URL: env[URL_ENV] },
    PoolCtor: options.PoolCtor,
    readOnly: true,
    applicationName: "mira-hfm-project-selection-read"
  });
  let client;
  let ready = false;
  try {
    client = await pool.connect();
    const result = await client.query(PREFLIGHT_SQL, [EXPECTED_READ_GROUP]);
    const report = verifyProjectReadPreflight(result.rows && result.rows[0], config);
    ready = true;
    return Object.freeze({ ...report, pool });
  } catch (error) {
    if (error && /^PROJECT_READ_/.test(String(error.code || ""))) throw error;
    throw fail("PROJECT_READ_PREFLIGHT_FAILED");
  } finally {
    if (client) {
      try { client.release(); } catch (_error) {}
    }
    if (!ready) {
      try { await pool.end(); } catch (_error) {}
    }
  }
}

async function findActiveProjectMembership(options = {}) {
  const pool = options.pool;
  const req = options.req;
  const projectId = options.projectId;
  if (!pool || typeof pool.connect !== "function") throw fail("PROJECT_READ_POOL_REQUIRED");
  const identity = buildTrustedActorContext(req);
  if (identity.status !== "ACTOR_RESOLVED" ||
      !identity.actor || identity.actor.authentication !== "session" ||
      typeof identity.actor.actorId !== "string" || !ACTOR_ID_PATTERN.test(identity.actor.actorId)) {
    throw fail("PROJECT_READ_TRUSTED_ACTOR_REQUIRED");
  }
  const actorId = identity.actor.actorId;
  if (typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId)) {
    throw fail("PROJECT_READ_PROJECT_HINT_INVALID");
  }

  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '3000ms'");
    await client.query("SELECT set_config('mira.project_id', $1, true)", [projectId]);
    await client.query("SELECT set_config('mira.actor_id', $1, true)", [actorId]);
    const result = await client.query(
      "SELECT owner.project_id, owner.revision AS owner_revision, " +
      "membership.membership_id, membership.revision AS membership_revision, " +
      "membership.permissions, membership.membership_role " +
      "FROM mira_hfm.project_owners owner " +
      "JOIN mira_hfm.project_memberships membership " +
      "ON membership.project_id = owner.project_id " +
      "WHERE owner.project_id = $1 AND owner.status = 'ACTIVE' " +
      "AND membership.actor_id = $2 AND membership.status = 'ACTIVE' " +
      "AND membership.valid_from <= clock_timestamp() " +
      "AND (membership.expires_at IS NULL OR membership.expires_at > clock_timestamp()) " +
      "LIMIT 2",
      [projectId, actorId]
    );
    const rows = result.rows || [];
    if (rows.length > 1) throw fail("PROJECT_READ_MEMBERSHIP_INVARIANT_VIOLATION");
    await client.query("COMMIT");
    transactionOpen = false;
    if (!rows.length) return Object.freeze({ status: "PROJECT_ACCESS_NOT_AVAILABLE" });
    return Object.freeze({
      status: "ACTIVE_MEMBERSHIP_VERIFIED",
      projectId: rows[0].project_id,
      ownerRevision: String(rows[0].owner_revision),
      membershipId: rows[0].membership_id,
      membershipRevision: String(rows[0].membership_revision),
      membershipRole: rows[0].membership_role,
      permissions: rows[0].permissions
    });
  } catch (error) {
    if (transactionOpen && client) {
      try { await client.query("ROLLBACK"); } catch (_rollbackError) {}
    }
    if (error && /^PROJECT_READ_/.test(String(error.code || ""))) throw error;
    throw fail("PROJECT_READ_MEMBERSHIP_LOOKUP_FAILED");
  } finally {
    if (client) {
      try { client.release(); } catch (_error) {}
    }
  }
}

module.exports = Object.freeze({
  ENABLED_ENV,
  URL_ENV,
  ROLE_ENV,
  EXPECTED_READ_GROUP,
  PREFLIGHT_SQL,
  getProjectReadConfig,
  verifyProjectReadPreflight,
  createProjectSelectionReadRuntime,
  findActiveProjectMembership
});
