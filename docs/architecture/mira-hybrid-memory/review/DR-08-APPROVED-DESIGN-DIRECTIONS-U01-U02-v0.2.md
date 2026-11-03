# DR-08 Approved Design Directions — U01 and U02

**Document ID:** MIRA-HFM-DR08-APPROVED-DIRECTIONS-U01-U02  
**Version:** 0.2  
**Recorded:** 2026-11-03  
**Repository:** `Shahed216215/herness-ai`  
**Branch:** `work/mira-hfm-v025-continuity`  
**Decision class:** USER-APPROVED DESIGN DIRECTION ONLY  
**Implementation status:** NOT AUTHORIZED

---

## 1. Purpose and authority

This document records the user's explicit approval of two DR-08 design directions for Mira Hybrid Memory v0.2. It is an additive decision record. It does not replace Contract v0.2.4, Blueprint v0.2.5, Prototypes B–E, or the full DR-08 decision-closure matrix.

Approval applies to the design direction only. It does not authorize implementation, production-provider access, Production Memory access, migration, restore, writes, or release.

## 2. DR08-U01 — Sequence gaps and abandoned allocation

**Disposition:** USER_APPROVED_FOR_V0.2_DESIGN  
**Approved direction:** **Atomic Append First; otherwise Durable Reservation with Explicit Gap Closure.**

Normative design rules:

1. Prefer one authoritative atomic operation that allocates the per-project sequence number and appends the corresponding event.
2. If atomic allocation-plus-append is unavailable, use a durable reservation with a stable allocation identity and explicit recovery semantics.
3. Never reuse an allocated sequence number for a different event.
4. Never silently skip an allocated sequence number.
5. An UNKNOWN outcome, or evidence insufficient to establish the authoritative outcome, enters RECOVERY_REQUIRED.
6. Block subsequent appends on the affected project chain while an earlier allocation remains unresolved. Independent project chains may continue.
7. A gap may be closed only when authoritative evidence establishes both that the original event was not appended and that it cannot later be appended. Closure then requires an authorized, authenticated, durable closure record bound to the original allocation and event identities.
8. If the required proof is unavailable or ambiguous, do not create a tombstone or closure record; retain the chain in recovery/review.
9. The closure record occupies the reserved sequence and permanently prevents the original event from later being appended at that sequence.

**Still open / not established:** backend atomicity, reservation durability, authoritative reconciliation, closure-record schema, crash/concurrency behavior, and independent verification.

## 3. DR08-U02 — Canonical audit event schema

**Disposition:** USER_APPROVED_FOR_V0.2_DESIGN  
**Approved direction:** **Single Canonical Versioned Audit Event Envelope.**

The design shall use one canonical, versioned envelope containing, at minimum:

- stable event identity and operation identity;
- project identity and per-project sequence number;
- event type and business/action fields;
- authorization decision and operation/result fields;
- previous-event chain linkage;
- authenticated writer identity;
- schema and versioned hash-profile metadata.

Canonical hash-profile requirements:

1. The defined canonical hash input includes the sequence number and previous-event hash.
2. The hash input excludes `eventHash` itself and any dependent proof fields that would create circular hashing.
3. The profile explicitly defines included/excluded fields, required/optional fields, absent-versus-null semantics, encoding, and schema-version behavior.
4. Contract §26's RFC 8785 JSON Canonicalization Scheme (JCS) is the baseline, subject to the final versioned profile.
5. Unsupported schema or hash-profile versions fail closed.
6. Historical events remain immutable during any future migration or compatibility work.

**Not yet finalized:** exact machine-readable field registry/schema, timestamp and null semantics (U06), genesis compatibility (U03), backend atomicity/arbitration (U04), canonical test registry and legacy ID crosswalk (U05), and independent verifier qualification (E-15). Any illustrative JSON is conceptual until these are closed.

## 4. Cross-decision invariants

- U01 and U02 must be implemented consistently: the sequence identity allocated under U01 is part of the canonical event envelope under U02.
- Stable event/allocation identity must survive retries, restart, uncertain outcomes, and recovery.
- No UNKNOWN outcome may be converted to success or NOT_APPENDED without authoritative evidence.
- No sequence may be silently reused or concealed.
- Chain repair must not rewrite historical events or fabricate proof.
- A producer's own PASS claim is not independent verification.
- Design approval does not establish that any database, provider, storage backend, or runtime satisfies the design.

## 5. Evidence and status

| Item | Status | Evidence boundary |
|---|---|---|
| User approval of U01 direction | USER_APPROVED_FOR_V0.2_DESIGN | Explicit approval recorded in conversation; prior local matrix update was reported as terminal-verified |
| User approval of U02 direction | USER_APPROVED_FOR_V0.2_DESIGN | Explicit approval recorded in conversation |
| Full original decision matrix imported to GitHub | NOT_YET_PRESENT | Must be imported from the authoritative local file; do not reconstruct it |
| Backend/provider compatibility | NOT_ESTABLISHED | No provider capability inferred |
| Runtime/concurrency/crash tests | NOT_TESTED | No tests executed by this decision record |
| Production Memory access | NOT_ACCESSED | Prohibited for this review |
| Implementation authorization | NOT_AUTHORIZED | Requires separate explicit approval |

## 6. Required closure work

1. Import the authoritative full DR-08 decision-closure matrix and verify its source hash.
2. Close U03 genesis protocol and align it with the U02 envelope.
3. Close U04 backend-neutral atomicity, arbitration, durability, and reconciliation acceptance requirements.
4. Close U05 canonical test registry and legacy ID mapping.
5. Close U06 canonical timestamp profile.
6. Define and qualify E-15 independent verifier.
7. Produce isolated fixture specifications for concurrency, allocation-before-append crash, append-before-ACK, duplicate arbitration, gap closure, tampering, wrong-project binding, and checkpoint verification.
8. Complete independent design review before considering implementation readiness.

---

**Overall:** U01 and U02 design directions are approved. DR-08 remains INCONCLUSIVE. Implementation is NOT AUTHORIZED. Production readiness is NOT CERTIFIED.
