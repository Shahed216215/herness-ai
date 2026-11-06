# Mira HFM v0.2.4 Contract vs Prototype E — Core Evidence Packet

- Mode: READ_ONLY
- Scope: Contract Sections 26–34; Prototype E Sections 4–12
- Purpose: Human semantic comparison
- Production Memory access: NO
- memory.json access: NO
- Network requests: 0
- Source modifications: NO

## CONTRACT_V024
- Path: `docs/architecture/mira-hybrid-memory/MIRA-HFM-PHASE2-DETAILED-TECHNICAL-CONTRACT-v0.2.4.md`
- Source lines: 1025
- Source SHA-256: `88c7df7bed05d8dc3ee230c77cb461ded3596e0aa3ca591f4879eeea493ae887`
- Sections selected: 9
- Missing requested sections: NONE

### SOURCE LINES 809-828: ## 26. Canonical Serialization and Integrity Hashing

## 26. Canonical Serialization and Integrity Hashing

Canonical JSON serialization MUST follow RFC 8785 JSON Canonicalization
Scheme (JCS), subject to the supported I-JSON data model. Canonical
bytes MUST use UTF-8 without a byte-order mark. Unsupported values
MUST be rejected rather than silently coerced, normalized or truncated.

The record content hash is:
SHA-256(UTF-8(JCS(content))).

The contentHash field itself MUST NOT be included in the content
being hashed. Whole-record integrity calculations MUST separately
define covered fields, excluded fields and a versioned canonicalization
profile. Unknown algorithms MUST fail closed.

A matching hash proves equality under the specified calculation only.
It does not prove provenance, authorship, authorization or authenticity.
Implementations MUST include deterministic test vectors for Unicode,
escaped strings, nested objects, numeric edge cases and invalid inputs.


### SOURCE LINES 829-855: ## 27. Normative Access Control Evaluation

## 27. Normative Access Control Evaluation

Access classification is deny-by-default and MUST be enforced by the
canonical Memory service on every read, search, list, export, backup
and restore operation.

PUBLIC does not grant write, update, delete, backup or restore rights.
Disclosure still requires the active policy to permit public retrieval.

PROJECT_PRIVATE requires the authenticated request projectId to equal
the record projectId. Actor membership and authorization MUST also be
verified. Matching projectId alone does not grant every actor access.

RESTRICTED requires an explicit authorization decision. If
allowedProjectIds is present, the requesting project MUST be included.
The allowlist MUST NOT silently transfer record ownership. Missing,
malformed or ambiguous access metadata MUST fail closed.

Restricted records MUST NOT appear in unauthorized results, counts,
snippets, exports or error messages. Caches, indexes, cursors and
derived summaries MUST preserve the original access restrictions.
Provider-side filtering does not replace canonical authorization.

Authentication, actor authorization, project scope, operation
capability and policy approval are separate checks. Denial MUST NOT
trigger privilege escalation, broader permission requests or fallback.


### SOURCE LINES 856-879: ## 28. Trust State Semantics and Transitions

## 28. Trust State Semantics and Transitions

Trust is an evidence state, not a reputation score or authorization.

UNVERIFIED means sufficient verification evidence is absent.
SOURCE_RECORDED means source identity and acquisition metadata exist.
SOURCE_REACHABLE means the source was reached through an authorized
verification process; this does not prove content accuracy.
CONTENT_VERIFIED means declared integrity and validation checks passed;
this does not prove factual correctness.
HUMAN_VERIFIED means an identified authorized human reviewed the
relevant content and recorded a scoped decision.
QUARANTINED means the record is excluded from trusted retrieval.

Every transition MUST record actor or process, timestamp, evidence
reference, policy version and reason. Transitions MUST NOT skip
required evidence stages. Reachability or integrity verification
MUST NOT automatically produce HUMAN_VERIFIED.

Source changes, content mutation or integrity mismatch MUST invalidate
affected verification evidence. Quarantined records remain excluded
until an authorized resolution. Trust elevation MUST NOT grant access
or operation capabilities. Unsupported transitions MUST be rejected.


### SOURCE LINES 880-906: ## 29. Uncertain Write Reconciliation and Idempotency

## 29. Uncertain Write Reconciliation and Idempotency

The adapter contract MUST expose:

reconcileOperation(operationId, idempotencyKey, context)

It MUST return COMMITTED, NOT_COMMITTED, IN_PROGRESS, CONFLICT or
UNKNOWN.

Every mutation MUST have stable operationId, idempotencyKey and
payloadHash. A timeout after a possible write MUST be treated as
uncertain. The caller MUST reconcile authoritative state before retry.

COMMITTED returns the prior result and revision. NOT_COMMITTED permits
a retry only under the original authorized scope and idempotency
identity. IN_PROGRESS MUST NOT trigger a duplicate mutation. CONFLICT
requires reread and explicit conflict handling. UNKNOWN MUST NOT be
reported as success.

Retries MUST reuse the original operationId, idempotencyKey and
payloadHash. Reuse of a key with a different payload MUST be rejected.

The implementation MUST define idempotency ownership, project scope,
result-retention period, expiry behavior, restart recovery and provider
reconciliation limitations. If authoritative reconciliation is
unsupported, safe automatic retry MUST NOT be claimed.


### SOURCE LINES 907-926: ## 30. Deterministic Conflict Resolution

## 30. Deterministic Conflict Resolution

Conflict detection MUST preserve all competing versions and provenance.
Unconditional last-write-wins, provider arrival order, lexical ordering
or unreviewed model-generated merges MUST NOT resolve content conflicts.

A resolution proposal MUST identify the conflict, affected identities
and revisions, source references, original hashes, access classes,
trust states, field-level changes, data-loss risks, required authority,
recovery point and verification plan.

Allowed outcomes are ACCEPT_EXISTING_VERSION, ACCEPT_ALTERNATE_VERSION,
APPROVED_FIELD_MERGE, REJECT_CONFLICTING_CHANGE and RETAIN_QUARANTINED.

Automated merging may prepare a proposal but MUST NOT authorize it.
An approved merge creates a new revision. Original versions remain
recoverable under retention policy. Restricted content MUST NOT be
merged into a broader access class without separate authorization.
Unresolved conflicts remain excluded from trusted retrieval.


### SOURCE LINES 927-955: ## 31. Backup Authenticity and Restore Verification

## 31. Backup Authenticity and Restore Verification

Backup integrity and authenticity are distinct requirements.

The manifest MUST bind backup identifier, format version, project
scope, record count, source revision or snapshot reference, payload
hash, manifest hash, creation time, backup process identity,
encryption profile, key version and authenticity evidence.

