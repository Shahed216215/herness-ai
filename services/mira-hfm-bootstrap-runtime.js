'use strict';

const postgres = require('./mira-hfm-postgres');

const ENABLED_ENV = 'MIRA_HFM_BOOTSTRAP_ENABLED';
const URL_ENV = 'MIRA_HFM_BOOTSTRAP_DATABASE_URL';
const ROLE_ENV = 'MIRA_HFM_BOOTSTRAP_ROLE';
const EXPECTED_GROUP = 'mira_hfm_bootstrap_operator';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function getHfmBootstrapConfig(env = process.env) {
  if (env[ENABLED_ENV] !== 'true') {
    return Object.freeze({ enabled: false, reason: 'HFM_BOOTSTRAP_NOT_ENABLED' });
  }
  if (typeof env[URL_ENV] !== 'string' || !env[URL_ENV].trim()) {
    return Object.freeze({ enabled: false, reason: 'HFM_BOOTSTRAP_DATABASE_URL_NOT_CONFIGURED' });
  }
  if (typeof env[ROLE_ENV] !== 'string' ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(env[ROLE_ENV])) {
    throw fail('HFM_BOOTSTRAP_ROLE_CONFIG_INVALID');
  }
  const config = postgres.resolveDatabaseConfig({
    MIRA_HFM_DATABASE_URL: env[URL_ENV]
  });
  if (!config.configured) throw fail('HFM_BOOTSTRAP_DATABASE_URL_NOT_CONFIGURED');
  return Object.freeze({
    enabled: true,
    host: config.host,
    databaseName: config.databaseName,
    expectedRole: env[ROLE_ENV]
  });
}

