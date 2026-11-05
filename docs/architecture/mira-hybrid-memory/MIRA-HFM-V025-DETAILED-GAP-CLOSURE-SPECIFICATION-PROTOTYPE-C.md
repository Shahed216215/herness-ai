# MIRA HYBRID MEMORY
# v0.2.5 DETAILED GAP CLOSURE SPECIFICATION — PROTOTYPE C

**Document ID:** MIRA-HFM-V025-DETAILED-GAP-CLOSURE-SPECIFICATION-PROTOTYPE-C  
**Document Version:** 0.1.0  
**Release Line:** v0.2  
**Design Status:** DESIGN PROTOTYPE — NOT APPROVED  
**Implementation Status:** NOT_STARTED

---

## 1. Purpose and Authority

This document expands the ten design-review findings DR-01 through
DR-10 into a detailed, test-oriented specification proposal.

It reconciles:

- v0.2.4 Detailed Technical Contract, Sections 26–34.
- v0.2.5 Design Revision Blueprint, Sections 5–18.
- v0.2.5 Gap Closure Prototype B, Sections 1–16.

This document is subordinate to the existing approved governance
boundaries and does not amend or replace either source document.

It is not a v0.2.5 Contract Candidate.

Normative words such as MUST and MUST NOT describe proposed
requirements for a future reviewed contract. They do not authorize
implementation.

## 2. Non-Negotiable Safety Boundaries

1. No production Memory read, write, search, export or restore.
2. No phone-local Memory, audit journal or recovery fallback.
3. No implicit migration, deletion, overwrite or restore.
4. No production self-modification.
5. No network, provider API, live model call or package installation
   under this design-only work.
6. No credentials, key material, OTP, secrets or raw production
   Memory content in test evidence.
7. All design tests must use isolated temporary fixtures and mocks.
8. Unknown, unavailable, stale or unverifiable evidence must not
   be interpreted as success.
9. Skipped tests must never be reported as PASS.
10. Existing v0.2.4, v0.2.5 and Prototype B documents remain unchanged.
11. Existing local Memory files remain preserved.
12. No design statement grants production authorization.

## 3. Requirement Language and Traceability

Each requirement in a future contract must have:

- A stable requirement ID.
- A source-section reference.
- A defined input and output.
- Preconditions and authorization requirements.
- Success and failure behavior.
- Evidence requirements.
- One or more test identifiers.
- An explicit open-decision marker where unresolved.

A future requirement-to-test matrix must distinguish:
IMPLEMENTED, TESTED, INCONCLUSIVE, NOT_APPROVED,
REVIEW_REQUIRED and NOT_APPLICABLE.

No requirement may be marked CLOSED solely because it has been
documented in this prototype.

## 4. DR-01 — Authoritative Write Reconciliation

### 4.1 Required API

Proposed adapter method:

`async reconcileOperation(operationId, idempotencyKey, context)`

Section 3 and Section 29 must use one identical method contract.

### 4.2 Original operation identity

The reconciliation request must bind:

- operationId
- idempotencyKey
- projectId
- actor
- purpose
- policyDecisionId
- payloadHash
- requestId

The request must identify the provider and original operation
where provider identity is available.

Reconciliation must not create a new mutation, change the payload,
change the actor, broaden project scope or replace the original
authorization context.

### 4.3 Normalized outcomes

| Outcome | Required interpretation |
|---|---|
| COMMITTED | Authoritative evidence confirms the original mutation and resulting revision |
| NOT_COMMITTED | Authoritative evidence confirms that the original mutation did not commit |
| IN_PROGRESS | Original operation remains active or unresolved |
| CONFLICT | Identity, payload, revision or authoritative state conflicts |
| UNKNOWN | Evidence is insufficient to establish the result |

### 4.4 Response validation

A response must be checked against the original operationId,
idempotencyKey, projectId, payloadHash and provider identity.

COMMITTED requires the prior result and resulting revision.
A missing, mismatched, stale or unverifiable revision cannot
establish completion.

