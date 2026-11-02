# MIRA HYBRID MEMORY
## v0.2.5 Design Revision Blueprint
STATUS: PROPOSED — NOT APPROVED

Document ID: MIRA-HFM-V025-DESIGN-REVISION-BLUEPRINT
Baseline: MIRA-HFM Phase 2 Detailed Technical Contract v0.2.4
Baseline SHA-256: 88c7df7bed05d8dc3ee230c77cb461ded3596e0aa3ca591f4879eeea493ae887
Design Review: REQUIRED
Independent Review: NOT PERFORMED
User Approval: NOT GRANTED
Implementation: NOT STARTED
Production Readiness: NOT CERTIFIED

---

## 1. Purpose

This blueprint proposes design revisions for inconsistencies and missing normative details identified during the v0.2.4 P0 consistency review.

It is a design document only. It does not authorize implementation, migration, restore, production Memory changes, or production self-modification.

## 2. Revision targets

- P0-01: Adapter reconciliation API and uncertain writes.
- P0-02: Content hash, record hash, and authenticity proof.
- P0-03: Owner-project access and external delegation.
- P0-04: Explicit trust-state transition graph.
- P0-05: Durable write-ahead audit and recovery state machine.
- P1: Idempotency, backup authenticity, audit-chain integrity, and test traceability.

## 3. Scope and safety boundaries

This blueprint does not authorize:
- Reading or modifying live production Memory content.
- Using phone-local storage as primary or fallback Memory.
- Production source-code modification or self-modification.
- Data migration, deletion, restoration, or bulk rewriting.
- Credential, password, token, or secret collection.
- Live API calls, network access, package installation, or paid services.
- Consequential writes without explicit policy authorization and required audit.

Existing local Memory files must remain preserved until dependency and recovery audits are independently verified and any migration is separately authorized.

## 4. Binding design principles

1. Provider neutrality does not imply provider capability or authorization.
2. Capability, identity, scope, policy, and access control remain separate checks.
3. Unknown outcomes must never be treated as success.
4. Hashes establish integrity comparison, not authorship or authenticity.
5. Quarantined records are excluded from normal trusted retrieval.
6. Audit failure must not be silently ignored.
7. No phone-local Memory, audit journal, or recovery fallback is permitted.
8. Missing durable audit capability disables consequential writes.
9. Retries preserve operation identity and idempotency constraints.
10. Skipped or unexecuted tests are never PASS.


## 5. P0-01 — Adapter API and uncertain write reconciliation

### 5.1 Proposed API addition

Section 3 must expose this normative MemoryProviderAdapter method:

async reconcileOperation(operationId, idempotencyKey, context) {}

Section 29 must use the same method signature and contract.

### 5.2 Request identity

The request must bind to the original operation using:
- operationId
- idempotencyKey
- projectId
- actor
- purpose
- policyDecisionId
- payloadHash
- requestId

Reconciliation must not create a new write operation or change the original payload, actor, project, or authorization context.

### 5.3 Normalized outcomes

- COMMITTED
- NOT_COMMITTED
- IN_PROGRESS
- CONFLICT
- UNKNOWN

UNKNOWN is not equivalent to NOT_COMMITTED. It must not authorize a blind retry.

### 5.4 Response validation and recovery

Validate operation identity, idempotency key, project scope, payload hash, provider identity, revision, and supporting evidence.

An incomplete, mismatched, stale, or unverifiable response must not mark the operation complete.

Retention expiry must not imply NOT_COMMITTED. If authoritative reconciliation is unavailable, the result remains uncertain and consequential retry is restricted.

The API result mapping must remain consistent with Section 3 result statuses and Section 14 adapter errors.

### 5.5 Proposed tests

