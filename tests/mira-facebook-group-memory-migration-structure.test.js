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
const sql = source.replace(/--[^\r\n]*/g, '');
const compact = sql.replace(/\s+/g, ' ').trim();

const batchTable = 'mira_facebook_group_import_batches';
const auditTable = 'mira_facebook_group_import_audit_events';

assert.match(compact, new RegExp('create table if not exists public\\.' + batchTable + ' \\('));
assert.match(compact, new RegExp('create table if not exists public\\.' + auditTable + ' \\('));
assert.match(compact, /batch_id text primary key/i);
assert.match(compact, /event_id uuid primary key/i);
assert.match(compact, /batch_id text not null references public\.mira_facebook_group_import_batches\(batch_id\) on delete restrict/i);
assert.match(compact, /batch_digest ~ '\\^\[a-f0-9\]\{64\}\$'/i);
assert.match(compact, /event_digest ~ '\\^\[a-f0-9\]\{64\}\$'/i);
assert.equal((compact.match(/enable row level security/gi) || []).length, 2);
assert.equal((compact.match(/revoke all on table public\./gi) || []).length, 2);
assert.equal((compact.match(/grant select, insert on table public\./gi) || []).length, 2);
assert.equal((compact.match(/to service_role/gi) || []).length, 2);
assert.doesNotMatch(compact, /grant[^;]*\b(update|delete|all)\b/i);
assert.doesNotMatch(compact, /create policy\b/i);
assert.doesNotMatch(compact, /\b(drop table|truncate table|delete from|update public\.)\b/i);

console.log('GROUP_IMPORT_MIGRATION_TABLES_AND_KEYS=PASS');
console.log('GROUP_IMPORT_MIGRATION_DIGEST_AND_IDENTITY_CONSTRAINTS=PASS');
console.log('GROUP_IMPORT_MIGRATION_RLS_AND_SERVICE_ROLE_GRANTS=PASS');
console.log('GROUP_IMPORT_MIGRATION_NO_CLIENT_POLICY_OR_MUTATION_GRANTS=PASS');
console.log('NOTE=STATIC_SQL_STRUCTURE_ONLY_NO_POSTGRES_EXECUTION');