const PREFLIGHT_SQL = `
SELECT
  current_user AS current_role,
  current_database() AS database_name,
  r.rolsuper AS is_superuser,
  r.rolbypassrls AS bypasses_rls,
  r.rolcreatedb AS can_create_databases,
  r.rolcreaterole AS can_create_roles,
  r.rolreplication AS can_replicate,
  r.rolinherit AS inherits_roles,
  r.rolcanlogin AS can_login,
  pg_has_role(current_user, $1::name, 'USAGE') AS has_bootstrap_group,
  NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND granted.rolname <> $1
  ) AS role_membership_isolated,
  NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1)
  ) AS bootstrap_group_has_no_parent_roles,
  (SELECT rolcanlogin = false AND rolinherit = false AND rolsuper = false
      AND rolcreatedb = false AND rolcreaterole = false
      AND rolreplication = false AND rolbypassrls = false
   FROM pg_roles WHERE rolname = $1) AS bootstrap_group_least_privilege,
  NOT EXISTS (
    SELECT 1 FROM pg_shdepend d
    WHERE d.refclassid = 'pg_authid'::regclass
      AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = $1)
      AND d.deptype = 'o'
  ) AS bootstrap_group_owns_no_objects,
  NOT EXISTS (
    SELECT 1 FROM pg_shdepend d
    WHERE d.refclassid = 'pg_authid'::regclass
      AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND d.deptype = 'o'
  ) AS login_role_owns_no_objects,
  has_schema_privilege(current_user, 'mira_hfm', 'USAGE') AS schema_usage,
  has_schema_privilege(current_user, 'mira_hfm', 'CREATE') AS schema_create,
  has_table_privilege(current_user, 'mira_hfm.bootstrap_registry', 'INSERT') AS latch_insert,
  has_table_privilege(current_user, 'mira_hfm.project_owners', 'INSERT') AS owners_insert,
  has_table_privilege(current_user, 'mira_hfm.project_memberships', 'INSERT') AS memberships_insert,
  has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'INSERT') AS audit_insert,
  has_sequence_privilege(current_user, 'mira_hfm.authority_audit_events_event_sequence_seq', 'USAGE') AS audit_sequence_usage,
  has_table_privilege(current_user, 'mira_hfm.bootstrap_registry', 'SELECT') AS latch_select,
  has_table_privilege(current_user, 'mira_hfm.bootstrap_registry', 'UPDATE') AS latch_update,
  has_table_privilege(current_user, 'mira_hfm.bootstrap_registry', 'DELETE') AS latch_delete,
  has_table_privilege(current_user, 'mira_hfm.bootstrap_registry', 'TRUNCATE') AS latch_truncate,
  has_table_privilege(current_user, 'mira_hfm.project_owners', 'SELECT') AS owners_select,
  has_table_privilege(current_user, 'mira_hfm.project_owners', 'UPDATE') AS owners_update,
  has_table_privilege(current_user, 'mira_hfm.project_owners', 'DELETE') AS owners_delete,
  has_table_privilege(current_user, 'mira_hfm.project_memberships', 'SELECT') AS memberships_select,
  has_table_privilege(current_user, 'mira_hfm.project_memberships', 'UPDATE') AS memberships_update,
  has_table_privilege(current_user, 'mira_hfm.project_memberships', 'DELETE') AS memberships_delete,
  has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'SELECT') AS audit_select,
  has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'UPDATE') AS audit_update,
  has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'DELETE') AS audit_delete,
  has_table_privilege(current_user, 'mira_hfm.project_owners', 'TRUNCATE') AS owners_truncate,
  has_table_privilege(current_user, 'mira_hfm.project_memberships', 'TRUNCATE') AS memberships_truncate,
  has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'TRUNCATE') AS audit_truncate,
  (SELECT count(*) = 4
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'mira_hfm'
     AND c.relname IN ('bootstrap_registry','project_owners','project_memberships','authority_audit_events')
     AND c.relrowsecurity AND c.relforcerowsecurity) AS bootstrap_rls_forced,
  (SELECT count(*) = 5
   FROM pg_policies
   WHERE schemaname = 'mira_hfm'
     AND policyname IN ('hfm_bootstrap_registry_insert','hfm_bootstrap_registry_select',
       'hfm_bootstrap_owner_insert','hfm_bootstrap_membership_insert','hfm_bootstrap_audit_insert')
     AND $1::name = ANY(roles)) AS bootstrap_policies_present,
  (SELECT count(*) = 5 AND bool_and(
     CASE policyname
       WHEN 'hfm_bootstrap_registry_insert' THEN
         cmd = 'INSERT' AND with_check LIKE '%bootstrap_key%' AND with_check LIKE '%bootstrap_approval_ref%'
       WHEN 'hfm_bootstrap_registry_select' THEN
         cmd = 'SELECT' AND qual LIKE '%bootstrap_key%' AND qual LIKE '%bootstrap_approval_ref%'
         AND with_check IS NULL
       WHEN 'hfm_bootstrap_owner_insert' THEN
         cmd = 'INSERT' AND with_check LIKE '%owner_actor_id%' AND with_check LIKE '%assigned_by_actor_id%'
         AND with_check LIKE '%revision%' AND with_check LIKE '%bootstrap_approval_ref%'
       WHEN 'hfm_bootstrap_membership_insert' THEN
         cmd = 'INSERT' AND with_check LIKE '%membership_role%' AND with_check LIKE '%memory.read%'
         AND with_check LIKE '%granted_by_actor_id%' AND with_check LIKE '%bootstrap_approval_ref%'
       WHEN 'hfm_bootstrap_audit_insert' THEN
         cmd = 'INSERT' AND with_check LIKE '%PROJECT_BOOTSTRAPPED%' AND with_check LIKE '%bootstrap_approval_ref%'
       ELSE false
     END
   )
   FROM pg_policies
   WHERE schemaname = 'mira_hfm'
     AND policyname IN ('hfm_bootstrap_registry_insert','hfm_bootstrap_registry_select',
       'hfm_bootstrap_owner_insert','hfm_bootstrap_membership_insert','hfm_bootstrap_audit_insert')
     AND $1::name = ANY(roles)) AS bootstrap_policy_semantics_exact,
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename IN ('bootstrap_registry','project_owners','project_memberships','authority_audit_events')
      AND 'public' = ANY(roles)
  ) AS no_public_bootstrap_policies
FROM pg_roles r
WHERE r.rolname = current_user
`;