The approved design MUST define an authenticity mechanism appropriate
to the threat model, such as a digital signature or approved message
authentication mechanism. Its verification key or trust anchor MUST
be protected separately from the payload. A payload hash alone MUST
NOT prove authenticity. Missing, invalid, unknown or revoked
authenticity evidence MUST block restore.

Manifest and payload scope MUST agree. Cross-project restore requires
separate review and explicit authorization. Original backups remain
immutable during conversion and restore preparation.

Restore MUST verify authenticity, integrity, schema, format, project
scope, access classification, encryption and key availability; prepare
a verified recovery point; obtain explicit approval; restore only the
approved scope; independently read back the destination; and verify
identities, revisions, counts, hashes and access boundaries.

Failed or incomplete verification MUST prevent COMPLETED status.
Plaintext fallback and implicit cross-project restore are prohibited.


### SOURCE LINES 956-979: ## 32. Audit Ordering, Atomicity and Checkpoints

## 32. Audit Ordering, Atomicity and Checkpoints

Audit events MUST be append-only and ordered within each project chain.

The implementation MUST define unique event identifiers, monotonic
sequence numbers, canonical serialization, hash algorithm and version,
previous-event linkage, authenticated writer identity, durable append
acknowledgement, checkpoints and independent verification.

A consequential operation MUST NOT be reported complete before its
required audit event is durably recorded. If operation execution
succeeds but audit persistence is uncertain, the outcome is uncertain.
The system MUST reconcile operation and audit state before retrying
or reporting completion. Duplicate delivery MUST be detectable.

Missing sequence numbers, broken links or invalid hashes MUST raise
AUDIT_INTEGRITY_FAILURE.

Checkpoints MUST bind project, sequence number, chain hash and creation
evidence, and MUST be protected from unauthorized modification.
Independent verification MUST be possible without trusting the
component that produced the checkpoint. Hash-chain validity alone
does not prove trusted authorship or secure storage.


### SOURCE LINES 980-1012: ## 33. Test Acceptance Criteria and Evidence Requirements

## 33. Test Acceptance Criteria and Evidence Requirements

Every contract requirement MUST map to one or more test identifiers.

Each test record MUST include testId, requirementId, fixtureId,
expectedResult, actualResult, testStatus, evidenceReference,
failureInjection, productionDataTouched, networkRequests and
executionEnvironment.

PASS requires the expected result and independently inspectable
evidence. FAIL means the observed result contradicts expectation.
INCONCLUSIVE means evidence or execution is insufficient.
NOT_APPROVED means required authority was not granted.
REVIEW_REQUIRED means review remains open. Skipped tests MUST NOT
count as PASS.

Mock-provider success does not prove real-provider compatibility.
Negative security tests MUST demonstrate unauthorized access or
mutation was blocked. Failure-injection tests MUST verify both the
reported outcome and resulting fixture state. Recovery tests MUST
independently verify recovered state.

Tests MUST cover concurrency, idempotency, hash vectors, access
classification and project boundaries, audit tampering, backup and
manifest tampering, and unauthorized trust transitions.

Coverage reports MUST identify tested and untested requirements,
unsupported provider behavior, unexecuted failure paths, known
limitations and independent review status.

All tests MUST use isolated temporary fixtures and mock providers.
This section authorizes no production Memory access or network calls.


### SOURCE LINES 1013-1025: ## 34. v0.2.4 Revision and Approval Status

## 34. v0.2.4 Revision and Approval Status

This revision adds requirements for canonical hashing, access control,
trust transitions, uncertain-write reconciliation, conflict resolution,
backup authenticity, audit ordering and test acceptance.

DOCUMENT_STATUS=PROPOSED
DOCUMENT_VERSION=0.2.4
IMPLEMENTATION=NOT_STARTED
PRODUCTION_MIGRATION=NOT_AUTHORIZED
PRODUCTION_RESTORE=NOT_AUTHORIZED
PRODUCTION_SELF_MODIFICATION=NOT_AUTHORIZED
PRODUCTION_READINESS=NOT_CERTIFIED

## PROTOTYPE_E
- Path: `docs/architecture/mira-hybrid-memory/MIRA-HFM-V025-FINAL-TECHNICAL-CONSISTENCY-TRACEABILITY-CLOSURE-PROTOTYPE-E.md`
- Source lines: 1006
- Source SHA-256: `5ab15274991360106dd5cea1f43bfbc623176485beb4bb77df18a39d080e9601`
- Sections selected: 52
- Missing requested sections: NONE

### SOURCE LINES 76-178: ## 4. Unified Identity Model

## 4. Unified Identity Model

### 4.1 Logical operation identity

The proposed logical operation identity remains:

`(projectId, operationId, idempotencyKey)`

It identifies one logical mutation, not every individual
attempt to execute or retry that mutation.

The identity must be stable across:

- process restarts;
- provider timeouts;
- reconciliation;
- retries;
- crash recovery;
- audit reconciliation.

A different logical mutation requires a different operation identity.

### 4.2 Immutable operation binding

The original operation record binds:

- projectId;
- operationId;
- idempotencyKey;
- original payloadHash;
- original actor identity;
- original target identity;
- original expected revision;
- original purpose;
- original request identity;
- original provider assignment, once assigned.

A retry MUST NOT silently replace any immutable binding.

A mismatch is CONFLICT or REVIEW_REQUIRED.

### 4.3 Authorization decision separation

Prototype E proposes separating immutable operation identity
from attempt-level authorization evidence.

The original authorization context is preserved as historical
evidence. A fresh authorization decision for a later attempt
does not rewrite the original operation identity.

Each attempt must record:

- attemptId;
- original operation identity;
- attempt number;
- actor identity;
- current authorization decision ID;
- authorization policy version;
- authorization timestamp;
- purpose;
- target;
- payloadHash;
- expected revision;
- decision outcome;
- evidence reference.

The attempt record must reference the original operation.
It must not replace its original authorization history.

### 4.4 Retry authorization invariant

A retry is a new execution attempt of the same logical operation.

Before a retry:

1. authenticate the actor;
2. verify project and target scope;
3. verify current permissions;
4. verify capability;
5. evaluate current policy;
6. verify payload identity;
7. verify expected revision;
8. reconcile the original provider operation;
9. verify provider retry capability.

A fresh authorization decision permits only the proposed attempt.
It does not establish that the original operation did not commit.

An expired or denied authorization cannot authorize a new attempt.

### 4.5 Provider assignment invariant

Before provider assignment, provider identity may be absent.

After provider assignment, provider identity becomes part of
the immutable operation binding.

A retry or reconciliation cannot silently move the operation
to another provider.

Any provider migration requires a separate, explicitly approved
protocol that establishes the original provider outcome first.


### SOURCE LINES 78-97: ### 4.1 Logical operation identity

### 4.1 Logical operation identity

The proposed logical operation identity remains:

