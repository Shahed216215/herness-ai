# MIRA HYBRID MEMORY
# v0.2.5 TECHNICAL GAP CLOSURE REVISION — PROTOTYPE D

**Document ID:** MIRA-HFM-V025-TECHNICAL-GAP-CLOSURE-REVISION-PROTOTYPE-D  
**Document Version:** 0.1.0  
**Release Line:** v0.2  
**Document Status:** DESIGN REVISION PROTOTYPE — NOT APPROVED  
**Implementation Status:** NOT_STARTED  
**Supersedes:** Nothing  
**Authority:** None; subordinate design proposal only

---

## 1. Purpose and Scope

Prototype D refines Prototype C following its technical review.

It addresses the following design areas:

- DR-01: authoritative write reconciliation.
- DR-02: canonical serialization and record integrity.
- DR-03: authenticity and key lifecycle.
- DR-04: owner-project access and delegation.
- DR-05: trust-state transitions.
- DR-06: durable audit and crash recovery.
- DR-07: backup manifest and restore authenticity.
- DR-08: audit-chain ordering and concurrent append.
- DR-09: idempotency and revision integration.
- DR-10: independent test evidence.

This document is a design proposal. It is not an approved contract,
implementation plan, production authorization or provider guarantee.

The controlling source documents remain:

1. v0.2.4 Detailed Technical Contract.
2. v0.2.5 Design Revision Blueprint.
3. Prototype B.
4. Prototype C.

No source document is modified or superseded by this prototype.

## 2. Authority and Normative Language

MUST, MUST NOT, SHOULD and MAY describe proposed future-contract
requirements only.

They do not authorize implementation.

Where this prototype identifies a proposed default, it remains
unapproved until the relevant design decision is explicitly accepted.

If this document conflicts with an approved existing security
requirement, the stronger approved requirement prevails.

Unresolved conflict means REVIEW_REQUIRED. Implementation must not
resolve a conflict by silently choosing the less restrictive rule.

## 3. Non-Negotiable Safety Boundaries

1. No production Memory read, write, search, export or restore.
2. No phone-local Memory, audit-journal or recovery fallback.
3. No implicit migration, deletion, overwrite or restore.
4. No production self-modification.
5. No network request, live provider API call or live model request.
6. No package installation.
7. No secrets, credentials, OTP, key material or raw production
   Memory content in test evidence.
8. Design tests use isolated temporary fixtures and mock providers.
9. Unknown, unavailable, stale or unverifiable evidence is not success.
10. Skipped or unexecuted tests are never PASS.
11. Existing local Memory files remain preserved.
12. No production authorization is implied by a design decision.
13. All source documents remain unchanged.
14. v0.2 work remains within the v0.2 release line.

## 4. Shared Identity and Protocol Vocabulary

### 4.1 Canonical operation identity

The proposed canonical operation identity is:

`(projectId, operationId, idempotencyKey)`

The operation identity is permanently bound to:

- projectId
- operationId
- idempotencyKey
- payloadHash
- actor identity
- policyDecisionId
- target identity
- expected revision
- provider identity, when assigned

The same logical operation MUST preserve this identity across
retries, process restarts and recovery.

A changed payload, actor, project, target or authorization context
must not be silently substituted into the original operation.

### 4.2 Canonical audit-event identity

Every consequential operation has stable audit event identities.

At minimum, the design distinguishes:

- intent event identity;
- completion event identity;
- recovery-decision event identity;
- security or quarantine event identity, where applicable.

An uncertain append is reconciled by its original event identity.
It is not replaced with a newly generated identity merely because
the acknowledgement was lost.

### 4.3 Shared terminology

- **Authoritative evidence:** evidence from a declared authority
  capable of establishing the relevant state.
- **Durable acknowledgement:** acknowledgement whose persistence
  guarantee is explicitly defined by the selected backend.
- **Uncertain:** available evidence cannot establish one permitted
  outcome.
- **Fresh authorization:** a new policy decision evaluated for
  the proposed action at the time it is requested.
- **Independent verifier:** a verifier whose evidence and decision
  are not solely controlled by the component being evaluated.

## 5. DR-01 — Authoritative Write Reconciliation

### 5.1 Proposed interface

`async reconcileOperation(operationId, idempotencyKey, context)`

The method contract must be identical wherever referenced by
adapter, revision, recovery and idempotency sections.

### 5.2 Required request binding

The request must bind:

- operationId;
- idempotencyKey;
- projectId;
- actor;
- purpose;
- policyDecisionId;
- payloadHash;
- requestId;
- target identity;
- expected revision;
- provider identity, if the original provider operation has one.

Provider identity is conditional only before provider assignment.
Once an operation is assigned to a provider, reconciliation must
validate that provider identity.

An unavailable provider identity after assignment is an
insufficient-evidence condition, not permission to search another
provider or create a new operation.

### 5.3 Normalized outcomes

| Outcome | Required meaning |
|---|---|
| COMMITTED | Authoritative evidence confirms the original mutation and resulting revision |
| NOT_COMMITTED | Authoritative evidence confirms the original operation did not commit |
| IN_PROGRESS | The original operation is still executing or unresolved |
| CONFLICT | Identity, payload, revision or authoritative state conflicts |
| UNKNOWN | Evidence cannot establish the result |

