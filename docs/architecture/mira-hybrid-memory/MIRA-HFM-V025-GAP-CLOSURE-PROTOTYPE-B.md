# MIRA HYBRID MEMORY
# v0.2.5 DESIGN REVIEW GAP CLOSURE PROTOTYPE

**Document ID:** MIRA-HFM-V025-GAP-CLOSURE-PROTOTYPE-B  
**Version:** 0.1.0  
**Status:** DESIGN PROTOTYPE — NOT APPROVED  
**Implementation:** NOT_STARTED  
**Production Memory Access:** NOT_AUTHORIZED

---

## 1. Purpose

This prototype proposes design-level resolutions for ten findings
identified during the v0.2.5 Design Revision Blueprint review.

It is not an approved production contract or implementation plan.
Existing v0.2.4 and v0.2.5 documents must remain unchanged.

## 2. Safety Boundaries

- No production Memory read, write, search, export or restore.
- No phone-local Memory as primary or fallback Memory.
- No production source modification or self-modification.
- No migration, deletion or restoration.
- No network, API, package installation or paid service.
- No secrets or raw Memory content in evidence.
- Unknown must never be interpreted as success.
- Skipped tests must never count as PASS.
- Existing Memory data must remain preserved.

## 3. DR-01 — Authoritative Write Reconciliation

Required interface:

`reconcileOperation(operationId, idempotencyKey, context)`

Required context:

- requestId
- projectId
- actor
- purpose
- policyDecisionId
- operationId
- idempotencyKey
- payloadHash

Allowed outcomes:

- COMMITTED
- NOT_COMMITTED
- IN_PROGRESS
- CONFLICT
- UNKNOWN

Rules:

1. COMMITTED requires authoritative evidence and resulting revision.
2. NOT_COMMITTED requires authoritative evidence of non-commit.
3. IN_PROGRESS must not trigger duplicate mutation.
4. CONFLICT requires explicit conflict handling.
5. UNKNOWN must never be reported as success.
6. Expired retention must not imply NOT_COMMITTED.
7. Provider reconciliation limitations must be declared.
8. Original operation identity and authorization scope must persist.

Acceptance: Every outcome must be evidence-backed and tied to the
original operation identity and payload hash.

Tests: HFM-RECON-001 through HFM-RECON-008.

## 4. DR-02 — Canonical Record Hash Profile

ContentHash:

`SHA-256(UTF-8(RFC8785-JCS(content)))`

The contentHash field must not hash itself.

Proposed versioned RecordHash field profile:

| Field | Treatment |
|---|---|
| recordId | Include |
| projectId | Include |
| revision | Include |
| contentHash | Include |
| accessClass | Include |
| trustState | Include |
| createdAt | Include |
| recordHash | Exclude |
| authenticityProof | Exclude |

The final profile must define null, timestamp, Unicode, numeric,
array and unsupported-value semantics.

Unknown profiles and algorithms must fail closed.

Acceptance: Deterministic test vectors must produce identical
canonical bytes and hashes.

Tests: HFM-HASH-001 through HFM-HASH-008.

## 5. DR-03 — Cryptographic Authenticity Lifecycle

Integrity and authenticity are separate properties.

The approved design must define:

- Signature or MAC algorithms.
- Domain separation and signed-data profile.
- Key identifier and version.
- Protected trust anchor.
- Key rotation and revocation.
- Unknown algorithm behavior.
- Historical evidence verification policy.
- Signature verification failure handling.

A matching SHA-256 hash alone must never prove trusted authorship.

Acceptance: Tampered records, unknown keys and revoked keys must
not be accepted as authenticated.

Tests: HFM-AUTH-001 through HFM-AUTH-008.

## 6. DR-04 — Delegation Lifecycle

Delegation must be explicit, scoped and time-bound.

Required fields:

- delegationId
- ownerProjectId
- delegateProjectId
- authorizedActor
- allowedOperations
- purpose
- issuedAt
- expiresAt
- revocationStatus
- policyDecisionId
- issuingAuthority

Rules:

1. Delegation grants only listed operations.
2. Expired or revoked delegation must be rejected.
3. Delegation chains must be validated to their authority.
4. Allowlist membership alone does not authorize an operation.
5. READ permission does not imply WRITE permission.
6. Delegation does not silently transfer ownership.
7. Ambiguous metadata fails closed.

Acceptance: Unauthorized actors, projects and operations must be
denied across all access surfaces.

Tests: HFM-ACL-001 through HFM-ACL-010.

## 7. DR-05 — Trust-State Transition Engine

Trust states:

- UNVERIFIED
- SOURCE_RECORDED
- SOURCE_REACHABLE
- CONTENT_VERIFIED
- HUMAN_VERIFIED
- QUARANTINED

Every transition records actor/process, timestamp, evidence
reference, policy version, reason, previous state and new state.

Rules:

1. Every permitted transition must be enumerated.
2. Unsupported transitions must be rejected.
3. Required evidence stages must not be skipped.
4. Reachability or hash verification cannot create HUMAN_VERIFIED.
5. Source changes and integrity mismatches invalidate affected evidence.
6. Quarantined records remain excluded from trusted retrieval.
7. Quarantine release requires authorized review and audit evidence.
8. Trust state never grants access or operation capability.

Acceptance: Invalid transitions and unauthorized quarantine releases
must fail.

Tests: HFM-TRUST-001 through HFM-TRUST-010.

## 8. DR-06 — Crash Recovery Protocol

Recovery sequence:

