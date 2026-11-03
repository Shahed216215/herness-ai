# DR-08 — Decision Closure Matrix
## Mira Hybrid Memory v0.2.5 Semantic Review

**Document ID:** MIRA-HFM-DR08-DCM-v0.2  
**Status:** DRAFT — REVIEW REQUIRED  
**Scope:** DR-08 Audit Chain Ordering and Concurrent Append  
**Authority:** Design review only  
**Implementation approval:** NOT_APPROVED  
**Production Memory access:** NOT_AUTHORIZED  
**Production readiness:** NOT_CERTIFIED  

---

## 1. Purpose and boundaries

This matrix consolidates unresolved DR-08 design decisions across:

1. Contract v0.2.4
2. Blueprint v0.2.5
3. Prototype B
4. Prototype C
5. Prototype D
6. Prototype E

It proposes decision directions, alternatives, required evidence, and closure criteria.

This document does not amend or supersede any source document. Proposals below are not approved requirements. No implementation, migration, provider selection, production write, or Production Memory test is authorized by this document.

### Evidence boundary

The latest read-only audit confirmed all six source files were present. Five reported hashes matched the previously recorded values. The Blueprint hash differed from the previously recorded baseline:

- Previously recorded: `246b0d43b82af95653a2431158a48bc48088cab9bb41b6efa7303a87a1b31f`
- Latest audit output: `246b0d43b82af95653a243115a58e48bc48088cab9bb41b6efa7303a87a1b31f`

**Status: BASELINE_HASH_MISMATCH — REVIEW_REQUIRED.**

This discrepancy must be reconciled against an authoritative baseline before claiming complete source-integrity closure. It does not by itself prove unauthorized modification.

---

## 2. Decision summary

| ID | Decision | Current status | Proposed direction |
|---|---|---|---|
| DR08-U01 | Sequence gap and abandoned allocation policy | USER_APPROVED_FOR_V0.2_DESIGN | Atomic Append First; otherwise Durable Reservation with Explicit Gap Closure |
| DR08-U02 | Canonical audit event schema | REVIEW_REQUIRED | Define one versioned event envelope including sequence identity |
| DR08-U03 | Genesis record and chain initialization | REVIEW_REQUIRED | Define an authenticated, independently verifiable genesis record |
| DR08-U04 | Backend atomicity and append arbitration | NOT_ESTABLISHED | Require one authoritative per-project arbitration mechanism |
| DR08-U05 | Canonical test registry and legacy ID mapping | REVIEW_REQUIRED | One canonical test ID per test definition |
| DR08-U06 | Canonical timestamp profile | OPEN | Select one deterministic UTC representation and reject ambiguity |

Cross-cutting review item: independent verifier qualification and evidence custody (Prototype E decision E-15) remain open.

---

## 3. DR08-U01 — Sequence gap and abandoned allocation policy

**Source evidence**

- Contract §32: monotonic sequence, missing-sequence and fork detection.
- Blueprint §12: per-project ordering and append reconciliation.
- Prototype B §10: authoritative sequence allocation and append arbitration.
- Prototype C §11: allocation/append crash cases and atomic arbitration requirement.
- Prototype D §12: allocation-before-append recovery; no silent sequence reuse.
- Prototype E §8 and E-06: stable allocation identity; unused allocation and gap policy unresolved.

**Problem**

A sequence may be allocated but its event may not be appended because of a crash, timeout, or uncertain provider response. The design has not selected a final policy for this unused allocation. Silently skipping or reusing it can conceal a missing event or create a fork.

**Proposed direction — NOT_APPROVED**

1. Every allocation receives a stable allocation identity bound to project, event identity, sequence, authority, and allocation profile.
2. An uncertain allocation or append is reconciled using the original identity.
3. An allocated sequence must never be silently reused for a different event.
4. A gap must not be silently skipped.
5. An unresolved allocation remains pending or enters `REVIEW_REQUIRED` / `RECOVERY_REQUIRED`.
6. Any future tombstone, abandonment, cancellation, or gap-record mechanism must itself be an authenticated, durable, auditable chain event under an explicitly approved policy.
7. If the gap cannot be resolved safely, the chain must not be represented as complete or healthy.

**Alternatives requiring comparison**

- A. Atomic sequence allocation and append in one provider operation.
- B. Durable reservation followed by append, with explicit recovery of unused reservations.
- C. Explicit authenticated tombstone/abandonment event.
- D. Permanent chain halt when an allocation cannot be reconciled.

**Trade-offs**