### 5.4 Outcome invariants

- COMMITTED requires matching operation identity, payload binding,
  provider identity and resulting revision.
- NOT_COMMITTED requires authoritative evidence for the original
  operation, not absence from a possibly incomplete lookup.
- IN_PROGRESS never authorizes duplicate execution.
- CONFLICT requires explicit conflict handling and authoritative
  state inspection.
- UNKNOWN remains uncertain.
- Retention expiry never proves NOT_COMMITTED.
- A stale or unverifiable revision never proves COMMITTED.

### 5.5 Retry authorization

NOT_COMMITTED is an observation, not authorization.

Before retry, the system must independently revalidate:

1. actor authentication;
2. project and target scope;
3. current authorization;
4. capability;
5. policy decision;
6. expected revision;
7. payload identity;
8. provider retry capability.

If any required check is unavailable or fails, retry is denied.

### 5.6 Provider capability declaration

Every provider profile must declare:

- operation lookup support;
- lookup consistency guarantee;
- operation identity retention;
- payload binding support;
- resulting revision evidence;
- reconciliation behavior after timeout;
- reconciliation behavior after restart;
- limitations and unsupported outcomes.

A provider that cannot establish authoritative non-commit must
not be used for automatic retry of consequential mutations.

### 5.7 Test mapping

- HFM-REC-001: matching committed operation.
- HFM-REC-002: authoritative non-commit.
- HFM-REC-003: in-progress operation.
- HFM-REC-004: identity mismatch.
- HFM-REC-005: payload mismatch.
- HFM-REC-006: stale or missing revision.
- HFM-REC-007: retention expiry.
- HFM-REC-008: unknown provider outcome.
- HFM-REC-009: restart reconciliation.
- HFM-REC-010: fresh authorization before retry.

## 6. DR-02 — Canonical Serialization and Record Integrity

### 6.1 ContentHash input boundary

ContentHash is calculated over the exact schema-defined content
payload, not an arbitrary runtime object.

Proposed calculation:

`SHA-256(UTF-8(RFC8785-JCS(contentPayload)))`

The future contract must identify the exact contentPayload schema
and its field boundary.

The following rules apply:

- RFC 8785 JSON Canonicalization Scheme.
- Supported I-JSON data model.
- UTF-8 encoding without a byte-order mark.
- Unsupported values are rejected.
- No silent coercion, truncation or normalization.
- contentHash is excluded from its own input.
- Absent and explicit null values follow the declared schema.
- Arrays preserve schema-defined ordering.

### 6.2 RecordHash input boundary

RecordHash uses a separately named and versioned profile.

The canonical input must bind:

- recordHashProfile identifier;
- profile version;
- schema version;
- declared immutable record fields;
- revision identity.

The profile must specify:

- included fields;
- excluded fields;
- null and absent-field rules;
- timestamp representation;
- Unicode and string handling;
- numeric edge-case behavior;
- array ordering;
- canonical byte encoding;
- unsupported-value behavior.

A profile cannot be inferred from fields present in a runtime object.

### 6.3 Mutable metadata separation

Prototype D proposes separating immutable record content from
mutable verification and operational metadata.

In particular:

- trust-state transitions must not silently rewrite immutable
  content;
- access-policy changes must have an explicit integrity model;
- authenticity evidence must not be included in the digest it signs;
- a revision change must create a new revision-bound integrity
  calculation where required.

The exact placement of accessClass and trustState remains an
OPEN_DESIGN_DECISION until compatibility with the existing schema
is established.

### 6.4 Self-reference exclusion

For every digest or proof, the future contract must declare:

1. canonical input object;
2. included fields;
3. excluded fields;
4. profile version;
5. byte encoding;
6. digest algorithm;
7. proof coverage.

No digest may include its own digest field.

No authenticity proof may be included in the canonical bytes
whose digest it authenticates.

### 6.5 Hash equality limitation

Hash equality establishes equality under the declared calculation.
It does not establish:

- authorship;
- actor identity;
- authorization;
- source trust;
- secure storage;
- freshness.

These require separate evidence.

### 6.6 Test mapping

- HFM-CANON-001: deterministic canonical bytes.
- HFM-CANON-002: Unicode vectors.
- HFM-CANON-003: escaped-string vectors.
- HFM-CANON-004: numeric edge cases.
- HFM-CANON-005: unsupported values rejected.
- HFM-CANON-006: absent versus null semantics.
- HFM-CANON-007: profile-version binding.
- HFM-CANON-008: excluded-field invariance.
- HFM-CANON-009: mutable metadata separation.
- HFM-CANON-010: independent digest recomputation.

## 7. DR-03 — Authenticity and Key Lifecycle

### 7.1 Separate security claims

The future contract must treat the following as separate claims:

1. content integrity;
2. record integrity;
3. cryptographic authenticity;
4. authorization;
5. provenance;
6. source verification.

One claim cannot substitute for another.

### 7.2 Proof input definition

An authenticity profile must define:

