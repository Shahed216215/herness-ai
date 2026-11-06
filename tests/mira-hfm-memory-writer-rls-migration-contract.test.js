'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', 'hfm', '005_memory_writer_role_and_project_rls.sql'),
  'utf8'
);

test('writer migration is source-only and creates no login credential', () => {
  assert.match(sql, /SOURCE-ONLY DRAFT/);
  assert.match(sql, /Do not execute on production/);
  assert.match(sql, /NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.doesNotMatch(sql, /\bCREATE\s+ROLE\s+\S+\s+LOGIN\b/i);
  assert.doesNotMatch(sql, /\bPASSWORD\b/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b|\bUPDATE\s+mira_hfm\.|\bDELETE\s+FROM\s+mira_hfm\./i);
});

test('writer group receives only the required table and sequence privileges', () => {
  assert.match(sql, /GRANT USAGE ON SCHEMA mira_hfm TO mira_hfm_memory_writer/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON TABLE mira_hfm\.memory_records/);
  assert.match(sql, /GRANT INSERT ON TABLE mira_hfm\.memory_record_versions/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON TABLE mira_hfm\.memory_operation_registry/);
  assert.match(sql, /GRANT SELECT, INSERT ON TABLE mira_hfm\.memory_audit_events/);
  assert.match(sql, /GRANT SELECT, UPDATE ON TABLE mira_hfm\.operation_authorities/);
  assert.match(sql, /GRANT INSERT ON TABLE mira_hfm\.authority_audit_events/);
  assert.match(sql, /GRANT USAGE ON SEQUENCE mira_hfm\.memory_audit_events_event_sequence_seq/);
  assert.doesNotMatch(sql, /GRANT\s+(DELETE|TRUNCATE|ALL)\b/i);
  assert.doesNotMatch(sql, /GRANT\s+CREATE\s+ON\s+SCHEMA/i);
});

test('all four Memory tables force project-scoped row-level security', () => {
  for (const table of [
    'memory_records',
    'memory_record_versions',
    'memory_operation_registry',
    'memory_audit_events'
  ]) {
    assert.match(sql, new RegExp('ALTER TABLE mira_hfm\\.' + table + ' ENABLE ROW LEVEL SECURITY'));
    assert.match(sql, new RegExp('ALTER TABLE mira_hfm\\.' + table + ' FORCE ROW LEVEL SECURITY'));
    assert.match(sql, new RegExp('CREATE POLICY [a-z_]+[\\s\\S]*?ON mira_hfm\\.' + table));
  }
  assert.equal((sql.match(/current_setting\('mira\.project_id', true\)/g) || []).length, 8);
  assert.match(sql, /NULLIF\(current_setting\('mira\.project_id', true\), ''\)/);
});

test('writer login membership and credentials remain a separate reviewed setup', () => {
  assert.match(sql, /does not create credentials or a login role/i);
  assert.match(sql, /separate, dedicated login role must be created/i);
  assert.doesNotMatch(sql, /GRANT mira_hfm_memory_writer TO/);
});

console.log('HFM_MEMORY_WRITER_RLS_MIGRATION_CONTRACT=PASS');
