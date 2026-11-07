'use strict';

const postgres = require('./mira-hfm-postgres');

const ENABLED_ENV = 'MIRA_HFM_AUTHORITY_ISSUER_ENABLED';
const URL_ENV = 'MIRA_HFM_AUTHORITY_ISSUER_DATABASE_URL';
const ROLE_ENV = 'MIRA_HFM_AUTHORITY_ISSUER_ROLE';
const EXPECTED_GROUP = 'mira_hfm_authority_issuer';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function getAuthorityIssuerConfig(env = process.env) {
  if (env[ENABLED_ENV] !== 'true') {
    return Object.freeze({ enabled: false, reason: 'AUTHORITY_ISSUER_NOT_ENABLED' });
  }
  if (typeof env[URL_ENV] !== 'string' || !env[URL_ENV].trim()) {
    return Object.freeze({ enabled: false, reason: 'AUTHORITY_ISSUER_DATABASE_URL_NOT_CONFIGURED' });
  }
  if (typeof env[ROLE_ENV] !== 'string' ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(env[ROLE_ENV])) {
    throw fail('AUTHORITY_ISSUER_ROLE_CONFIG_INVALID');
  }
  const config = postgres.resolveDatabaseConfig({
    MIRA_HFM_DATABASE_URL: env[URL_ENV]
  });
  if (!config.configured) throw fail('AUTHORITY_ISSUER_DATABASE_URL_NOT_CONFIGURED');
  return Object.freeze({
    enabled: true,
    host: config.host,
    databaseName: config.databaseName,
    expectedRole: env[ROLE_ENV]
  });
}

const PREFLIGHT_SQL = [
  'SELECT current_user AS current_role, current_database() AS database_name,',
  'r.rolsuper AS is_superuser, r.rolbypassrls AS bypasses_rls,',
  'r.rolcreatedb AS can_create_databases, r.rolcreaterole AS can_create_roles,',
  'r.rolreplication AS can_replicate, r.rolinherit AS inherits_roles, r.rolcanlogin AS can_login,',
  "pg_has_role(current_user, $1, 'MEMBER') AS has_issuer_group,",
  "NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles granted ON granted.oid = m.roleid " +
    "WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user) AND granted.rolname <> $1) AS role_membership_isolated,",
  "NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1)) AS issuer_group_has_no_parent_roles,",
  "(SELECT rolcanlogin = false AND rolinherit = false AND rolsuper = false AND rolcreatedb = false " +
    "AND rolcreaterole = false AND rolreplication = false AND rolbypassrls = false FROM pg_roles WHERE rolname = $1) AS issuer_group_least_privilege,",
  "NOT EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refclassid = 'pg_authid'::regclass " +
    "AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = $1) AND d.deptype = 'o') AS issuer_group_owns_no_objects,",
  "has_schema_privilege(current_user, 'mira_hfm', 'USAGE') AS schema_usage,",
  "has_schema_privilege(current_user, 'mira_hfm', 'CREATE') AS schema_create,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'SELECT') AS owners_select,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'SELECT') AS memberships_select,",
  "has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'INSERT') AS authorities_insert,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'INSERT') AS audit_insert,",
  "has_sequence_privilege(current_user, 'mira_hfm.authority_audit_events_event_sequence_seq', 'USAGE') AS audit_sequence_usage,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'INSERT') AS owners_insert,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'UPDATE') AS owners_update,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'DELETE') AS owners_delete,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'INSERT') AS memberships_insert,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'UPDATE') AS memberships_update,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'DELETE') AS memberships_delete,",
  "has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'SELECT') AS authorities_select,",
  "has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'UPDATE') AS authorities_update,",
  "has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'DELETE') AS authorities_delete,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'SELECT') AS audit_select,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'UPDATE') AS audit_update,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'DELETE') AS audit_delete,",
  "has_any_column_privilege(current_user, 'mira_hfm.project_owners', 'INSERT') AS owners_column_insert,",
  "has_any_column_privilege(current_user, 'mira_hfm.project_owners', 'UPDATE') AS owners_column_update,",
  "has_any_column_privilege(current_user, 'mira_hfm.project_owners', 'REFERENCES') AS owners_column_references,",
  "has_any_column_privilege(current_user, 'mira_hfm.project_memberships', 'INSERT') AS memberships_column_insert,",
  "has_any_column_privilege(current_user, 'mira_hfm.project_memberships', 'UPDATE') AS memberships_column_update,",
  "has_any_column_privilege(current_user, 'mira_hfm.project_memberships', 'REFERENCES') AS memberships_column_references,",
  "has_any_column_privilege(current_user, 'mira_hfm.operation_authorities', 'UPDATE') AS authorities_column_update,",
  "has_any_column_privilege(current_user, 'mira_hfm.operation_authorities', 'REFERENCES') AS authorities_column_references,",
  "has_any_column_privilege(current_user, 'mira_hfm.authority_audit_events', 'UPDATE') AS audit_column_update,",
  "has_any_column_privilege(current_user, 'mira_hfm.authority_audit_events', 'REFERENCES') AS audit_column_references,",
  "has_sequence_privilege(current_user, 'mira_hfm.authority_audit_events_event_sequence_seq', 'SELECT') AS audit_sequence_select,",
  "has_sequence_privilege(current_user, 'mira_hfm.authority_audit_events_event_sequence_seq', 'UPDATE') AS audit_sequence_update,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'TRUNCATE') AS owners_truncate,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'TRUNCATE') AS memberships_truncate,",
  "has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'TRUNCATE') AS authorities_truncate,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'TRUNCATE') AS audit_truncate,"
  "(SELECT count(*) = 4 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE n.nspname = 'mira_hfm' AND c.relname IN ('project_owners','project_memberships','operation_authorities','authority_audit_events') " +
    "AND c.relrowsecurity AND c.relforcerowsecurity) AS issuer_rls_forced,",
  "(SELECT count(*) = 4 FROM pg_policies WHERE schemaname = 'mira_hfm' AND policyname IN " +
    "('hfm_authority_issuer_owner_select','hfm_authority_issuer_membership_select'," +
    "'hfm_authority_issuer_authority_insert','hfm_authority_issuer_audit_insert') AND $1 = ANY(roles)) AS issuer_policies_present,",
  "NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'mira_hfm' " +
    "AND tablename IN ('project_owners','project_memberships','operation_authorities','authority_audit_events') " +
    "AND 'public' = ANY(roles)) AS no_public_issuer_policies",
  'FROM pg_roles r WHERE r.rolname = current_user'
].join(' ');