NOT_COMMITTED does not itself authorize a retry. Before retry,
the original authorized scope, actor, policy, capability and
revision constraints must be revalidated.

IN_PROGRESS must not initiate a duplicate write.

CONFLICT requires authoritative reread and explicit conflict handling.

UNKNOWN must remain uncertain and must not be represented as
success or non-commit.

Retention expiry must never imply NOT_COMMITTED.

### 4.5 Provider limitations

Each provider capability profile must state whether authoritative
operation lookup and reconciliation are supported.

If reconciliation is unsupported or insufficiently authoritative,
safe automatic retry must not be claimed. Consequential writes
requiring that guarantee must remain disabled or restricted.

### 4.6 Acceptance criteria

- Original operation identity remains stable across restart.
- All eight request identity fields are validated.
- Mismatched payload or project scope is rejected.
- All five outcomes have deterministic mappings.
- Expiry does not establish non-commit.
- No UNKNOWN result triggers blind retry.
- No incomplete response marks an operation complete.

### 4.7 Test mapping

HFM-API-001 through HFM-API-008, plus negative response and
restart-recovery fixtures.

## 5. DR-02 — Canonical Serialization and Record Integrity

### 5.1 ContentHash

Required calculation:

`SHA-256(UTF-8(RFC8785-JCS(content)))`

Requirements:

- RFC 8785 JSON Canonicalization Scheme.
- Supported I-JSON data model.
- UTF-8 without byte-order mark.
- Unsupported values rejected.
- No silent coercion, truncation or normalization.
- contentHash excluded from the content being hashed.

### 5.2 RecordHash

RecordHash must use a separately defined, versioned canonical
field profile.

The profile must define:

- Profile identifier and version.
- Schema version binding.
- Included fields.
- Excluded fields.
- Null and absent-field treatment.
- Timestamp representation.
- Unicode and string handling.
- Numeric edge-case behavior.
- Array ordering.
- Unsupported-value rejection.
- Canonical byte encoding.

The profile must not be inferred from whichever fields happen
to be present in a runtime object.

### 5.3 Proposed integrity envelope

A versioned integrity envelope is a candidate design:

- recordHashProfile
- recordHash
- authenticityProfile
- authenticityProofReference

The final location of recordHash—canonical record or separate
integrity envelope—remains an OPEN_DESIGN_DECISION.

If schema changes are necessary, schema-version review is required.

### 5.4 Field-profile decision

Prototype B proposed including recordId, projectId, revision,
contentHash, accessClass, trustState and createdAt while excluding
recordHash and authenticityProof.

This is a proposal, not a finalized normative profile.

Before approval, the design review must determine whether every
field is immutable for a given revision, whether mutable trust
metadata belongs in the same hash, and how profile upgrades work.

No field inclusion or exclusion is approved by this document.

### 5.5 Acceptance criteria

- Canonical bytes are deterministic.
- Unicode and escaped-string vectors are reproducible.
- Numeric edge cases follow the declared JCS profile.
- Unsupported inputs are rejected.
- Profile version is bound to the digest.
- Excluded fields do not affect RecordHash.
- Hash equality is never accepted as proof of authorship.

### 5.6 Test mapping

HFM-HASH-001 through HFM-HASH-008.

## 6. DR-03 — Authenticity and Key Lifecycle

### 6.1 Separation of concerns

The future contract must distinguish:

1. Content integrity.
2. Record integrity.
3. Cryptographic authenticity.
4. Authorization.
5. Provenance and source verification.

A hash alone proves equality under a defined calculation.
It does not prove authorship or authorization.

### 6.2 Authenticity evidence

The authenticity profile must identify:

- Algorithm profile.
- Key identifier.
- Key version.
- Signed digest.
- Domain-separation context.
- Trust-anchor reference.
- Verification result and evidence reference.

Secret key material MUST NOT be stored in record metadata,
audit events, manifests or test evidence.

### 6.3 Key lifecycle

The design must define:

- Key creation authority.
- Key custody and access policy.
- Key activation.
- Rotation and version transition.
- Revocation.
- Compromise response.
- Historical verification.
- Trust-anchor replacement.
- Unknown-key and unknown-algorithm handling.