`(projectId, operationId, idempotencyKey)`

It identifies one logical mutation, not every individual
attempt to execute or retry that mutation.

The identity must be stable across:

- process restarts;
- provider timeouts;
- reconciliation;
- retries;
- crash recovery;
- audit reconciliation.

A different logical mutation requires a different operation identity.


### SOURCE LINES 98-116: ### 4.2 Immutable operation binding

### 4.2 Immutable operation binding

The original operation record binds:

- projectId;
- operationId;
- idempotencyKey;
- original payloadHash;
- original actor identity;
- original target identity;
- original expected revision;
- original purpose;
- original request identity;
- original provider assignment, once assigned.

A retry MUST NOT silently replace any immutable binding.

A mismatch is CONFLICT or REVIEW_REQUIRED.


### SOURCE LINES 117-144: ### 4.3 Authorization decision separation

### 4.3 Authorization decision separation

Prototype E proposes separating immutable operation identity
from attempt-level authorization evidence.

The original authorization context is preserved as historical
evidence. A fresh authorization decision for a later attempt
does not rewrite the original operation identity.

Each attempt must record:

- attemptId;
- original operation identity;
- attempt number;
- actor identity;
- current authorization decision ID;
- authorization policy version;
- authorization timestamp;
- purpose;
- target;
- payloadHash;
- expected revision;
- decision outcome;
- evidence reference.

The attempt record must reference the original operation.
It must not replace its original authorization history.


### SOURCE LINES 145-165: ### 4.4 Retry authorization invariant

### 4.4 Retry authorization invariant

A retry is a new execution attempt of the same logical operation.

Before a retry:

1. authenticate the actor;
2. verify project and target scope;
3. verify current permissions;
4. verify capability;
5. evaluate current policy;
6. verify payload identity;
7. verify expected revision;
8. reconcile the original provider operation;
9. verify provider retry capability.

A fresh authorization decision permits only the proposed attempt.
It does not establish that the original operation did not commit.

An expired or denied authorization cannot authorize a new attempt.


### SOURCE LINES 166-178: ### 4.5 Provider assignment invariant

### 4.5 Provider assignment invariant

Before provider assignment, provider identity may be absent.

After provider assignment, provider identity becomes part of
the immutable operation binding.

A retry or reconciliation cannot silently move the operation
to another provider.

Any provider migration requires a separate, explicitly approved
protocol that establishes the original provider outcome first.


### SOURCE LINES 179-303: ## 5. Audit Event Identity and Lifecycle

## 5. Audit Event Identity and Lifecycle

### 5.1 Stable event identity

Every logical audit event must have a stable event identity.

At minimum, distinguish:

- intent event;
- completion event;
- failure event;
- recovery decision event;
- quarantine or security event.

The event identity is preserved during retries, lookup,
reconciliation and restart recovery.

A lost acknowledgement must not create a new logical event.

### 5.2 Event binding

Every event must bind:

- eventId;
- project identity;
- original operation identity;
- event type;
- canonical payload hash;
- actor or system identity;
- policy decision reference;
- event profile and version;
- sequence allocation reference, where applicable.

The event payload must not contain secret key material or
unnecessary raw Memory content.

### 5.3 Append result model

The proposed normalized append outcomes are:

| Outcome | Required interpretation |
|---|---|
| APPENDED | Authoritative evidence confirms durable append |
| ALREADY_APPENDED | Same event identity and identical canonical payload already exist |
| NOT_APPENDED | Authoritative evidence confirms the event was not appended |
| IN_PROGRESS | Original append remains in progress |
| CONFLICT | Same identity has incompatible content or sequence binding |
| UNKNOWN | Available evidence cannot establish the result |
| FAILED | Authoritative evidence establishes failure without an unresolved append |

NOT_APPENDED must not be inferred from an incomplete or
eventually consistent lookup.

### 5.4 Intent append lifecycle

The proposed intent lifecycle is:

1. Allocate a stable intent event identity.
2. Submit the original intent event.
3. Reconcile using that same event identity.
4. If APPENDED, verify project, operation and payload binding.
5. If ALREADY_APPENDED, verify identical canonical content.
6. If NOT_APPENDED, re-evaluate current authorization and retry
   the same logical intent event under the approved append policy.
7. If IN_PROGRESS, wait or reconcile without creating a second event.
8. If CONFLICT, quarantine or require review.
9. If UNKNOWN, enter RECOVERY_REQUIRED.

Memory mutation is prohibited until durable intent evidence
is authoritatively established.

### 5.5 Completion append lifecycle

After an authoritative Memory commit:

1. preserve the original operation identity;
2. preserve the original completion event identity;
3. verify the committed record and resulting revision;
4. submit the completion event;
5. reconcile using the same event identity;
6. verify canonical payload and operation binding;
7. mark the operation COMPLETED only after all required evidence
   is durable and verified.

A repeated completion request must not create a second logical
completion event or a duplicate Memory revision.

### 5.6 Failure event lifecycle

A terminal failure requires evidence establishing:

- whether the Memory mutation committed;
- whether any side effect remains unresolved;
- whether the original intent event exists;
- whether the failure event was durably recorded;
- whether the operation can safely be considered terminal.

A timeout alone is not authoritative failure evidence.

Where an intent event exists, a consequential operation must
not silently disappear from the audit lifecycle.

If failure-event append is uncertain, retain the original
failure event identity and reconcile it.

### 5.7 Recovery event lifecycle

Every consequential recovery decision must bind:

- recoveryDecisionId;
- original operation identity;
- original event identities;
- attempt identity;
- evidence references;
- current authorization decision;
- recovery policy version;
- decision outcome;
- reviewer or authorized process identity.

If recovery-decision persistence is uncertain, reconcile the
same recoveryDecisionId.

A new mutation is prohibited while the recovery decision
remains uncertain.


### SOURCE LINES 181-197: ### 5.1 Stable event identity

### 5.1 Stable event identity

Every logical audit event must have a stable event identity.

At minimum, distinguish:

- intent event;
- completion event;
- failure event;
- recovery decision event;
- quarantine or security event.

The event identity is preserved during retries, lookup,
reconciliation and restart recovery.

A lost acknowledgement must not create a new logical event.


### SOURCE LINES 198-214: ### 5.2 Event binding

### 5.2 Event binding

Every event must bind:

- eventId;
- project identity;
- original operation identity;
- event type;
- canonical payload hash;
- actor or system identity;
- policy decision reference;
- event profile and version;
- sequence allocation reference, where applicable.

The event payload must not contain secret key material or
unnecessary raw Memory content.


### SOURCE LINES 215-231: ### 5.3 Append result model

### 5.3 Append result model

The proposed normalized append outcomes are:

