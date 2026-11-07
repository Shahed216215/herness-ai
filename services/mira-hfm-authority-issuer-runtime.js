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
  pg_has_role(current_user, $1, 'USAGE') AS has_issuer_group,
  NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND granted.rolname <> $1
  ) AS role_membership_isolated,
  NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1)
  ) AS issuer_group_has_no_parent_roles,
  (SELECT rolcanlogin = false AND rolinherit = false AND rolsuper = false
      AND rolcreatedb = false AND rolcreaterole = false
      AND rolreplication = false AND rolbypassrls = false
   FROM pg_roles WHERE rolname = $1) AS issuer_group_least_privilege,
  NOT EXISTS (
    SELECT 1 FROM pg_shdepend d
    WHERE d.refclassid = 'pg_authid'::regclass
      AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = $1)
      AND d.deptype = 'o'
  ) AS issuer_group_owns_no_objects,
  has_schema_privilege(current_user, 'mira_hfm', 'USAGE') AS schema_usage,
  has_schema_privilege(current_user, 'mira_hfm', 'CREATE') AS schema_create,
  has_table_privilege(current_user, 'mira_hfm.project_owners', 'SELECT') AS owners_select,
  has_table_privilege(current_user, 'mira_hfm.project_memberships', 'SELECT') AS memberships_select,
  has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'INSERT') AS authorities_insert,
  has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'INSERT') AS audit_insert,
  has_table_privilege(current_user, 'mira_hfm.standing_read_authorities', 'SELECT') AS standing_authorities_select,
  has_table_privilege(current_user, 'mira_hfm.standing_read_authorities', 'INSERT') AS standing_authorities_insert,
  has_table_privilege(current_user, 'mira_hfm.standing_read_authorities', 'UPDATE') AS standing_authorities_table_update,
  has_column_privilege(current_user, 'mira_hfm.standing_read_authorities', 'status', 'UPDATE') AS standing_status_update,
  has_column_privilege(current_user, 'mira_hfm.standing_read_authorities', 'updated_at', 'UPDATE') AS standing_updated_at_update,
  has_column_privilege(current_user, 'mira_hfm.standing_read_authorities', 'paused_at', 'UPDATE') AS standing_paused_at_update,
  has_column_privilege(current_user, 'mira_hfm.standing_read_authorities', 'revoked_at', 'UPDATE') AS standing_revoked_at_update,
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'mira_hfm'
    AND table_name = 'standing_read_authorities'
    AND column_name NOT IN ('status','updated_at','paused_at','revoked_at')
    AND has_column_privilege(current_user, 'mira_hfm.standing_read_authorities', column_name, 'UPDATE')) AS standing_only_status_metadata_update,
  has_table_privilege(current_user, 'mira_hfm.standing_read_authorities', 'DELETE') AS standing_authorities_delete,
  has_table_privilege(current_user, 'mira_hfm.standing_read_authorities', 'TRUNCATE') AS standing_authorities_truncate,
  has_sequence_privilege(current_user, 'mira_hfm.authority_audit_events_event_sequence_seq', 'USAGE') AS audit_sequence_usage,
  has_table_privilege(current_user, 'mira_hfm.authority_approval_nonces', 'SELECT') AS approval_nonce_select,
  has_table_privilege(current_user, 'mira_hfm.authority_approval_nonces', 'INSERT') AS approval_nonce_insert,
  has_column_privilege(current_user, 'mira_hfm.authority_approval_nonces', 'consumed_at', 'UPDATE') AS approval_nonce_consumed_update,
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'mira_hfm' AND table_name = 'authority_approval_nonces'
      AND column_name <> 'consumed_at'
      AND has_column_privilege(current_user, 'mira_hfm.authority_approval_nonces', column_name, 'UPDATE')
  ) AS approval_nonce_only_consumed_update,
  has_table_privilege(current_user, 'mira_hfm.authority_approval_nonces', 'UPDATE') AS approval_nonce_table_update,
  has_table_privilege(current_user, 'mira_hfm.authority_approval_nonces', 'DELETE') AS approval_nonce_delete,
  has_table_privilege(current_user, 'mira_hfm.authority_approval_nonces', 'TRUNCATE') AS approval_nonce_truncate,
  has_column_privilege(current_user, 'mira_hfm.authority_approval_nonces', 'nonce_hash', 'UPDATE') AS approval_nonce_hash_update,
  has_column_privilege(current_user, 'mira_hfm.authority_approval_nonces', 'approval_ref', 'UPDATE') AS approval_nonce_ref_update,
  has_table_privilege(current_user, 'mira_hfm.project_owners', 'INSERT') AS owners_insert,
  has_table_privilege(current_user, 'mira_hfm.project_owners', 'UPDATE') AS owners_update,
  has_table_privilege(current_user, 'mira_hfm.project_owners', 'DELETE') AS owners_delete,
  has_table_privilege(current_user, 'mira_hfm.project_memberships', 'INSERT') AS memberships_insert,
  has_table_privilege(current_user, 'mira_hfm.project_memberships', 'UPDATE') AS memberships_update,
  has_table_privilege(current_user, 'mira_hfm.project_memberships', 'DELETE') AS memberships_delete,
  has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'SELECT') AS authorities_select,
  has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'UPDATE') AS authorities_update,
  has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'DELETE') AS authorities_delete,
  has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'SELECT') AS audit_select,
  has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'UPDATE') AS audit_update,
  has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'DELETE') AS audit_delete,
  has_any_column_privilege(current_user, 'mira_hfm.project_owners', 'INSERT') AS owners_column_insert,
  has_any_column_privilege(current_user, 'mira_hfm.project_owners', 'UPDATE') AS owners_column_update,
  has_any_column_privilege(current_user, 'mira_hfm.project_owners', 'REFERENCES') AS owners_column_references,
  has_any_column_privilege(current_user, 'mira_hfm.project_memberships', 'INSERT') AS memberships_column_insert,
  has_any_column_privilege(current_user, 'mira_hfm.project_memberships', 'UPDATE') AS memberships_column_update,
  has_any_column_privilege(current_user, 'mira_hfm.project_memberships', 'REFERENCES') AS memberships_column_references,
  has_any_column_privilege(current_user, 'mira_hfm.operation_authorities', 'UPDATE') AS authorities_column_update,
  has_any_column_privilege(current_user, 'mira_hfm.operation_authorities', 'REFERENCES') AS authorities_column_references,
  has_any_column_privilege(current_user, 'mira_hfm.authority_audit_events', 'UPDATE') AS audit_column_update,
  has_any_column_privilege(current_user, 'mira_hfm.authority_audit_events', 'REFERENCES') AS audit_column_references,
  has_sequence_privilege(current_user, 'mira_hfm.authority_audit_events_event_sequence_seq', 'SELECT') AS audit_sequence_select,
  has_sequence_privilege(current_user, 'mira_hfm.authority_audit_events_event_sequence_seq', 'UPDATE') AS audit_sequence_update,
  has_table_privilege(current_user, 'mira_hfm.project_owners', 'TRUNCATE') AS owners_truncate,
  has_table_privilege(current_user, 'mira_hfm.project_memberships', 'TRUNCATE') AS memberships_truncate,
  has_table_privilege(current_user, 'mira_hfm.operation_authorities', 'TRUNCATE') AS authorities_truncate,
  has_table_privilege(current_user, 'mira_hfm.authority_audit_events', 'TRUNCATE') AS audit_truncate,
  (SELECT count(*) = 6
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'mira_hfm'
     AND c.relname IN ('project_owners','project_memberships','operation_authorities',
                       'authority_audit_events','authority_approval_nonces','standing_read_authorities')
     AND c.relrowsecurity AND c.relforcerowsecurity) AS issuer_rls_forced,
  (SELECT count(*) = 7
   FROM pg_policies
   WHERE schemaname = 'mira_hfm'
     AND policyname IN ('hfm_authority_issuer_owner_select',
       'hfm_authority_issuer_membership_select',
       'hfm_authority_issuer_authority_insert',
       'hfm_authority_issuer_audit_insert',
       'hfm_authority_issuer_approval_nonce_select',
       'hfm_authority_issuer_approval_nonce_insert',
       'hfm_authority_issuer_approval_nonce_consume')
     AND $1::name = ANY(roles)) AS issuer_policies_present,
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename IN ('project_owners','project_memberships','operation_authorities',
                        'authority_audit_events','authority_approval_nonces')
      AND $1::name = ANY(roles)
      AND policyname NOT IN ('hfm_authority_issuer_owner_select',
        'hfm_authority_issuer_membership_select',
        'hfm_authority_issuer_authority_insert',
        'hfm_authority_issuer_audit_insert',
        'hfm_authority_issuer_approval_nonce_select',
        'hfm_authority_issuer_approval_nonce_insert',
        'hfm_authority_issuer_approval_nonce_consume')
  ) AS issuer_policy_set_exact,
  (SELECT count(*) = 7 AND bool_and(
     CASE policyname
       WHEN 'hfm_authority_issuer_owner_select' THEN
         cmd = 'SELECT' AND qual LIKE '%project_id%' AND qual LIKE '%ACTIVE%' AND with_check IS NULL
       WHEN 'hfm_authority_issuer_membership_select' THEN
         cmd = 'SELECT' AND qual LIKE '%project_id%' AND qual LIKE '%actor_id%'
         AND qual LIKE '%valid_from%' AND qual LIKE '%expires_at%' AND with_check IS NULL
       WHEN 'hfm_authority_issuer_authority_insert' THEN
         cmd = 'INSERT' AND with_check LIKE '%project_id%' AND with_check LIKE '%actor_id%'
         AND with_check LIKE '%issued_by_actor_id%' AND with_check LIKE '%memory.read%'
         AND with_check LIKE '%memory.write%' AND with_check LIKE '%memory.trash%' AND with_check LIKE '%memory.restore%'
         AND with_check LIKE '%resource%' AND with_check LIKE '%expires_at%'
       WHEN 'hfm_authority_issuer_audit_insert' THEN
         cmd = 'INSERT' AND with_check LIKE '%project_id%' AND with_check LIKE '%actor_id%'
         AND with_check LIKE '%APPROVAL_TOKEN_CONSUMED%'
       WHEN 'hfm_authority_issuer_approval_nonce_select' THEN
         cmd = 'SELECT' AND qual LIKE '%project_id%' AND qual LIKE '%actor_id%'
         AND qual LIKE '%approver_actor_id%' AND qual NOT LIKE '%consumed_at%' AND qual LIKE '%expires_at%'
         AND with_check IS NULL
       WHEN 'hfm_authority_issuer_approval_nonce_insert' THEN
         cmd = 'INSERT' AND with_check LIKE '%project_id%' AND with_check LIKE '%actor_id%'
         AND with_check LIKE '%approver_actor_id%' AND with_check LIKE '%memory.read%'
         AND with_check LIKE '%memory.write%' AND with_check LIKE '%memory.trash%' AND with_check LIKE '%memory.restore%'
         AND with_check LIKE '%resource%' AND with_check LIKE '%expires_at%'
       WHEN 'hfm_authority_issuer_approval_nonce_consume' THEN
         cmd = 'UPDATE' AND qual LIKE '%consumed_at%' AND qual LIKE '%expires_at%'
         AND with_check LIKE '%consumed_at%' AND with_check NOT LIKE '%project_id%'
       ELSE false
     END
   )
   FROM pg_policies
   WHERE schemaname = 'mira_hfm'
     AND policyname IN ('hfm_authority_issuer_owner_select',
       'hfm_authority_issuer_membership_select',
       'hfm_authority_issuer_authority_insert',
       'hfm_authority_issuer_audit_insert',
       'hfm_authority_issuer_approval_nonce_select',
       'hfm_authority_issuer_approval_nonce_insert',
       'hfm_authority_issuer_approval_nonce_consume')
     AND $1::name = ANY(roles)) AS issuer_policy_semantics_exact,
  (SELECT count(*) = 3 FROM pg_policies WHERE schemaname = 'mira_hfm'
    AND policyname IN ('hfm_standing_issuer_select','hfm_standing_issuer_insert','hfm_standing_issuer_update')
    AND $1::name = ANY(roles)) AS standing_authority_policies_present,
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'mira_hfm'
    AND tablename = 'standing_read_authorities' AND $1::name = ANY(roles)
    AND policyname NOT IN ('hfm_standing_issuer_select','hfm_standing_issuer_insert','hfm_standing_issuer_update'))
    AS standing_authority_policy_set_exact,
  has_function_privilege(current_user, 'mira_hfm.guard_standing_read_authority_scope()', 'EXECUTE')
    AS standing_scope_trigger_function_execute,
  has_function_privilege(current_user, 'mira_hfm.audit_standing_read_authority_change()', 'EXECUTE')
    AS standing_audit_trigger_function_execute,
  (SELECT count(*) = 2 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'mira_hfm' AND c.relname = 'standing_read_authorities'
      AND t.tgname IN ('standing_read_authority_scope_immutable','standing_read_authority_audit')
      AND NOT t.tgisinternal AND t.tgenabled = 'O') AS standing_authority_triggers_present,
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename IN ('project_owners','project_memberships','operation_authorities',
                        'authority_audit_events','authority_approval_nonces','standing_read_authorities')
      AND 'public' = ANY(roles)
  ) AS no_public_issuer_policies