- HFM-API-001: Method is declared in the adapter contract.
- HFM-API-002: Required request identity fields are validated.
- HFM-API-003: All normalized outcomes map consistently.
- HFM-API-004: Mismatched operation identity is rejected.
- HFM-API-005: Mismatched payload hash is rejected.
- HFM-API-006: Expired retention does not imply non-commit.
- HFM-API-007: UNKNOWN never triggers blind retry.
- HFM-API-008: Restart recovery preserves operation identity.

## 6. P0-02 — Canonical hashes and authenticity proof

### 6.1 Separate integrity concepts

ContentHash: SHA-256 over UTF-8 bytes of RFC 8785 JSON Canonicalization Scheme serialization of content.

RecordHash: SHA-256 over UTF-8 bytes of canonical serialization using an explicitly versioned record-field profile.

AuthenticityProof: an approved digital signature or message authentication code over a defined digest and context. A plain hash does not prove authorship or authenticity.

### 6.2 Canonical field profile

The revised contract must enumerate included and excluded fields, schema/profile version, null handling, timestamp normalization, Unicode handling, array ordering, and treatment of circular or unsupported values.

The design review must decide whether recordHash belongs in the canonical record schema or a versioned integrity envelope. Any schema change requires explicit schema-version review.

Authenticity metadata must identify the algorithm profile, key identifier and version, signed digest, trust anchor reference, and verification evidence. It must never contain secret key material.

### 6.3 Proposed tests

- HFM-HASH-001: Canonical serialization is deterministic.
- HFM-HASH-002: ContentHash changes when canonical content changes.
- HFM-HASH-003: RecordHash follows the declared field profile.
- HFM-HASH-004: Excluded fields do not affect RecordHash.
- HFM-HASH-005: Schema/profile version is bound to the digest.
- HFM-HASH-006: Hash alone is never accepted as authenticity proof.
- HFM-HASH-007: Invalid or unknown signature profile fails closed.
- HFM-HASH-008: Secret key material is absent from persisted metadata.


## 7. P0-03 — Owner-project access and external delegation

### 7.1 Ownership and visibility

record.projectId identifies the owning project. Ownership does not automatically grant every actor permission; the owner project must still authorize the actor and requested action.

PUBLIC visibility does not grant write, update, delete, export, or administrative permission.

PROJECT_PRIVATE records are accessible only to authorized actors within the owning project, subject to policy.

RESTRICTED records are accessible to authorized owner-project actors and explicitly delegated external projects.

### 7.2 Delegation semantics

If allowedProjectIds is absent or empty, no external project delegation exists.

If allowedProjectIds is nonempty, only listed projects are eligible for delegation. Membership in the list alone does not authorize an actor; actor identity, action permission, purpose, and policy must also be validated.

Owner-project access and external delegation must be specified separately and unambiguously.

### 7.3 Enforcement surface

The same access-control decision must apply to direct reads, search, listing, pagination, caches, indexes, cursors, snippets, counts, exports, backup, restore, and conflict resolution.

No cached or derived representation may disclose information that the actor could not access through the authoritative record path.

### 7.4 Proposed tests

- HFM-ACL-001: Owner-project actor requires authorization.
- HFM-ACL-002: PUBLIC does not imply write permission.
- HFM-ACL-003: PROJECT_PRIVATE blocks unauthorized external projects.
- HFM-ACL-004: RESTRICTED blocks undelegated external projects.
- HFM-ACL-005: Absent allowlist means no external delegation.
- HFM-ACL-006: Empty allowlist means no external delegation.
- HFM-ACL-007: Allowlist membership alone does not authorize an actor.
- HFM-ACL-008: Search, cache, export, backup, and restore enforce equivalent scope.

## 8. P0-04 — Explicit trust-state transition graph

### 8.1 Proposed states

- UNVERIFIED
- SOURCE_RECORDED
- SOURCE_REACHABLE
- CONTENT_VERIFIED
- HUMAN_VERIFIED
- QUARANTINED

### 8.2 Normal transition graph

UNVERIFIED -> SOURCE_RECORDED -> SOURCE_REACHABLE -> CONTENT_VERIFIED -> HUMAN_VERIFIED

