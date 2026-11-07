'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const sql = fs.readFileSync('migrations/hfm/007_authority_issuer_role.sql', 'utf8');

test('authority issuer migration is source-only and creates no login credential', () => {
  assert.match(sql, /SOURCE-ONLY/);
  assert.match(sql, /CREATE ROLE mira_hfm_authority_issuer NOLOGIN/);
  assert.doesNotMatch(sql, /CREATE ROLE\s+\S+\s+LOGIN/i);
  assert.doesNotMatch(sql, /PASSWORD/i);
});

test('issuer role is isolated from Memory payload tables and narrowly scoped by project RLS', () => {
  assert.match(sql, /GRANT SELECT ON TABLE mira_hfm\.project_owners, mira_hfm\.project_memberships/);
  assert.match(sql, /GRANT INSERT ON TABLE mira_hfm\.operation_authorities, mira_hfm\.authority_audit_events/);
  assert.match(sql, /authority_issuer_insert/);
  assert.match(sql, /authority_issuer_audit_insert/);
  assert.doesNotMatch(sql, /GRANT .*memory_records|GRANT .*memory_record_versions/i);
});