- A gives the simplest chain semantics but depends on provider capability.
- B supports separate allocation and append but requires durable allocation records and crash recovery.
- C makes gaps explicit but introduces another event type and authorization path.
- D is safest when evidence is insufficient but may reduce availability.

**Required tests**

- Allocation-before-append crash.
- Append-before-ack crash.
- Reconciliation of the same allocation identity.
- Attempted sequence reuse.
- Unresolved allocation cannot be silently skipped.
- Tombstone/abandonment behavior, if approved.
- Concurrent allocation conflict and fork detection.

**Closure evidence**

A normative gap policy, allocation state machine, recovery rules, unique test definitions, failure-injection evidence, and independent review.

**Decision disposition: USER_APPROVED_FOR_V0.2_DESIGN.**

**Approved policy direction**

1. Prefer atomic sequence allocation and append as one authoritative operation.
2. If atomic append is unavailable, use durable reservation with a stable allocation identity and explicit recovery.
3. Never reuse an allocated sequence for a different event.
4. Never silently skip an allocated sequence.
5. Treat UNKNOWN or insufficient evidence as RECOVERY_REQUIRED.
6. Block subsequent appends on the affected project chain while an earlier allocation remains unresolved.
7. Permit gap closure only after authoritative evidence establishes that the original event was not appended and cannot later be appended, followed by an authorized, authenticated, durable closure record bound to the original allocation and event identities.
8. If evidence is insufficient, do not create a tombstone or closure record; keep the chain in recovery/review state.

**Approval boundary**

This approval accepts the policy direction for the v0.2 design record only. It does not establish backend capability, approve an implementation, authorize production writes, or authorize access to Production Memory. The exact provider protocol, state machine, schema, and test evidence remain subject to technical qualification.

**Remaining verification**

- Backend atomic allocation-and-append capability: NOT_ESTABLISHED.
- Durable reservation and authoritative reconciliation: NOT_ESTABLISHED.
- Gap-closure record schema and verification: REVIEW_REQUIRED.
- Concurrency and crash-recovery tests: NOT_TESTED.
- Independent verification: NOT_TESTED.

---

## 4. DR08-U02 — Canonical audit event schema

**Source evidence**

- Contract §19: required audit event fields and hash-chain linkage.
- Contract §32: monotonic sequence, canonical serialization, authenticated writer, checkpoints, independent verification.
- Blueprint §12: sequence number and append outcomes.
- Prototype B §10 and C §11: event structure and ordering.
- Prototype D §12: canonical event hash input and proof separation.
- Prototype E §§5, 10: stable event identity, append lifecycle, canonical profile requirements.

**Problem**

Contract §19 lists the event fields but does not explicitly list `sequenceNumber`, although Contract §32 requires monotonic sequence numbers. Later prototypes include sequence number in the event structure and hash input.

The final schema must also distinguish event data from allocation references, proof metadata, and chain/checkpoint metadata.

**Proposed direction — NOT_APPROVED**

Define a versioned canonical event envelope with at least:

- `eventId`
- `eventType`
- `occurredAt`
- `actorId` or authenticated system identity
- `projectId`
- `operationId`, where applicable
- `idempotencyKey`, where applicable
- `targetMemoryId`, where applicable
- `action`
- `authorizationDecision`
- `capabilityState`
- `beforeRevision` and `afterRevision`, where applicable
- `resultStatus`
- `errorCode`, where applicable
- `sourceReference`, where applicable
- `payloadHash`, where applicable
- `sequenceNumber`
- `previousEventHash`
- canonical profile ID/version
- hash algorithm ID/version
- `eventHash`

Optional fields must have explicitly defined absent/null semantics. The schema must define which fields are mandatory for each event type.

Proof fields dependent on `eventHash` must not be included in the bytes used to calculate that same hash. Their independent authenticity coverage must be specified.

**Alternatives**

- A. Put `sequenceNumber` directly in the canonical event schema.
- B. Put sequence and allocation information in a separately authenticated chain envelope bound to the event hash.
- C. Use a hybrid schema with an event body and a versioned chain envelope.

**Recommendation for review**

Prefer A or C, provided the canonical bytes and hash boundary are unambiguous. Do not leave sequence identity outside the authenticated event/chain binding.

**Required tests**

- Required and conditional field validation.
- Unknown field/profile rejection.
- Absent versus null behavior.
- Canonical byte reproducibility.
- Event hash self-reference exclusion.
- Same event ID with different canonical payload produces conflict.
- Independent verifier reproduces the same event hash.

