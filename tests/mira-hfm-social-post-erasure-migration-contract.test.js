'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const sql = fs.readFileSync('migrations/hfm/006_social_post_manual_publish_payload_erasure.sql', 'utf8');
const provenanceSql = fs.readFileSync('migrations/hfm/010_social_post_provenance_retention.sql', 'utf8');

test('migration is explicitly source-only and transaction-wrapped', () => {
  assert.match(sql, /SOURCE-ONLY/i);
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /HFM_SOCIAL_POST_PREREQUISITES_MISSING/);
});

test('only social_post_draft PROJECT_PRIVATE payloads can be erased', () => {
  assert.match(sql, /record_type = 'social_post_draft'/);
  assert.match(sql, /classification = 'PROJECT_PRIVATE'/);
  assert.match(sql, /payload_erased_at IS NOT NULL/);
  assert.match(sql, /public_payload IS NULL AND encrypted_envelope IS NULL/);
});

test('version history remains metadata-only and cannot be deleted or generally updated', () => {
  assert.match(sql, /memory_record_versions/);
  assert.match(sql, /HFM_MEMORY_HISTORY_IS_APPEND_ONLY/);
  assert.match(sql, /mira\.memory_payload_erasure_operation_id/);
  assert.match(sql, /op\.operation = 'memory\.social_post\.delete_payload'/);
  assert.match(sql, /op\.status = 'REQUESTED'/);
  assert.match(sql, /NEW\.payload_erased_by_actor_id = OLD\.owner_actor_id/);
  assert.match(sql, /NEW\.recorded_at = OLD\.recorded_at/);
  assert.match(sql, /NEW\.updated_at = OLD\.updated_at/);
  assert.match(sql, /GRANT UPDATE ON TABLE mira_hfm\.memory_record_versions TO mira_hfm_memory_writer/);
});

test('social status and RLS are project-scoped', () => {
  assert.match(sql, /memory_social_post_state/);
  assert.match(sql, /USER_CONFIRMED_PUBLISHED/);
  assert.match(sql, /DELETE_STATUS_UNKNOWN/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /current_setting\('mira\.project_id', true\)/);
});

test('migration does not grant delete or truncate permissions', () => {
  assert.doesNotMatch(sql, /GRANT\s+[^;]*(DELETE|TRUNCATE)/i);
  assert.doesNotMatch(sql, /DROP\s+TABLE/i);
});


test('payload erasure trigger uses an unambiguous operation id variable', () => {
  assert.match(sql, /v_operation_id := NULLIF\(current_setting\('mira\.memory_payload_erasure_operation_id'/);
  assert.match(sql, /op\.operation_id = v_operation_id/);
  assert.doesNotMatch(sql, /op\.operation_id = operation_id/);
  assert.doesNotMatch(sql, /IF operation_id IS NOT NULL/);
  assert.equal((sql.match(/v_operation_id IS NOT NULL/g) || []).length, 2);
});


test('payload erasure guards permit only payload fields to change', () => {
  assert.match(sql, /NEW\.revision = OLD\.revision/);
  assert.match(sql, /NEW\.recorded_at = OLD\.recorded_at/);
  assert.match(sql, /NEW\.updated_at = OLD\.updated_at/);
  assert.match(sql, /NEW\.trashed_at IS NOT DISTINCT FROM OLD\.trashed_at/);
  assert.doesNotMatch(sql, /to_jsonb\(NEW\)\s*-\s*ARRAY/);
});

test('migration PL/pgSQL blocks use valid balanced dollar-quote delimiters', () => {
  assert.doesNotMatch(sql, /^DO \$(?!\$)/m);
  assert.doesNotMatch(sql, /^\$;$/m);
  assert.equal((sql.match(/^(?:DO|AS) \$\$/gm) || []).length,
    (sql.match(/^\$\$;$/gm) || []).length);
});

test('provenance retention migration is source-only and retains only allowlisted metadata', () => {
  assert.match(provenanceSql, /SOURCE-ONLY/i);
  assert.match(provenanceSql, /memory_social_post_state/);
  assert.match(provenanceSql, /source_metadata/);
  assert.match(provenanceSql, /provenance_metadata/);
  assert.match(provenanceSql, /sourceType/);
  assert.match(provenanceSql, /collectionMethod/);
  assert.doesNotMatch(provenanceSql, /content|encrypted_envelope|access_token|private_payload/i);
});