Encryption-key rotation in Contract Section 16 and authenticity
signing/MAC-key lifecycle are related but distinct controls.
They must not be conflated.

### 6.4 Failure behavior

Unknown, revoked, unavailable or unverifiable authenticity
material must fail closed for operations requiring authenticity.

Historical verification after key rotation must use a separately
approved policy and trusted historical evidence. A revoked key
must not silently become trusted again.

### 6.5 Acceptance criteria

- Hash-only metadata is never accepted as authenticity proof.
- Unknown algorithm profiles fail closed.
- Revocation is enforced.
- Key rotation preserves required historical verification.
- Secret key material is absent from persisted metadata.
- Trust-anchor changes are auditable.

### 6.6 Test mapping

HFM-HASH-006 through HFM-HASH-008, plus isolated key lifecycle
fixtures.

OPEN_DESIGN_DECISION: exact algorithms, trust-anchor governance
and historical verification policy.

## 7. DR-04 — Owner-Project Access and Delegation

### 7.1 Independent authorization checks

The future access decision must evaluate separately:

- Authenticated actor.
- Request project.
- Record owner project.
- Access classification.
- Requested operation.
- Actor permission.
- Delegation eligibility.
- Delegation validity.
- Purpose and active policy decision.
- Required capability.

Project ownership does not grant every actor unrestricted access.

### 7.2 Allowlist semantics

For RESTRICTED records:

- An absent allowedProjectIds list means no external delegation.
- An empty list means no external delegation.
- A listed project is eligible for delegation evaluation only.
- Allowlist membership alone does not authorize an actor or action.
- The owner project must retain ownership.
- No implicit privilege escalation is permitted.

### 7.3 Delegation object proposal

A future explicit delegation object may contain:

- delegationId
- ownerProjectId
- delegateProjectId
- authorizedActor or actor policy
- allowedOperations
- purpose
- issuedAt
- expiresAt
- revocation reference
- policyDecisionId
- issuingAuthority

These fields are proposed additions. Their schema and authority
model require explicit review.

### 7.4 Delegation lifecycle

The future specification must define:

- Issuance authority.
- Scope limitation.
- Expiry semantics.
- Revocation authority.
- Revocation propagation.
- Delegation-chain validation.
- Conflicting delegation handling.
- Audit requirements.
- Restart and cache invalidation behavior.

READ must not imply WRITE. Delegation must not transfer ownership.
An expired or revoked delegation must not authorize a new action.

### 7.5 Enforcement surface

The same canonical authorization decision must cover direct read,
search, list, pagination, cache, index, cursor, snippets, counts,
export, backup, restore and conflict resolution.

### 7.6 Acceptance criteria

- Unauthorized actors and projects are denied.
- Allowlist membership alone is insufficient.
- Missing or ambiguous delegation fails closed.
- Revocation is enforced at every access surface.
- Derived data does not leak restricted content.
- Ownership remains unchanged.

### 7.7 Test mapping

HFM-ACL-001 through HFM-ACL-008, with additional delegation
expiry and revocation fixtures.

OPEN_DESIGN_DECISION: delegation-chain authority and revocation
consistency guarantees.

## 8. DR-05 — Trust-State Transition Specification

### 8.1 States

- UNVERIFIED
- SOURCE_RECORDED
- SOURCE_REACHABLE
- CONTENT_VERIFIED
- HUMAN_VERIFIED
- QUARANTINED

Trust is an evidence state, not a reputation score or permission.

### 8.2 Normal transition graph

`UNVERIFIED -> SOURCE_RECORDED -> SOURCE_REACHABLE -> CONTENT_VERIFIED -> HUMAN_VERIFIED`

QUARANTINED may be entered from any state when integrity,
provenance, policy or security checks fail.

Release from QUARANTINED requires authorized review, sufficient
evidence, policy approval and an audit record.

### 8.3 Transition evidence

Every transition must bind:

- Record identity and revision.
- Previous and resulting trust state.
- Actor or verification process.
- Timestamp.
- Evidence reference.
- Policy version and decision.
- Reason.
- Audit reference.