- algorithm profile and version;
- key identifier and key version;
- digest profile and digest value;
- domain-separation identifier;
- object type;
- project scope;
- record or manifest identity;
- revision or snapshot identity;
- trust-anchor reference;
- verification policy version.

The exact signed or MACed byte representation must be
deterministic and versioned.

Secret key material MUST NOT be stored in record metadata,
manifests, audit events or test evidence.

### 7.3 Key lifecycle

The design must define:

- key creation authority;
- key custody;
- access-control policy;
- activation;
- rotation;
- revocation;
- compromise declaration;
- historical verification;
- trust-anchor replacement;
- destruction or retirement;
- audit evidence.

Encryption keys and authenticity keys are distinct key roles.
Their lifecycle policies must not be conflated.

### 7.4 Revocation and historical verification

A revoked key cannot authorize a new operation.

Historical verification must distinguish:

- whether the key was valid at the relevant signing time;
- whether trusted time evidence exists;
- whether the key was later compromised;
- whether the proof predates the compromise;
- whether the applicable historical policy permits acceptance.

If the evidence cannot establish the required historical status,
the result is UNKNOWN or REVIEW_REQUIRED.

A revoked key must never silently become trusted again.

### 7.5 Fail-closed behavior

Unknown algorithm, unavailable trust anchor, invalid proof,
revoked key or insufficient historical evidence must block
operations that require authenticity.

### 7.6 Test mapping

- HFM-AUTH-001: valid proof.
- HFM-AUTH-002: modified signed content.
- HFM-AUTH-003: unknown algorithm.
- HFM-AUTH-004: unknown key.
- HFM-AUTH-005: revoked key.
- HFM-AUTH-006: key rotation.
- HFM-AUTH-007: historical verification.
- HFM-AUTH-008: compromised-key scenario.
- HFM-AUTH-009: trust-anchor replacement.
- HFM-AUTH-010: secret-material exclusion.

## 8. DR-04 — Owner-Project Access and Delegation

### 8.1 Independent authorization dimensions

Every access decision evaluates independently:

- authenticated actor;
- requesting project;
- record owner project;
- access classification;
- requested operation;
- actor permission;
- delegation eligibility;
- delegation validity;
- purpose;
- policy decision;
- required capability.

Ownership does not grant every actor unrestricted access.

### 8.2 Allowlist semantics

For RESTRICTED records:

- absent allowedProjectIds means no external delegation;
- an empty list means no external delegation;
- list membership is eligibility only;
- list membership is not authorization;
- owner project identity remains unchanged;
- READ does not imply WRITE;
- delegation does not transfer ownership.

### 8.3 Delegation object

A proposed delegation object contains:

- delegationId;
- ownerProjectId;
- delegateProjectId;
- authorized actor or actor policy;
- allowedOperations;
- purpose;
- issuedAt;
- expiresAt;
- revocation reference;
- policyDecisionId;
- issuingAuthority;
- delegation version;
- parent delegation reference, if chains are permitted.

### 8.4 Delegation-chain default

Prototype D proposes a conservative default:

**Delegation cannot be re-delegated unless a separate, explicit
delegation capability is granted by the owner authority.**

If re-delegation is not explicitly granted, a delegate cannot
issue another delegation.

If re-delegation is permitted by a future approved policy,
the policy must define:

- maximum chain depth;
- non-expanding scope;
- permitted operations at each level;
- purpose restrictions;
- expiry bounded by the parent;
- revocation propagation;
- cycle prevention;
- issuing authority verification.

No child delegation may exceed the parent delegation's scope
or expiry.

### 8.5 Revocation and cache behavior

Revocation must invalidate affected authorization decisions.

Cached access, search results, pagination cursors, indexes,
snippets, counts and derived content must not preserve access
after the relevant authorization becomes invalid.

If immediate revocation propagation cannot be guaranteed,
the limitation and maximum stale authorization window must be
explicitly approved. Until then, high-risk access must fail closed.

### 8.6 Enforcement surface

The same authorization policy must cover:

- direct read;
- search;
- list;
- pagination;
- cache;
- index;
- cursor;
- snippets;
- counts;
- export;
- backup;
- restore;
- conflict resolution.

### 8.7 Test mapping

- HFM-ACL-001: unauthorized actor.
- HFM-ACL-002: wrong project.
- HFM-ACL-003: allowlist membership alone.
- HFM-ACL-004: READ does not imply WRITE.
- HFM-ACL-005: expired delegation.
- HFM-ACL-006: revoked delegation.
- HFM-ACL-007: re-delegation denied by default.
- HFM-ACL-008: child scope expansion denied.
- HFM-ACL-009: cache and cursor revocation.
- HFM-ACL-010: ownership preservation.

## 9. DR-05 — Trust-State Transition Specification

### 9.1 Trust states

- UNVERIFIED
- SOURCE_RECORDED
- SOURCE_REACHABLE
- CONTENT_VERIFIED
- HUMAN_VERIFIED
- QUARANTINED

Trust state is evidence state, not a reputation score,
authorization grant or access capability.

### 9.2 Proposed transition table