| Outcome | Required interpretation |
|---|---|
| APPENDED | Authoritative evidence confirms durable append |
| ALREADY_APPENDED | Same event identity and identical canonical payload already exist |
| NOT_APPENDED | Authoritative evidence confirms the event was not appended |
| IN_PROGRESS | Original append remains in progress |
| CONFLICT | Same identity has incompatible content or sequence binding |
| UNKNOWN | Available evidence cannot establish the result |
| FAILED | Authoritative evidence establishes failure without an unresolved append |

NOT_APPENDED must not be inferred from an incomplete or
eventually consistent lookup.


### SOURCE LINES 232-249: ### 5.4 Intent append lifecycle

### 5.4 Intent append lifecycle

The proposed intent lifecycle is:

1. Allocate a stable intent event identity.
2. Submit the original intent event.
3. Reconcile using that same event identity.
4. If APPENDED, verify project, operation and payload binding.
5. If ALREADY_APPENDED, verify identical canonical content.
6. If NOT_APPENDED, re-evaluate current authorization and retry
   the same logical intent event under the approved append policy.
7. If IN_PROGRESS, wait or reconcile without creating a second event.
8. If CONFLICT, quarantine or require review.
9. If UNKNOWN, enter RECOVERY_REQUIRED.

Memory mutation is prohibited until durable intent evidence
is authoritatively established.


### SOURCE LINES 250-265: ### 5.5 Completion append lifecycle

### 5.5 Completion append lifecycle

After an authoritative Memory commit:

1. preserve the original operation identity;
2. preserve the original completion event identity;
3. verify the committed record and resulting revision;
4. submit the completion event;
5. reconcile using the same event identity;
6. verify canonical payload and operation binding;
7. mark the operation COMPLETED only after all required evidence
   is durable and verified.

A repeated completion request must not create a second logical
completion event or a duplicate Memory revision.


### SOURCE LINES 266-283: ### 5.6 Failure event lifecycle

### 5.6 Failure event lifecycle

A terminal failure requires evidence establishing:

- whether the Memory mutation committed;
- whether any side effect remains unresolved;
- whether the original intent event exists;
- whether the failure event was durably recorded;
- whether the operation can safely be considered terminal.

A timeout alone is not authoritative failure evidence.

Where an intent event exists, a consequential operation must
not silently disappear from the audit lifecycle.

If failure-event append is uncertain, retain the original
failure event identity and reconcile it.


### SOURCE LINES 284-303: ### 5.7 Recovery event lifecycle

### 5.7 Recovery event lifecycle

Every consequential recovery decision must bind:

- recoveryDecisionId;
- original operation identity;
- original event identities;
- attempt identity;
- evidence references;
- current authorization decision;
- recovery policy version;
- decision outcome;
- reviewer or authorized process identity.

If recovery-decision persistence is uncertain, reconcile the
same recoveryDecisionId.

A new mutation is prohibited while the recovery decision
remains uncertain.


### SOURCE LINES 304-390: ## 6. Complete Operation State Model

## 6. Complete Operation State Model

### 6.1 Proposed states

- REQUESTED
- AUTHORIZATION_PENDING
- AUTHORIZED
- AUDIT_INTENT_PENDING
- AUDIT_INTENT_RECORDED
- EXECUTING
- COMMIT_UNCERTAIN
- VERIFYING
- COMMITTED_AUDIT_PENDING
- AUDIT_COMPLETION_RECORDED
- FAILED_AUDIT_PENDING
- FAILED
- QUARANTINED
- RECOVERY_REQUIRED
- COMPLETED

### 6.2 State transition matrix

The following is a proposed transition matrix. Every transition
requires the stated evidence and must be implemented only after
the complete state model is approved.

| Current state | Permitted next state | Required evidence |
|---|---|---|
| REQUESTED | AUTHORIZATION_PENDING | Valid request identity |
| AUTHORIZATION_PENDING | AUTHORIZED | Fresh successful policy decision |
| AUTHORIZATION_PENDING | FAILED | Authoritative denial or invalid request |
| AUTHORIZED | AUDIT_INTENT_PENDING | Stable intent event identity |
| AUDIT_INTENT_PENDING | AUDIT_INTENT_RECORDED | Durable intent confirmation |
| AUDIT_INTENT_PENDING | RECOVERY_REQUIRED | Intent outcome cannot be established |
| AUDIT_INTENT_PENDING | QUARANTINED | Conflicting event or integrity evidence |
| AUDIT_INTENT_RECORDED | EXECUTING | Fresh execution authorization and valid claim |
| EXECUTING | VERIFYING | Provider returned a result requiring verification |
| EXECUTING | COMMIT_UNCERTAIN | Provider outcome is uncertain |
| EXECUTING | FAILED_AUDIT_PENDING | Authoritative non-commit and terminal failure evidence |
| COMMIT_UNCERTAIN | VERIFYING | Original operation reconciliation permits verification |
| COMMIT_UNCERTAIN | RECOVERY_REQUIRED | Provider outcome cannot be established |
| COMMIT_UNCERTAIN | QUARANTINED | Conflicting authoritative evidence |
| VERIFYING | COMMITTED_AUDIT_PENDING | Commit and resulting revision verified |
| VERIFYING | FAILED_AUDIT_PENDING | Authoritative non-commit and no unresolved side effect |
| VERIFYING | RECOVERY_REQUIRED | Verification remains inconclusive |
| COMMITTED_AUDIT_PENDING | AUDIT_COMPLETION_RECORDED | Durable completion event confirmed |
| COMMITTED_AUDIT_PENDING | RECOVERY_REQUIRED | Completion event outcome unknown |
| COMMITTED_AUDIT_PENDING | QUARANTINED | Audit or Memory evidence conflicts |
| AUDIT_COMPLETION_RECORDED | COMPLETED | All completion invariants verified |
| FAILED_AUDIT_PENDING | FAILED | Required failure audit evidence confirmed |
| FAILED_AUDIT_PENDING | RECOVERY_REQUIRED | Failure audit outcome unknown |
| FAILED_AUDIT_PENDING | QUARANTINED | Conflicting terminal evidence |
| RECOVERY_REQUIRED | Any approved recovery path | Authorized recovery decision and sufficient evidence |
| QUARANTINED | Any approved recovery path | Authorized quarantine resolution and audit |
| COMPLETED | No mutation transition | Terminal state |
| FAILED | No mutation transition | Terminal state |

A terminal state cannot be reopened by reusing the same
operation identity for a different payload or target.

A new logical operation requires a new operation identity.

### 6.3 State transition enforcement

The implementation must reject:

- transitions not listed in the approved matrix;
- transitions without required evidence;
- transitions based only on timeout;
- transitions that bypass authorization;
- transitions that bypass required audit persistence;
- transitions that silently replace event identity;
- transitions that create duplicate mutations;
- transitions that treat UNKNOWN as success or failure.

