'use strict';

const postgres = require('./mira-hfm-postgres');

const ENABLED_ENV = 'MIRA_HFM_MEMORY_WRITE_ENABLED';
const URL_ENV = 'MIRA_HFM_MEMORY_DATABASE_URL';
const ROLE_ENV = 'MIRA_HFM_MEMORY_WRITER_ROLE';
const EXPECTED_WRITER_GROUP = 'mira_hfm_memory_writer';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function getMemoryWriterConfig(env = process.env) {
  if (env[ENABLED_ENV] !== 'true') {
    return Object.freeze({ enabled: false, reason: 'MEMORY_WRITES_NOT_ENABLED' });
  }
  if (typeof env[URL_ENV] !== 'string' || !env[URL_ENV].trim()) {
    return Object.freeze({ enabled: false, reason: 'MEMORY_WRITER_DATABASE_URL_NOT_CONFIGURED' });
  }
  if (typeof env[ROLE_ENV] !== 'string' ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(env[ROLE_ENV])) {
    throw fail('MEMORY_WRITER_ROLE_CONFIG_INVALID');
  }
  const config = postgres.resolveDatabaseConfig({
    MIRA_HFM_DATABASE_URL: env[URL_ENV]
  });
  if (!config.configured) throw fail('MEMORY_WRITER_DATABASE_URL_NOT_CONFIGURED');
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
  'r.rolcreaterole AS can_create_roles, r.rolcreatedb AS can_create_databases,',
  'r.rolinherit AS inherits_roles, r.rolcanlogin AS can_login, r.rolreplication AS can_replicate,',
  "pg_has_role(current_user, $1, 'MEMBER') AS has_memory_writer_group,",
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
  "has_table_privilege(current_user, 'mira_hfm.memory_record_versions', 'INSERT') AS versions_insert,",
  "has_table_privilege(current_user, 'mira_hfm.memory_record_versions', 'SELECT') AS versions_select,",

  "has_table_privilege(current_user, 'mira_hfm.memory_record_versions', 'UPDATE') AS versions_update,",
  "has_table_privilege(current_user, 'mira_hfm.memory_record_versions', 'DELETE') AS versions_delete,",
  "has_table_privilege(current_user, 'mira_hfm.memory_record_versions', 'TRUNCATE') AS versions_truncate,",
  "has_table_privilege(current_user, 'mira_hfm.memory_operation_registry', 'SELECT') AS operations_select,",
  "has_table_privilege(current_user, 'mira_hfm.memory_operation_registry', 'INSERT') AS operations_insert,",
  "has_table_privilege(current_user, 'mira_hfm.memory_operation_registry', 'UPDATE') AS operations_update,",
  "has_table_privilege(current_user, 'mira_hfm.memory_operation_registry', 'DELETE') AS operations_delete,",
  "has_table_privilege(current_user, 'mira_hfm.memory_operation_registry', 'TRUNCATE') AS operations_truncate,",
  "has_table_privilege(current_user, 'mira_hfm.memory_audit_events', 'SELECT') AS memory_audit_select,",
  "has_table_privilege(current_user, 'mira_hfm.memory_audit_events', 'INSERT') AS memory_audit_insert,",
  "has_table_privilege(current_user, 'mira_hfm.memory_audit_events', 'UPDATE') AS memory_audit_update,",
  "has_table_privilege(current_user, 'mira_hfm.memory_audit_events', 'DELETE') AS memory_audit_delete,",
  "has_table_privilege(current_user, 'mira_hfm.memory_audit_events', 'TRUNCATE') AS memory_audit_truncate,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'UPDATE') AS authority_audit_update,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'DELETE') AS authority_audit_delete,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'TRUNCATE') AS authority_audit_truncate,",
  "has_sequence_privilege(current_user, 'mira_hfm.memory_audit_events_event_sequence_seq', 'USAGE') AS audit_sequence_usage,",
  "has_sequence_privilege(current_user, 'mira_hfm.memory_audit_events_event_sequence_seq', 'SELECT') AS audit_sequence_select,",
  "has_sequence_privilege(current_user, 'mira_hfm.memory_audit_events_event_sequence_seq', 'UPDATE') AS audit_sequence_update,",

  '(SELECT count(*) = 8 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace ' +
    "WHERE n.nspname = 'mira_hfm' AND c.relname IN " +
    "('project_owners','project_memberships','operation_authorities','authority_audit_events'," +
    "'memory_records','memory_record_versions','memory_operation_registry','memory_audit_events') " +
    'AND c.relrowsecurity = true AND c.relforcerowsecurity = true) AS memory_rls_forced',
  'FROM pg_roles r WHERE r.rolname = current_user'
].join(' ');