**Closure evidence**

Approved schema, field-level inclusion/exclusion table, profile version, canonical test vectors, and traceability to Contract §§19 and 32.

**Status: REVIEW_REQUIRED — NOT_APPROVED.**

---

## 5. DR08-U03 — Genesis record and chain initialization

**Source evidence**

- Prototype B §10: genesis record.
- Prototype C §11: genesis identity and initial chain state must be defined.
- Prototype D §12: independent verification starts from genesis and checks sequence continuity.
- Prototype E §8: allocation and chain-head binding.

**Problem**

A genesis requirement exists, but a complete machine-readable genesis schema, creation protocol, authenticity evidence, and verification procedure have not been established.

**Proposed direction — NOT_APPROVED**

Define one immutable genesis record per project chain. The normative specification must define:

1. Unique genesis identity.
2. Project identity and chain identity.
3. Initial sequence convention.
4. Initial chain-head value and its canonical derivation.
5. Canonical profile and hash algorithm versions.
6. Authenticated creator/process identity.
7. Creation timestamp profile.
8. Trust-anchor or authenticity evidence.
9. Durable creation acknowledgement.
10. Independent verification procedure.
11. Duplicate genesis creation behavior.
12. Recovery behavior after uncertain genesis creation.

The exact initial sequence and genesis hash derivation must be explicit constants or deterministic rules in the approved profile. They must not be inferred by an implementation.

**Alternatives**

- A. Genesis is a dedicated first chain event.
- B. Genesis is a separately authenticated chain anchor referenced by the first event.
- C. Genesis is a versioned envelope containing the initial chain state.

**Required tests**

- Valid genesis creation.
- Duplicate genesis request.
- Genesis identity conflict.
- Genesis tampering.
- Unknown or invalid genesis profile.
- First event links to the approved genesis state.
- Independent verifier rejects missing or invalid genesis.

**Closure evidence**

Machine-readable schema, deterministic initialization rules, authenticity model, duplicate/recovery semantics, and independent test vectors.

**Status: REVIEW_REQUIRED — NOT_APPROVED.**

---

## 6. DR08-U04 — Backend atomicity and append arbitration

**Source evidence**

- Blueprint §12: append outcomes and stable event reconciliation.
- Prototype B §10: authoritative sequence allocation and append arbitration.
- Prototype C §11: backend must provide verifiable atomic arbitration.
- Prototype D §12: one authoritative arbitration mechanism per project chain.
- Prototype E §8: stable allocation identity and no sequence reuse.

**Problem**

The design requires atomic arbitration, but no actual backend/provider capability has been established. A design statement is not evidence that a selected backend provides linearizable sequence allocation, uniqueness, durable append, or authoritative lookup.

**Proposed direction — NOT_APPROVED**

The implementation contract should require one authoritative arbitration mechanism per project chain.

Preferred capability:

- Atomically claim the next sequence and append the event; or
- Use a separately durable allocation protocol with stable allocation identity and fully specified crash recovery.

The backend must demonstrate:

1. No two different events can become authoritative for the same project sequence.
2. Duplicate event identities are arbitrated deterministically.
3. Same identity plus same canonical payload can reconcile as already appended.
4. Same identity plus different payload returns conflict.
5. Append acknowledgement semantics are documented.
6. Uncertain outcomes can be reconciled against authoritative evidence.
7. Crash after allocation and crash after append-before-ack are recoverable.
8. A fork cannot be silently overwritten or repaired.

If no backend can meet the approved guarantees, consequential audit-dependent operations must remain disabled or fail closed.

**Alternatives**

- A. Provider-native conditional append/transaction.
- B. Durable per-project allocator plus conditional append.
- C. Dedicated serialized append service with authenticated durable state.
- D. No supported backend: keep consequential operations disabled.

**Required evidence**

Provider documentation is insufficient by itself for final qualification. Require isolated concurrency and crash-injection tests, authoritative readback, duplicate arbitration tests, and independent verification.

**Status: NOT_ESTABLISHED — NOT_APPROVED.**

---

## 7. DR08-U05 — Canonical test registry and legacy ID mapping

**Source evidence**

- Blueprint §12: HFM-LOG-001 through HFM-LOG-007.
- Prototype B §10: HFM-LOG-001 through HFM-LOG-010.
- Prototype C §11: HFM-LOG-001 through HFM-LOG-007 with extended fixtures.
- Prototype D §12: HFM-CHAIN-001 through HFM-CHAIN-012.
- Contract §33: every requirement maps to test definitions and evidence.
- Prototype E §9: one test ID must identify exactly one test definition; execution status and evidence are required.

