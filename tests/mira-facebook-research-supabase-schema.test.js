'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'docs', 'architecture', 'mira-hybrid-memory', 'phase4', 'sql', '001_create_facebook_research_archive.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

assert.match(sql, /create table if not exists public\.mira_facebook_research_archive/i);
assert.match(sql, /archive_id text primary key/i);
assert.match(sql, /page_id text not null/i);
assert.match(sql, /payload jsonb not null/i);
assert.match(sql, /record_digest text not null/i);
assert.match(sql, /enable row level security/i);
assert.match(sql, /revoke all on table public\.mira_facebook_research_archive from anon/i);
assert.match(sql, /revoke all on table public\.mira_facebook_research_archive from authenticated/i);
assert.match(sql, /grant select, insert on table public\.mira_facebook_research_archive to service_role/i);
assert.match(sql, /payload->>'archivePolicy' = 'UNTRUSTED_RESEARCH_ONLY'/);
assert.match(sql, /payload->>'canonicalMemoryWrite' = 'false'/);
assert.match(sql, /payload->>'sourceIntegrity' = 'NOT_INDEPENDENTLY_VERIFIED'/);
assert.doesNotMatch(sql, /grant\s+update|grant\s+delete|create policy/i);

console.log('SUPABASE_SCHEMA_TABLE_AND_DIGEST_CONSTRAINTS_PASS=PASS');
console.log('SUPABASE_SCHEMA_RLS_AND_PUBLIC_ACCESS_REVOKED_PASS=PASS');
console.log('SUPABASE_SCHEMA_NO_UPDATE_DELETE_OR_PUBLIC_POLICY_PASS=PASS');
console.log('LIVE_DATABASE_MIGRATIONS=0');
console.log('TESTS_FAILED=0');