| Current state | Proposed next state | Required evidence |
|---|---|---|
| UNVERIFIED | SOURCE_RECORDED | Source identity and recording evidence |
| SOURCE_RECORDED | SOURCE_REACHABLE | Time-bound reachability evidence |
| SOURCE_REACHABLE | CONTENT_VERIFIED | Content identity and integrity verification |
| CONTENT_VERIFIED | HUMAN_VERIFIED | Explicit human review evidence |
| Any non-quarantined state | QUARANTINED | Defined security, integrity or provenance trigger |
| QUARANTINED | UNVERIFIED or another approved state | Authorized resolution, new evidence and audit |

No transition may be inferred merely because another state
was previously reached.

### 9.3 Transition evidence

Every transition binds:

- record identity;
- revision;
- previous state;
- resulting state;
- actor or verification process;
- timestamp;
- evidence reference;
- policy version;
- policy decision;
- reason;
- audit reference.

### 9.4 Quarantine rules

Quarantine triggers include:

- integrity mismatch;
- authenticity failure;
- provenance conflict;
- unauthorized modification;
- unresolved security incident;
- conflicting authoritative evidence;
- policy-defined risk condition.

A quarantine event must preserve evidence and must not silently
overwrite the previous trust history.

Quarantine release requires:

1. authorized reviewer;
2. explicit resolution reason;
3. sufficient new evidence;
4. policy approval;
5. audit event;
6. defined resulting state.

### 9.5 Invalidation

A content revision change invalidates verification bound to the
previous revision.

Source mutation invalidates affected source evidence.

Reachability evidence expires according to a future approved
time policy.

Expired reachability evidence does not automatically prove
that the source is unreachable; it means the previous evidence
is no longer sufficient.

Human verification applies only to the reviewed content revision
and declared review scope.

### 9.6 Access independence

Trust elevation never grants access or write permission.

QUARANTINED content is excluded from trusted retrieval until
authorized resolution.

### 9.7 Test mapping

- HFM-TRUST-001: valid normal transition.
- HFM-TRUST-002: invalid transition.
- HFM-TRUST-003: missing evidence.
- HFM-TRUST-004: quarantine from each eligible state.
- HFM-TRUST-005: unauthorized quarantine release.
- HFM-TRUST-006: authorized release with audit.
- HFM-TRUST-007: revision invalidation.
- HFM-TRUST-008: reachability expiry.
- HFM-TRUST-009: HUMAN_VERIFIED scope.
- HFM-TRUST-010: trust state does not grant access.

## 10. DR-06 — Durable Audit and Crash Recovery

### 10.1 Atomicity boundary

Memory and Audit may be separate systems.

The design MUST NOT claim a distributed atomic transaction
unless the selected infrastructure provides and verifies it.

A durable audit backend must declare:

- append durability;
- acknowledgement semantics;
- lookup consistency;
- event identity uniqueness;
- reconciliation capability;
- project isolation;
- integrity verification;
- restart behavior.

If required audit guarantees are unavailable, consequential
Memory writes remain disabled.

Phone-local storage is never a Memory, audit-journal or
recovery fallback.

### 10.2 Operation states

The proposed state set is:

- REQUESTED
- AUTHORIZED
- AUDIT_INTENT_PENDING
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

### 10.3 State semantics

- REQUESTED: operation received but not authorized.
- AUTHORIZED: current policy decision permits the proposed attempt.
- AUDIT_INTENT_PENDING: intent append was attempted but is not
  authoritatively confirmed.
- AUDIT_INTENT_RECORDED: intent event is durably confirmed.
- EXECUTING: original mutation attempt may be in progress.
- COMMIT_UNCERTAIN: provider outcome is not established.
- VERIFYING: provider result and resulting revision are being checked.
- COMMITTED_AUDIT_PENDING: Memory commit is established but
  completion audit is not yet established.
- AUDIT_COMPLETION_RECORDED: completion event is durably confirmed.
- COMPLETED: all required completion evidence is verified.
- FAILED: operation is authoritatively not completed and no
  unresolved mutation or audit outcome remains.
- QUARANTINED: conflicting or unsafe evidence requires controlled
  investigation.
- RECOVERY_REQUIRED: automated recovery cannot safely decide
  the next permitted action.

### 10.4 Required sequence

1. Validate actor, project, policy, capability and payload.
2. Validate revision and idempotency constraints.
3. Resolve existing operation identity.
4. Allocate stable intent event identity.
5. Append audit intent.
6. Reconcile the intent append until authoritative outcome
   is established.
7. Begin Memory mutation only after confirmed intent persistence.
8. Preserve original operation identity during provider execution.
9. Reconcile uncertain provider outcomes.
10. Read back and verify resulting record and revision.
11. Allocate stable completion event identity.
12. Append and reconcile audit completion.
13. Mark COMPLETED only after all completion requirements pass.

### 10.5 Intent uncertainty

If intent append is uncertain:

- enter AUDIT_INTENT_PENDING;
- reconcile using the original intent event identity;
- do not begin Memory mutation;
- do not create a replacement intent event to conceal uncertainty.

If the audit backend cannot establish whether intent was
persisted, the operation enters RECOVERY_REQUIRED or QUARANTINED
according to the approved recovery policy.

### 10.6 Commit uncertainty

