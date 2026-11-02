# MIRA HYBRID MEMORY
## Phase 2 — Detailed Technical Contract v0.2.0

Document ID: MIRA-HFM-PHASE2-DTC-001
Status: PROPOSED — DESIGN ONLY — NOT IMPLEMENTED

## 1. Purpose and constraints

This specification defines canonical records, adapters, capabilities,
conflict handling, recovery, Evolution integration and offline tests.

Phone-local storage is not an approved Mira Memory backend.
Existing data must be preserved until migration and recovery are
independently verified and separately authorized.

Facebook Page is a proposed primary provider subject to permission
and API verification. Facebook Group is a secondary/manual import
source. Public Web Search is retrieval, not durable Memory storage.
Google Drive is emergency backup only.

No unauthorized private Group access, secrets in Memory, silent
fallback, hidden network calls, production restore or destructive
migration is permitted.

## 2. Canonical Memory JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:mira:hfm:memory-record:1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion", "memoryId", "projectId", "recordType",
    "content", "source", "timestamps", "version",
    "integrity", "trust", "access", "lifecycle"
  ],
  "properties": {
    "schemaVersion": {"type": "string", "const": "1.0.0"},
    "memoryId": {"type": "string", "minLength": 8, "maxLength": 128},
    "projectId": {"type": "string", "minLength": 1, "maxLength": 128},
    "recordType": {
      "type": "string",
      "enum": ["fact", "decision", "preference", "procedure",
        "lesson", "experience", "strategy", "project",
        "conversation_reference", "knowledge", "research_reference"]
    },
    "content": {"type": "string", "minLength": 1, "maxLength": 100000},
    "source": {
      "type": "object",
      "required": ["sourceType", "sourceId", "observedAt"],
      "properties": {
        "sourceType": {
          "type": "string",
          "enum": ["facebook_page", "facebook_group", "web", "manual",
            "legacy_import", "internal_system", "google_drive_backup"]
        },
        "sourceId": {"type": "string", "minLength": 1},
        "sourceUrl": {"type": ["string", "null"]},
        "observedAt": {"type": "string", "format": "date-time"}
      }
    },
    "timestamps": {
      "type": "object",
      "required": ["createdAt", "updatedAt"],
      "properties": {
        "createdAt": {"type": "string", "format": "date-time"},
        "updatedAt": {"type": "string", "format": "date-time"}
      }
    },
    "version": {
      "type": "object",
      "required": ["revision", "contentHash"],
      "properties": {
        "revision": {"type": "integer", "minimum": 1},
        "contentHash": {"type": "string", "pattern": "^[a-f0-9]{64}$"}
      }
    },
    "integrity": {
      "type": "object",
      "required": ["status", "algorithm"],
      "properties": {
        "status": {"enum": ["UNVERIFIED", "VERIFIED", "FAILED", "QUARANTINED"]},
        "algorithm": {"const": "SHA-256"}
      }
    },
    "trust": {
      "type": "object",
      "required": ["status"],
      "properties": {
        "status": {"enum": ["UNVERIFIED", "SOURCE_RECORDED",
          "SOURCE_REACHABLE", "CONTENT_VERIFIED", "HUMAN_VERIFIED",
          "QUARANTINED"]}
      }
    },
    "access": {
      "type": "object",
      "required": ["classification"],
      "properties": {
        "classification": {"enum": ["PUBLIC", "PROJECT_PRIVATE", "RESTRICTED"]},
        "allowedProjectIds": {"type": "array", "uniqueItems": true,
          "items": {"type": "string"}}
      }
    },
    "lifecycle": {
      "enum": ["ACTIVE", "SUPERSEDED", "ARCHIVED", "QUARANTINED", "PENDING_REVIEW"]
    }
  }
}
```

Identity rules:
- memoryId identifies the logical record across providers.
- Provider IDs are adapter metadata.
- Hashes require documented canonical serialization.
- Invalid records and unsupported critical schema versions are rejected.
- Content must never be silently truncated.
- Restricted records must not cross project boundaries.

## 3. Provider Adapter API

```js
class MemoryProviderAdapter {
  async getCapabilities(context) {}
  async read(query, context) {}
  async write(record, context) {}
  async update(memoryId, patch, context) {}
  async search(query, filters, context) {}
  async verify(memoryId, context) {}
  async listVersions(memoryId, context) {}
  async backup(scope, context) {}
  async restore(backupId, context) {}
}
```

Context requires requestId, projectId, actor, purpose and
policyDecisionId. Updates also require expectedRevision.

Result statuses:
SUCCESS, PARTIAL, NOT_CONFIGURED, PERMISSION_DENIED, RATE_LIMITED,
CONFLICT, VALIDATION_FAILED, INTEGRITY_FAILED, TIMEOUT,
PROVIDER_ERROR, NOT_FOUND, NOT_SUPPORTED and UNKNOWN.

A timeout after a possible write is UNKNOWN until reconciled.
No blind retries. Read and Write capabilities are independent.
No silent provider fallback.


## 4. Capability and Permission State Machine

Each provider independently exposes READ, WRITE, SEARCH, VERIFY,
BACKUP and RESTORE capabilities.

States: AVAILABLE, UNAVAILABLE, NOT_CONFIGURED, PERMISSION_DENIED,
RATE_LIMITED and UNKNOWN.

UNKNOWN fails closed. Read permission never implies Write permission.
Permission denial cannot trigger privilege escalation. Rate limits
must respect provider guidance. No silent provider fallback.

Consequential operations require an authenticated actor, project
authorization, operation capability, policy approval and audit ID.

## 5. Conflict Resolution and Quarantine

Conflict categories: IDENTITY_CONFLICT, REVISION_CONFLICT,
CONTENT_CONFLICT, SOURCE_CONFLICT, ACCESS_CONFLICT,
SCHEMA_CONFLICT and INTEGRITY_CONFLICT.

States: DETECTED, QUARANTINED, UNDER_REVIEW, RESOLVED, REJECTED.

Quarantined records are excluded from trusted retrieval and preserved
for investigation. No silent overwrite or unconditional last-write-wins.

A merge preserves source versions, hashes, provenance, conflict reason,
resolution actor and resulting revision.

## 6. Backup and Restore Recovery

Backup states: REQUESTED, AUTHORIZED, EXPORTING, ENCRYPTING,
VERIFYING, VERIFIED, FAILED and QUARANTINED.

Restore states: REQUESTED, VALIDATING, AWAITING_APPROVAL, AUTHORIZED,
PREPARING_RECOVERY_POINT, RESTORING, VERIFYING, COMPLETED,
FAILED, ROLLBACK_REQUIRED and QUARANTINED.

RESTORE_REQUIRES_EXPLICIT_HUMAN_APPROVAL=true

Before restore: verify manifest, payload integrity, schema, project
scope and Restore capability; create a recovery point; obtain explicit
human approval; record audit correlation.

After restore: read back records and verify counts, hashes, identities,
versions and access boundaries. Failed readback cannot be COMPLETED.

Encryption keys must be stored separately from encrypted payloads.
Encryption profile and key-management design remain undecided.

## 7. Evolution Integration Contract

Evolution must use the canonical Memory service, not an independent
production Memory writer.

Sequence: validate proposal; verify scope and authorization; read
current revision; compare expected pre-state; generate change plan;
obtain policy approval; create verified recovery point; write through
authorized adapter; read back and verify; record audit evidence.

Uncertain writes require reconciliation before retry.
Failed verification blocks completion. Rollback requires authorization
and independent verification.

Evolution cannot autonomously delete legacy records, expose restricted
Memory or bypass governance.

## 8. Offline Contract Test Specification

All tests use isolated temporary fixtures and mock adapters.
Production Memory must not be read, hashed, modified or restored.

Test schema validation, identity and revision, independent capabilities,
permission denial, rate limits, uncertain writes, idempotency,
conflicts, quarantine, backup tampering, wrong-scope rejection,
restore approval, failed readback, Evolution policy denial,
rollback authorization and audit integrity.

Each test records testId, expectedResult, actualResult,
evidenceReference, productionDataTouched and networkRequests.

Statuses: PASS, FAIL, INCONCLUSIVE, NOT_APPROVED, REVIEW_REQUIRED.
Skipped tests are INCONCLUSIVE, never PASS.

## 9. Migration Contract

Migration is a separate approval gate.

Stages: inventory ownership; identify authoritative sources; define
mapping; identify duplicates and conflicts; define preservation;
test transformation in isolated fixtures; verify fixture counts and
hashes; obtain approval; execute authorized import; independently
verify destination; maintain recovery window; separately approve
legacy retirement.

Proposed dependency order:
General Memory; Work Learning; Experience Memory and Retrieval;
Future Strategy and Cross-Task Learning; Learning History;
Knowledge Consolidation; Conversation Store; Knowledge and Drive;
Evolution integration; full regression.

This order is a proposal, not migration authorization.

## 10. Security and Privacy

Keep provider credentials outside canonical Memory.
Redact secrets and private content from logs.
Enforce project scope on every operation.
Private Group access requires authorization.
Treat imported content and public search as untrusted.
Screen imported content for prompt injection.
Imported instructions cannot override system or project policy.
Enforce access classification on reads and searches.
Define retention and deletion policy before implementation.
No hidden network calls or silent provider fallback.

## 11. Implementation Acceptance Gates

Implementation requires reviewed contract, positive and negative
isolated tests, failure-path tests, integrity verification, source
review, regression tests, independent verification, verified recovery,
audit evidence and explicit deployment approval.

Design checks are not implementation checks.
Migration and production restore require separate approval.

## 12. Approval Boundary and Final Status

This document authorizes no production implementation, Memory access,
migration, deletion, backup, restore, Facebook or Google Drive API
calls, paid services, credential setup, network requests or production
source changes.

DOCUMENT_STATUS=PROPOSED
DOCUMENT_VERSION=0.2.0
IMPLEMENTATION=NOT_STARTED
PRODUCTION_MIGRATION=NOT_AUTHORIZED
PRODUCTION_RESTORE=NOT_AUTHORIZED
PRODUCTION_READINESS=NOT_CERTIFIED