const REQUIRED_TRUE = Object.freeze([
  'has_issuer_group', 'role_membership_isolated', 'issuer_group_has_no_parent_roles',
  'issuer_group_least_privilege', 'issuer_group_owns_no_objects', 'inherits_roles', 'can_login',
  'schema_usage', 'owners_select', 'memberships_select', 'authorities_insert',
  'audit_insert', 'audit_sequence_usage', 'issuer_rls_forced',
  'issuer_policies_present', 'no_public_issuer_policies'
]);
const REQUIRED_FALSE = Object.freeze([
  'is_superuser', 'bypasses_rls', 'can_create_databases', 'can_create_roles',
  'can_replicate', 'schema_create', 'owners_insert', 'owners_update', 'owners_delete',
  'memberships_insert', 'memberships_update', 'memberships_delete',
  'authorities_select', 'authorities_update', 'authorities_delete',
  'audit_select', 'audit_update', 'audit_delete'
]);

function verifyAuthorityIssuerPreflight(row, config) {
  if (!row || row.current_role !== config.expectedRole || row.database_name !== config.databaseName) {
    throw fail('AUTHORITY_ISSUER_IDENTITY_MISMATCH');
  }
  for (const field of REQUIRED_TRUE) {
    if (row[field] !== true) throw fail('AUTHORITY_ISSUER_REQUIRED_PRIVILEGE_OR_POLICY_MISSING');
  }
  for (const field of REQUIRED_FALSE) {
    if (row[field] !== false) throw fail('AUTHORITY_ISSUER_EXCESS_PRIVILEGE_DETECTED');
  }
  return Object.freeze({
    status: 'AUTHORITY_ISSUER_READY',
    databaseName: config.databaseName,
    role: config.expectedRole,
    issuesMemoryReadAuthorityOnly: true,
    consumesAuthority: false,
    changesMembership: false,
    writesMemory: false,
    rowLevelSecurityForced: true
  });
}

async function createAuthorityIssuerPool(options = {}) {
  const env = options.env || process.env;
  const config = getAuthorityIssuerConfig(env);
  if (!config.enabled) {
    return Object.freeze({ status: 'DISABLED', reason: config.reason, pool: null });
  }
  const pool = postgres.createPool({
    env: { MIRA_HFM_DATABASE_URL: env[URL_ENV] },
    PoolCtor: options.PoolCtor,
    readOnly: false,
    allowWrites: true,
    applicationName: 'mira-hfm-authority-issuer'
  });
  let client;
  let ready = false;
  try {
    client = await pool.connect();
    const result = await client.query(PREFLIGHT_SQL, [EXPECTED_GROUP]);
    const report = verifyAuthorityIssuerPreflight(result.rows && result.rows[0], config);
    ready = true;
    return Object.freeze({ ...report, pool });
  } catch (error) {
    if (error && /^AUTHORITY_ISSUER_/.test(String(error.code || ''))) throw error;
    throw fail('AUTHORITY_ISSUER_PREFLIGHT_FAILED');
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
  REQUIRED_TRUE, REQUIRED_FALSE, getAuthorityIssuerConfig,
  verifyAuthorityIssuerPreflight, createAuthorityIssuerPool
});