### 6.4 State persistence uncertainty

If operation-state persistence is uncertain, the system must
reconstruct the state from authoritative operation, provider
and audit evidence.

It must not infer a terminal state from an in-memory value
or a local phone fallback.

If reconstruction remains ambiguous, the result is
RECOVERY_REQUIRED or QUARANTINED.


### SOURCE LINES 306-323: ### 6.1 Proposed states

### 6.1 Proposed states

- REQUESTED
- AUTHORIZATION_PENDING
- AUTHORIZED
- AUDIT_INTENT_PENDING
- AUDIT_INTENT_RECORDED
- EXECUTING
- COMMIT_UNCERTAIN
- VERIFYING
- COMMITTED_AUDIT_PENDING
- AUDIT_COMPLETION_RECORDED
- FAILED_AUDIT_PENDING
- FAILED
- QUARANTINED
- RECOVERY_REQUIRED
- COMPLETED


### SOURCE LINES 324-365: ### 6.2 State transition matrix

### 6.2 State transition matrix

The following is a proposed transition matrix. Every transition
requires the stated evidence and must be implemented only after
the complete state model is approved.

| Current state | Permitted next state | Required evidence |
|---|---|---|
| REQUESTED | AUTHORIZATION_PENDING | Valid request identity |
| AUTHORIZATION_PENDING | AUTHORIZED | Fresh successful policy decision |
| AUTHORIZATION_PENDING | FAILED | Authoritative denial or invalid request |
| AUTHORIZED | AUDIT_INTENT_PENDING | Stable intent event identity |
| AUDIT_INTENT_PENDING | AUDIT_INTENT_RECORDED | Durable intent confirmation |
| AUDIT_INTENT_PENDING | RECOVERY_REQUIRED | Intent outcome cannot be established |
| AUDIT_INTENT_PENDING | QUARANTINED | Conflicting event or integrity evidence |
| AUDIT_INTENT_RECORDED | EXECUTING | Fresh execution authorization and valid claim |
| EXECUTING | VERIFYING | Provider returned a result requiring verification |
| EXECUTING | COMMIT_UNCERTAIN | Provider outcome is uncertain |
| EXECUTING | FAILED_AUDIT_PENDING | Authoritative non-commit and terminal failure evidence |
| COMMIT_UNCERTAIN | VERIFYING | Original operation reconciliation permits verification |
| COMMIT_UNCERTAIN | RECOVERY_REQUIRED | Provider outcome cannot be established |
| COMMIT_UNCERTAIN | QUARANTINED | Conflicting authoritative evidence |
| VERIFYING | COMMITTED_AUDIT_PENDING | Commit and resulting revision verified |
| VERIFYING | FAILED_AUDIT_PENDING | Authoritative non-commit and no unresolved side effect |
| VERIFYING | RECOVERY_REQUIRED | Verification remains inconclusive |
| COMMITTED_AUDIT_PENDING | AUDIT_COMPLETION_RECORDED | Durable completion event confirmed |
| COMMITTED_AUDIT_PENDING | RECOVERY_REQUIRED | Completion event outcome unknown |
| COMMITTED_AUDIT_PENDING | QUARANTINED | Audit or Memory evidence conflicts |
| AUDIT_COMPLETION_RECORDED | COMPLETED | All completion invariants verified |
| FAILED_AUDIT_PENDING | FAILED | Required failure audit evidence confirmed |
| FAILED_AUDIT_PENDING | RECOVERY_REQUIRED | Failure audit outcome unknown |
| FAILED_AUDIT_PENDING | QUARANTINED | Conflicting terminal evidence |
| RECOVERY_REQUIRED | Any approved recovery path | Authorized recovery decision and sufficient evidence |
| QUARANTINED | Any approved recovery path | Authorized quarantine resolution and audit |
| COMPLETED | No mutation transition | Terminal state |
| FAILED | No mutation transition | Terminal state |

A terminal state cannot be reopened by reusing the same
operation identity for a different payload or target.

A new logical operation requires a new operation identity.


### SOURCE LINES 366-378: ### 6.3 State transition enforcement

### 6.3 State transition enforcement

The implementation must reject:

- transitions not listed in the approved matrix;
- transitions without required evidence;
- transitions based only on timeout;
- transitions that bypass authorization;
- transitions that bypass required audit persistence;
- transitions that silently replace event identity;
- transitions that create duplicate mutations;
- transitions that treat UNKNOWN as success or failure.


### SOURCE LINES 379-390: ### 6.4 State persistence uncertainty

### 6.4 State persistence uncertainty

If operation-state persistence is uncertain, the system must
reconstruct the state from authoritative operation, provider
and audit evidence.

It must not infer a terminal state from an in-memory value
or a local phone fallback.

If reconstruction remains ambiguous, the result is
RECOVERY_REQUIRED or QUARANTINED.


### SOURCE LINES 391-464: ## 7. Crash Recovery Decision Matrix

## 7. Crash Recovery Decision Matrix

### 7.1 Recovery principles

Recovery is reconciliation, not replay by default.

The original operation identity, event identities and payload
binding must be preserved.

A crash must never convert uncertainty into permission to
perform a second mutation.

### 7.2 Required crash-point matrix

| Crash point | Required first action | Mutation permitted? |
|---|---|---|
| Before authorization | Revalidate request and authorization | No |
| After authorization, before intent append | Revalidate authorization and original request | No |
| During intent append | Reconcile original intent event | No |
| After intent append, before state update | Verify original intent event | No |
| After intent confirmation, before provider call | Revalidate attempt authorization and claim | Only after checks |
| During provider call | Reconcile original provider operation | No new mutation |
| After provider commit, before read-back | Reconcile and verify original commit | No new mutation |
| After read-back, before completion append | Verify commit and original revision | No new mutation |
| During completion append | Reconcile original completion event | No new mutation |
| After completion append, before state update | Verify completion event and commit | No new mutation |
| During failure-event append | Reconcile original failure event | No new mutation |
| During recovery-event append | Reconcile original recovery decision | No new mutation |
| During operation-state persistence | Reconstruct from authoritative evidence | No until resolved |

### 7.3 Recovery outcome rules

A recovery decision may produce:

- RESUME_RECONCILIATION
- VERIFY_ORIGINAL_COMMIT
- VERIFY_ORIGINAL_AUDIT_EVENT
- RETRY_SAME_LOGICAL_EVENT
- RETRY_MUTATION_WITH_FRESH_AUTHORIZATION
- MARK_FAILED_WITH_AUTHORITATIVE_EVIDENCE
- QUARANTINE
- MANUAL_REVIEW_REQUIRED

These outcomes are not operation states.

### 7.4 Recovery decision constraints