QUARANTINED may be entered from any state when integrity, provenance, policy, or security checks fail.

Release from QUARANTINED requires authorized review, sufficient evidence, policy approval, and an audit record. It must not be an automatic transition.

### 8.3 Transition evidence and invalidation

Every transition must record evidence, actor or verification mechanism, record revision, timestamp, reason, policy decision, and audit reference.

Source or content mutation invalidates affected verification states. A revision change invalidates human verification tied to an older revision.

SOURCE_REACHABLE evidence is time-bound and must expire according to an explicit policy.

HUMAN_VERIFIED means a human reviewed a particular version and scope. It does not establish absolute truth, grant access, or override authorization.

Trust state and access authorization are independent controls.

### 8.4 Proposed tests

- HFM-TRUST-001: Only declared transitions are accepted.
- HFM-TRUST-002: Transition evidence is mandatory.
- HFM-TRUST-003: Invalid evidence blocks promotion.
- HFM-TRUST-004: Any applicable state can enter QUARANTINED.
- HFM-TRUST-005: Quarantine release requires authorization and audit.
- HFM-TRUST-006: Content mutation invalidates verification.
- HFM-TRUST-007: Revision change invalidates stale human verification.
- HFM-TRUST-008: Trust state never substitutes for access control.


## 9. P0-05 — Durable write-ahead audit and recovery

### 9.1 Atomicity boundary

Memory and Audit providers may be independent systems. The design must not claim distributed atomic transactions unless the selected infrastructure explicitly provides and verifies that guarantee.

The contract must define a durable, authenticated audit backend with append, lookup, reconciliation, integrity verification, project scope, and recovery capabilities.

Phone-local storage must not be used as a Memory, audit-journal, or recovery fallback.

If no approved durable audit backend is available, consequential Memory writes must be disabled.

### 9.2 Proposed operation states

- REQUESTED
- AUTHORIZED
- AUDIT_INTENT_RECORDED
- EXECUTING
- COMMIT_UNCERTAIN
- VERIFYING
- COMMITTED_AUDIT_PENDING
- AUDIT_COMPLETION_RECORDED
- COMPLETED
- FAILED
- QUARANTINED
- RECOVERY_REQUIRED

### 9.3 Required write sequence

1. Validate identity, authorization, project scope, capability, policy, and payload.
2. Validate revision and idempotency constraints.
3. Check for an existing or unresolved operation with the same identity.
4. Persist a durable audit intent using a stable audit operation identity.
5. Only after confirmed intent persistence, perform the conditional Memory write.
6. Reconcile uncertain provider outcomes using the original operation identity.
7. Read back and verify the committed record and revision.
8. Persist the audit completion event.
9. Mark the operation COMPLETED only after all required evidence is verified.

If audit intent persistence fails or is uncertain, the Memory write must not begin.

### 9.4 Commit and audit failure handling

If the Memory provider commits but audit completion cannot be confirmed, the operation enters COMMITTED_AUDIT_PENDING.

This state is not user-visible success and must not be silently converted to COMPLETED.

Reconciliation must use the same operation and audit identities. It must not create a new operation ID, blindly repeat the Memory write, or perform an assumed rollback.

An uncertain audit append must be reconciled through the same stable audit event identity before another append is attempted.

### 9.5 Proposed tests

- HFM-AUDIT-001: Audit intent precedes every consequential Memory write.
- HFM-AUDIT-002: Intent persistence failure blocks the Memory write.
- HFM-AUDIT-003: Uncertain intent persistence is reconciled before writing.
- HFM-AUDIT-004: Provider commit uncertainty enters recovery.
- HFM-AUDIT-005: Read-back verification is required.
- HFM-AUDIT-006: Completion audit failure enters COMMITTED_AUDIT_PENDING.
- HFM-AUDIT-007: Pending completion is never reported as success.
- HFM-AUDIT-008: Recovery preserves original operation identity.
- HFM-AUDIT-009: No blind rollback or duplicate write occurs.
- HFM-AUDIT-010: Missing durable audit capability disables consequential writes.


