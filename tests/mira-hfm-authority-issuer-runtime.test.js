'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const runtime = require('../services/mira-hfm-authority-issuer-runtime');

const env = {
  MIRA_HFM_AUTHORITY_ISSUER_ENABLED: 'true',
  MIRA_HFM_AUTHORITY_ISSUER_DATABASE_URL: 'postgresql://issuer:synthetic-password@ep-test.neon.tech/neondb?sslmode=require',
  MIRA_HFM_AUTHORITY_ISSUER_ROLE: 'mira_hfm_authority_issuer_login'
};

function validRow() {
  return {
    current_role: env.MIRA_HFM_AUTHORITY_ISSUER_ROLE,
    database_name: 'neondb',
    is_superuser: false,
    bypasses_rls: false,
    can_create_roles: false,
    can_create_databases: false,
    inherits_roles: true,
    can_login: true,
    can_replicate: false,
    has_issuer_group: true,
    schema_usage: true,
    schema_create: false,
    owners_select: true,
    owners_insert: true,
    owners_update: false,
    memberships_select: true,
    memberships_insert: true,
    memberships_update: false,
    authorities_insert: true,
    audit_insert: true,
    audit_sequence_usage: true,
    memory_select: false,
    memory_insert: false,
    memory_update: false,
    versions_select: false,
    versions_insert: false,
    operations_select: false,
    authority_rls_forced: true
  };
}

test('authority issuer runtime is disabled unless explicitly enabled', () => {
  assert.deepEqual(runtime.configFrom({}), { enabled: false, reason: 'AUTHORITY_ISSUER_NOT_ENABLED' });
});

test('authority issuer config requires Neon TLS URL and exact role name', () => {
  assert.throws(() => runtime.configFrom({
    ...env,
    MIRA_HFM_AUTHORITY_ISSUER_DATABASE_URL: 'postgresql://user:pass@example.com/db?sslmode=require'
  }), /DATABASE_HOST_NOT_ALLOWLISTED/);
  assert.throws(() => runtime.configFrom({
    ...env,
    MIRA_HFM_AUTHORITY_ISSUER_ROLE: 'bad role'
  }), /AUTHORITY_ISSUER_ROLE_INVALID/);
});

test('authority issuer preflight accepts only the dedicated minimal privilege profile', () => {
  const config = runtime.configFrom(env);
  assert.deepEqual(runtime.verify(validRow(), config), {
    status: 'AUTHORITY_ISSUER_READY',
    role: env.MIRA_HFM_AUTHORITY_ISSUER_ROLE,
    databaseName: 'neondb'
  });
  assert.throws(() => runtime.verify({ ...validRow(), memory_select: true }, config), /AUTHORITY_ISSUER_EXCESS_PRIVILEGE/);
  assert.throws(() => runtime.verify({ ...validRow(), owners_update: true }, config), /AUTHORITY_ISSUER_EXCESS_PRIVILEGE/);
  assert.throws(() => runtime.verify({ ...validRow(), owners_insert: false }, config), /AUTHORITY_ISSUER_REQUIRED_PRIVILEGE_MISSING/);
});

test('authority issuer pool performs preflight and fails closed on excess grants', async () => {
  class FakePool {
    constructor() { this.closed = false; }
    on() {}
    async connect() {
      return { query: async () => ({ rows: [validRow()] }), release() {} };
    }
    async end() { this.closed = true; }
  }
  const ready = await runtime.createAuthorityIssuerPool({ env, PoolCtor: FakePool });
  assert.equal(ready.status, 'AUTHORITY_ISSUER_READY');
  assert.ok(ready.pool);
  class ExcessPool extends FakePool {
    async connect() {
      return { query: async () => ({ rows: [{ ...validRow(), memory_select: true }] }), release() {} };
    }
  }
  await assert.rejects(runtime.createAuthorityIssuerPool({ env, PoolCtor: ExcessPool }), /AUTHORITY_ISSUER_EXCESS_PRIVILEGE/);
});