RETRY_MUTATION_WITH_FRESH_AUTHORIZATION is permitted only if:

1. authoritative evidence establishes NOT_COMMITTED;
2. the original provider identity is preserved;
3. the payload hash matches;
4. the target matches;
5. the expected revision remains valid;
6. the original operation identity remains unchanged;
7. current authorization succeeds;
8. provider retry semantics are explicitly supported;
9. the idempotency claim is authoritative;
10. the audit lifecycle permits the retry.

If any requirement is unknown, retry is denied.

### 7.5 Human escalation

Human review is mandatory when:

- provider outcome cannot be established;
- audit and Memory evidence conflict;
- an event identity has conflicting content;
- an audit sequence has a fork;
- key compromise affects required verification;
- authorization history cannot be reconstructed;
- a recovery action would require changing original operation identity.


### SOURCE LINES 393-402: ### 7.1 Recovery principles

### 7.1 Recovery principles

Recovery is reconciliation, not replay by default.

The original operation identity, event identities and payload
binding must be preserved.

A crash must never convert uncertainty into permission to
perform a second mutation.


### SOURCE LINES 403-420: ### 7.2 Required crash-point matrix

### 7.2 Required crash-point matrix

| Crash point | Required first action | Mutation permitted? |
|---|---|---|
| Before authorization | Revalidate request and authorization | No |
| After authorization, before intent append | Revalidate authorization and original request | No |
| During intent append | Reconcile original intent event | No |
| After intent append, before state update | Verify original intent event | No |
| After intent confirmation, before provider call | Revalidate attempt authorization and claim | Only after checks |
| During provider call | Reconcile original provider operation | No new mutation |
| After provider commit, before read-back | Reconcile and verify original commit | No new mutation |
| After read-back, before completion append | Verify commit and original revision | No new mutation |
| During completion append | Reconcile original completion event | No new mutation |
| After completion append, before state update | Verify completion event and commit | No new mutation |
| During failure-event append | Reconcile original failure event | No new mutation |
| During recovery-event append | Reconcile original recovery decision | No new mutation |
| During operation-state persistence | Reconstruct from authoritative evidence | No until resolved |


### SOURCE LINES 421-435: ### 7.3 Recovery outcome rules

### 7.3 Recovery outcome rules

A recovery decision may produce:

- RESUME_RECONCILIATION
- VERIFY_ORIGINAL_COMMIT
- VERIFY_ORIGINAL_AUDIT_EVENT
- RETRY_SAME_LOGICAL_EVENT
- RETRY_MUTATION_WITH_FRESH_AUTHORIZATION
- MARK_FAILED_WITH_AUTHORITATIVE_EVIDENCE
- QUARANTINE
- MANUAL_REVIEW_REQUIRED

These outcomes are not operation states.


### SOURCE LINES 436-452: ### 7.4 Recovery decision constraints

### 7.4 Recovery decision constraints

RETRY_MUTATION_WITH_FRESH_AUTHORIZATION is permitted only if:

1. authoritative evidence establishes NOT_COMMITTED;
2. the original provider identity is preserved;
3. the payload hash matches;
4. the target matches;
5. the expected revision remains valid;
6. the original operation identity remains unchanged;
7. current authorization succeeds;
8. provider retry semantics are explicitly supported;
9. the idempotency claim is authoritative;
10. the audit lifecycle permits the retry.

If any requirement is unknown, retry is denied.


### SOURCE LINES 453-464: ### 7.5 Human escalation

### 7.5 Human escalation

Human review is mandatory when:

- provider outcome cannot be established;
- audit and Memory evidence conflict;
- an event identity has conflicting content;
- an audit sequence has a fork;
- key compromise affects required verification;
- authorization history cannot be reconstructed;
- a recovery action would require changing original operation identity.


### SOURCE LINES 465-548: ## 8. Audit Sequence Allocation and Recovery

## 8. Audit Sequence Allocation and Recovery

### 8.1 Allocation identity

Sequence allocation must have a stable allocation identity
bound to:

- project chain;
- event identity;
- allocated sequence;
- allocation authority;
- allocation profile;
- creation evidence.

### 8.2 Allocation outcomes

The proposed allocation outcomes are:

- ALLOCATED
- ALREADY_ALLOCATED
- NOT_ALLOCATED
- CONFLICT
- UNKNOWN

An allocation result must be authoritative for the project chain.

### 8.3 Allocation-before-append crash

If allocation is confirmed but append is not confirmed:

1. preserve the original allocation identity;
2. reconcile the original event identity;
3. verify the allocated sequence;
4. verify the previous chain hash;
5. append only under the approved same-allocation protocol;
6. never silently reuse the sequence for a different event.

### 8.4 Unused allocation handling

A missing event at an allocated sequence is not automatically
a harmless gap.

The approved audit profile must define whether the backend
supports:

- pending allocation;
- abandoned allocation;
- tombstone event;
- explicit gap record;
- allocation cancellation;
- permanent chain-integrity failure.

No gap-resolution mechanism is selected by this prototype.

Until approved, an unresolved allocated sequence is
REVIEW_REQUIRED and must not be silently skipped.

### 8.5 Append-before-acknowledgement crash

If append may have succeeded:

1. look up the original event identity;
2. verify canonical payload;
3. verify allocation identity;
4. verify sequence;
5. verify previous hash;
6. verify project scope;
7. return ALREADY_APPENDED only if every binding matches.

Otherwise return CONFLICT or UNKNOWN.

### 8.6 Concurrency and forks

The selected backend must provide one authoritative arbitration
mechanism for each project chain.

The mechanism must prevent two different events from being
accepted as the authoritative event for one sequence.

A fork is an integrity failure, not a merge opportunity.

Historical audit events must not be rewritten to conceal
allocation or append failures.


### SOURCE LINES 467-478: ### 8.1 Allocation identity

### 8.1 Allocation identity

Sequence allocation must have a stable allocation identity
bound to:

- project chain;
- event identity;
- allocated sequence;
- allocation authority;
- allocation profile;
- creation evidence.


### SOURCE LINES 479-490: ### 8.2 Allocation outcomes

### 8.2 Allocation outcomes

The proposed allocation outcomes are:

- ALLOCATED
- ALREADY_ALLOCATED
- NOT_ALLOCATED
- CONFLICT
- UNKNOWN

An allocation result must be authoritative for the project chain.


### SOURCE LINES 491-501: ### 8.3 Allocation-before-append crash

### 8.3 Allocation-before-append crash

If allocation is confirmed but append is not confirmed:

1. preserve the original allocation identity;
2. reconcile the original event identity;
3. verify the allocated sequence;
4. verify the previous chain hash;
5. append only under the approved same-allocation protocol;
6. never silently reuse the sequence for a different event.