1. RECOVERY_STARTED
2. LOAD_DURABLE_OPERATION_IDENTITY
3. VALIDATE_AUTHORIZATION
4. RECONCILE_PROVIDER_STATE
5. RECONCILE_AUDIT_STATE
6. VERIFY_RESULT_AND_REVISION
7. DETERMINE_RECOVERY_DECISION
8. RECORD_RECOVERY_AUDIT

Rules:

- A committed mutation must not be repeated.
- Expired authorization cannot authorize a new retry.
- Uncertain provider state remains UNKNOWN.
- Uncertain audit completion prevents COMPLETED status.
- Recovery decisions must be durably auditable.
- Original operation identity must be preserved.
- Integrity mismatch requires quarantine or recovery review.

Acceptance: Crash recovery must not create duplicate mutations
or falsely report completion.

Tests: HFM-RECOVERY-001 through HFM-RECOVERY-010.

## 9. DR-07 — Backup Manifest Self-Reference

The manifest must bind backupId, formatVersion, projectScope,
recordCount, snapshotReference, payloadHash, manifestProfile,
manifestHash, creationTime, backupProcessIdentity,
encryptionProfile, keyVersion and authenticityProof.

The manifest hash profile must exclude manifestHash and
authenticityProof to avoid self-reference.

Authenticity evidence must use the approved canonical manifest
representation. The trust anchor must be protected separately.

Acceptance: Manifest tampering, payload tampering and invalid
authenticity evidence must block restore.

Tests: HFM-BACKUP-001 through HFM-BACKUP-008.

## 10. DR-08 — Concurrent Audit Chain

The design must define:

- Unique event identifiers.
- Per-project monotonic sequence numbers.
- Canonical event serialization.
- Versioned hash algorithm.
- Previous-event linkage.
- Authenticated writer identity.
- Durable append acknowledgement.
- Genesis record.
- Checkpoint structure.
- Independent verification procedure.

Concurrent append requires authoritative sequence allocation
and append arbitration.

Forks, missing sequence numbers, broken links and invalid hashes
must raise AUDIT_INTEGRITY_FAILURE.

Acceptance: Concurrent append must not silently fork or overwrite
the authoritative project audit chain.

Tests: HFM-LOG-001 through HFM-LOG-010.

## 11. DR-09 — Idempotency Ownership and Expiry

Proposed uniqueness scope:

`(projectId, operationId, idempotencyKey)`

Rules:

1. Original payloadHash remains bound to the operation.
2. Reuse with a different payload must be rejected.
3. Repeated completed operations return the prior result.
4. Concurrent duplicates require atomic arbitration.
5. Retention duration must be explicitly configured.
6. Expired records must not imply NOT_COMMITTED.
7. Provider reconciliation limitations must be declared.
8. Restart recovery preserves operation identity.

Acceptance: Duplicate delivery must not produce duplicate mutation.
Payload mismatch must produce IDEMPOTENCY_KEY_REUSE_CONFLICT.

Tests: HFM-IDEM-001 through HFM-IDEM-010.

## 12. DR-10 — Independent Test Evidence

Every test record must include:

- testId
- requirementId
- fixtureId
- expectedResult
- actualResult
- testStatus
- evidenceReference
- failureInjection
- productionDataTouched
- networkRequests
- executionEnvironment
- buildHash
- providerVersion
- verifierIdentity
- reproducibilityReference

Statuses: PASS, FAIL, INCONCLUSIVE, NOT_APPROVED,
REVIEW_REQUIRED.

PASS requires independently inspectable evidence.
Mock-provider success does not prove real-provider compatibility.
Tests use isolated temporary fixtures and mock providers only.

Acceptance: Every requirement must have traceable evidence.
Unexecuted or skipped tests must never count as PASS.

Tests: HFM-EVIDENCE-001 through HFM-EVIDENCE-008.

## 13. Cross-Section Compatibility

The final v0.2.5 contract revision must reconcile this prototype
with v0.2.4 Sections:

3, 13, 14, 19, 26, 27, 28, 29, 30, 31, 32, 33 and 34.

No amendment may silently weaken an existing security requirement.

## 14. Outstanding Design Decisions

1. Signature/MAC profile and trust-anchor governance.
2. Complete RecordHash field profile.
3. Authoritative audit backend guarantees.
4. Idempotency retention and expiry.
5. Provider reconciliation evidence guarantees.
6. Delegation chain and revocation authority.
7. Trust-state transition matrix.
8. Recovery authority and failure handling.
9. Audit checkpoint independence.
10. Independent verifier qualification.

## 15. Approval Gates

Gate A — Resolve or formally accept DR-01 through DR-10.

Gate B — Review cross-section consistency, normative language,
schemas and acceptance criteria.

Gate C — Obtain separate implementation authorization.

Gate D — Run isolated tests, failure injection and independent review.

Gate E — Obtain separate production security, recovery, privacy
and operational approval.

This prototype grants no production authorization.

## 16. Final Status

DOCUMENT_STATUS=DESIGN_PROTOTYPE
DOCUMENT_VERSION=0.1.0
DESIGN_APPROVAL=NOT_APPROVED
CONTRACT_CANDIDATE=NOT_CREATED
IMPLEMENTATION=NOT_STARTED
PRODUCTION_MEMORY_ACCESS=NOT_AUTHORIZED
PRODUCTION_MIGRATION=NOT_AUTHORIZED
PRODUCTION_RESTORE=NOT_AUTHORIZED
PRODUCTION_SELF_MODIFICATION=NOT_AUTHORIZED
PRODUCTION_READINESS=NOT_CERTIFIED

This is a design proposal only. It does not establish
implementation correctness, provider compatibility or production
security.
