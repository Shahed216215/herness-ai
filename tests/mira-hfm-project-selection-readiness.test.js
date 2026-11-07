"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const server = read("server.js");
const postgres = read("services/mira-hfm-postgres.js");
const writerRuntime = read("services/mira-hfm-memory-postgres-runtime.js");
const authority = read("services/mira-hfm-authority-transaction.js");
const identity = read("services/mira-hfm-runtime-identity-context.js");
const projectBinding = read("services/mira-hfm-project-binding-context.js");
const projectSelectionRoute = read("routes/mira-hfm-project-selection.js");
const memoryReadRuntime = read("services/mira-hfm-memory-read-runtime.js");
const authoritySchema = read("migrations/hfm/001_project_authority_registry.sql");
const projectReaderMigration = read("migrations/hfm/006_project_selection_read_policy.sql");

// The endpoint is additive and uses lazy, disabled-by-default runtime initialization.
assert.match(projectBinding, /SERVER_VERIFIED_PROJECT_SELECTION_REQUIRED/);
assert.match(projectBinding, /req\.session\.hfmProjectBinding/);
assert.match(server, /registerMiraHfmProjectSelectionRoute/);
assert.match(server, /createProjectSelectionReadRuntime/);
assert.match(server, /getHfmProjectReadRuntime/);
assert.match(projectSelectionRoute, /ACTIVE_MEMBERSHIP_VERIFIED/);
assert.match(projectSelectionRoute, /req\.session\.hfmProjectBinding/);
assert.doesNotMatch(projectSelectionRoute, /req\.body\.actorId/);
console.log("PROJECT_SELECTION_ROUTE_SESSION_BOUND_AND_LAZY=PASS");

// The generic Postgres adapter defaults to read-only, but the HFM runtime only exposes a writer pool.
assert.match(postgres, /const readOnly = options\.readOnly !== false/);
assert.match(postgres, /default_transaction_read_only=on/);
assert.match(writerRuntime, /function createMemoryWriterPool/);
assert.match(writerRuntime, /readOnly: false/);
assert.doesNotMatch(writerRuntime, /function createMemoryReadPool/);
assert.match(memoryReadRuntime, /function createMemoryReadPool/);
assert.match(memoryReadRuntime, /allowWrites: true/);
assert.match(memoryReadRuntime, /MEMORY_READ_NOT_ENABLED/);
console.log("CONSTRAINED_HFM_MEMORY_READ_RUNTIME_PRESENT_AND_DISABLED_BY_DEFAULT=PASS");

// The authority executor is a write-capable transaction and is not suitable for unauthorised discovery.
assert.match(authority, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
assert.match(authority, /UPDATE mira_hfm\.operation_authorities SET status = 'CONSUMED'/);
assert.match(authority, /SELECT project_id, owner_actor_id, status, revision/);
console.log("AUTHORITY_EXECUTOR_NOT_USED_FOR_PROJECT_DISCOVERY=PASS");

// Identity is derived from server-issued session principal, not caller-supplied identifiers.
assert.match(identity, /session\.hfmPrincipal/);
assert.match(identity, /principal\.authenticationRef !== sessionId/);
assert.match(identity, /normalizeTrustedActorIdentity/);
console.log("PROJECT_SELECTION_ACTOR_MUST_BE_SESSION_DERIVED=PASS");

// Schema supports active, time-bounded membership checks; project ID alone is not authorization.
assert.match(authoritySchema, /actor_id TEXT NOT NULL/);
assert.match(authoritySchema, /status TEXT NOT NULL CHECK \(status IN \('ACTIVE', 'REVOKED', 'EXPIRED'\)\)/);
assert.match(authoritySchema, /valid_from TIMESTAMPTZ NOT NULL/);
assert.match(authoritySchema, /expires_at TIMESTAMPTZ/);
assert.match(projectReaderMigration, /REVOKE ALL ON SCHEMA mira_hfm FROM mira_hfm_project_reader/);
assert.match(projectReaderMigration, /REVOKE ALL ON ALL TABLES IN SCHEMA mira_hfm FROM mira_hfm_project_reader/);
assert.match(projectReaderMigration, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA mira_hfm FROM mira_hfm_project_reader/);
assert.match(projectReaderMigration, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mira_hfm FROM mira_hfm_project_reader/);
assert.match(projectReaderMigration, /GRANT SELECT ON TABLE mira_hfm\.project_owners, mira_hfm\.project_memberships/);
console.log("MEMBERSHIP_STATUS_AND_VALIDITY_FIELDS_CONFIRMED=PASS");

console.log("HFM_PROJECT_SELECTION_READINESS_CONTRACT=PASS");