If Memory outcome is uncertain:

- enter COMMIT_UNCERTAIN;
- preserve original operation identity;
- reconcile the original provider operation;
- do not create a new mutation;
- do not mark FAILED merely because a timeout occurred.

### 10.7 Completion uncertainty

If Memory commit is established but audit completion is uncertain:

- enter COMMITTED_AUDIT_PENDING;
- preserve the original completion event identity;
- reconcile that event identity;
- do not create a second logical completion event;
- do not mark COMPLETED before durable confirmation.

### 10.8 Crash after audit completion

If the completion event is durably recorded but the process
crashes before persisting COMPLETED:

1. load the original operation identity;
2. reconcile the Memory result and revision;
3. look up the original completion event identity;
4. verify its project, operation and payload binding;
5. verify the event chain;
6. reconstruct the completion decision;
7. persist the operation state as COMPLETED only if all required
   evidence is independently established.

This recovery must not append a new logical completion event.

### 10.9 Recovery decision uncertainty

A recovery decision is itself an auditable operation.

It requires:

- stable recovery decision identity;
- original operation identity;
- evidence references;
- authorization context;
- recovery policy version;
- decision outcome;
- durable audit evidence.

If recovery-decision persistence is uncertain, reconcile the
same recovery decision identity.

Do not execute a new mutation while the recovery decision
remains uncertain.

### 10.10 Proposed recovery decision outcomes

- RESUME_RECONCILIATION
- VERIFY_COMMIT
- VERIFY_AUDIT
- RETRY_REQUIRES_FRESH_AUTHORIZATION
- MARK_FAILED_WITH_AUTHORITATIVE_EVIDENCE
- QUARANTINE
- MANUAL_REVIEW_REQUIRED

These are decision outcomes, not operation states.

### 10.11 State transition restrictions

- AUDIT_INTENT_PENDING cannot transition to EXECUTING without
  authoritative intent confirmation.
- COMMIT_UNCERTAIN cannot transition to COMPLETED without
  authoritative commit and audit evidence.
- COMMITTED_AUDIT_PENDING cannot transition to COMPLETED without
  completion-event reconciliation.
- FAILED requires authoritative evidence of non-completion and
  no unresolved side effect.
- QUARANTINED requires authorized resolution before release.
- RECOVERY_REQUIRED cannot independently authorize a mutation.
- Expired authorization never authorizes a new retry.

### 10.12 Test mapping

- HFM-RECOVERY-001: intent append failure.
- HFM-RECOVERY-002: uncertain intent acknowledgement.
- HFM-RECOVERY-003: crash after intent persistence.
- HFM-RECOVERY-004: crash during Memory mutation.
- HFM-RECOVERY-005: uncertain Memory commit.
- HFM-RECOVERY-006: crash after commit before read-back.
- HFM-RECOVERY-007: completion append uncertainty.
- HFM-RECOVERY-008: crash after completion append before state update.
- HFM-RECOVERY-009: recovery decision uncertainty.
- HFM-RECOVERY-010: expired authorization.
- HFM-RECOVERY-011: conflicting Memory and audit evidence.
- HFM-RECOVERY-012: no local fallback.

## 11. DR-07 — Backup Manifest and Restore Authenticity

### 11.1 Manifest schema boundary

The final manifest schema must use one canonical naming convention.

The following are proposed fields:

- backupId;
- formatVersion;
- schemaVersion;
- projectId or formally defined projectScope;
- recordCount;
- snapshot identity;
- source revision;
- payloadHash;
- manifest profile identifier;
- manifest profile version;
- manifestHash;
- creation timestamp;
- backup process identity;
- encryption profile;
- key identifier;
- key version;
- authenticity profile;
- authenticity proof reference.

The projectId/projectScope alternative must be resolved before
a candidate schema is approved.

### 11.2 Manifest hash profile

The manifest hash input must exclude:

- manifestHash itself;
- authenticity proof fields that depend on the manifest digest.

The profile must bind:

- manifest profile ID and version;
- schema and format versions;
- project scope;
- backup identity;
- snapshot identity;
- payload digest;
- encryption metadata;
- creation and process metadata as approved.

The exact inclusion list remains subject to schema review.

### 11.3 Authenticity coverage

The authenticity proof must cover the approved canonical
manifest digest and an explicit domain-separation context.

The verification trust anchor must be protected independently
from the backup payload.

Payload integrity alone is not authenticity.

### 11.4 Restore sequence

1. Parse the manifest using a declared format.
2. Validate schema and profile compatibility.
3. Verify manifest canonicalization and digest.
4. Verify authenticity evidence.
5. Verify payload integrity.
6. Validate project scope.
7. Validate access classifications.
8. Validate encryption profile and key availability.
9. Validate authorization and capability.
10. Validate recovery point and snapshot identity.
11. Require explicit restore approval.
12. Prepare isolated restore output.
13. Verify restored record identities, revisions, counts and hashes.
14. Verify access boundaries.
15. Require destination read-back and independent verification.

### 11.5 Restore safety

- Cross-project restore requires separate approval.
- Missing, unknown, invalid or revoked authenticity evidence
  blocks restore.