### 8.4 Invalidation

Source mutation, content mutation or integrity mismatch invalidates
affected evidence.

SOURCE_REACHABLE evidence must be time-bound and expire under
an explicitly approved policy.

HUMAN_VERIFIED applies only to the reviewed content revision
and scope. A revision change invalidates stale human verification.

Reachability and integrity checks must not create HUMAN_VERIFIED.

### 8.5 Access independence

Trust elevation never grants access, write permission or operation
capability. Access classification remains independently enforced.

Quarantined records remain excluded from trusted retrieval until
authorized resolution.

### 8.6 Acceptance criteria

- Only declared transitions are accepted.
- Required evidence cannot be omitted.
- Invalid transitions fail closed.
- Any state can enter QUARANTINED under the defined trigger rules.
- Quarantine release requires authority and audit.
- Revision change invalidates affected verification.
- Trust state never substitutes for access control.

### 8.7 Test mapping

HFM-TRUST-001 through HFM-TRUST-008.

OPEN_DESIGN_DECISION: complete machine-readable transition table
and SOURCE_REACHABLE expiry policy.

## 9. DR-06 — Durable Write-Ahead Audit and Crash Recovery

### 9.1 Atomicity boundary

Memory and Audit providers may be independent systems.

The design must not claim a distributed atomic transaction unless
the selected infrastructure explicitly provides and verifies it.

The future contract requires a durable, authenticated audit backend
with append, lookup, reconciliation, integrity verification,
project scope and recovery capabilities.

Phone-local storage must never be used as Memory, audit-journal
or recovery fallback.

If an approved durable audit backend is unavailable, consequential
Memory writes must be disabled.

### 9.2 Operation states

The proposed operation states are:

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

1. Validate actor, authorization, project, capability, policy and payload.
2. Validate revision and idempotency constraints.
3. Check for an existing or unresolved operation.
4. Persist durable audit intent with stable audit event identity.
5. Begin Memory mutation only after confirmed intent persistence.
6. Reconcile uncertain provider outcome with original operation identity.
7. Read back and verify resulting record and revision.
8. Persist audit completion using stable event identity.
9. Mark COMPLETED only after required evidence is verified.

If audit intent persistence fails or is uncertain, Memory mutation
must not begin.

### 9.4 Failure-state handling

If Memory commit is uncertain, enter COMMIT_UNCERTAIN.

If Memory commit succeeds but audit completion is uncertain,
enter COMMITTED_AUDIT_PENDING.

COMMITTED_AUDIT_PENDING is not success and must not be silently
converted to COMPLETED.

An uncertain audit append must be reconciled using the same
stable audit event identity.

No blind rollback, duplicate Memory write or new operation ID
may be used to hide uncertainty.

### 9.5 Restart recovery

After restart:

1. Load durable operation identity and state.
2. Validate the original authorization context.
3. Reconcile the Memory provider.
4. Reconcile the audit backend.
5. Verify result, revision and event identity.
6. Determine a permitted recovery decision.
7. Record the recovery decision durably.
8. Report completion only if all completion requirements pass.

Expired authorization does not authorize a new mutation.
A fresh authorization decision is required before any retry.

### 9.6 Acceptance criteria

- Audit intent precedes every consequential Memory write.
- Uncertain intent blocks Memory mutation.
- Commit uncertainty enters recovery.
- Read-back verification is required.
- Audit completion uncertainty blocks COMPLETED.
- Original operation and event identities survive restart.
- No phone-local fallback exists.
- No durable audit capability means consequential writes disabled.

### 9.7 Test mapping

HFM-AUDIT-001 through HFM-AUDIT-010, plus crash-point fixtures
for each sequence boundary.

OPEN_DESIGN_DECISION: exact backend durability, consistency,
lookup and reconciliation guarantees.

## 10. DR-07 — Backup Manifest and Restore Authenticity

### 10.1 Manifest fields

The future manifest schema must reconcile Contract Section 31,
Blueprint Section 11 and Prototype B.

