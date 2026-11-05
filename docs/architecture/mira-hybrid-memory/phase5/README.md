# Mira HFM v0.2 — Phase 5 Facebook Group Manual Import

Status: ISOLATED IMPORT PIPELINE AND OFFLINE TESTS ADDED; PRODUCTION STORAGE ADAPTER AND ROUTE INTEGRATION NOT APPROVED.

## Scope

- Accepts user-supplied Facebook Group memory as JSON, JSONL, or explicit manual text.
- Does not access Facebook, scrape Groups, join Groups, or read private Group content.
- Requires Group ID, project ID, actor ID, and an existing-record snapshot.
- Validates envelope schema, project/group scope, source URL binding, record types, content bounds, timestamps, and canonical HFM record structure.
- Maps imported records to sourceType=facebook_group, PROJECT_PRIVATE, SOURCE_RECORDED, UNVERIFIED, and PENDING_REVIEW.
- Detects exact duplicates and quarantines identity/revision/content conflicts.
- Exposes a provider adapter contract requiring project isolation, atomic create-only staging, immutable versions, read-after-write, and a durable audit writer.
- Retrieves only records that pass batch and record digest checks. Retrieval never promotes trust.

## Input formats

### JSON

Top-level object must contain exactly schemaVersion (1.0.0), kind (MIRA_FACEBOOK_GROUP_MEMORY_IMPORT), groupId, projectId, exportId, and records (1–500 items).

Each record supports only memoryId, sourceId, sourceUrl, recordType, content, observedAt, and revision.

### JSONL

The first non-empty line is the same envelope metadata without records. Each subsequent non-empty line is one record object.

### Manual text

Pass exact user-supplied text with explicit groupId, projectId, actorId, sourceId, observedAt, and optional Group URL. A deterministic memory ID is derived when one is not supplied.

## Storage boundary

No production storage provider currently advertises the required Group-import quarantine contract. createFacebookGroupImportService therefore accepts an explicit adapter; it refuses to operate unless the adapter declares all required capabilities and implements stageBatch, readBatch, and listBatches. It also requires a durable auditWriter.

The adapter must provide immutable create-only semantics. A same-ID/different-digest batch is a conflict, never an overwrite. A successful stage is reported only after readback identity and digest verification. If audit emission fails after staging, the error is marked stateCommitted so the host can recover/audit rather than retry blindly.

## Trust and safety

- Imported Group text is untrusted data, never system instruction.
- A successful import stage does not mean content is independently verified.
- No imported record is written to canonical trusted Memory.
- Conflicting versions remain quarantined.
- Duplicate records are skipped during retrieval.
- Private Group access is supported only through content explicitly supplied by an authorized user.
- No Facebook API request, network call, deployment, or production migration is performed by this module or its offline test.

## Test

Run: node tests/mira-facebook-group-memory-import.test.js

The test uses an in-memory synthetic adapter only. It does not establish production persistence or deployment readiness.