- Original backups remain immutable.
- Conversion preparation must not overwrite the source backup.
- Restore preparation does not authorize production restore.
- Failed verification prevents COMPLETED.
- No phone-local restore fallback is permitted.

### 11.6 Test mapping

- HFM-BACKUP-001: valid manifest.
- HFM-BACKUP-002: manifest tampering.
- HFM-BACKUP-003: payload tampering.
- HFM-BACKUP-004: self-reference exclusion.
- HFM-BACKUP-005: unknown or revoked trust anchor.
- HFM-BACKUP-006: project scope mismatch.
- HFM-BACKUP-007: cross-project approval requirement.
- HFM-BACKUP-008: destination verification.
- HFM-BACKUP-009: immutable source backup.
- HFM-BACKUP-010: restore failure containment.

## 12. DR-08 — Audit Chain Ordering and Concurrent Append

### 12.1 Event hash input

Each audit event uses a versioned canonical event profile.

The canonical hash input must explicitly exclude:

- eventHash itself;
- authenticity proof fields that depend on eventHash.

It must include, as approved by the profile:

- event profile identifier and version;
- eventId;
- operationId;
- project scope;
- sequence number;
- previous event hash;
- timestamp;
- event type;
- authenticated writer identity;
- declared event payload;
- hash algorithm identifier and version.

The canonical event bytes must be reproducible independently.

### 12.2 Event authenticity

Event hash establishes integrity under the declared profile.

It does not independently establish writer authenticity.

Writer authenticity requires separate proof, identity and
trust-anchor validation.

### 12.3 Append outcomes

- APPENDED
- ALREADY_APPENDED
- CONFLICT
- UNKNOWN
- FAILED

ALREADY_APPENDED is valid only when the existing event has the
same event identity and matching canonical payload.

A matching eventId with different payload is CONFLICT.

UNKNOWN requires reconciliation with the original eventId.

### 12.4 Sequence allocation

The selected backend must provide one authoritative arbitration
mechanism for each project chain.

The future contract must specify:

- sequence allocation authority;
- atomic claim or conditional append;
- uniqueness constraints;
- duplicate event handling;
- ordering guarantee;
- acknowledgement semantics;
- recovery after allocation;
- recovery after append;
- reconciliation after timeout.

No two different events may be accepted as the authoritative
event for the same project sequence.

### 12.5 Allocation-before-append crash

If a sequence is allocated but the event is not confirmed appended:

- preserve the allocation identity;
- reconcile the original event;
- do not silently reuse the sequence;
- do not invent an event to conceal the gap;
- apply the approved recovery policy.

The policy must distinguish a recoverable pending allocation
from an integrity-breaking missing sequence.

### 12.6 Append-before-acknowledgement crash

If append may have succeeded but acknowledgement was lost:

- look up the original eventId;
- verify canonical payload;
- verify sequence and previous hash;
- return ALREADY_APPENDED only when all bindings match;
- otherwise return CONFLICT or UNKNOWN.

### 12.7 Chain verification

Independent verification checks:

- genesis identity;
- sequence continuity;
- previous-hash linkage;
- event hash;
- project scope;
- event identity uniqueness;
- checkpoint binding;
- writer authenticity where required.

Missing sequence, fork, invalid hash or broken linkage raises
AUDIT_INTEGRITY_FAILURE.

Integrity failure must not be silently repaired by rewriting
history.

### 12.8 Checkpoints

A checkpoint binds:

- project identity;
- sequence number;
- chain head hash;
- checkpoint profile;
- creation evidence;
- authenticity evidence.

Checkpoint verification must not trust only the component
that created the checkpoint.

### 12.9 Test mapping

- HFM-CHAIN-001: canonical event bytes.
- HFM-CHAIN-002: event hash self-reference exclusion.
- HFM-CHAIN-003: valid append.
- HFM-CHAIN-004: duplicate identical event.
- HFM-CHAIN-005: same eventId with changed payload.
- HFM-CHAIN-006: concurrent sequence allocation.
- HFM-CHAIN-007: allocation-before-append crash.
- HFM-CHAIN-008: append-before-acknowledgement crash.
- HFM-CHAIN-009: missing sequence.
- HFM-CHAIN-010: fork detection.
- HFM-CHAIN-011: checkpoint verification.
- HFM-CHAIN-012: writer authenticity failure.

## 13. DR-09 — Idempotency and Revision Integration

### 13.1 Canonical uniqueness scope

Proposed scope:

`(projectId, operationId, idempotencyKey)`

The identity is bound to payloadHash, actor, policy decision,
target and expected revision.

### 13.2 Request behavior

- Same identity and same payload resolve to one logical operation.
- Same identity with different payload is rejected.
- Repeated committed requests return the prior result.
- Repeated completion does not create another revision.
- IN_PROGRESS does not authorize duplicate execution.
- UNKNOWN does not authorize blind retry.
- CONFLICT requires authoritative reread.
- NOT_COMMITTED requires fresh authorization and revision checks.
- Expiry does not prove non-commit.
- Restart preserves identity and prior evidence.

### 13.3 Atomic claim protocol

The selected provider must implement or support an atomic
arbitration mechanism.