Required candidate fields:

- backupId
- formatVersion
- schemaVersion
- projectId or explicitly defined projectScope
- recordCount
- sourceRevision or snapshot identity
- payloadHash
- manifestHash
- manifest profile identifier and version
- creation timestamp
- backup process identity
- encryption profile
- keyId
- keyVersion
- authenticity evidence

The final schema must resolve naming and scope semantics before
implementation.

### 10.2 Self-reference exclusion

The manifest hash profile must exclude manifestHash itself and
the authenticity proof field that depends on the manifest digest.

The exact canonical manifest byte representation must be versioned.

Authenticity proof must cover the approved canonical manifest
digest and context. The verification trust anchor must be protected
separately from the backup payload.

A payload hash alone is not authenticity evidence.

### 10.3 Restore gates

Restore must verify:

1. Manifest authenticity.
2. Payload integrity.
3. Schema and format compatibility.
4. Project scope agreement.
5. Access classification.
6. Encryption profile and key availability.
7. Authorization and required capability.
8. Verified recovery point.
9. Explicit approval.
10. Destination read-back.
11. Identity, revision, count and hash consistency.
12. Access-boundary consistency.

Cross-project restore requires separate review and explicit approval.

Original backups remain immutable during conversion and restore
preparation.

Missing, invalid, unknown or revoked authenticity evidence
blocks restore.

Failed or incomplete verification prevents COMPLETED.

### 10.4 Acceptance criteria

- Manifest and payload tampering are detected.
- Self-reference is excluded deterministically.
- Unknown or revoked trust material blocks restore.
- Project and manifest scope must agree.
- Cross-project restore requires separate approval.
- Restore cannot overwrite production Memory by implication.

### 10.5 Test mapping

HFM-BACKUP-001 through HFM-BACKUP-008.

OPEN_DESIGN_DECISION: final manifest field names, canonical
profile and authenticity mechanism.

## 11. DR-08 — Audit Chain Ordering and Concurrent Append

### 11.1 Event structure

Each event must define:

- eventId
- operationId
- project scope
- sequence number
- previous event hash
- event hash
- timestamp
- event type
- authenticated writer identity
- canonical serialization profile
- hash algorithm and version

### 11.2 Append outcomes

The append interface must distinguish:

- APPENDED
- ALREADY_APPENDED
- CONFLICT
- UNKNOWN
- FAILED

An uncertain append must be reconciled using its stable eventId.
Duplicate logical events must not silently become new events.

### 11.3 Per-project ordering

Each project chain requires monotonic sequence ordering and
previous-event linkage.

The design must define how a single authoritative sequence is
allocated and how concurrent append requests are arbitrated.

A sequence number must not be silently reused or assigned to
two different authoritative events.

### 11.4 Concurrency protocol requirements

The selected backend must provide or support a verifiable
atomic arbitration mechanism for sequence allocation and append.

The future contract must define:

- Concurrent request identity.
- Sequence allocation authority.
- Conditional append or equivalent atomic operation.
- Duplicate event arbitration.
- Conflict response.
- Retry and reconciliation behavior.
- Crash behavior after allocation but before append.
- Crash behavior after append but before acknowledgement.
- Fork detection and recovery.

This prototype does not select a database, lock manager or
distributed consensus algorithm.

### 11.5 Chain and checkpoint integrity

Genesis identity and initial chain state must be defined.

Checkpoints must bind project, sequence number, chain hash
and creation evidence.

Independent verification must not trust only the component
that produced the checkpoint.

Missing sequences, forks, broken links and invalid hashes
must raise AUDIT_INTEGRITY_FAILURE.

Hash-chain validity alone does not prove trusted authorship
or secure storage.

### 11.6 Acceptance criteria

- Concurrent append cannot silently fork a project chain.
- Duplicate event identity is reconciled.
- Sequence order and previous-hash linkage are verified.
- Uncertain append does not trigger blind duplication.
- Checkpoint authenticity and chain head are independently verified.
- Integrity failure is surfaced and cannot be silently repaired.

### 11.7 Test mapping

