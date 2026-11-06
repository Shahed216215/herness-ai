"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "hfm", "003_authority_relational_integrity.sql"),
  "utf8"
);

for (const constraint of [
  "project_memberships_project_owner_fk",
  "operation_authorities_project_owner_fk",
  "operation_authorities_membership_revision_fk"
]) {
  assert.ok(sql.includes(constraint), "missing relational constraint: " + constraint);
}

assert.match(sql, /FOREIGN KEY\s*\(project_id\)/i);
assert.match(sql, /FOREIGN KEY\s*\(project_id,\s*actor_id,\s*membership_revision\)/i);
assert.match(sql, /NOT VALID/i);
assert.equal((sql.match(/VALIDATE CONSTRAINT/g) || []).length, 3);
assert.match(sql, /Owner revisions are historical snapshots/i);
assert.doesNotMatch(sql, /FOREIGN KEY\s*\([^)]*owner_revision/i);
assert.match(sql, /ON DELETE RESTRICT/i);
assert.match(sql, /Audit events intentionally have no FK/i);

// Source-contract only: no PostgreSQL connection or SQL execution occurs here.
assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
assert.doesNotMatch(sql, /\bUPDATE\s+mira_hfm\./i);
assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+mira_hfm\./i);
assert.doesNotMatch(sql, /\bDROP\s+(TABLE|SCHEMA|INDEX|CONSTRAINT)\b/i);
assert.match(sql, /do not execute on production/i);

console.log("HFM_RELATIONAL_INTEGRITY_CONSTRAINTS=PASS");
console.log("HFM_RELATIONAL_INTEGRITY_VALIDATION_GATES=PASS");
console.log("HFM_RELATIONAL_INTEGRITY_NO_DATA_MUTATION=PASS");
console.log("HFM_RELATIONAL_INTEGRITY_CONTRACT_TEST=PASS");
