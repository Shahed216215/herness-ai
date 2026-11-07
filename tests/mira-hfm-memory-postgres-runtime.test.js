'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const runtime = require('../services/mira-hfm-memory-postgres-runtime');

const validEnv = {
  MIRA_HFM_MEMORY_WRITE_ENABLED: 'true',
  MIRA_HFM_MEMORY_DATABASE_URL: 'postgresql://writer:synthetic-secret@ep-test.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  MIRA_HFM_MEMORY_WRITER_ROLE: 'mira_hfm_memory_app'
};

function preflightRow(overrides = {}) {
  const row = {
    current_role: 'mira_hfm_memory_app',
    database_name: 'neondb',
    is_superuser: false,
    bypasses_rls: false,
    can_create_roles: false,
    can_create_databases: false,
    inherits_roles: true,
    can_login: true,
    can_replicate: false,
    has_memory_writer_group: true,
    role_membership_isolated: true,
    writer_group_has_no_parent_roles: true,
    writer_group_least_privilege: true,
    writer_group_owns_no_objects: true,
    login_role_owns_no_objects: true,
    schema_usage: true,
    schema_create: false,
    owners_select: true,
    owners_insert: false,
    owners_update: false,
    owners_delete: false,
    owners_truncate: false,
    memberships_select: true,
    memberships_insert: false,
    memberships_update: false,
    memberships_delete: false,
    memberships_truncate: false,
    authorities_select: true,
    authorities_update: true,
    authorities_insert: false,
    authorities_delete: false,
    authorities_truncate: false,
    authority_audit_insert: true,
    authority_audit_select: false,
    authority_audit_update: false,
    authority_audit_delete: false,
    authority_audit_truncate: false,
    records_select: true,
    records_insert: true,
    records_update: true,
    records_delete: false,
    records_truncate: false,
    versions_insert: true,
    versions_select: false,
    versions_update: false,
    versions_delete: false,
    versions_truncate: false,
    operations_select: true,
    operations_insert: true,
    operations_update: true,
    operations_delete: false,
    operations_truncate: false,
    memory_audit_select: true,
    memory_audit_insert: true,
    memory_audit_update: false,
    memory_audit_delete: false,
    memory_audit_truncate: false,
    authority_audit_update: false,
    authority_audit_delete: false,
    authority_audit_truncate: false,
    audit_sequence_usage: true,
    audit_sequence_select: false,
    audit_sequence_update: false,
    memory_rls_forced: true,
    writer_actor_scope_policies_present: true
  };
  return { ...row, ...overrides };
}

test('writer pool stays disabled unless an explicit feature flag is enabled', async () => {
  const result = await runtime.createMemoryWriterPool({
    env: { MIRA_HFM_MEMORY_DATABASE_URL: validEnv.MIRA_HFM_MEMORY_DATABASE_URL }
  });
  assert.deepEqual(result, {
    status: 'DISABLED',
    reason: 'MEMORY_WRITES_NOT_ENABLED',
    pool: null
  });
});

test('writer config rejects missing URL, invalid role and non-Neon hosts', () => {
  assert.deepEqual(
    runtime.getMemoryWriterConfig({ ...validEnv, MIRA_HFM_MEMORY_DATABASE_URL: '' }),
    { enabled: false, reason: 'MEMORY_WRITER_DATABASE_URL_NOT_CONFIGURED' }
  );
  assert.throws(
    () => runtime.getMemoryWriterConfig({ ...validEnv, MIRA_HFM_MEMORY_WRITER_ROLE: 'bad role' }),
    error => error.code === 'MEMORY_WRITER_ROLE_CONFIG_INVALID'
  );
  assert.throws(
    () => runtime.getMemoryWriterConfig({
      ...validEnv,
      MIRA_HFM_MEMORY_DATABASE_URL: 'postgresql://writer:placeholder@db.example.com/neondb?sslmode=require'
    }),
    error => error.code === 'DATABASE_HOST_NOT_ALLOWLISTED'
  );
});

