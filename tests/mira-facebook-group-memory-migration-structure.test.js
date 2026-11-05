'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20261105090000_mira_facebook_group_import_batches.sql'
);
const source = fs.readFileSync(migrationPath, 'utf8');
const compact = source
  .replace(/--[^\r\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const batchTable = 'mira_facebook_group_import_batches';
const auditTable = 'mira_facebook_group_import_audit_events';
const requireSql = (fragment, label) => {
  assert.ok(compact.includes(fragment.toLowerCase()), label);
};

requireSql('create table if not exists public.' + batchTable + ' (', 'Batch table declaration missing.');
requireSql('create table if not exists public.' + auditTable + ' (', 'Audit table declaration missing.');
requireSql('batch_id text primary key', 'Batch primary key missing.');
requireSql('event_id uuid primary key', 'Audit primary key missing.');
requireSql('batch_id text not null references public.' + batchTable + '(batch_id) on delete restrict', 'Audit foreign key missing.');
requireSql("batch_digest ~ '^[a-f0-9]{64}$'", 'Batch digest constraint missing.');
requireSql("event_digest ~ '^[a-f0-9]{64}$'", 'Audit digest constraint missing.');

for (const table of [batchTable, auditTable]) {
  requireSql('alter table public.' + table + ' enable row level security', 'RLS missing for ' + table + '.');
  requireSql('revoke all on table public.' + table + ' from public, anon, authenticated, service_role', 'Privilege revocation missing for ' + table + '.');
  requireSql('grant select, insert on table public.' + table + ' to service_role', 'Service-role least-privilege grant missing for ' + table + '.');
}

const grantStatements = compact.match(/grant\s+[^;]+;/g) || [];
assert.equal(grantStatements.length, 2, 'Unexpected grant statement count.');
assert.ok(grantStatements.every(statement => /^grant select, insert on table public\.[a-z_]+ to service_role;$/i.test(statement)), 'Unexpected grant found; only service_role SELECT/INSERT is allowed.');
assert.doesNotMatch(compact, /create policy\b/i, 'Client-facing RLS policy must not be introduced.');
assert.doesNotMatch(compact, /\b(drop table|truncate table|delete from|update public\.)\b/i, 'Destructive or mutation statement found.');

console.log('GROUP_IMPORT_MIGRATION_TABLES_AND_KEYS=PASS');
console.log('GROUP_IMPORT_MIGRATION_DIGEST_AND_IDENTITY_CONSTRAINTS=PASS');
console.log('GROUP_IMPORT_MIGRATION_RLS_AND_SERVICE_ROLE_GRANTS=PASS');
console.log('GROUP_IMPORT_MIGRATION_NO_CLIENT_POLICY_OR_MUTATION_GRANTS=PASS');

const recoveryPath = path.join(
  __dirname, '..', 'supabase', 'migrations',
  '20261105120000_mira_facebook_group_import_atomic_recovery.sql'
);
const recoverySource = fs.readFileSync(recoveryPath, 'utf8');
const recovery = recoverySource
  .replace(/--[^\r\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

assert.ok(recovery.includes('add column if not exists operation_key text'), 'Audit operation key migration missing.');
assert.ok(recovery.includes('unique (operation_key)'), 'Audit operation key uniqueness missing.');
assert.ok(recovery.includes('create or replace function public.mira_stage_facebook_group_import_v1'), 'Atomic recovery RPC missing.');
assert.ok(recovery.includes('security invoker'), 'RPC must use SECURITY INVOKER.');
assert.ok(recovery.includes('on conflict (batch_id) do nothing'), 'Batch insert must be idempotent.');
assert.ok(recovery.includes('on conflict (operation_key) do nothing'), 'Audit insert must be idempotent.');
assert.ok(recovery.includes('for update'), 'RPC must verify existing immutable rows under lock.');
assert.ok(recovery.includes('grant execute on function public.mira_stage_facebook_group_import_v1(jsonb, jsonb, text) to service_role'), 'RPC execute must be restricted to service_role.');
assert.doesNotMatch(recovery, /\b(drop table|truncate table|delete from|update public\.)\b/i, 'Recovery migration must remain additive.');

console.log('GROUP_IMPORT_RECOVERY_MIGRATION_ATOMIC_RPC_AND_IDEMPOTENCY=PASS');
console.log('NOTE=STATIC_SQL_STRUCTURE_ONLY_NO_POSTGRES_EXECUTION');