const REQUIRED_TRUE = Object.freeze([
  'has_bootstrap_group', 'role_membership_isolated',
  'bootstrap_group_has_no_parent_roles', 'bootstrap_group_least_privilege',
  'bootstrap_group_owns_no_objects', 'login_role_owns_no_objects', 'inherits_roles', 'can_login',
  'schema_usage', 'latch_insert', 'owners_insert', 'memberships_insert',
  'audit_insert', 'audit_sequence_usage', 'latch_select', 'bootstrap_rls_forced',
  'bootstrap_policies_present', 'bootstrap_policy_semantics_exact',
  'no_public_bootstrap_policies'
]);
const REQUIRED_FALSE = Object.freeze([
  'is_superuser', 'bypasses_rls', 'can_create_databases', 'can_create_roles',
  'can_replicate', 'schema_create', 'latch_update',
  'latch_delete', 'latch_truncate', 'owners_select', 'owners_update',
  'owners_delete', 'memberships_select', 'memberships_update',
  'memberships_delete', 'audit_select', 'audit_update', 'audit_delete',
  'owners_truncate', 'memberships_truncate', 'audit_truncate'
]);

function verifyHfmBootstrapPreflight(row, config) {
  if (!row || row.current_role !== config.expectedRole ||
      row.database_name !== config.databaseName) {
    throw fail('HFM_BOOTSTRAP_DATABASE_OR_ROLE_IDENTITY_MISMATCH');
  }
  for (const field of REQUIRED_TRUE) {
    if (row[field] !== true) throw fail('HFM_BOOTSTRAP_REQUIRED_PRIVILEGE_OR_POLICY_MISSING');
  }
  for (const field of REQUIRED_FALSE) {
    if (row[field] !== false) throw fail('HFM_BOOTSTRAP_EXCESS_PRIVILEGE_DETECTED');
  }
  return Object.freeze({
    status: 'HFM_BOOTSTRAP_READY',
    databaseName: config.databaseName,
    role: config.expectedRole,
    oneTimeOnly: true,
    createsInitialOwnerAndAdminMembership: true,
    changesExistingMembership: false,
    writesMemory: false,
    rowLevelSecurityForced: true
  });
}

async function createHfmBootstrapPool(options = {}) {
  const env = options.env || process.env;
  const config = getHfmBootstrapConfig(env);
  if (!config.enabled) {
    return Object.freeze({ status: 'DISABLED', reason: config.reason, pool: null });
  }
  const pool = postgres.createPool({
    env: { MIRA_HFM_DATABASE_URL: env[URL_ENV] },
    PoolCtor: options.PoolCtor,
    readOnly: false,
    allowWrites: true,
    applicationName: 'mira-hfm-initial-bootstrap'
  });
  let client;
  let ready = false;
  try {
    client = await pool.connect();
    const result = await client.query(PREFLIGHT_SQL, [EXPECTED_GROUP]);
    const report = verifyHfmBootstrapPreflight(result.rows && result.rows[0], config);
    ready = true;
    return Object.freeze({ ...report, pool });
  } catch (error) {
    if (error && /^HFM_BOOTSTRAP_/.test(String(error.code || ''))) throw error;
    throw fail('HFM_BOOTSTRAP_PREFLIGHT_FAILED');
  } finally {
    if (client) {
      try { client.release(); } catch (_error) {}
    }
    if (!ready) {
      try { await pool.end(); } catch (_error) {}
    }
  }
}

module.exports = Object.freeze({
  ENABLED_ENV, URL_ENV, ROLE_ENV, EXPECTED_GROUP, PREFLIGHT_SQL,
  REQUIRED_TRUE, REQUIRED_FALSE, getHfmBootstrapConfig,
  verifyHfmBootstrapPreflight, createHfmBootstrapPool
});
