'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', 'hfm', '019_memory_reader_login_principal.sql'),
  'utf8'
);

assert.match(sql, /SOURCE-ONLY DRAFT/);
assert.match(sql, /Do not execute on production or staging without separate approval/);
assert.match(sql, /mira_hfm_memory_reader_login/);
assert.match(sql, /CREATE ROLE mira_hfm_memory_reader_login[\\s\\S]*LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
assert.match(sql, /mira_hfm_memory_reader NOLOGIN/);
assert.match(sql, /HFM_MEMORY_READER_CAPABILITY_GROUP_REQUIRED/);
assert.match(sql, /HFM_MEMORY_READER_GROUP_MUST_NOT_INHERIT_OTHER_ROLES/);
assert.match(sql, /HFM_MEMORY_READER_GROUP_MUST_NOT_OWN_DATABASE_OBJECTS/);
assert.match(sql, /HFM_MEMORY_READER_LOGIN_HAS_UNEXPECTED_ROLE_MEMBERSHIP/);
assert.match(sql, /HFM_MEMORY_READER_LOGIN_MUST_NOT_OWN_DATABASE_OBJECTS/);
assert.match(sql, /GRANT mira_hfm_memory_reader TO mira_hfm_memory_reader_login/);
assert.doesNotMatch(sql, /CREATE ROLE[\\s\\S]*PASSWORD/i);
assert.doesNotMatch(sql, /ALTER ROLE[\\s\\S]*PASSWORD/i);
assert.doesNotMatch(sql, /GRANT\\s+(SUPERUSER|CREATEDB|CREATEROLE|REPLICATION|BYPASSRLS)/i);
assert.doesNotMatch(sql, /GRANT\\s+.*\\s+TO\\s+PUBLIC/i);
assert.match(sql, /NOT rolcanlogin OR NOT rolinherit/);
assert.match(sql, /rolsuper OR rolcreatedb/);
assert.match(sql, /rolcreaterole OR rolreplication OR rolbypassrls/);

console.log('HFM_MEMORY_READER_LOGIN_PRINCIPAL_CREATED=CONTRACT_PASS');
console.log('HFM_MEMORY_READER_LOGIN_INHERITS_ONLY_READER_GROUP=CONTRACT_PASS');
console.log('HFM_MEMORY_READER_LOGIN_NO_ELEVATED_ATTRIBUTES=CONTRACT_PASS');
console.log('HFM_MEMORY_READER_LOGIN_NO_PASSWORD_IN_MIGRATION=CONTRACT_PASS');
console.log('HFM_MEMORY_READER_LOGIN_MIGRATION_SOURCE_ONLY=CONTRACT_PASS');