The proposed logical sequence is:

1. Normalize and validate the operation identity.
2. Atomically claim or retrieve the identity.
3. If an existing identity has a different payload, reject.
4. If an identical operation is in progress, return IN_PROGRESS.
5. If an identical operation is committed, return its prior result.
6. If the identity is unresolved, reconcile the original operation.
7. Execute only if the claim is authoritative and authorization
   remains valid.
8. Persist the result and resulting revision.
9. Preserve the same identity through recovery.

This sequence is a logical requirement, not a selection of a
specific database or lock implementation.

### 13.4 Claim expiry and leases

A lease or claim timeout must not prove that the original
mutation did not commit.

If leases are used, the provider contract must define:

- lease identity;
- ownership;
- expiry;
- renewal;
- fencing or equivalent stale-owner prevention;
- takeover rules;
- crash recovery;
- reconciliation before takeover.

A stale process must not continue mutation after losing
authoritative claim ownership.

### 13.5 Retention expiry

The contract must define:

- retention duration;
- retention authority;
- provider lookup availability;
- post-expiry reconciliation;
- expired unresolved operation handling;
- audit evidence retention relationship.

If identity evidence expires and the provider cannot establish
the original outcome, the result remains UNKNOWN or
RECOVERY_REQUIRED.

### 13.6 Revision integration

The operation's expected revision is checked before execution.

The resulting revision is bound to the original operation result.

A repeated operation must not create a second revision merely
because a caller retries after losing the first acknowledgement.

Revision conflict requires explicit conflict resolution.
No automatic merge is authorized by this prototype.

### 13.7 Test mapping

- HFM-IDEM-001: same identity and same payload.
- HFM-IDEM-002: same identity and changed payload.
- HFM-IDEM-003: concurrent duplicate claims.
- HFM-IDEM-004: repeated committed request.
- HFM-IDEM-005: in-progress duplicate.
- HFM-IDEM-006: restart preservation.
- HFM-IDEM-007: expired claim.
- HFM-IDEM-008: stale lease owner.
- HFM-IDEM-009: retention expiry.
- HFM-IDEM-010: revision conflict.
- HFM-IDEM-011: no duplicate revision.
- HFM-IDEM-012: fresh authorization before retry.

## 14. DR-10 — Independent Test Evidence and Verification

### 14.1 Evidence schema

Every test record must include:

- testId;
- requirementId;
- fixtureId;
- expectedResult;
- actualResult;
- testStatus;
- evidenceReference;
- failureInjection;
- productionDataTouched;
- networkRequests;
- executionEnvironment;
- buildHash;
- providerVersion;
- verifierIdentity;
- reproducibilityReference;
- execution timestamp;
- test harness version;
- fixture integrity reference;
- tested requirement list;
- untested requirement list.

No raw production Memory or secret material is permitted.

### 14.2 Status semantics

- PASS: expected result observed and independently inspectable evidence exists.
- FAIL: observed result contradicts expectation.
- INCONCLUSIVE: execution or evidence is insufficient.
- NOT_APPROVED: required authority was not granted.
- REVIEW_REQUIRED: review remains open.
- NOT_APPLICABLE: requirement is formally determined not to apply,
  with rationale and approval reference.

NOT_APPLICABLE is not a substitute for an unexecuted test.

Skipped, unavailable and unexecuted tests are never PASS.

### 14.3 Test ID uniqueness

Every testId must map to exactly one test definition.

A test may verify multiple requirements only when each requirement
mapping is explicitly recorded.

A reused identifier must not refer to different test definitions.

The test registry must reject duplicate test IDs.

### 14.4 Independent verification

The implementation under test or Bug Hunter cannot be the sole
independent verifier of its own repair or security claims.

The evidence record must identify:

- verifier;
- verification scope;
- independence basis;
- evidence access;
- method;
- limitations;
- reproducibility.

A second execution by the same unverified component is not,
by itself, independent verification.

### 14.5 Mock limitations

Mock-provider success proves only the tested mock behavior.

It does not establish real-provider compatibility, durability,
atomicity, reconciliation or production readiness.

Live provider verification requires a separate authorization
and controlled test plan.

### 14.6 Coverage and evidence closure

Every normative requirement must map to one or more test IDs.

Every test must map back to at least one requirement or be
explicitly classified as an approved supporting test.

Coverage reporting must distinguish:

- tested;
- failed;
- inconclusive;
- not approved;
- review required;
- not applicable;
- not executed.

A documented requirement is not automatically a tested requirement.

### 14.7 Test mapping

- HFM-EVIDENCE-001: mandatory evidence fields.
- HFM-EVIDENCE-002: unique test ID registry.
- HFM-EVIDENCE-003: requirement traceability.
- HFM-EVIDENCE-004: PASS evidence inspection.
- HFM-EVIDENCE-005: INCONCLUSIVE semantics.
- HFM-EVIDENCE-006: NOT_APPLICABLE approval.
- HFM-EVIDENCE-007: verifier independence.
- HFM-EVIDENCE-008: fixture isolation.
- HFM-EVIDENCE-009: failure-injection state verification.
- HFM-EVIDENCE-010: coverage and limitation report.

