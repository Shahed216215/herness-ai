'use strict';

// Separate least-privilege runtime for one-time-authorized HFM retrieval.
// It can consume an already-issued authority and read eligible Memory only.
// It cannot issue authorities, change memberships, or write Memory records.

const postgres = require('./mira-hfm-postgres');

const ENABLED_ENV = 'MIRA_HFM_MEMORY_READ_ENABLED';
const URL_ENV = 'MIRA_HFM_MEMORY_READ_DATABASE_URL';
const ROLE_ENV = 'MIRA_HFM_MEMORY_READ_ROLE';
const EXPECTED_GROUP = 'mira_hfm_memory_reader';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function getMemoryReadConfig(env = process.env) {
  if (env[ENABLED_ENV] !== 'true') {
    return Object.freeze({ enabled: false, reason: 'MEMORY_READ_NOT_ENABLED' });
  }
  if (typeof env[URL_ENV] !== 'string' || !env[URL_ENV].trim()) {
    return Object.freeze({ enabled: false, reason: 'MEMORY_READ_DATABASE_URL_NOT_CONFIGURED' });
  }
  if (typeof env[ROLE_ENV] !== 'string' ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(env[ROLE_ENV])) {
    throw fail('MEMORY_READ_ROLE_CONFIG_INVALID');
  }
  const config = postgres.resolveDatabaseConfig({
    MIRA_HFM_DATABASE_URL: env[URL_ENV]
  });
  if (!config.configured) throw fail('MEMORY_READ_DATABASE_URL_NOT_CONFIGURED');
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
  "pg_has_role(current_user, $1, 'MEMBER') AS has_memory_reader_group,",
  "NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles granted ON granted.oid = m.roleid " +
    "WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user) AND granted.rolname <> $1) AS role_membership_isolated,",
  "NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1)) AS reader_group_has_no_parent_roles,",
  "(SELECT rolcanlogin = false AND rolinherit = false AND rolsuper = false AND rolcreatedb = false " +
    "AND rolcreaterole = false AND rolreplication = false AND rolbypassrls = false FROM pg_roles WHERE rolname = $1) AS reader_group_is_nologin_least_privilege,",
  "NOT EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refclassid = 'pg_authid'::regclass " +
    "AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = $1) AND d.deptype = 'o') AS reader_group_owns_no_objects,",
  "has_schema_privilege(current_user, 'mira_hfm', 'USAGE') AS schema_usage,",
  "has_schema_privilege(current_user, 'mira_hfm', 'CREATE') AS schema_create,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'SELECT') AS owners_select,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'INSERT') AS owners_insert,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'UPDATE') AS owners_update,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'DELETE') AS owners_delete,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'TRUNCATE') AS owners_truncate,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'SELECT') AS memberships_select,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'INSERT') AS memberships_insert,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'UPDATE') AS memberships_update,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'DELETE') AS memberships_delete,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'TRUNCATE') AS memberships_truncate,",
  "has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'SELECT') AS authorities_select,",
  "has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'UPDATE') AS authorities_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'status', 'UPDATE') AS authorities_status_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'consumed_at', 'UPDATE') AS authorities_consumed_at_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'authority_id', 'UPDATE') AS authorities_id_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'project_id', 'UPDATE') AS authorities_project_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'actor_id', 'UPDATE') AS authorities_actor_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'operation', 'UPDATE') AS authorities_operation_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'resource', 'UPDATE') AS authorities_resource_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'purpose', 'UPDATE') AS authorities_purpose_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'request_id', 'UPDATE') AS authorities_request_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'membership_revision', 'UPDATE') AS authorities_membership_revision_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'owner_revision', 'UPDATE') AS authorities_owner_revision_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'issued_by_actor_id', 'UPDATE') AS authorities_issuer_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'approval_ref', 'UPDATE') AS authorities_approval_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'valid_from', 'UPDATE') AS authorities_valid_from_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'expires_at', 'UPDATE') AS authorities_expires_update,",
  "has_column_privilege(current_user, 'mira_hfm.operation_authorities', 'revoked_at', 'UPDATE') AS authorities_revoked_update,",
  "has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'INSERT') AS authorities_insert,",
  "has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'DELETE') AS authorities_delete,",
  "has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'TRUNCATE') AS authorities_truncate,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'INSERT') AS authority_audit_insert,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'SELECT') AS authority_audit_select,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'UPDATE') AS authority_audit_update,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'DELETE') AS authority_audit_delete,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'TRUNCATE') AS authority_audit_truncate,",
  "has_table_privilege(current_user, 'mira_hfm.memory_records', 'SELECT') AS records_select,",
  "has_table_privilege(current_user, 'mira_hfm.memory_records', 'INSERT') AS records_insert,",
  "has_table_privilege(current_user, 'mira_hfm.memory_records', 'UPDATE') AS records_update,",
  "has_table_privilege(current_user, 'mira_hfm.memory_records', 'DELETE') AS records_delete,",
  "has_table_privilege(current_user, 'mira_hfm.memory_records', 'TRUNCATE') AS records_truncate,",
  "has_sequence_privilege(current_user, 'mira_hfm.authority_audit_events_event_sequence_seq', 'USAGE') AS audit_sequence_usage,",
  "has_sequence_privilege(current_user, 'mira_hfm.authority_audit_events_event_sequence_seq', 'SELECT') AS audit_sequence_select,",
  "has_sequence_privilege(current_user, 'mira_hfm.authority_audit_events_event_sequence_seq', 'UPDATE') AS audit_sequence_update,",
  "(SELECT count(*) = 5 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE n.nspname = 'mira_hfm' AND c.relname IN ('project_owners','project_memberships','operation_authorities'," +
    "'authority_audit_events','memory_records') AND c.relrowsecurity AND c.relforcerowsecurity) AS retrieval_rls_forced,",
  "(SELECT count(*) = 6 FROM pg_policies WHERE schemaname = 'mira_hfm' AND policyname IN " +
    "('hfm_memory_reader_owner_select','hfm_memory_reader_membership_select'," +
    "'hfm_memory_reader_authority_consume','hfm_memory_reader_authority_consume_update'," +
    "'hfm_memory_reader_authority_audit_insert','hfm_memory_reader_memory_select') " +
    "AND $1 = ANY(roles)) AS retrieval_policies_present,",
  "NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'mira_hfm' " +
    "AND tablename IN ('project_owners','project_memberships','operation_authorities','authority_audit_events','memory_records') " +
    "AND 'public' = ANY(roles)) AS no_public_retrieval_policies",
  'FROM pg_roles r WHERE r.rolname = current_user'
].join(' ');

