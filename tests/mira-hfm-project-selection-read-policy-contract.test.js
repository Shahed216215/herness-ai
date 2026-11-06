"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "hfm", "006_project_selection_read_policy.sql"),
  "utf8"
);

assert.match(sql, /CREATE ROLE mira_hfm_project_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
assert.match(sql, /rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls/);
assert.match(sql, /HFM_PROJECT_READER_ROLE_MUST_NOT_INHERIT_PARENT_ROLES/);
assert.match(sql, /HFM_PROJECT_READER_ROLE_MUST_NOT_OWN_DATABASE_OBJECTS/);
assert.match(sql, /HFM_PROJECT_READER_POLICY_NAME_COLLISION/);
assert.match(sql, /pg_shdepend/);
assert.match(sql, /relrowsecurity AND c\.relforcerowsecurity/);
assert.match(sql, /GRANT SELECT ON TABLE mira_hfm\.project_owners, mira_hfm\.project_memberships/);
assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE|TRUNCATE|ALL)/i);
assert.match(sql, /CREATE POLICY hfm_project_reader_owner_select/);
assert.match(sql, /current_setting\('mira\.project_id', true\)/);
assert.match(sql, /CREATE POLICY hfm_project_reader_own_membership_select/);
assert.match(sql, /current_setting\('mira\.actor_id', true\)/);
assert.match(sql, /valid_from <= clock_timestamp\(\)/);
assert.match(sql, /expires_at IS NULL OR expires_at > clock_timestamp\(\)/);
assert.match(sql, /SOURCE-ONLY DRAFT/);
assert.match(sql, /Do not execute on production/i);
assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
assert.doesNotMatch(sql, /\bUPDATE\s+mira_hfm\./i);
assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+mira_hfm\./i);

console.log("PROJECT_SELECTION_READER_ROLE_NOLOGIN_AND_NO_BYPASS=PASS");
console.log("PROJECT_SELECTION_READER_SELECT_ONLY_GRANTS=PASS");
console.log("PROJECT_SELECTION_RLS_PROJECT_AND_ACTOR_SCOPED=PASS");
console.log("PROJECT_SELECTION_RLS_TIME_BOUNDED_MEMBERSHIP=PASS");
console.log("PROJECT_SELECTION_POLICY_MIGRATION_NO_DATA_MUTATION=PASS");
console.log("PROJECT_SELECTION_POLICY_MIGRATION_CONTRACT=PASS");