FROM pg_roles r
WHERE r.rolname = current_user
`;
const REQUIRED_TRUE = Object.freeze([
  'has_issuer_group', 'role_membership_isolated', 'issuer_group_has_no_parent_roles',
  'issuer_group_least_privilege', 'issuer_group_owns_no_objects', 'inherits_roles', 'can_login',
  'schema_usage', 'owners_select', 'memberships_select', 'authorities_insert',
  'audit_insert', 'audit_sequence_usage', 'approval_nonce_select', 'approval_nonce_insert',
  'standing_authorities_select', 'standing_authorities_insert',
  'standing_status_update', 'standing_updated_at_update', 'standing_paused_at_update',
  'standing_revoked_at_update', 'standing_only_status_metadata_update',
  'standing_authority_policies_present', 'standing_authority_policy_set_exact',
  'standing_scope_trigger_function_execute', 'standing_audit_trigger_function_execute',
  'standing_authority_triggers_present',
  'approval_nonce_consumed_update', 'approval_nonce_only_consumed_update', 'issuer_rls_forced', 'issuer_policies_present',
  'issuer_policy_set_exact', 'issuer_policy_semantics_exact', 'no_public_issuer_policies'
]);
const REQUIRED_FALSE = Object.freeze([
  'is_superuser', 'bypasses_rls', 'can_create_databases', 'can_create_roles',
  'can_replicate', 'schema_create', 'owners_insert', 'owners_update', 'owners_delete',
  'memberships_insert', 'memberships_update', 'memberships_delete',
  'authorities_select', 'authorities_update', 'authorities_delete',
  'audit_select', 'audit_update', 'audit_delete',
  'owners_column_insert', 'owners_column_update', 'owners_column_references',
  'memberships_column_insert', 'memberships_column_update', 'memberships_column_references',
  'authorities_column_update', 'authorities_column_references',
  'audit_column_update', 'audit_column_references',
  'audit_sequence_select', 'audit_sequence_update',
  'owners_truncate', 'memberships_truncate', 'authorities_truncate', 'audit_truncate',
  'approval_nonce_table_update', 'approval_nonce_delete', 'approval_nonce_truncate',
  'approval_nonce_hash_update', 'approval_nonce_ref_update',
  'standing_authorities_table_update', 'standing_authorities_delete', 'standing_authorities_truncate'
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
    issuesAllowlistedMemoryOperationAuthorities: true,
    allowedOperations: Object.freeze(['memory.read', 'memory.write', 'memory.trash', 'memory.restore']),
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