### SOURCE LINES 502-521: ### 8.4 Unused allocation handling

### 8.4 Unused allocation handling

A missing event at an allocated sequence is not automatically
a harmless gap.

The approved audit profile must define whether the backend
supports:

- pending allocation;
- abandoned allocation;
- tombstone event;
- explicit gap record;
- allocation cancellation;
- permanent chain-integrity failure.

No gap-resolution mechanism is selected by this prototype.

Until approved, an unresolved allocated sequence is
REVIEW_REQUIRED and must not be silently skipped.


### SOURCE LINES 522-535: ### 8.5 Append-before-acknowledgement crash

### 8.5 Append-before-acknowledgement crash

If append may have succeeded:

1. look up the original event identity;
2. verify canonical payload;
3. verify allocation identity;
4. verify sequence;
5. verify previous hash;
6. verify project scope;
7. return ALREADY_APPENDED only if every binding matches.

Otherwise return CONFLICT or UNKNOWN.


### SOURCE LINES 536-548: ### 8.6 Concurrency and forks

### 8.6 Concurrency and forks

The selected backend must provide one authoritative arbitration
mechanism for each project chain.

The mechanism must prevent two different events from being
accepted as the authoritative event for one sequence.

A fork is an integrity failure, not a merge opportunity.

Historical audit events must not be rewritten to conceal
allocation or append failures.


### SOURCE LINES 549-651: ## 9. Requirement-to-Test Traceability

## 9. Requirement-to-Test Traceability

### 9.1 Required traceability record

Every normative requirement must have:

- stable requirement ID;
- source document and section;
- proposed requirement text;
- applicable DR;
- priority;
- preconditions;
- authorization requirements;
- expected behavior;
- failure behavior;
- evidence requirement;
- test IDs;
- open decision references;
- review status.

### 9.2 Test registry rules

Every test ID must identify exactly one test definition.

A test may cover multiple requirements only when each mapping
is explicitly recorded.

A test definition must include:

- testId;
- requirementId list;
- fixture identity;
- setup;
- action;
- expected result;
- failure injection;
- actual result;
- status;
- evidence reference;
- environment;
- build hash;
- verifier identity;
- limitations.

### 9.3 Required coverage classifications

Coverage reporting must distinguish:

- TESTED_PASS
- TESTED_FAIL
- INCONCLUSIVE
- NOT_APPROVED
- REVIEW_REQUIRED
- NOT_APPLICABLE
- NOT_EXECUTED

NOT_APPLICABLE requires a documented rationale and approval
reference.

NOT_EXECUTED is not PASS.

A test name or test mapping is not execution evidence.

### 9.4 Minimum traceability domains

The future traceability matrix must cover:

1. operation identity;
2. authorization and retry;
3. provider reconciliation;
4. canonical serialization;
5. record integrity;
6. authenticity and key lifecycle;
7. owner-project access;
8. delegation;
9. trust-state transitions;
10. quarantine;
11. durable audit;
12. crash recovery;
13. backup and restore;
14. audit chain;
15. sequence allocation;
16. idempotency;
17. revision integration;
18. independent evidence;
19. privacy and secret exclusion;
20. production safety boundaries.

### 9.5 Coverage closure rule

A domain is not closed merely because it has one or more tests.

Closure requires:

- all normative requirements identified;
- each requirement mapped to test definitions;
- each test uniquely identified;
- expected results specified;
- evidence requirements specified;
- untested requirements explicitly listed;
- unresolved decisions linked;
- independent review completed.


### SOURCE LINES 551-568: ### 9.1 Required traceability record

### 9.1 Required traceability record

Every normative requirement must have:

- stable requirement ID;
- source document and section;
- proposed requirement text;
- applicable DR;
- priority;
- preconditions;
- authorization requirements;
- expected behavior;
- failure behavior;
- evidence requirement;
- test IDs;
- open decision references;
- review status.


### SOURCE LINES 569-592: ### 9.2 Test registry rules

### 9.2 Test registry rules

Every test ID must identify exactly one test definition.

A test may cover multiple requirements only when each mapping
is explicitly recorded.

A test definition must include:

- testId;
- requirementId list;
- fixture identity;
- setup;
- action;
- expected result;
- failure injection;
- actual result;
- status;
- evidence reference;
- environment;
- build hash;
- verifier identity;
- limitations.


### SOURCE LINES 593-611: ### 9.3 Required coverage classifications

### 9.3 Required coverage classifications

Coverage reporting must distinguish:

- TESTED_PASS
- TESTED_FAIL
- INCONCLUSIVE
- NOT_APPROVED
- REVIEW_REQUIRED
- NOT_APPLICABLE
- NOT_EXECUTED

NOT_APPLICABLE requires a documented rationale and approval
reference.

NOT_EXECUTED is not PASS.

A test name or test mapping is not execution evidence.


### SOURCE LINES 612-636: ### 9.4 Minimum traceability domains

### 9.4 Minimum traceability domains

The future traceability matrix must cover:

1. operation identity;
2. authorization and retry;
3. provider reconciliation;
4. canonical serialization;
5. record integrity;
6. authenticity and key lifecycle;
7. owner-project access;
8. delegation;
9. trust-state transitions;
10. quarantine;
11. durable audit;
12. crash recovery;
13. backup and restore;
14. audit chain;
15. sequence allocation;
16. idempotency;
17. revision integration;
18. independent evidence;
19. privacy and secret exclusion;
20. production safety boundaries.


### SOURCE LINES 637-651: ### 9.5 Coverage closure rule

### 9.5 Coverage closure rule

A domain is not closed merely because it has one or more tests.

Closure requires:

- all normative requirements identified;
- each requirement mapped to test definitions;
- each test uniquely identified;
- expected results specified;
- evidence requirements specified;
- untested requirements explicitly listed;
- unresolved decisions linked;
- independent review completed.


### SOURCE LINES 652-708: ## 10. Canonical Serialization and Time Profiles

## 10. Canonical Serialization and Time Profiles

### 10.1 Canonical profile declaration

Every canonical profile must define:

- profile identifier;
- profile version;
- schema version;
- included fields;
- excluded fields;
- absent-field behavior;
- explicit-null behavior;
- string encoding;
- Unicode behavior;
- numeric behavior;
- array ordering;
- timestamp representation;
- byte encoding;
- digest algorithm;
- unsupported-value behavior.

### 10.2 Timestamp proposal

The future contract must select one deterministic timestamp
representation for each profile.

The selection must explicitly define:

- UTC normalization;
- timezone offset handling;
- precision;
- fractional-second behavior;
- leap-second handling;
- invalid timestamp rejection;
- missing timestamp behavior.

This prototype does not silently select a final timestamp
precision or serialization rule.

### 10.3 Self-reference exclusion

