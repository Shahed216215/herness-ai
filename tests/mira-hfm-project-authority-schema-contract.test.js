"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "hfm", "001_project_authority_registry.sql"),
  "utf8"
);

for (const table of [
  "project_owners",
  "project_memberships",
  "operation_authorities",
  "authority_audit_events"
]) {
  assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS mira_hfm\\." + table + "\\b"));
}

assert.match(sql, /project_id TEXT PRIMARY KEY/);
assert.match(sql, /project_memberships_one_active_actor/);
assert.match(sql, /revoked_by_actor_id IS NOT NULL/);
assert.match(sql, /request_id TEXT NOT NULL UNIQUE/);
assert.match(sql, /membership_revision BIGINT NOT NULL/);
assert.match(sql, /owner_revision BIGINT NOT NULL/);
assert.match(sql, /BEFORE UPDATE OR DELETE ON mira_hfm\.authority_audit_events/);
assert.match(sql, /BEFORE TRUNCATE ON mira_hfm\.authority_audit_events/);
assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA mira_hfm FROM PUBLIC/);

// This is a source-contract test only; it does not parse or execute PostgreSQL SQL.
assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
assert.doesNotMatch(sql, /\bUPDATE\s+mira_hfm\./i);
assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+mira_hfm\./i);
assert.match(sql, /DO NOT execute against production/);
assert.match(sql, /creates EMPTY tables/);

console.log("HFM_AUTHORITY_SCHEMA_TABLES=PASS");
console.log("HFM_AUTHORITY_SCHEMA_REVISION_AND_REPLAY_GUARDS=PASS");
console.log("HFM_AUTHORITY_AUDIT_APPEND_ONLY_GUARDS=PASS");
console.log("HFM_AUTHORITY_SCHEMA_NO_SEED_OR_DATA_MUTATION=PASS");
console.log("HFM_AUTHORITY_SCHEMA_CONTRACT_TEST=PASS");
