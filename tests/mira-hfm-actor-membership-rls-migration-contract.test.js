'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', 'hfm', '015_actor_membership_operation_rls.sql'),
  'utf8'
);
const transaction = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'mira-hfm-authority-transaction.js'),
  'utf8'
);

test('015 is an additive source-only RLS policy migration with no grants or data mutation', () => {
  assert.match(migration, /SOURCE-ONLY DRAFT/);
  assert.match(migration, /Do not execute on production/);
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
  assert.doesNotMatch(migration, /\b(?:INSERT\s+INTO|UPDATE\s+mira_hfm\.|DELETE\s+FROM\s+mira_hfm\.|TRUNCATE)\b/i);
  assert.doesNotMatch(migration, /\b(?:GRANT|REVOKE|CREATE\s+ROLE|ALTER\s+ROLE)\b/i);
});

test('writer RLS requires active owner, actor membership permission, exact resource and consumed authority', () => {
  for (const policy of [
    'hfm_writer_owner_active',
    'hfm_writer_membership_permission',
    'hfm_writer_consumed_authority_scope',
    'hfm_writer_consume_exact_authority',
    'hfm_writer_consumed_authority_audit',
    'hfm_writer_memory_record_select_scope',
    'hfm_writer_memory_record_insert_scope',
    'hfm_writer_memory_record_update_scope',
    'hfm_writer_memory_version_insert_scope',
    'hfm_writer_operation_registry_scope',
    'hfm_writer_memory_audit_select_scope',
    'hfm_writer_memory_audit_insert_scope'
  ]) {
    assert.match(migration, new RegExp('CREATE POLICY ' + policy));
    assert.match(migration, new RegExp('CREATE POLICY ' + policy + '[\\s\\S]*?AS RESTRICTIVE'));
  }
  assert.match(migration, /permissions -> 'operations' \? NULLIF\(current_setting\('mira\.operation', true\), ''\)/);
  assert.match(migration, /owner_actor_id = NULLIF\(current_setting\('mira\.actor_id', true\), ''\)/);
  assert.match(migration, /authority_row\.status = 'CONSUMED'/);
  assert.match(migration, /CREATE POLICY hfm_reader_consumed_authority_select[\s\S]*?status = 'CONSUMED'/);
  assert.match(migration, /classification IN \('PUBLIC', 'PROJECT_PRIVATE'\)/);
  assert.doesNotMatch(migration, /classification IN \('PUBLIC', 'PROJECT_PRIVATE', 'RESTRICTED'\)/);
});

test('reader RLS requires memory.read membership and a live standing or consumed authority', () => {
  for (const policy of [
    'hfm_reader_membership_permission',
    'hfm_reader_consumed_authority_select',
    'hfm_reader_consumed_authority_scope',
    'hfm_reader_consume_exact_authority',
    'hfm_reader_authority_audit_request_scope',
    'hfm_reader_memory_membership_authority_scope'
  ]) {
    assert.match(migration, new RegExp('CREATE POLICY ' + policy));
  }
  assert.match(migration, /permissions -> 'operations' \? 'memory\.read'/);
  assert.match(migration, /standing_row\.status = 'ACTIVE'/);
  assert.match(migration, /standing_row\.expires_at > clock_timestamp\(\)/);
  assert.match(migration, /authority_row\.status = 'CONSUMED'/);
  assert.match(migration, /request_id = NULLIF\(current_setting\('mira\.request_id', true\), ''\)/);
  assert.match(migration, /CREATE POLICY hfm_memory_reader_trashed_social_draft_select[\s\S]*?lifecycle = 'TRASHED'[\s\S]*?record_type = 'social_post_draft'/);
  assert.match(migration, /lifecycle = 'TRASHED'[\s\S]*?record_type = 'social_post_draft'[\s\S]*?mira\.standing_read_authority/);
});

test('authority transactions bind project, actor, operation, resource and request ID locally', () => {
  assert.match(transaction, /set_config\('mira\.project_id'/);
  assert.match(transaction, /set_config\('mira\.actor_id'/);
  assert.match(transaction, /set_config\('mira\.operation'/);
  assert.match(transaction, /set_config\('mira\.resource'/);
  assert.match(transaction, /set_config\('mira\.request_id'/);
  assert.match(transaction, /set_config\('mira\.standing_read_authority', 'true', true\)/);
});

console.log('HFM_ACTOR_MEMBERSHIP_OPERATION_RLS_MIGRATION_CONTRACT=PASS');