## 15. Cross-Protocol Consistency Rules

### 15.1 Operation identity

DR-01, DR-06 and DR-09 must use the same original operation
identity and payload binding.

No section may create a replacement operation identity
to resolve uncertainty.

### 15.2 Audit identity

DR-06 and DR-08 must use the same stable audit event identity
for append, lookup, reconciliation and restart recovery.

### 15.3 Hash and authenticity

DR-02, DR-03, DR-07 and DR-08 must use explicit, versioned
canonical profiles.

Each profile must declare self-reference exclusions.

Hash validity is not authenticity proof.

### 15.4 Authorization and trust

DR-04 and DR-05 remain independent.

Trust elevation does not grant access.

Delegation does not change record ownership.

### 15.5 Recovery and idempotency

DR-06 recovery must invoke DR-01 reconciliation and DR-09
identity arbitration.

Recovery must not bypass fresh authorization.

### 15.6 Restore and audit

DR-07 restore must preserve audit evidence and must not create
an implicit production write.

Restore verification must be distinct from restore authorization.

### 15.7 Test traceability

DR-10 must map every normative requirement across DR-01
through DR-09 to unique test definitions.

### 15.8 Conflict precedence

If two proposed rules conflict:

1. preserve the stronger approved existing security rule;
2. block the affected action;
3. record the conflict;
4. require explicit design resolution;
5. do not let implementation choose a permissive interpretation.

## 16. Consolidated Open Design Decision Register

These decisions remain open. Prototype D does not claim they
are approved or closed.

| ID | Decision | Required resolution |
|---|---|---|
| D-01 | RecordHash profile | Final immutable field set and envelope location |
| D-02 | Authenticity profiles | Algorithm, domain separation and trust-anchor governance |
| D-03 | Historical verification | Revocation, compromise and trusted-time policy |
| D-04 | Delegation chains | Re-delegation authority, depth and revocation propagation |
| D-05 | Trust transition table | Machine-readable transitions and quarantine release |
| D-06 | Reachability expiry | Evidence lifetime and expiry behavior |
| D-07 | Audit backend | Durability, consistency and reconciliation guarantees |
| D-08 | Recovery authority | State decision table and human escalation rules |
| D-09 | Manifest schema | Canonical field names, scope and proof coverage |
| D-10 | Audit concurrency | Sequence allocator and atomic append mechanism |
| D-11 | Idempotency retention | Duration, uniqueness and provider-boundary implementation |
| D-12 | Independent verification | Verifier qualification and evidence custody |

Each decision must record:

- rationale;
- alternatives;
- security impact;
- compatibility impact;
- operational impact;
- test impact;
- approval authority;
- decision status.

A decision is not closed merely because a proposal appears in
this document.

## 17. Requirement Traceability and Acceptance Gates

### 17.1 Traceability record

Every future normative requirement must identify:

- stable requirement ID;
- source contract section;
- source blueprint section;
- applicable DR;
- input and output;
- preconditions;
- authorization requirements;
- success behavior;
- failure behavior;
- evidence requirement;
- test IDs;
- unresolved decision references.

### 17.2 Acceptance gates

**Gate A — Source consistency**

Every proposed requirement maps to the existing contract and
blueprint. No existing security rule is weakened.

**Gate B — Decision closure**

Required P0/P1 design decisions are resolved or explicitly
accepted as limitations by the proper authority.

**Gate C — Protocol consistency**

Operation identity, audit identity, canonical profiles,
state machines, authorization and provider guarantees agree.

**Gate D — Schema review**

Record, manifest, event, delegation and evidence schemas are
internally consistent and versioned.

**Gate E — Test traceability**

Every normative requirement maps to unique tests and evidence.

**Gate F — Independent design review**

A reviewer independent of the prototype author examines
security, recovery, cryptography, privacy and compatibility.

**Gate G — Explicit user approval**

The user explicitly approves the reviewed design before any
separate candidate preparation is proposed.

**Gate H — Candidate preparation**

Only after the preceding gates pass may a separate v0.2.5
Contract Candidate be proposed.

Passing these gates does not itself authorize production
migration, restore, network access or implementation.

## 18. Required Independent Review Checklist

The reviewer must independently examine:

- operation identity consistency;
- provider reconciliation authority;
- retry authorization;
- ContentHash and RecordHash boundaries;
- cryptographic self-reference exclusion;
- key compromise and historical verification;
- delegation scope and revocation;
- trust-state completeness;
- crash points across every persistence boundary;
- audit append idempotency;
- sequence allocation and fork handling;
- backup manifest authenticity;
- restore containment;
- revision and idempotency consistency;
- test ID uniqueness;
- independent evidence custody;
- privacy and secret exclusion;
- compatibility with existing contract sections;
- release and production authorization boundaries.

Each checklist item must have evidence and a status.
An unchecked item is not PASS.

## 19. Final Status

DOCUMENT_STATUS=TECHNICAL_GAP_CLOSURE_REVISION_PROTOTYPE
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

Prototype D is a design revision proposal only.

It does not establish cryptographic approval, provider
compatibility, implementation correctness, independent review
completion or production readiness.

END OF PROTOTYPE D