## 10. P1 — Idempotency and revision integration

### 10.1 Required behavior

- Same operation identity and same idempotency key must resolve to the same logical operation.
- Same idempotency key with a different payload must return CONFLICT.
- A retry of an already COMMITTED operation must not create another revision.
- IN_PROGRESS must not trigger a duplicate write.
- CONFLICT requires an authoritative reread and explicit conflict handling.
- NOT_COMMITTED requires fresh authorization, scope, revision, and policy validation before retry.
- UNKNOWN must not trigger a new operation identity or blind retry.
- Retention expiry must not be interpreted as proof that an operation did not commit.

### 10.2 Proposed tests

- HFM-IDEM-001: Same identity returns the same logical operation.
- HFM-IDEM-002: Same key with different payload is rejected.
- HFM-IDEM-003: Repeated COMMITTED request creates no new revision.
- HFM-IDEM-004: IN_PROGRESS prevents duplicate execution.
- HFM-IDEM-005: CONFLICT requires reread and conflict handling.
- HFM-IDEM-006: UNKNOWN and expiry never authorize blind retry.

## 11. P1 — Backup authenticity and restore verification

### 11.1 Proposed manifest fields

The backup manifest should bind:
- backupId
- formatVersion
- schemaVersion
- projectId
- recordCount
- payloadHash
- manifestHash
- encryptionProfile
- keyId and keyVersion
- authenticityProof
- sourceRevision or snapshot identity
- creation timestamp

### 11.2 Restore gates

Restore must validate authenticity proof, trusted key or trust anchor, key revocation status, payload integrity, schema compatibility, project scope, access policy, required capability, and explicit approval.

A hash-only manifest is not authenticated. Missing, revoked, or unverifiable signing material must fail closed.

Restore must not overwrite production Memory merely because a backup is structurally readable.

### 11.3 Proposed tests

- HFM-BACKUP-001: Manifest binds all required identity and integrity fields.
- HFM-BACKUP-002: Payload tampering is detected.
- HFM-BACKUP-003: Manifest authenticity is verified.
- HFM-BACKUP-004: Unknown trust anchor is rejected.
- HFM-BACKUP-005: Revoked key is rejected.
- HFM-BACKUP-006: Schema and project scope are checked.
- HFM-BACKUP-007: Restore requires authorization and approval.
- HFM-BACKUP-008: Hash-only manifest is never treated as authenticated.

## 12. P1 — Audit chain and checkpoint integrity

### 12.1 Proposed event structure

Each audit event must include a unique eventId, operationId, project scope, sequence number, previous event hash, event hash, timestamp, and defined event type.

The chain must use a documented canonical serialization and versioned hash profile.

### 12.2 Append outcomes

The audit append interface must distinguish APPENDED, ALREADY_APPENDED, CONFLICT, UNKNOWN, and FAILED.

An uncertain append must be reconciled using its stable event identity. A duplicate logical event must not be silently appended as a new event.

Authenticated checkpoints must bind the relevant sequence and chain head. A broken chain or invalid checkpoint must fail verification and trigger the defined incident or quarantine path.

### 12.3 Proposed tests

- HFM-LOG-001: Event identity and project scope are mandatory.
- HFM-LOG-002: Sequence ordering is validated.
- HFM-LOG-003: Previous-hash linkage is verified.
- HFM-LOG-004: Event hash uses the declared canonical profile.
- HFM-LOG-005: Duplicate event identity is reconciled.
- HFM-LOG-006: Checkpoint authenticity and chain head are verified.
- HFM-LOG-007: Broken chain fails closed.


## 13. Requirement-to-test traceability

Every normative requirement must map to one or more test cases and recorded evidence.

Each test record must identify:
- requirementId
- contract section
- normative rule
- testId
- expected result
- failure-injection scenario, where applicable
- evidence reference
- productionDataTouched
- networkRequests
- independentVerificationRequired

