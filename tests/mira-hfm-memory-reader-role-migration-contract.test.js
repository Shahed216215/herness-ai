'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', 'hfm', '007_memory_retrieval_runtime_role.sql'),
  'utf8'
);

assert.match(sql, /SOURCE-ONLY DRAFT/);
assert.match(sql, /Do not execute on production or staging without separate approval/);
assert.match(sql, /CREATE ROLE mira_hfm_memory_reader[\s\S]*NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
assert.match(sql, /HFM_MEMORY_READER_GROUP_MUST_NOT_INHERIT_OTHER_ROLES/);
assert.match(sql, /HFM_MEMORY_READER_GROUP_MUST_NOT_OWN_DATABASE_OBJECTS/);
assert.match(sql, /GRANT SELECT, UPDATE ON TABLE mira_hfm\.operation_authorities/);
assert.match(sql, /GRANT INSERT ON TABLE mira_hfm\.authority_audit_events/);
assert.match(sql, /GRANT SELECT ON TABLE mira_hfm\.memory_records/);
assert.match(sql, /GRANT SELECT ON TABLE[\s\S]*mira_hfm\.project_owners[\s\S]*mira_hfm\.project_memberships/);
assert.doesNotMatch(sql, /GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE|ALL)\s+ON\s+TABLE\s+mira_hfm\.memory_records/i);
assert.doesNotMatch(sql, /GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE|ALL)\s+ON\s+TABLE\s+mira_hfm\.project_(owners|memberships)/i);
assert.doesNotMatch(sql, /GRANT\s+INSERT\s+ON\s+TABLE\s+mira_hfm\.operation_authorities/i);
assert.doesNotMatch(sql, /GRANT\s+DELETE|GRANT\s+TRUNCATE|GRANT\s+ALL/i);
assert.match(sql, /hfm_memory_reader_authority_consume_update/);
assert.match(sql, /status = 'ISSUED'/);
assert.match(sql, /status = 'CONSUMED'/);
assert.match(sql, /actor_id = NULLIF\(current_setting\('mira\.actor_id', true\), ''\)/);
assert.match(sql, /classification IN \('PUBLIC', 'PROJECT_PRIVATE'\)/);
assert.match(sql, /lifecycle = 'ACTIVE'/);
assert.doesNotMatch(sql, /\bINSERT\s+INTO\b|\bUPDATE\s+mira_hfm\.|\bDELETE\s+FROM\s+mira_hfm\./i);
console.log('HFM_MEMORY_READER_ROLE_NOLOGIN_AND_NO_BYPASS=PASS');
console.log('HFM_MEMORY_READER_AUTHORITY_CONSUME_ONLY=PASS');
console.log('HFM_MEMORY_READER_MEMORY_SELECT_ONLY=PASS');
console.log('HFM_MEMORY_READER_PROJECT_ACTOR_RLS=PASS');
console.log('HFM_MEMORY_READER_MIGRATION_SOURCE_ONLY=PASS');