HFM-LOG-001 through HFM-LOG-007, extended with concurrent
append and crash-injection fixtures.

OPEN_DESIGN_DECISION: authoritative sequence allocator and
atomic append mechanism.

## 12. DR-09 — Idempotency and Revision Integration

### 12.1 Identity model

Every mutation binds stable:

- projectId
- operationId
- idempotencyKey
- payloadHash
- actor
- policyDecisionId
- target identity
- expected revision

The proposed uniqueness scope is:

`(projectId, operationId, idempotencyKey)`

This is a candidate scope requiring review against existing
Section 13 revision-control semantics and provider capabilities.

### 12.2 Required behavior

- Same logical operation and same payload resolve to one operation.
- Same key with a different payload is rejected.
- Repeated COMMITTED requests return the prior result.
- Repeated completion must not create a new revision.
- IN_PROGRESS does not permit duplicate execution.
- CONFLICT requires authoritative reread and conflict handling.
- NOT_COMMITTED requires fresh authorization and revision checks.
- UNKNOWN does not permit blind retry.
- Expiry does not prove non-commit.
- Restart preserves original identity.

### 12.3 Atomic arbitration

The implementation must define how concurrent requests claim
or resolve the same operation identity.

The arbitration mechanism must prevent two requests from both
executing the same logical mutation.

If the provider cannot guarantee this behavior, the limitation
must be declared and automatic retry restricted.

### 12.4 Retention and expiry

The contract must define:

- Retention duration.
- Retention owner.
- Expiry semantics.
- Provider reconciliation availability after expiry.
- Recovery behavior for expired but uncertain operations.
- Payload mismatch behavior.
- Audit evidence retention relationship.

Expired identity evidence must never be treated as proof
that the operation did not commit.

### 12.5 Acceptance criteria

- Same operation cannot create duplicate revisions.
- Payload mismatch is rejected.
- Concurrent duplicates are arbitrated.
- Restart preserves identity.
- Expiry does not authorize a blind retry.
- Reconciliation and revision checks remain consistent.

### 12.6 Test mapping

HFM-IDEM-001 through HFM-IDEM-006, with concurrent and restart
fixtures.

OPEN_DESIGN_DECISION: retention duration and exact uniqueness
implementation across provider boundaries.

## 13. DR-10 — Independent Test Evidence and Verification

### 13.1 Required evidence fields

Each test record must include Contract Section 33 fields:

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

Additional proposed metadata:

- buildHash
- providerVersion
- verifierIdentity
- reproducibilityReference
- execution timestamp
- test harness version
- fixture integrity reference
- tested and untested requirement list

### 13.2 Status semantics

- PASS: expected result and independently inspectable evidence exist.
- FAIL: observed result contradicts expectation.
- INCONCLUSIVE: evidence or execution is insufficient.
- NOT_APPROVED: required authority was not granted.
- REVIEW_REQUIRED: review remains open.

Skipped, unavailable or unexecuted tests are never PASS.

### 13.3 Independent verification

The implementation under test or Bug Hunter must not be the sole
independent verifier of its own repair or security claims.

The verifier identity, verification scope, evidence access and
independence basis must be recorded.

A second execution by the same unverified component is not,
by itself, independent verification.

### 13.4 Provider evidence limitations

Mock-provider success proves only the tested mock behavior.

It does not prove real-provider compatibility, durability,
atomicity or reconciliation guarantees.

This design authorizes no live provider API calls or production
data access. Any later provider compatibility work requires
separate authorization and controlled test planning.

### 13.5 Acceptance criteria

- Every normative requirement maps to test identifiers.
- Every PASS has inspectable evidence.
- Negative tests demonstrate denied access or mutation.
- Failure injection checks both outcome and fixture state.
- Recovery tests independently verify recovered state.
- Coverage reports identify untested requirements and limitations.
- Independent verifier identity is recorded.

### 13.6 Test mapping

HFM-EVIDENCE-001 through HFM-EVIDENCE-008.

OPEN_DESIGN_DECISION: verifier qualification and independent
evidence custody.