Allowed result statuses:
- PASS
- FAIL
- INCONCLUSIVE
- NOT_APPROVED
- REVIEW_REQUIRED

An unexecuted, skipped, unavailable, or insufficiently evidenced test must never be reported as PASS.

Bug Hunter or the implementation under test must not be the sole independent verifier of its own repair or security claims.

## 14. Cross-section integration requirements

The v0.2.5 contract revision must reconcile these sections as one consistent specification:

- Section 3: Adapter API and normalized results.
- Section 13: Concurrent writes, revision checks, and idempotency.
- Section 14: Adapter error taxonomy.
- Section 19: Append-only hash-linked audit.
- Section 26: Canonical serialization and integrity hashing.
- Section 27: Access-control enforcement.
- Section 28: Trust-state semantics.
- Section 29: Uncertain write reconciliation.
- Section 30: Conflict resolution.
- Section 31: Backup authenticity and restore verification.
- Section 32: Audit ordering, atomicity boundary, and checkpoints.
- Section 33: Test acceptance and evidence.
- Section 34: Version and approval status.

No section may introduce a weaker or contradictory rule than another section.

## 15. Version and approval control

The revised contract must contain one authoritative status block. Proposed values:

DOCUMENT_VERSION=0.2.5
DOCUMENT_STATUS=PROPOSED
DESIGN_REVIEW=REQUIRED
INDEPENDENT_REVIEW=NOT_PERFORMED
USER_APPROVAL=NOT_GRANTED
IMPLEMENTATION=NOT_STARTED
PRODUCTION_SELF_MODIFICATION=NOT_AUTHORIZED
PRODUCTION_MIGRATION=NOT_AUTHORIZED
PRODUCTION_RESTORE=NOT_AUTHORIZED
PRODUCTION_READINESS=NOT_CERTIFIED

No stale or contradictory approval block may remain elsewhere in the revised contract.

## 16. Candidate creation gates

Before creating a v0.2.5 contract candidate:

1. Verify the v0.2.4 baseline SHA-256 and its recovery backup.
2. Review every P0 and P1 proposal for correctness and compatibility.
3. Resolve schema impact and canonical hash profile decisions.
4. Complete the requirement-to-test traceability matrix.
5. Preserve all applicable v0.2.4 requirements and sections.
6. Check for duplicate, contradictory, or stale normative language.
7. Verify the prohibition on phone-local Memory and fallback behavior.
8. Obtain required design review and explicit user approval.
9. Create a separate candidate with backup and revision evidence.

Passing structural checks alone does not certify design correctness or production readiness.

## 17. Outstanding review decisions

- Which approved signature or MAC profiles and trust-anchor lifecycle will be supported?
- What exact record-field profile and versioning strategy defines RecordHash?
- Which durable audit backend meets the required append and recovery guarantees?
- What retention period and reconciliation guarantees must each provider supply?
- What evidence and authority are required to release quarantined records?
- Which independent test authority verifies implementation and repair claims?

These decisions remain open until explicitly reviewed and recorded.

## 18. Blueprint completion status

DESIGN_BLUEPRINT=PREPARED
P0_PROPOSALS=DOCUMENTED
P1_PROPOSALS=DOCUMENTED
DESIGN_REVIEW=REQUIRED
INDEPENDENT_REVIEW=NOT_PERFORMED
USER_APPROVAL=NOT_GRANTED
V025_CONTRACT_CANDIDATE=NOT_CREATED
IMPLEMENTATION=NOT_STARTED
PRODUCTION_MIGRATION=NOT_AUTHORIZED
PRODUCTION_RESTORE=NOT_AUTHORIZED
PRODUCTION_SELF_MODIFICATION=NOT_AUTHORIZED
PRODUCTION_READINESS=NOT_CERTIFIED

END OF DESIGN REVISION BLUEPRINT
