'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', 'hfm', '004_memory_repository_schema.sql'),
  'utf8'
);

test('migration is explicitly source-only and creates empty structures only', () => {
  assert.match(sql, /SOURCE-ONLY DRAFT/);
  assert.match(sql, /Do not execute on production/);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+mira_hfm\./i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+mira_hfm\./i);
});

test('repository separates PUBLIC plaintext from encrypted private and restricted payloads', () => {
  assert.match(sql, /public_payload JSONB/);
  assert.match(sql, /encrypted_envelope JSONB/);
  assert.match(sql, /classification = 'PUBLIC'[\s\S]*?public_payload IS NOT NULL[\s\S]*?encrypted_envelope IS NULL/);
  assert.match(sql, /classification IN \('PROJECT_PRIVATE', 'RESTRICTED'\)[\s\S]*?public_payload IS NULL[\s\S]*?encrypted_envelope IS NOT NULL/);
  assert.match(sql, /public_search_vector TSVECTOR GENERATED ALWAYS AS/);
  assert.match(sql, /WHERE classification = 'PUBLIC'/);
});

test('client and financial records are restricted; daily, learning, and social drafts are private', () => {
  assert.match(sql, /client_vault_record', 'financial_vault_record'[\s\S]*?classification = 'RESTRICTED'/);
  assert.match(sql, /daily_activity', 'learning_note', 'social_post_draft'[\s\S]*?classification = 'PROJECT_PRIVATE'/);
});

test('repository has project scope, immutable versions, idempotency, and audit history', () => {
  for (const table of [
    'memory_records',
    'memory_record_versions',
    'memory_operation_registry',
    'memory_audit_events'
  ]) {
    assert.match(sql, new RegExp('CREATE TABLE IF NOT EXISTS mira_hfm\\.' + table + '\\b'));
  }
  assert.match(sql, /REFERENCES mira_hfm\.project_owners/);
  assert.match(sql, /UNIQUE \(project_id, idempotency_key\)/);
  assert.match(sql, /PRIMARY KEY \(memory_id, revision\)/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON mira_hfm\.memory_record_versions/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON mira_hfm\.memory_audit_events/);
  assert.match(sql, /BEFORE TRUNCATE ON mira_hfm\.memory_audit_events/);
});


test('immutable version rows preserve canonical type and classification constraints', () => {
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS mira_hfm.memory_record_versions');
  const end = sql.indexOf('CREATE TABLE IF NOT EXISTS mira_hfm.memory_operation_registry');
  const versions = sql.slice(start, end);
  assert.match(versions, /record_type TEXT NOT NULL[\s\S]*?CHECK \(record_type IN/);
  assert.match(versions, /schema_version = '1.0.0'[\s\S]*?research_reference/);
  assert.match(versions, /client_vault_record', 'financial_vault_record'[\s\S]*?classification = 'RESTRICTED'/);
  assert.match(versions, /daily_activity', 'learning_note', 'social_post_draft'[\s\S]*?classification = 'PROJECT_PRIVATE'/);
  assert.match(versions, /jsonb_typeof\(public_payload -> 'content'\) = 'string'/);
});


test('current records preserve immutable identity, monotonic revisions, and no hard-delete path', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION mira_hfm\.guard_memory_record_update/);
  assert.match(sql, /HFM_MEMORY_RECORD_IDENTITY_IMMUTABLE/);
  assert.match(sql, /HFM_MEMORY_REVISION_MUST_INCREMENT/);
  assert.match(sql, /HFM_MEMORY_UPDATED_AT_MUST_ADVANCE/);
  assert.match(sql, /memory_records_no_delete/);
  assert.match(sql, /memory_records_no_truncate/);
  assert.match(sql, /memory_operations_no_delete/);
});

test('migration does not grant a writer role or broad application privileges', () => {
  assert.doesNotMatch(sql, /\bCREATE\s+ROLE\b/i);
  assert.doesNotMatch(sql, /\bGRANT\s+(INSERT|UPDATE|DELETE|ALL)\b/i);
  assert.match(sql, /REVOKE ALL ON TABLE/);
  assert.doesNotMatch(sql, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA mira_hfm/i);
  assert.match(sql, /REVOKE ALL ON SEQUENCE mira_hfm\.memory_audit_events_event_sequence_seq FROM PUBLIC/);
});

test('migration PL/pgSQL function and DO blocks use valid dollar quoting', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION mira_hfm\.guard_memory_record_update\(\)\s+RETURNS TRIGGER\s+LANGUAGE plpgsql\s+AS \$\$/);
  assert.match(sql, /DO \$\$\s+BEGIN/);
  assert.match(sql, /END;\s+\$\$;\s+REVOKE ALL ON TABLE/);
});

test('social draft deletion is recoverable through the TRASHED lifecycle', () => {
  assert.equal((sql.match(/'TRASHED'/g) || []).length >= 2, true);
  assert.equal((sql.match(/trashed_at TIMESTAMPTZ/g) || []).length, 2);
  assert.equal((sql.match(/trashed_by_actor_id TEXT/g) || []).length, 2);
  assert.match(sql, /lifecycle = 'TRASHED'[\s\S]*?trashed_at IS NOT NULL[\s\S]*?trashed_by_actor_id IS NOT NULL/);
  assert.match(sql, /BEFORE DELETE ON mira_hfm\.memory_records/);
  assert.match(sql, /HFM_MEMORY_HISTORY_IS_APPEND_ONLY/);
});

console.log('HFM_MEMORY_REPOSITORY_MIGRATION_SOURCE_CONTRACT=PASS');
