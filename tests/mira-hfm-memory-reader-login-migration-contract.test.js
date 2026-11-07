'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', 'hfm', '019_memory_reader_login_principal.sql'),
  'utf8'
);

assert.ok(sql.includes('SOURCE-ONLY DRAFT'));
assert.ok(sql.includes('Do not execute on production or staging without separate approval'));
assert.ok(sql.includes('CREATE ROLE mira_hfm_memory_reader_login'));
assert.ok(sql.includes('LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'));
assert.ok(sql.includes('HFM_MEMORY_READER_CAPABILITY_GROUP_REQUIRED'));
assert.ok(sql.includes('HFM_MEMORY_READER_GROUP_ATTRIBUTES_NOT_LEAST_PRIVILEGE'));
assert.ok(sql.includes('HFM_MEMORY_READER_GROUP_MUST_NOT_INHERIT_OTHER_ROLES'));
assert.ok(sql.includes('HFM_MEMORY_READER_GROUP_MUST_NOT_OWN_DATABASE_OBJECTS'));
assert.ok(sql.includes('HFM_MEMORY_READER_LOGIN_ATTRIBUTES_NOT_LEAST_PRIVILEGE'));
assert.ok(sql.includes('HFM_MEMORY_READER_LOGIN_HAS_UNEXPECTED_ROLE_MEMBERSHIP'));
assert.ok(sql.includes('roleid <> reader_oid OR admin_option'));
assert.ok(sql.includes('roleid <> reader_oid OR admin_option OR NOT inherit_option'));
assert.ok(sql.includes('HFM_MEMORY_READER_LOGIN_MUST_NOT_OWN_DATABASE_OBJECTS'));
assert.ok(sql.includes('GRANT mira_hfm_memory_reader TO mira_hfm_memory_reader_login'));
assert.ok(sql.includes('NOT rolcanlogin OR NOT rolinherit'));
assert.ok(sql.includes('rolsuper OR rolcreatedb'));
assert.ok(sql.includes('rolcreaterole OR rolreplication OR rolbypassrls'));
assert.doesNotMatch(sql, /CREATE ROLE[^;]*PASSWORD/i);
assert.doesNotMatch(sql, /ALTER ROLE[^;]*PASSWORD/i);
assert.doesNotMatch(sql, /GRANT\s+(SUPERUSER|CREATEDB|CREATEROLE|REPLICATION|BYPASSRLS)/i);
assert.doesNotMatch(sql, /GRANT\s+.*\s+TO\s+PUBLIC/i);

console.log('HFM_MEMORY_READER_LOGIN_PRINCIPAL_CREATED=CONTRACT_PASS');
console.log('HFM_MEMORY_READER_LOGIN_INHERITS_ONLY_READER_GROUP=CONTRACT_PASS');
console.log('HFM_MEMORY_READER_LOGIN_NO_ELEVATED_ATTRIBUTES=CONTRACT_PASS');
console.log('HFM_MEMORY_READER_LOGIN_NO_PASSWORD_IN_MIGRATION=CONTRACT_PASS');
console.log('HFM_MEMORY_READER_LOGIN_MIGRATION_SOURCE_ONLY=CONTRACT_PASS');
