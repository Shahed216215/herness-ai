'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const sql = fs.readFileSync('migrations/hfm/008_project_bootstrap_issuer.sql', 'utf8');

test('project bootstrap migration grants insert only to the isolated issuer group', () => {
  assert.match(sql, /SOURCE-ONLY/);
  assert.match(sql, /GRANT INSERT ON TABLE mira_hfm\\.project_owners, mira_hfm\\.project_memberships/);
  assert.match(sql, /authority_issuer_owner_insert/);
  assert.match(sql, /authority_issuer_membership_insert/);
  assert.doesNotMatch(sql, /GRANT UPDATE|GRANT DELETE|GRANT .*memory_records/i);
});