const REQUIRED_TRUE = Object.freeze([
  'has_memory_writer_group', 'inherits_roles', 'can_login', 'schema_usage',
  'owners_select', 'memberships_select', 'authorities_select',
  'authorities_update', 'authority_audit_insert',
  'records_select', 'records_insert', 'records_update',
  'versions_insert',
  'operations_select', 'operations_insert', 'operations_update',
  'memory_audit_select', 'memory_audit_insert',
  'audit_sequence_usage', 'memory_rls_forced'
]);

const REQUIRED_FALSE = Object.freeze([
  'is_superuser', 'bypasses_rls', 'can_create_roles', 'can_create_databases', 'can_replicate',
  'records_delete', 'records_truncate',
  'versions_update', 'versions_delete', 'versions_truncate',
  'operations_delete', 'operations_truncate',
  'memory_audit_update', 'memory_audit_delete', 'memory_audit_truncate',
  'owners_insert', 'owners_update', 'owners_delete', 'owners_truncate',
  'memberships_insert', 'memberships_update', 'memberships_delete', 'memberships_truncate',
  'authorities_insert', 'authorities_delete', 'authorities_truncate',
  'authority_audit_select', 'authority_audit_update', 'authority_audit_delete', 'authority_audit_truncate',
  'versions_select', 'audit_sequence_select', 'audit_sequence_update', 'schema_create'
]);

function verifyWriterPreflight(row, config) {
  if (!row || row.current_role !== config.expectedRole ||
      row.database_name !== config.databaseName) {
    throw fail('MEMORY_WRITER_IDENTITY_MISMATCH');
  }
  for (const field of REQUIRED_TRUE) {
    if (row[field] !== true) throw fail('MEMORY_WRITER_REQUIRED_PRIVILEGE_MISSING');
  }
  for (const field of REQUIRED_FALSE) {
    if (row[field] !== false) throw fail('MEMORY_WRITER_EXCESS_PRIVILEGE_DETECTED');
  }
  return Object.freeze({
    status: 'MEMORY_WRITER_READY',
    databaseName: config.databaseName,
    role: config.expectedRole,
    rowLevelSecurityForced: true,
    hardDeleteAllowed: false,
    appendOnlyHistory: true
  });
}

async function createMemoryWriterPool(options = {}) {
  const env = options.env || process.env;
  const config = getMemoryWriterConfig(env);
  if (!config.enabled) return Object.freeze({ status: 'DISABLED', reason: config.reason, pool: null });

  const pool = postgres.createPool({
    env: { MIRA_HFM_DATABASE_URL: env[URL_ENV] },
    PoolCtor: options.PoolCtor,
    readOnly: false,
    allowWrites: true,
    applicationName: 'mira-hfm-memory-writer'
  });
  let client;
  let ready = false;
  try {
    client = await pool.connect();
    const result = await client.query(PREFLIGHT_SQL, [EXPECTED_WRITER_GROUP]);
    const report = verifyWriterPreflight(result.rows && result.rows[0], config);
    ready = true;
    return Object.freeze({ ...report, pool });
  } catch (error) {
    if (error && /^MEMORY_WRITER_/.test(String(error.code || ''))) throw error;
    throw fail('MEMORY_WRITER_PREFLIGHT_FAILED');
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
  ENABLED_ENV,
  URL_ENV,
  ROLE_ENV,
  EXPECTED_WRITER_GROUP,
  PREFLIGHT_SQL,
  getMemoryWriterConfig,
  verifyWriterPreflight,
  createMemoryWriterPool
});