**Problem**

The same HFM-LOG IDs do not necessarily retain the same test meaning across documents. Prototype D introduces HFM-CHAIN IDs. A test name or mapping does not prove that a test ran.

**Proposed direction — NOT_APPROVED**

Create one canonical DR-08 test registry.

Each canonical test definition must have:

- Unique immutable test ID.
- Requirement ID(s).
- Source document and section.
- Fixture and setup.
- Action and failure injection.
- Expected result.
- Actual result.
- Execution status.
- Evidence reference.
- Environment and build/source hash.
- Verifier identity.
- Limitations and approval state.

Legacy IDs must be retained only as aliases in an explicit migration table. An alias must not silently change the meaning of an existing test.

Suggested canonical test families:

- Event schema and canonical serialization.
- Event hash and previous-hash linkage.
- Duplicate identity and changed-payload conflict.
- Sequence allocation and concurrency arbitration.
- Allocation-before-append recovery.
- Append-before-ack recovery.
- Gap and abandoned-allocation policy.
- Genesis creation and verification.
- Checkpoint and independent verification.
- Writer authenticity.
- Fork, missing-sequence, and tamper detection.
- Timestamp determinism.

**Status vocabulary**

Use the Prototype E coverage statuses:

`TESTED_PASS`, `TESTED_FAIL`, `INCONCLUSIVE`, `NOT_APPROVED`, `REVIEW_REQUIRED`, `NOT_APPLICABLE`, `NOT_EXECUTED`.

`NOT_EXECUTED` is never PASS. `NOT_APPLICABLE` requires rationale and approval. A test mapping is not execution evidence.

**Closure evidence**

A complete requirement-to-test registry, unique test definitions, legacy ID migration table, and evidence-backed execution records.

**Status: REVIEW_REQUIRED — NOT_APPROVED.**

---

## 8. DR08-U06 — Canonical timestamp profile

**Source evidence**

- Contract §19: audit event timestamp.
- Contract §32: canonical serialization and ordered chain.
- Prototype D §12: timestamp is part of the canonical event hash input.
- Prototype E §10 and E-08: timestamp representation decisions remain open.

**Problem**

Different timezone offsets, fractional precision, missing timestamps, leap seconds, and inconsistent normalization can produce different canonical bytes for the same intended instant.

**Proposed direction — NOT_APPROVED**

Select one versioned timestamp profile. It must define:

1. Accepted input syntax.
2. UTC normalization rule.
3. Fractional-second precision.
4. Rounding or rejection behavior for excess precision.
5. Leap-second handling.
6. Invalid and missing timestamp behavior.
7. Whether event creation time and provider-observed time are distinct fields.
8. Canonical serialized representation.
9. Clock-source and trusted-time limitations.
10. Independent verifier behavior.

Do not silently normalize malformed timestamps or silently discard precision.

**Alternatives for review**

- A. Fixed-precision RFC 3339 UTC string.
- B. Integer epoch time with an explicitly defined unit and range.
- C. A typed timestamp envelope carrying canonical instant and separately recorded source-time metadata.

**Recommendation for review**

Prefer one deterministic UTC representation with fixed precision and explicit rejection rules. Keep display formatting separate from canonical hash input.

**Required tests**

- Equivalent timezone inputs normalize identically, if normalization is allowed.
- Fractional precision boundaries.
- Excess precision.
- Missing and invalid timestamps.
- Leap-second policy.
- Canonical bytes remain reproducible across independent implementations.

**Status: OPEN — NOT_APPROVED.**

---

## 9. Cross-cutting decision — Independent verifier (E-15)

An independent verifier must not rely solely on the writer, allocator, checkpoint producer, or the same unverified provider response it is checking.

The qualification plan must define:

- Verifier identity and authority.
- Independence criteria.
- Source of trust anchors and verification profiles.
- Evidence custody and tamper protection.
- Reproducible verification procedure.
- Conflict and disagreement handling.
- Verification limitations and environment.
- Audit record of the verification decision.

**Status: REVIEW_REQUIRED.** This item is related to DR-08 closure but remains separately governed by E-15.

---

## 10. Required canonical append outcome semantics

Prototype E expands the append outcomes beyond the earlier five-state interface.

Candidate canonical outcomes:

