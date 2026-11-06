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
const authoritySchema = read("migrations/hfm/001_project_authority_registry.sql");

// The resolver is intentionally not an endpoint: only verified server code may set the binding.
assert.match(projectBinding, /SERVER_VERIFIED_PROJECT_SELECTION_REQUIRED/);
assert.match(projectBinding, /req\.session\.hfmProjectBinding/);
assert.doesNotMatch(server, /mira-hfm-project-binding-context/);
assert.doesNotMatch(server, /\/api\/hfm\/projects\/select/);
console.log("PROJECT_SELECTION_ENDPOINT_NOT_WIRED=PASS");

// The generic Postgres adapter defaults to read-only, but the HFM runtime only exposes a writer pool.
assert.match(postgres, /const readOnly = options\.readOnly !== false/);
assert.match(postgres, /default_transaction_read_only=on/);
assert.match(writerRuntime, /function createMemoryWriterPool/);
assert.match(writerRuntime, /readOnly: false/);
assert.doesNotMatch(writerRuntime, /function createMemoryReadPool/);
console.log("DEDICATED_HFM_READ_ONLY_POOL_MISSING=PASS");

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
console.log("MEMBERSHIP_STATUS_AND_VALIDITY_FIELDS_CONFIRMED=PASS");

console.log("HFM_PROJECT_SELECTION_READINESS_CONTRACT=PASS");
