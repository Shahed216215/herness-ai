# MIRA HYBRID MEMORY
## Phase 2 — Detailed Technical Contract v0.2.1

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
    "schemaVersion",
    "memoryId",
    "projectId",
    "recordType",
    "content",
    "source",
    "timestamps",
    "version",
    "integrity",
    "trust",
    "access",
    "lifecycle"
  ],
  "properties": {
    "schemaVersion": {
      "type": "string",
      "const": "1.0.0"
    },
    "memoryId": {
      "type": "string",
      "minLength": 8,
      "maxLength": 128
    },
    "projectId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "recordType": {
      "type": "string",
      "enum": [
        "fact",
        "decision",
        "preference",
        "procedure",
        "lesson",
        "experience",
        "strategy",
        "project",
        "conversation_reference",
        "knowledge",
        "research_reference"
      ]
    },
    "content": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100000
    },
    "source": {
      "type": "object",
      "required": [
        "sourceType",
        "sourceId",
        "observedAt"
      ],
      "properties": {
        "sourceType": {
          "type": "string",
          "enum": [
            "facebook_page",
            "facebook_group",
            "web",
            "manual",
            "legacy_import",
            "internal_system",
            "google_drive_backup"
          ]
        },
        "sourceId": {
          "type": "string",
          "minLength": 1
        },
        "sourceUrl": {
          "type": [
            "string",
            "null"
          ]
        },
        "observedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "additionalProperties": false
    },
    "timestamps": {
      "type": "object",
      "required": [
        "createdAt",
        "updatedAt"
      ],
      "properties": {
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "additionalProperties": false
    },
    "version": {
      "type": "object",
      "required": [
        "revision",
        "contentHash"
      ],
      "properties": {
        "revision": {
          "type": "integer",
          "minimum": 1
        },
        "contentHash": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "additionalProperties": false
    },
    "integrity": {
      "type": "object",
      "required": [
        "status",
        "algorithm"
      ],
      "properties": {
        "status": {
          "enum": [
            "UNVERIFIED",
            "VERIFIED",
            "FAILED",
            "QUARANTINED"
          ]
        },
        "algorithm": {
          "const": "SHA-256"
        }
      },
      "additionalProperties": false
    },
    "trust": {
      "type": "object",
      "required": [
        "status"
      ],
      "properties": {
        "status": {
          "enum": [
            "UNVERIFIED",
            "SOURCE_RECORDED",
            "SOURCE_REACHABLE",
            "CONTENT_VERIFIED",
            "HUMAN_VERIFIED",
            "QUARANTINED"
          ]
        }
      },
      "additionalProperties": false
    },
    "access": {
      "type": "object",
      "required": [
        "classification"
      ],
      "properties": {
        "classification": {
          "enum": [
            "PUBLIC",
            "PROJECT_PRIVATE",
            "RESTRICTED"
          ]
        },
        "allowedProjectIds": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "type": "string"
          }
        }
      },
      "additionalProperties": false
    },
    "lifecycle": {
      "enum": [
        "ACTIVE",
        "SUPERSEDED",
        "ARCHIVED",
        "QUARANTINED",
        "PENDING_REVIEW"
      ]
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
DOCUMENT_VERSION=0.2.2
IMPLEMENTATION=NOT_STARTED
PRODUCTION_MIGRATION=NOT_AUTHORIZED
PRODUCTION_RESTORE=NOT_AUTHORIZED
PRODUCTION_READINESS=NOT_CERTIFIED


## 13. Concurrent Writes and Revision Control

Every mutable record has a monotonically increasing revision.

A write request must include:
- memoryId
- expectedRevision
- operationId
- idempotencyKey
- projectId
- actorId
- payloadHash

The adapter must perform an atomic conditional update:
write only if the stored revision equals expectedRevision.

Successful update increments the revision exactly once.
A revision mismatch returns REVISION_CONFLICT and must not overwrite
the newer record.

The implementation must provide atomic compare-and-swap semantics
at the authoritative backend. A read followed by an unconditional
write is not an acceptable substitute.

If the provider cannot guarantee conditional writes, the adapter must
report CONCURRENCY_CONTROL_UNSUPPORTED. It must not claim safe
concurrent-write support.

Retries must reuse the same idempotencyKey and operationId.
A repeated completed operation returns its prior result.
The same key with a different payload hash returns
IDEMPOTENCY_KEY_REUSE_CONFLICT.

Concurrent conflict resolution must preserve both competing versions
and require an explicit merge or rejection decision.

## 14. Adapter Error Taxonomy

Every adapter operation returns a typed result with:
status, errorCode, retryable, operationId, providerCode,
safeMessage and occurredAt.

Standard error codes:

- AUTHENTICATION_FAILED
- PERMISSION_DENIED
- CAPABILITY_UNAVAILABLE
- PROVIDER_UNAVAILABLE
- RATE_LIMITED
- REQUEST_TIMEOUT
- REQUEST_CANCELLED
- INVALID_REQUEST
- SCHEMA_VALIDATION_FAILED
- RECORD_NOT_FOUND
- REVISION_CONFLICT
- IDEMPOTENCY_KEY_REUSE_CONFLICT
- CONCURRENCY_CONTROL_UNSUPPORTED
- QUOTA_EXCEEDED
- CURSOR_EXPIRED
- INTEGRITY_CHECK_FAILED
- ENCRYPTION_FAILED
- DECRYPTION_FAILED
- BACKUP_VERSION_UNSUPPORTED
- RESTORE_VALIDATION_FAILED
- PARTIAL_WRITE_UNCERTAIN
- INTERNAL_ADAPTER_ERROR

Retry policy:
- Retryable: transient provider outage, eligible timeout and rate limit.
- Non-retryable: authentication, permission, schema and invalid request.
- Conflict: reread and reconcile; never blind retry.
- PARTIAL_WRITE_UNCERTAIN: query operation status or reconcile
  authoritative state before retry.

Provider raw errors must be sanitized. Secrets, access tokens,
private record content and cryptographic key material must not appear
in safeMessage or audit logs.

## 15. Pagination and Retrieval Limits

Search and list operations must support bounded pagination.

Request fields:
projectId, query, pageSize, cursor and optional snapshotToken.

Rules:
- Default page size: 25.
- Maximum page size: 100.
- Cursor is opaque and provider-bound.
- Cursor must not contain credentials or raw private record content.
- Cursor expiry returns CURSOR_EXPIRED.
- A new cursor must be obtained through a new authorized query.
- Results must enforce project scope and access classification.
- Total result count is optional and must not be fabricated.
- Retrieval must expose truncation and incomplete-result indicators.
- Stable pagination should use a provider snapshot token where supported.
- Unsupported stable pagination must be explicitly reported.

The retrieval layer must enforce maximum response bytes, maximum
records, bounded query execution time and cancellation.

## 16. Encryption Key Rotation and Recovery

Encryption key material must remain separate from Memory records,
backup payloads, logs and source code.

Use envelope encryption:
data encryption keys protect payloads; a key-encryption key protects
the data encryption keys.

Each encrypted object must identify:
encryptionProfile, keyId, keyVersion, algorithm, nonce,
authenticationTag and ciphertext integrity metadata.

Key rotation procedure:
1. Create a new key version in the authorized key-management system.
2. Verify that authorized readers can access the new key.
3. Rewrap or re-encrypt eligible data.
4. Verify decrypted content hashes in an isolated validation process.
5. Record rotation evidence and completion state.
6. Retain the previous key only for the approved recovery window.
7. Retire old key versions only after recovery verification and approval.

Key loss must fail closed. There is no plaintext fallback.
Recovery requires an authorized recovery identity and separately
protected recovery material.

The exact cryptographic provider, algorithm profile, key custody,
escrow and recovery mechanism require security review before
implementation. This contract does not authorize key creation
or external key-service calls.

## 17. Backup Format Version Compatibility

Every backup manifest must include:
backupFormatVersion, schemaVersion, createdAt, projectId,
recordCount, payloadHash, manifestHash, encryptionProfile
and sourceRevision.

A reader must explicitly declare supported backup format versions.

Compatibility outcomes:
- SUPPORTED: exact supported format.
- MIGRATION_REQUIRED: known older format with a reviewed converter.
- UNSUPPORTED: unknown or newer format.
- INTEGRITY_FAILED: manifest or payload verification failed.

Unknown formats must never be interpreted using best-effort parsing.

Format conversion must be deterministic, versioned and tested on
isolated fixtures. The original backup remains immutable.
Converted output receives a new manifest and new integrity hashes.

Restore is prohibited until compatibility, integrity, project scope
and schema validation all pass.

## 18. Provider Capability Revalidation

Capabilities are dynamic and must not be treated as permanent.

Each capability observation records:
providerId, projectId, capability, state, checkedAt,
expiresAt, permissionScope, policyVersion and evidenceReference.

Revalidate:
- At adapter initialization.
- After credential or permission changes.
- After provider errors indicating revoked access.
- Before backup, restore, migration or other consequential operation.
- When the capability observation expires.

Expired or UNKNOWN capability state fails closed.
A cached capability cannot authorize a consequential operation after
its expiry.

Read and Write capabilities remain independent.
A successful Read check cannot authorize Write.
Capability revalidation must not silently request broader permission.

## 19. Audit Event Schema and Integrity

Every consequential Memory operation emits a structured audit event.

Required fields:
eventId, eventType, occurredAt, actorId, projectId,
operationId, idempotencyKey, targetMemoryId,
action, authorizationDecision, capabilityState,
beforeRevision, afterRevision, resultStatus,
errorCode, sourceReference, payloadHash,
previousEventHash and eventHash.

Audit events must not contain raw Memory content, credentials,
access tokens or encryption keys.

Integrity:
- Events are append-only.
- eventHash covers a canonical serialization of the event excluding
  eventHash itself.
- previousEventHash links to the preceding event in the same
  project audit chain.
- A missing or invalid link raises AUDIT_INTEGRITY_FAILURE.
- Hash-chain verification does not alone prove trusted authorship;
  authenticated storage and access controls are also required.

Audit failure during a consequential operation must follow an explicit
policy. The default is to block completion when the required audit
event cannot be durably recorded.

Audit retention, export and independent verification require a
separate approved policy.

## 20. Additional Acceptance Tests

The isolated contract test suite must additionally verify:

- All six nested schema objects reject unknown properties.
- Concurrent writes with the same expected revision cannot both
  silently succeed.
- Revision mismatch preserves the newer record.
- Idempotent retry does not duplicate a write.
- Reused idempotency key with changed payload is rejected.
- Every standard adapter error maps to the declared taxonomy.
- Retryable and non-retryable failures are distinguished.
- Pagination cursor expiry is handled explicitly.
- Maximum page size and response limits are enforced.
- Key rotation preserves decryptability in isolated fixtures.
- Missing key fails closed without plaintext fallback.
- Supported and unsupported backup versions are distinguished.
- Provider capability expiry blocks consequential operations.
- Audit event schema and hash-chain verification detect tampering.

All tests must use isolated temporary fixtures and mock providers.
Production Memory, real provider accounts and network services
must not be accessed.

## 21. Revised Approval Boundary

This revision remains a proposed technical contract.
It does not authorize production implementation, Memory migration,
restore, deletion, credential creation, provider API calls,
network requests, paid services or production source changes.

DOCUMENT_STATUS=PROPOSED
DOCUMENT_VERSION=0.2.2
IMPLEMENTATION=NOT_STARTED
PRODUCTION_MIGRATION=NOT_AUTHORIZED
PRODUCTION_RESTORE=NOT_AUTHORIZED
PRODUCTION_READINESS=NOT_CERTIFIED


## 22. Backend-Neutral Memory Core Contract

The canonical Memory Core is backend-neutral and provider-independent.

Canonical records, identity rules, access classification, trust,
revision semantics, integrity rules and lifecycle policy must not
depend on provider-specific identifiers or data formats.

Provider-specific behavior belongs exclusively inside provider
adapters and isolated mapping layers.

Every adapter must:
- Map provider records to the canonical Memory Record.
- Preserve canonical identity and project scope.
- Declare supported and unsupported capabilities.
- Preserve source provenance and provider references.
- Report provider limitations without weakening policy.
- Reject unsupported operations explicitly.
- Avoid silently changing canonical semantics.

The canonical Memory service is the policy enforcement boundary.
No adapter may bypass authorization, project scope, revision control,
integrity verification, audit requirements or human approval.

Adding, replacing or removing a provider must not require changing
the canonical record contract unless a separately reviewed schema
revision is proposed and approved.

Provider neutrality does not imply provider equivalence, guaranteed
availability, guaranteed write support or guaranteed portability.

## 23. Self-Modification and Governance Boundary

Mira may inspect, research, test in isolated fixtures and propose
changes to its own software and Memory architecture.

Mira must not autonomously apply changes to:
- Production source code or executable modules.
- Canonical Memory schema or compatibility rules.
- Provider adapter security boundaries.
- Authorization, permission or capability policies.
- Encryption, key custody or recovery policies.
- Audit, retention, deletion or quarantine policies.
- Human approval requirements or governance rules.
- Production deployment or recovery configuration.

Self-improvement follows this mandatory sequence:

1. Discover and document the proposed improvement.
2. Identify affected components, dependencies and risks.
3. Create a versioned change proposal with evidence.
4. Preserve the pre-change baseline and recovery plan.
5. Run isolated tests without modifying production state.
6. Obtain explicit approval from an authorized human.
7. Execute only the approved scope through a controlled process.
8. Run independent regression, security and integrity verification.
9. Record approval, execution, verification and recovery evidence.
10. Stop or use authorized recovery when verification fails.

Approval for one proposal does not authorize unrelated changes,
expanded permissions, additional providers or future modifications.

Mira must not modify, suppress, bypass or rewrite its own approval
requirements, audit evidence or governance controls.

Failed or inconclusive verification must never be reported as PASS.
Production deployment remains a separate approval decision.

## 24. Security and Encryption Policy Integration

Section 10 Security and Privacy and Section 16 Encryption Key
Rotation and Recovery form one mandatory security control boundary.

The following requirements apply to provider adapters, Memory
services, backup and recovery processes, and relevant test fixtures:

- Encryption requirements must be enforced by canonical security
  policy and an approved cryptographic profile.
- Key material, credentials and recovery material must remain
  separate from canonical Memory records and ordinary audit logs.
- Key custody, access authorization, rotation, revocation and
  recovery must have documented owners and evidence.
- Provider-native encryption alone does not establish compliance
  with Mira's complete encryption requirements.
- Encryption failure, unavailable keys, invalid authentication tags
  or failed integrity checks must fail closed.
- Plaintext fallback is prohibited.
- Key rotation must preserve verified recoverability throughout
  the approved recovery window.
- Key retirement requires successful recovery verification and
  separate authorization.
- Audit events may record key identifiers and operation outcomes,
  but must never contain key material, access tokens, credentials
  or plaintext private Memory content.
- Imported and retrieved content remains untrusted regardless of
  encryption or provider provenance.
- Security review must approve the cryptographic profile, key
  custody, recovery mechanism and provider integration before
  production implementation.

Security acceptance requires isolated positive and negative tests
for encryption, decryption, integrity failure, missing keys,
unauthorized key access, key rotation, recovery and secret redaction.

This section does not authorize key creation, credential setup,
external key-service calls or production encryption changes.

## 25. Revised Version and Approval Status

DOCUMENT_STATUS=PROPOSED
DOCUMENT_VERSION=0.2.2
IMPLEMENTATION=NOT_STARTED
PRODUCTION_MIGRATION=NOT_AUTHORIZED
PRODUCTION_RESTORE=NOT_AUTHORIZED
PRODUCTION_SELF_MODIFICATION=NOT_AUTHORIZED
PRODUCTION_READINESS=NOT_CERTIFIED

This revision is a design proposal only.
It does not authorize production implementation, provider API calls,
network requests, credential creation, paid services, migration,
deletion, restore or deployment.

The previous v0.2.1 specification remains the preserved baseline.