| Outcome | Meaning | Required handling |
|---|---|---|
| APPENDED | Authoritative evidence confirms durable append | Verify event and chain binding |
| ALREADY_APPENDED | Same identity and identical canonical payload already exist | Reconcile; do not append again |
| NOT_APPENDED | Authoritative evidence confirms no append occurred | Reauthorize before retrying same logical event |
| IN_PROGRESS | Original append remains active or unresolved | Wait/reconcile same identity |
| CONFLICT | Identity, payload, allocation, or chain binding conflicts | Stop and review/quarantine |
| UNKNOWN | Evidence cannot establish outcome | Recovery required; no blind retry |
| FAILED | A defined terminal failure is established | Verify side effects and failure audit |

The approved interface must define whether `FAILED` is terminal, what evidence establishes `NOT_APPENDED`, and how provider-specific outcomes map to these canonical states.

An eventually consistent or incomplete lookup must not be treated as authoritative proof of `NOT_APPENDED`.

**Status: REVIEW_REQUIRED — NOT_APPROVED.**

---

## 11. Requirement and test traceability checklist

Before DR-08 design closure, verify that every normative requirement has:

- Stable requirement ID.
- Source document and section.
- One or more canonical test IDs.
- One unambiguous expected result.
- Failure behavior.
- Authorization requirement.
- Evidence requirement.
- Open-decision reference, if applicable.
- Review and approval status.

Minimum test domains:

- [ ] Event schema and canonical serialization.
- [ ] Hash self-reference exclusion.
- [ ] Previous-event linkage.
- [ ] Project chain isolation.
- [ ] Event identity uniqueness.
- [ ] Concurrent sequence allocation.
- [ ] Allocation-before-append crash.
- [ ] Append-before-ack crash.
- [ ] Gap and abandoned-allocation handling.
- [ ] Genesis creation and verification.
- [ ] Duplicate and changed-payload reconciliation.
- [ ] Checkpoint authenticity and chain-head binding.
- [ ] Independent chain verification.
- [ ] Writer authenticity.
- [ ] Timestamp canonicalization.
- [ ] Audit privacy and secret exclusion.
- [ ] Failure containment and recovery.

No unchecked item is PASS.

---

## 12. DR-08 closure gates

| Gate | Required evidence | Current state |
|---|---|---|
| G1 Source integrity | All six source hashes reconciled to authoritative baseline | REVIEW_REQUIRED |
| G2 Source traceability | Every decision tied to exact source sections | PARTIAL |
| G3 Schema consistency | Event and chain envelope schema approved | NOT_APPROVED |
| G4 Sequence recovery | Allocation and gap policy approved | OPEN |
| G5 Genesis | Creation and verification protocol approved | REVIEW_REQUIRED |
| G6 Backend capability | Atomic arbitration demonstrated by isolated evidence | NOT_ESTABLISHED |
| G7 Test registry | Unique canonical IDs and legacy mappings | REVIEW_REQUIRED |
| G8 Timestamp profile | Deterministic timestamp profile approved | OPEN |
| G9 Independent verification | Verifier qualification and evidence custody | REVIEW_REQUIRED |
| G10 Independent design review | All unresolved decisions reviewed | NOT_APPROVED |
| G11 Explicit authorization | Separate approval for any implementation scope | NOT_APPROVED |

Passing design gates does not authorize Production Memory access, migration, restore, network activity, or self-modification.

---

## 13. Final assessment

**DR-08 overall: INCONCLUSIVE.**

The source material establishes important design principles: per-project ordering, stable event identity, sequence allocation, append reconciliation, crash recovery, checkpoint verification, and fail-closed handling of chain corruption.

However, the following remain unresolved:

1. Sequence gap and unused allocation policy.
2. Final canonical event schema and sequence binding.
3. Complete genesis protocol.
4. Actual backend atomicity and provider guarantees.
5. Canonical test registry and legacy ID mapping.
6. Timestamp profile.
7. Independent verifier qualification and evidence custody.
8. Reconciliation of the Blueprint source hash discrepancy.

No implementation or runtime/provider capability is established by this matrix.

**Design approval: NOT_APPROVED.**  
**Implementation approval: NOT_APPROVED.**  
**Production Memory: NOT_AUTHORIZED.**  
**Production readiness: NOT_CERTIFIED.**

---

## 14. Change control

This is a review draft. Any accepted decision must be recorded with:

- Decision ID.
- Exact approved wording.
- Rationale and alternatives considered.
- Security and compatibility impact.
- Approving authority.
- Source sections requiring revision.
- Test and evidence updates.
- Effective version and date.

No source document should be silently changed to match this draft. Source revisions require their own review, integrity baseline, and explicit authorization.