A digest must exclude its own digest field.

A proof must exclude proof fields that depend on the digest
being authenticated.

The profile must identify the exact canonical input object
and reproducible byte representation.

### 10.4 Profile compatibility

A verifier must not infer a profile from the fields present.

Unknown or unsupported profiles must fail closed for operations
that require the relevant integrity or authenticity guarantee.


### SOURCE LINES 654-673: ### 10.1 Canonical profile declaration

### 10.1 Canonical profile declaration

Every canonical profile must define:

- profile identifier;
- profile version;
- schema version;
- included fields;
- excluded fields;
- absent-field behavior;
- explicit-null behavior;
- string encoding;
- Unicode behavior;
- numeric behavior;
- array ordering;
- timestamp representation;
- byte encoding;
- digest algorithm;
- unsupported-value behavior.


### SOURCE LINES 674-691: ### 10.2 Timestamp proposal

### 10.2 Timestamp proposal

The future contract must select one deterministic timestamp
representation for each profile.

The selection must explicitly define:

- UTC normalization;
- timezone offset handling;
- precision;
- fractional-second behavior;
- leap-second handling;
- invalid timestamp rejection;
- missing timestamp behavior.

This prototype does not silently select a final timestamp
precision or serialization rule.


### SOURCE LINES 692-701: ### 10.3 Self-reference exclusion

### 10.3 Self-reference exclusion

A digest must exclude its own digest field.

A proof must exclude proof fields that depend on the digest
being authenticated.

The profile must identify the exact canonical input object
and reproducible byte representation.


### SOURCE LINES 702-708: ### 10.4 Profile compatibility

### 10.4 Profile compatibility

A verifier must not infer a profile from the fields present.

Unknown or unsupported profiles must fail closed for operations
that require the relevant integrity or authenticity guarantee.


### SOURCE LINES 709-762: ## 11. Manifest and Record Schema Closure

## 11. Manifest and Record Schema Closure

### 11.1 Manifest schema decision

The future manifest schema must select one canonical project
scope field.

The alternatives `projectId` and `projectScope` must not
remain interchangeable in an approved schema.

The approved schema must define:

- backup identity;
- format version;
- schema version;
- project scope;
- snapshot identity;
- source revision;
- record count;
- payload digest;
- manifest profile;
- creation evidence;
- encryption metadata;
- authenticity metadata.

### 11.2 Record integrity boundary

The final RecordHash profile must declare:

- immutable record fields;
- revision binding;
- mutable metadata exclusions;
- trust-state representation;
- access-classification representation;
- schema compatibility behavior.

No implementation may guess whether a mutable field is
inside or outside the digest boundary.

### 11.3 Restore compatibility

Restore preparation must reject:

- unknown manifest profiles;
- incompatible schema versions;
- invalid authenticity proof;
- invalid payload digest;
- project scope mismatch;
- unapproved cross-project restore;
- unsupported encryption profile;
- unavailable required trust anchor.

Restore preparation is not production restore authorization.


### SOURCE LINES 711-733: ### 11.1 Manifest schema decision

### 11.1 Manifest schema decision

The future manifest schema must select one canonical project
scope field.

The alternatives `projectId` and `projectScope` must not
remain interchangeable in an approved schema.

The approved schema must define:

- backup identity;
- format version;
- schema version;
- project scope;
- snapshot identity;
- source revision;
- record count;
- payload digest;
- manifest profile;
- creation evidence;
- encryption metadata;
- authenticity metadata.


### SOURCE LINES 734-747: ### 11.2 Record integrity boundary

### 11.2 Record integrity boundary

The final RecordHash profile must declare:

- immutable record fields;
- revision binding;
- mutable metadata exclusions;
- trust-state representation;
- access-classification representation;
- schema compatibility behavior.

No implementation may guess whether a mutable field is
inside or outside the digest boundary.


### SOURCE LINES 748-762: ### 11.3 Restore compatibility

### 11.3 Restore compatibility

Restore preparation must reject:

- unknown manifest profiles;
- incompatible schema versions;
- invalid authenticity proof;
- invalid payload digest;
- project scope mismatch;
- unapproved cross-project restore;
- unsupported encryption profile;
- unavailable required trust anchor.

Restore preparation is not production restore authorization.


### SOURCE LINES 763-825: ## 12. Independent Verification and Evidence Custody

## 12. Independent Verification and Evidence Custody

### 12.1 Verifier independence

The component being evaluated must not be the sole authority
for verifying its own correctness or security claims.

The verification record must identify:

- verifier identity;
- verifier role;
- verification scope;
- independence basis;
- evidence access;
- verification method;
- limitations;
- reproducibility reference.

### 12.2 Evidence integrity

Evidence must be bound to:

- test identity;
- build identity;
- fixture identity;
- execution environment;
- execution timestamp;
- verifier identity;
- result status.

Evidence must not contain:

- production Memory content;
- passwords;
- API keys;
- private key material;
- OTP values;
- unnecessary personal data.

### 12.3 Mock and provider evidence

Mock success proves only the tested mock behavior.

It does not establish:

- provider durability;
- atomicity;
- consistency;
- idempotency;
- crash recovery;
- production compatibility.

Provider-specific guarantees require a separate authorized
verification plan.

### 12.4 Independent verification failure

If independent verification is unavailable, the result is
INCONCLUSIVE or REVIEW_REQUIRED.

The system must not promote a self-reported PASS into
independent verification evidence.


### SOURCE LINES 765-780: ### 12.1 Verifier independence

### 12.1 Verifier independence

The component being evaluated must not be the sole authority
for verifying its own correctness or security claims.

The verification record must identify:

- verifier identity;
- verifier role;
- verification scope;
- independence basis;
- evidence access;
- verification method;
- limitations;
- reproducibility reference.


### SOURCE LINES 781-801: ### 12.2 Evidence integrity

### 12.2 Evidence integrity

Evidence must be bound to:

- test identity;
- build identity;
- fixture identity;
- execution environment;
- execution timestamp;
- verifier identity;
- result status.

Evidence must not contain:

- production Memory content;
- passwords;
- API keys;
- private key material;
- OTP values;
- unnecessary personal data.


### SOURCE LINES 802-817: ### 12.3 Mock and provider evidence

### 12.3 Mock and provider evidence

Mock success proves only the tested mock behavior.

It does not establish:

- provider durability;
- atomicity;
- consistency;
- idempotency;
- crash recovery;
- production compatibility.

Provider-specific guarantees require a separate authorized
verification plan.


### SOURCE LINES 818-825: ### 12.4 Independent verification failure

### 12.4 Independent verification failure

If independent verification is unavailable, the result is
INCONCLUSIVE or REVIEW_REQUIRED.

The system must not promote a self-reported PASS into
independent verification evidence.

