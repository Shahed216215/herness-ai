'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const sql = fs.readFileSync('migrations/hfm/009_dedicated_login_principals.sql', 'utf8');

test('dedicated runtime login roles inherit only their matching no-login capability groups', () => {
  assert.match(sql, /SOURCE-ONLY DRAFT/);
  assert.match(sql, /CREATE ROLE mira_hfm_memory_writer_login[\s\S]*?LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(sql, /CREATE ROLE mira_hfm_authority_issuer_login[\s\S]*?LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(sql, /GRANT mira_hfm_memory_writer TO mira_hfm_memory_writer_login/);
  assert.match(sql, /GRANT mira_hfm_authority_issuer TO mira_hfm_authority_issuer_login/);
  assert.match(sql, /HFM_LOGIN_ROLE_HAS_UNEXPECTED_ROLE_MEMBERSHIP/);
  assert.doesNotMatch(sql, /PASSWORD\s+['\"]/i);
  assert.doesNotMatch(sql, /GRANT .* TO PUBLIC/i);
});