const REQUIRED_TRUE = Object.freeze([
  'has_memory_reader_group', 'role_membership_isolated',
  'reader_group_has_no_parent_roles', 'reader_group_is_nologin_least_privilege',
  'reader_group_owns_no_objects', 'inherits_roles', 'can_login',
  'schema_usage', 'owners_select', 'memberships_select',
  'authorities_select', 'authorities_status_update', 'authorities_consumed_at_update', 'authority_audit_insert',
  'records_select', 'audit_sequence_usage',
  'retrieval_rls_forced', 'retrieval_policies_present',
  'no_public_retrieval_policies'
]);

const REQUIRED_FALSE = Object.freeze([
  'is_superuser', 'bypasses_rls', 'can_create_databases',
  'can_create_roles', 'can_replicate', 'schema_create',
  'owners_insert', 'owners_update', 'owners_delete', 'owners_truncate',
  'memberships_insert', 'memberships_update', 'memberships_delete', 'memberships_truncate',
  'authorities_update', 'authorities_id_update', 'authorities_project_update',
  'authorities_actor_update', 'authorities_operation_update', 'authorities_resource_update',
  'authorities_purpose_update', 'authorities_request_update',
  'authorities_membership_revision_update', 'authorities_owner_revision_update',
  'authorities_issuer_update', 'authorities_approval_update',
  'authorities_valid_from_update', 'authorities_expires_update', 'authorities_revoked_update',
  'authorities_insert', 'authorities_delete', 'authorities_truncate',
  'authority_audit_select', 'authority_audit_update', 'authority_audit_delete',
  'authority_audit_truncate',
  'records_insert', 'records_update', 'records_delete', 'records_truncate',
  'audit_sequence_select', 'audit_sequence_update'
]);

function verifyMemoryReadPreflight(row, config) {
  if (!row || row.current_role !== config.expectedRole ||
      row.database_name !== config.databaseName) {
    throw fail('MEMORY_READ_IDENTITY_MISMATCH');
  }
  for (const field of REQUIRED_TRUE) {
    if (row[field] !== true) throw fail('MEMORY_READ_REQUIRED_PRIVILEGE_OR_POLICY_MISSING');
  }
  for (const field of REQUIRED_FALSE) {
    if (row[field] !== false) throw fail('MEMORY_READ_EXCESS_PRIVILEGE_DETECTED');
  }
  return Object.freeze({
    status: 'MEMORY_READ_READY',
    databaseName: config.databaseName,
    role: config.expectedRole,
    consumesPreissuedAuthority: true,
    issuesAuthority: false,
    readsActiveNonRestrictedMemory: true,
    writesMemory: false,
    rowLevelSecurityForced: true
  });
}

async function createMemoryReadPool(options = {}) {
  const env = options.env || process.env;
  const config = getMemoryReadConfig(env);
  if (!config.enabled) {
    return Object.freeze({ status: 'DISABLED', reason: config.reason, pool: null });
  }

  const pool = postgres.createPool({
    env: { MIRA_HFM_DATABASE_URL: env[URL_ENV] },
    PoolCtor: options.PoolCtor,
    readOnly: false,
    allowWrites: true,
    applicationName: 'mira-hfm-memory-reader'
  });
  let client;
  let ready = false;
  try {
    client = await pool.connect();
    const result = await client.query(PREFLIGHT_SQL, [EXPECTED_GROUP]);
    const report = verifyMemoryReadPreflight(result.rows && result.rows[0], config);
    ready = true;
    return Object.freeze({ ...report, pool });
  } catch (error) {
    if (error && /^MEMORY_READ_/.test(String(error.code || ''))) throw error;
    throw fail('MEMORY_READ_PREFLIGHT_FAILED');
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
  REQUIRED_TRUE, REQUIRED_FALSE, getMemoryReadConfig,
  verifyMemoryReadPreflight, createMemoryReadPool
});
