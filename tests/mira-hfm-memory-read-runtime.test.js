'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const runtime = require('../services/mira-hfm-memory-read-runtime');

const env = {
  MIRA_HFM_MEMORY_READ_ENABLED: 'true',
  MIRA_HFM_MEMORY_READ_DATABASE_URL: 'postgresql://reader:secret@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require',
  MIRA_HFM_MEMORY_READ_ROLE: 'mira_hfm_memory_reader_login'
};
const config = runtime.getMemoryReadConfig(env);
assert.equal(config.enabled, true);
assert.equal(config.expectedRole, 'mira_hfm_memory_reader_login');
assert.equal(config.databaseName, 'neondb');
assert.equal(Object.hasOwn(config, 'connectionString'), false);
console.log('MEMORY_READ_CONFIG_SECRET_NOT_EXPOSED=PASS');

assert.equal(runtime.getMemoryReadConfig({}).enabled, false);
assert.throws(() => runtime.getMemoryReadConfig({
  ...env, MIRA_HFM_MEMORY_READ_ROLE: 'bad role'
}), error => error.code === 'MEMORY_READ_ROLE_CONFIG_INVALID');
assert.throws(() => runtime.getMemoryReadConfig({
  ...env,
  MIRA_HFM_MEMORY_READ_DATABASE_URL: 'postgresql://reader:secret@db.example.com/neondb?sslmode=require'
}), error => error.code === 'DATABASE_HOST_NOT_ALLOWLISTED');
console.log('MEMORY_READ_CONFIG_FAILS_CLOSED=PASS');
assert.match(runtime.PREFLIGHT_SQL, /reader_actor_scope_policies_present/);
assert.match(runtime.PREFLIGHT_SQL, /hfm_reader_memory_membership_authority_scope/);
assert.match(runtime.PREFLIGHT_SQL, /standing_read_scope_policy_present/);
assert.match(runtime.PREFLIGHT_SQL, /permissive = 'RESTRICTIVE'/);
console.log('MEMORY_READ_PREFLIGHT_REQUIRES_ACTOR_BOUND_STANDING_RLS=PASS');

function preflightRow(overrides = {}) {
  return {
    current_role: 'mira_hfm_memory_reader_login', database_name: 'neondb',
    is_superuser: false, bypasses_rls: false, can_create_databases: false,
    can_create_roles: false, can_replicate: false, inherits_roles: true, can_login: true,
    has_memory_reader_group: true, role_membership_isolated: true,
    reader_group_has_no_parent_roles: true, reader_group_is_nologin_least_privilege: true,
    reader_group_owns_no_objects: true, schema_usage: true, schema_create: false,
    owners_select: true, owners_insert: false, owners_update: false, owners_delete: false, owners_truncate: false,
    memberships_select: true, memberships_insert: false, memberships_update: false, memberships_delete: false, memberships_truncate: false,
    authorities_select: true, authorities_update: false, authorities_status_update: true,
    authorities_consumed_at_update: true, authorities_id_update: false, authorities_project_update: false,
    authorities_actor_update: false, authorities_operation_update: false, authorities_resource_update: false,
    authorities_purpose_update: false, authorities_request_update: false,
    authorities_membership_revision_update: false, authorities_owner_revision_update: false,
    authorities_issuer_update: false, authorities_approval_update: false,
    authorities_valid_from_update: false, authorities_expires_update: false,
    authorities_revoked_update: false, authorities_insert: false, authorities_delete: false, authorities_truncate: false,
    authority_audit_insert: true, authority_audit_select: false, authority_audit_update: false,
    authority_audit_delete: false, authority_audit_truncate: false,
    records_select: true, records_insert: false, records_update: false, records_delete: false, records_truncate: false,
    standing_authorities_select: true, standing_authorities_insert: false,
    standing_authorities_update: false, standing_authorities_delete: false, standing_authorities_truncate: false,
    audit_sequence_usage: true, audit_sequence_select: false, audit_sequence_update: false,
    retrieval_rls_forced: true, retrieval_policies_present: true, no_public_retrieval_policies: true,
    reader_actor_scope_policies_present: true, standing_read_scope_policy_present: true,
    ...overrides
  };
}

const good = runtime.verifyMemoryReadPreflight(preflightRow(), config);
assert.equal(good.status, 'MEMORY_READ_READY');
assert.equal(good.consumesPreissuedAuthority, true);
assert.equal(good.issuesAuthority, false);
assert.equal(good.writesMemory, false);
console.log('MEMORY_READ_LEAST_PRIVILEGE_PREFLIGHT=PASS');

for (const patch of [
  { is_superuser: true }, { bypasses_rls: true }, { can_create_roles: true },
  { has_memory_reader_group: false }, { role_membership_isolated: false },
  { reader_group_has_no_parent_roles: false }, { reader_group_is_nologin_least_privilege: false },
  {
    authorities_status_update: false
  }, { authorities_consumed_at_update: false }, { authorities_id_update: true },
  { owners_insert: true }, { memberships_update: true }, { authorities_insert: true }, { authorities_update: true },
  { authority_audit_update: true }, { records_insert: true }, { records_update: true },
  { standing_authorities_select: false }, { standing_authorities_insert: true },
  { standing_authorities_update: true }, { standing_authorities_delete: true },
  { schema_create: true }, { retrieval_rls_forced: false },
  { retrieval_policies_present: false }, { no_public_retrieval_policies: false },
  { reader_actor_scope_policies_present: false }, { standing_read_scope_policy_present: false },
  { current_role: 'wrong_role' }, { database_name: 'production' }
]) {
  assert.throws(() => runtime.verifyMemoryReadPreflight(preflightRow(patch), config));
}
console.log('MEMORY_READ_PREFLIGHT_REJECTS_PRIVILEGE_RLS_AND_IDENTITY_DRIFT=PASS');

test('runtime remains disabled without explicit feature flag', async () => {
  const result = await runtime.createMemoryReadPool({ env: {} });
  assert.deepEqual(result, {
    status: 'DISABLED', reason: 'MEMORY_READ_NOT_ENABLED', pool: null
  });
});

test('runtime uses constrained transaction-capable role and closes failed preflight pool', async () => {
  let poolConfig;
  let closed = false;
  class FakePool {
    constructor(config) { poolConfig = config; }
    on() {}
    async connect() {
      return {
        async query(sql, params) {
          assert.equal(sql, runtime.PREFLIGHT_SQL);
          assert.deepEqual(params, ['mira_hfm_memory_reader']);
          return { rows: [preflightRow()] };
        },
        release() {}
      };
    }
    async end() { closed = true; }
  }
  const result = await runtime.createMemoryReadPool({ env, PoolCtor: FakePool });
  assert.equal(result.status, 'MEMORY_READ_READY');
  assert.equal(poolConfig.application_name, 'mira-hfm-memory-reader');
  assert.equal(poolConfig.options, undefined);
  assert.equal(poolConfig.ssl.rejectUnauthorized, true);
  assert.equal(closed, false);

  let failedClosed = false;
  class DeniedPool extends FakePool {
    async connect() {
      return { async query() { return { rows: [preflightRow({ records_update: true })] }; }, release() {} };
    }
    async end() { failedClosed = true; }
  }
  await assert.rejects(
    runtime.createMemoryReadPool({ env, PoolCtor: DeniedPool }),
    error => error.code === 'MEMORY_READ_EXCESS_PRIVILEGE_DETECTED'
  );
  assert.equal(failedClosed, true);
});