## 14. Cross-Section Consistency Matrix

| Design area | Contract source | Blueprint source | Required reconciliation |
|---|---|---|---|
| Adapter and reconciliation | Sections 3, 14, 29 | Section 5 | One API, identity and outcome model |
| Concurrency and revision | Section 13 | Sections 9, 10 | One revision and idempotency model |
| Access and delegation | Section 27 | Section 7 | Owner, actor, project and operation checks |
| Trust transitions | Section 28 | Section 8 | Same states, graph and evidence |
| Hashing | Section 26 | Section 6 | One versioned canonical profile |
| Key lifecycle | Sections 16, 24, 31 | Section 6 | Encryption and authenticity keys separated |
| Conflict resolution | Section 30 | Sections 9, 10 | No unapproved automatic merge |
| Backup and restore | Sections 6, 17, 31 | Section 11 | One manifest and restore-gate model |
| Audit and recovery | Sections 19, 32 | Sections 9, 12 | Durable intent, completion and chain consistency |
| Test evidence | Sections 8, 20, 33 | Section 13 | Requirement-to-test and independent evidence |
| Version and approval | Section 34 | Sections 15, 16, 18 | One authoritative status block |

No future section may weaken a stronger existing security rule.

## 15. Consolidated Open Design Decision Register

The following decisions remain OPEN and cannot be silently
resolved by implementation:

1. Exact RecordHash field profile and envelope location.
2. Authenticity algorithm profiles and trust-anchor governance.
3. Historical verification and key revocation policy.
4. Delegation-chain authority and revocation propagation.
5. Complete machine-readable trust transition matrix.
6. SOURCE_REACHABLE evidence expiry.
7. Durable audit backend guarantees.
8. Recovery authority and exact crash-state decision table.
9. Backup manifest canonical schema and signature coverage.
10. Atomic sequence allocation and concurrent append mechanism.
11. Idempotency retention duration and uniqueness implementation.
12. Independent verifier qualification and evidence custody.

Each decision must record its rationale, alternatives, security
impact, compatibility impact, approval authority and test impact.

## 16. Approval and Candidate Gates

Gate A — Source consistency review:
All requirements must map to the v0.2.4 Contract and v0.2.5 Blueprint.

Gate B — Design decision closure:
All P0/P1 decisions must be resolved or explicitly accepted
as limitations by the required authority.

Gate C — Schema and protocol review:
Schemas, canonical profiles, state machines, provider guarantees
and error semantics must be internally consistent.

Gate D — Test traceability:
Every normative requirement must map to tests and evidence rules.

Gate E — Independent design review:
A reviewer independent of the prototype author must inspect
security, recovery, integrity and privacy implications.

Gate F — Explicit user approval:
No candidate creation or implementation follows without the
required separate approval.

Gate G — Candidate preparation:
Only after earlier gates pass may a separate v0.2.5 candidate
be proposed with backup, revision evidence and integrity checks.

Passing document structure or local tests alone does not certify
design correctness or production readiness.

## 17. Final Status

DOCUMENT_STATUS=DETAILED_DESIGN_PROTOTYPE
DOCUMENT_VERSION=0.1.0
RELEASE_LINE=v0.2
DESIGN_APPROVAL=NOT_APPROVED
INDEPENDENT_DESIGN_REVIEW=NOT_PERFORMED
OPEN_DESIGN_DECISIONS=12
CONTRACT_CANDIDATE=NOT_CREATED
IMPLEMENTATION=NOT_STARTED
PRODUCTION_MEMORY_ACCESS=NOT_AUTHORIZED
PRODUCTION_MIGRATION=NOT_AUTHORIZED
PRODUCTION_RESTORE=NOT_AUTHORIZED
PRODUCTION_SELF_MODIFICATION=NOT_AUTHORIZED
PRODUCTION_NETWORK_ACCESS=NOT_AUTHORIZED
PRODUCTION_READINESS=NOT_CERTIFIED

This document proposes a detailed design only.
It does not establish implementation correctness, provider
compatibility, cryptographic approval or production security.

END OF PROTOTYPE C
