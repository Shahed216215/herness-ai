'use strict';

const postgres = require('./mira-hfm-postgres');

const ENABLED = 'MIRA_HFM_AUTHORITY_ISSUER_ENABLED';
const URL = 'MIRA_HFM_AUTHORITY_ISSUER_DATABASE_URL';
const ROLE = 'MIRA_HFM_AUTHORITY_ISSUER_ROLE';
const GROUP = 'mira_hfm_authority_issuer';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function configFrom(env = process.env) {
  if (env[ENABLED] !== 'true') return Object.freeze({ enabled: false, reason: 'AUTHORITY_ISSUER_NOT_ENABLED' });
  if (typeof env[URL] !== 'string' || !env[URL].trim()) {
    return Object.freeze({ enabled: false, reason: 'AUTHORITY_ISSUER_URL_NOT_CONFIGURED' });
  }
  if (typeof env[ROLE] !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(env[ROLE])) {
    throw fail('AUTHORITY_ISSUER_ROLE_INVALID');
  }
  const resolved = postgres.resolveDatabaseConfig({ MIRA_HFM_DATABASE_URL: env[URL] });
  if (!resolved.configured) throw fail('AUTHORITY_ISSUER_URL_INVALID');
  return Object.freeze({
    enabled: true,
    databaseName: resolved.databaseName,
    expectedRole: env[ROLE]
  });
}

const PREFLIGHT_SQL = [
  'SELECT current_user AS current_role, current_database() AS database_name,',
  'r.rolsuper AS is_superuser, r.rolbypassrls AS bypasses_rls,',
  'r.rolcreaterole AS can_create_roles, r.rolcreatedb AS can_create_databases,',
  'r.rolinherit AS inherits_roles, r.rolcanlogin AS can_login, r.rolreplication AS can_replicate,',
  "pg_has_role(current_user, $1, 'MEMBER') AS has_issuer_group,",
  "has_schema_privilege(current_user, 'mira_hfm', 'USAGE') AS schema_usage,",
  "has_schema_privilege(current_user, 'mira_hfm', 'CREATE') AS schema_create,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'SELECT') AS owners_select,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'INSERT') AS owners_insert,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'INSERT') AS memberships_insert,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'SELECT') AS memberships_select,",
  "has_table_privilege(current_user, 'mira_hfm.project_owners', 'UPDATE') AS owners_update,",
  "has_table_privilege(current_user, 'mira_hfm.project_memberships', 'UPDATE') AS memberships_update,",
  "has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'INSERT') AS authorities_insert,",
  "has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'INSERT') AS audit_insert,",
  "has_sequence_privilege(current_user, 'mira_hfm.authority_audit_events_event_sequence_seq', 'USAGE') AS audit_sequence_usage,",
  "has_table_privilege(current_user, 'mira_hfm.memory_records', 'SELECT') AS memory_select,",
  "has_table_privilege(current_user, 'mira_hfm.memory_records', 'INSERT') AS memory_insert,",
  "has_table_privilege(current_user, 'mira_hfm.memory_records', 'UPDATE') AS memory_update,",
  "has_table_privilege(current_user, 'mira_hfm.memory_record_versions', 'SELECT') AS versions_select,",
  "has_table_privilege(current_user, 'mira_hfm.memory_record_versions', 'INSERT') AS versions_insert,",
  "has_table_privilege(current_user, 'mira_hfm.memory_operation_registry', 'SELECT') AS operations_select,",
  "(SELECT count(*) = 4 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mira_hfm' AND c.relname IN ('project_owners','project_memberships','operation_authorities','authority_audit_events') AND c.relrowsecurity AND c.relforcerowsecurity) AS authority_rls_forced",
  'FROM pg_roles r WHERE r.rolname = current_user'
].join(' ');

function verify(row, config) {
  if (!row || row.current_role !== config.expectedRole || row.database_name !== config.databaseName) {
    throw fail('AUTHORITY_ISSUER_IDENTITY_MISMATCH');
  }
  const requiredTrue = ['has_issuer_group','inherits_roles','can_login','schema_usage','owners_select','memberships_select','owners_insert','memberships_insert','authorities_insert','audit_insert','audit_sequence_usage','authority_rls_forced'];
  const requiredFalse = ['is_superuser','bypasses_rls','owners_update','memberships_update','can_create_roles','can_create_databases','can_replicate','schema_create','memory_select','memory_insert','memory_update','versions_select','versions_insert','operations_select'];
  for (const field of requiredTrue) if (row[field] !== true) throw fail('AUTHORITY_ISSUER_REQUIRED_PRIVILEGE_MISSING');
  for (const field of requiredFalse) if (row[field] !== false) throw fail('AUTHORITY_ISSUER_EXCESS_PRIVILEGE');
  return Object.freeze({ status: 'AUTHORITY_ISSUER_READY', role: config.expectedRole, databaseName: config.databaseName });
}

async function createAuthorityIssuerPool(options = {}) {
  const env = options.env || process.env;
  const config = configFrom(env);
  if (!config.enabled) return Object.freeze({ status: 'DISABLED', reason: config.reason, pool: null });
  const pool = postgres.createPool({
    env: { MIRA_HFM_DATABASE_URL: env[URL] },
    PoolCtor: options.PoolCtor,
    readOnly: false,
    allowWrites: true,
    applicationName: 'mira-hfm-authority-issuer'
  });
  let client;
  let ready = false;
  try {
    client = await pool.connect();
    const result = await client.query(PREFLIGHT_SQL, [GROUP]);
    const report = verify(result.rows && result.rows[0], config);
    ready = true;
    return Object.freeze({ ...report, pool });
  } catch (error) {
    if (error && /^AUTHORITY_ISSUER_/.test(String(error.code || ''))) throw error;
    throw fail('AUTHORITY_ISSUER_PREFLIGHT_FAILED');
  } finally {
    if (client) { try { client.release(); } catch (_error) {} }
    if (!ready) { try { await pool.end(); } catch (_error) {} }
  }
}

module.exports = Object.freeze({ ENABLED, URL, ROLE, GROUP, PREFLIGHT_SQL, configFrom, verify, createAuthorityIssuerPool });