test('writer preflight requires the exact login role, limited privileges and forced RLS', () => {
  const config = runtime.getMemoryWriterConfig(validEnv);
  const report = runtime.verifyWriterPreflight(preflightRow(), config);
  assert.equal(report.status, 'MEMORY_WRITER_READY');
  assert.equal(report.rowLevelSecurityForced, true);
  assert.equal(report.hardDeleteAllowed, false);

  assert.throws(
    () => runtime.verifyWriterPreflight(preflightRow({ current_role: 'other_role' }), config),
    error => error.code === 'MEMORY_WRITER_IDENTITY_MISMATCH'
  );
  assert.throws(
    () => runtime.verifyWriterPreflight(preflightRow({ memory_rls_forced: false }), config),
    error => error.code === 'MEMORY_WRITER_REQUIRED_PRIVILEGE_MISSING'
  );
  assert.throws(
    () => runtime.verifyWriterPreflight(preflightRow({ records_delete: true }), config),
    error => error.code === 'MEMORY_WRITER_EXCESS_PRIVILEGE_DETECTED'
  );
  assert.throws(
    () => runtime.verifyWriterPreflight(preflightRow({ bypasses_rls: true }), config),
    error => error.code === 'MEMORY_WRITER_EXCESS_PRIVILEGE_DETECTED'
  );
  assert.throws(
    () => runtime.verifyWriterPreflight(preflightRow({ inherits_roles: false }), config),
    error => error.code === 'MEMORY_WRITER_REQUIRED_PRIVILEGE_MISSING'
  );
  assert.throws(
    () => runtime.verifyWriterPreflight(preflightRow({ owners_delete: true }), config),
    error => error.code === 'MEMORY_WRITER_EXCESS_PRIVILEGE_DETECTED'
  );
  assert.throws(
    () => runtime.verifyWriterPreflight(preflightRow({ role_membership_isolated: false }), config),
    error => error.code === 'MEMORY_WRITER_REQUIRED_PRIVILEGE_MISSING'
  );
  assert.throws(
    () => runtime.verifyWriterPreflight(preflightRow({ can_login: false }), config),
    error => error.code === 'MEMORY_WRITER_REQUIRED_PRIVILEGE_MISSING'
  );
  assert.throws(
    () => runtime.verifyWriterPreflight(preflightRow({ writer_actor_scope_policies_present: false }), config),
    error => error.code === 'MEMORY_WRITER_REQUIRED_PRIVILEGE_MISSING'
  );
});

test('writer pool uses a separate URL, explicit write mode and closes after failed preflight', async () => {
  let poolConfig;
  let closed = false;
  let seenSql = '';
  class FakePool {
    constructor(config) { poolConfig = config; }
    on() {}
    async connect() {
      return {
        async query(sql, params) {
          seenSql = sql;
          assert.deepEqual(params, ['mira_hfm_memory_writer']);
          return { rows: [preflightRow()] };
        },
        release() {}
      };
    }
    async end() { closed = true; }
  }
  const result = await runtime.createMemoryWriterPool({ env: validEnv, PoolCtor: FakePool });
  assert.equal(result.status, 'MEMORY_WRITER_READY');
  assert.equal(poolConfig.application_name, 'mira-hfm-memory-writer');
  assert.equal(poolConfig.options, undefined);
  assert.equal(poolConfig.ssl.rejectUnauthorized, true);
  assert.match(seenSql, /relforcerowsecurity = true/);
  assert.equal(closed, false);

  let failedPoolClosed = false;
  class DeniedPool extends FakePool {
    async connect() {
      return {
        async query() { return { rows: [preflightRow({ records_delete: true })] }; },
        release() {}
      };
    }
    async end() { failedPoolClosed = true; }
  }
  await assert.rejects(
    runtime.createMemoryWriterPool({ env: validEnv, PoolCtor: DeniedPool }),
    error => error.code === 'MEMORY_WRITER_EXCESS_PRIVILEGE_DETECTED'
  );
  assert.equal(failedPoolClosed, true);
});

console.log('HFM_MEMORY_WRITER_RUNTIME_TESTS=PASS');
