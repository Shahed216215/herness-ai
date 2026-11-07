'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', 'hfm', '018_restricted_vault_write_authority.sql'),
  'utf8'
);

test('restricted vault record insert binds consumed authority purpose to exact record type', () => {
  assert.match(migration, /SOURCE-ONLY DRAFT/);
  assert.match(
    migration,
    /authority_row\.purpose = 'hfm-vault:' \|\| memory_records\.record_type \|\| ':explicit-user-request'/
  );
  assert.doesNotMatch(migration, /authority_row\.purpose LIKE 'hfm-vault:%'/);
});

test('restricted vault version insert independently binds authority purpose to version record type', () => {
  assert.match(
    migration,
    /authority_row\.purpose = 'hfm-vault:' \|\| memory_record_versions\.record_type \|\| ':explicit-user-request'/
  );
  assert.match(migration, /memory_record_versions\.record_type/);
  assert.doesNotMatch(migration, /authority_row\.purpose LIKE 'hfm-vault:%'/);
});

test('restricted vault authority can create only the initial version and must match parent revision', () => {
  const versionPolicy = migration
    .split('CREATE POLICY hfm_writer_memory_version_insert_scope')[1]
    ?.split('COMMENT ON POLICY')[0] || '';
  assert.match(
    versionPolicy,
    /classification = 'RESTRICTED'[\s\S]*?AND revision = 1[\s\S]*?memory\.vault\.write/
  );
  assert.match(
    versionPolicy,
    /parent_record\.revision = memory_record_versions\.revision/
  );
});

test('restricted vault writes remain exact-resource, consumed, short-lived and review-pending', () => {
  assert.match(migration, /authority_row\.resource = 'memory:' \|\| memory_records\.memory_id/);
  assert.match(migration, /authority_row\.status = 'CONSUMED'/);
  assert.match(migration, /authority_row\.consumed_at IS NOT NULL/);
  assert.match(migration, /authority_row\.expires_at > clock_timestamp\(\)/);
  assert.match(migration, /lifecycle = 'PENDING_REVIEW'/);
  assert.match(migration, /trust_status = 'SOURCE_RECORDED'/);
  assert.match(migration, /integrity_status = 'VERIFIED'/);
});

console.log('HFM_RESTRICTED_VAULT_AUTHORITY_TYPE_BINDING=PASS');
