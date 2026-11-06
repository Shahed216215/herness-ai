# Mira HFM Data Plane Proposal v0.1 — Contract Consistency Review

**Review date:** 2026-11-06  
**Reviewed proposal:** `MIRA-HFM-DATA-PLANE-ARCHITECTURE-PROPOSAL-V0.1-20261106.md`  
**Normative baseline:** HFM Phase 2 Detailed Technical Contract v0.2.4  
**Design input:** HFM v0.2.5 Design Revision Blueprint and Gap Closure Prototype B  
**Status:** REVIEW COMPLETE — CHANGES REQUIRED — NOT APPROVED  
**Implementation:** NOT AUTHORIZED

## 1. Executive decision

The Data Plane Proposal v0.1 is a useful first architecture sketch, but it is **not yet consistent enough with the HFM v0.2.4 contract and v0.2.5 design work to approve as the implementation contract**.

The largest unresolved decision is the storage/provider topology. v0.2.4 describes Facebook Page as the proposed primary provider, Google Drive as emergency backup, and explicitly rejects phone-local storage as an approved Memory backend. Proposal v0.1 instead proposes PostgreSQL/Neon as the initial canonical payload store and treats local JSON/Google Drive as legacy sources. These positions may be reconcilable only if the architecture explicitly distinguishes:
- the canonical logical Memory record and its authority;
- the durable canonical payload repository;
- external source/provider adapters and source-of-truth semantics;
- emergency backup and recovery copies.

The proposal currently does not define that reconciliation. It must not silently replace the v0.2.4 provider contract.

No production implementation, migration, schema, grant, role, secret, Render setting, or data operation is authorized by this review.

## 2. Findings and required resolutions

### DR-COMPAT-01 — Provider topology and canonical storage conflict

**Severity:** BLOCKER  
**Evidence:**
- v0.2.4 §1: Facebook Page is a proposed primary provider; Facebook Group is secondary/manual import; Public Web Search is retrieval rather than durable Memory; Google Drive is emergency backup only.
- v0.2.4 §1 and §12: phone-local storage is not an approved Memory backend; silent fallback is prohibited.
- Proposal v0.1 §§1, 3, 11: PostgreSQL/Neon is proposed as the initial durable structured payload store; local JSON and Google Drive are described as legacy sources.

**Risk:** The implementation could select a new system of record without a reviewed HFM contract revision. Provider capability, ownership, backup, and recovery semantics may then diverge from the existing design.

**Required resolution:** Produce one explicit topology decision table defining the role of Facebook Page, PostgreSQL/Neon, Google Drive, Facebook Group, public web retrieval, and legacy local files. State which system is authoritative for each record class and operation. If PostgreSQL is intended to become the canonical durable store, submit that as an explicit v0.2.5 contract-level change; do not imply that v0.2.4 already approves it. Preserve the no-phone-local-primary/no-silent-fallback rule.

### DR-COMPAT-02 — Canonical identifier and schema incompatibility

**Severity:** BLOCKER  
**Evidence:**
- v0.2.4 Memory schema uses string identifiers for `memoryId` and `projectId` (with defined length bounds).
- Proposal v0.1 §4 changes `record_id`, `project_id`, and subject identifiers to UUID.
- v0.2.4 defines `recordType`, `source`, `timestamps`, `version`, `integrity`, `trust`, `access`, and `lifecycle` as explicit envelope sections.

**Risk:** Existing identifiers and provider IDs may not map losslessly. A new UUID-only schema could invalidate references, complicate migration, or produce incompatible records.

**Required resolution:** Publish a field-by-field compatibility matrix. Define whether UUIDs are new internal database keys or replacements for public/canonical HFM identifiers. If both exist, specify immutable mapping rules and uniqueness constraints. Do not change the v0.2.4 canonical record schema without an explicitly versioned contract revision.

### DR-COMPAT-03 — Trust, classification, and lifecycle vocabularies diverge

**Severity:** BLOCKER  
**Evidence:**
- v0.2.4 trust states include UNVERIFIED, SOURCE_RECORDED, SOURCE_REACHABLE, CONTENT_VERIFIED, HUMAN_VERIFIED, and QUARANTINED.
- v0.2.4 integrity states include UNVERIFIED, VERIFIED, FAILED, and QUARANTINED.
- v0.2.4 classification includes PUBLIC, PROJECT_PRIVATE, and RESTRICTED.
- v0.2.4 lifecycle includes ACTIVE, SUPERSEDED, ARCHIVED, QUARANTINED, and PENDING_REVIEW.
- Proposal v0.1 §4 compresses trust to unverified/verified/quarantined/rejected, changes classification labels, and proposes a different lifecycle vocabulary.

**Risk:** The simplified envelope loses provenance and verification distinctions. In particular, a digest match could be mistaken for content/source/human trust, or a lifecycle transition could be mistaken for authorization.

**Required resolution:** Retain the v0.2.4 state dimensions separately unless a reviewed contract amendment defines a safe mapping. Trust, integrity, classification, lifecycle, and operation authority must remain distinct. Add an explicit transition matrix and migration mapping; unknown or unmappable states must quarantine rather than default.

### DR-COMPAT-04 — Owner-project access and external delegation are incomplete

**Severity:** BLOCKER  
**Evidence:**
- v0.2.4 §27 distinguishes record ownership project, actor membership, access classification, and explicitly allowed external project IDs. Matching project ID alone is not authorization.
- v0.2.5 Blueprint P0-03 requires owner-project access and external delegation to be explicit and separately validated.
- Gap Closure Prototype B DR-04 defines time-bound delegation, allowed operations, purpose, revocation, issuing authority, and chain validation.
- Proposal v0.1 §5 checks actor, project, membership, role, operation, expiry, and replay, but does not define the complete delegation lifecycle or allowed-project semantics.

**Risk:** A project allowlist may be treated as a grant, or an owner may be assumed to have unrestricted access. Cross-project reads and writes could be incorrectly authorized.

**Required resolution:** Incorporate the owner-project and external-delegation model explicitly. Define the exact checks for actor membership, owner-project authorization, delegate project, allowed operations, purpose, expiry, revocation, delegation chain, classification, and policy decision. Allowlist membership alone must never authorize access. Admin status must not imply unrestricted payload access.

### DR-COMPAT-05 — Audit atomicity and write-ahead recovery are overstated

**Severity:** BLOCKER  
**Evidence:**
- v0.2.5 Blueprint P0-05 states that Memory and Audit providers may be independent systems and distributed atomicity must not be claimed unless the selected infrastructure explicitly provides and verifies it.
- Blueprint requires durable write-ahead audit intent, stable operation identity, reconciliation, COMMITTED_AUDIT_PENDING handling, and disabling consequential writes if durable audit is unavailable.
- Proposal v0.1 §5 says payload operation and audit append occur in the same transaction, but does not establish that the chosen payload and audit stores share one transactional database boundary or that the current authority audit table provides the required Memory write-ahead protocol.
- The existing runtime DB role is read-only; no approved runtime write path is established.

**Risk:** The design may claim atomic payload-plus-audit behavior that the current system cannot provide. A crash between payload commit and audit completion could be misreported or retried unsafely.

**Required resolution:** Specify the exact transaction topology. If payload and audit are in one PostgreSQL transaction, prove that both records are committed/rolled back together under the same database transaction and privilege model. If they are separate providers, implement the v0.2.5 durable intent/reconciliation state machine and never claim distributed atomicity. Define behavior for UNKNOWN, IN_PROGRESS, COMMITTED_AUDIT_PENDING, and audit append uncertainty. Consequential writes remain disabled until the durable audit capability is verified.

### DR-COMPAT-06 — Canonical hash and authenticity profile is unresolved

**Severity:** BLOCKER  
**Evidence:**
- v0.2.4 requires canonical serialization and SHA-256 integrity, and later sections define a RecordHash/integrity profile.
- v0.2.5 Blueprint requires the record-hash field profile to be resolved.
- Gap Closure Prototype B DR-02 proposes RFC 8785 JCS for ContentHash and a separate versioned RecordHash field profile; DR-03 states that SHA-256 alone does not prove trusted authorship.
- Proposal v0.1 §4 only says SHA-256 of canonicalized record content without specifying canonicalization, field inclusion/exclusion, profile version, or authenticity proof.

**Risk:** Different implementations may calculate different digests, or an integrity hash may be misrepresented as authenticity evidence.

**Required resolution:** Adopt or explicitly revise the proposed canonical serialization and hash profiles. Define field inclusion/exclusion, nulls, timestamps, Unicode, numbers, arrays, versioning, domain separation, and deterministic test vectors. Keep integrity and authenticity separate. Define signature/MAC algorithm, trust anchor, key revocation, and historical verification policy before claiming authenticated backups or records.

### DR-COMPAT-07 — Encryption/key custody is not implementable from current proposal

**Severity:** BLOCKER  
**Evidence:**
- v0.2.4 §§16 and 24 require envelope encryption, DEK/KEK separation, key rotation, revocation, recovery, and separate key custody; exact provider/profile remains subject to security review.
- Proposal v0.1 §10 says key custody, rotation, recovery, and revocation must be defined before restricted data is stored, but does not provide the design.
- Gap Closure Prototype B leaves signature/MAC and trust-anchor governance as open decisions.

**Risk:** “Encrypted backup” or “restricted data protected” could be claimed without a usable, recoverable, independently reviewed key-management design.

**Required resolution:** Define data encryption and key-encryption roles, algorithm/profile, nonce and authentication-tag handling, key IDs/versions, custody boundary, access authority, rotation, revocation, backup/escrow, recovery, and key-loss behavior. Do not store restricted content until the approved design is implemented and independently verified. Provider encryption at rest alone is insufficient.

### DR-COMPAT-08 — Backup authenticity and recovery objectives need stronger treatment

**Severity:** HIGH  
**Evidence:**
- v0.2.4 requires manifest integrity, encryption metadata, recovery point, read-back verification, and explicit human restore approval.
- v0.2.5 Blueprint P1 requires backup authenticity proof; a hash-only manifest is not authenticated.
- Gap Closure Prototype B DR-07 defines manifest self-reference exclusions and a separate authenticity proof.
- Proposal v0.1 §9 lists digests and encrypted backup, but does not require an authenticity proof or define a complete manifest profile.

**Risk:** A tamper-evident hash may be mistaken for proof that a backup came from an authorized producer. Restore could accept forged but internally consistent data.

**Required resolution:** Bind backup identity, project, format/schema versions, snapshot identity, record count, payload hash, manifest hash profile, encryption profile/key version, producer identity, and authenticity proof. Define trust-anchor verification and revocation. Keep RPO/RTO NOT APPROVED until provider limits and actual restore drills are measured. Do not claim zero data loss or permanent free durability.

### DR-COMPAT-09 — Idempotency, reconciliation, and crash recovery need normative integration

**Severity:** HIGH  
**Evidence:**
- v0.2.4 §13 requires atomic compare-and-swap, operation identity, idempotency key, payload hash, and exact revision behavior.
- v0.2.5 Blueprint P1 and Gap Closure Prototype B DR-01/DR-06/DR-09 require authoritative operation reconciliation, durable identity, retention semantics, and restart recovery.
- Proposal v0.1 §7 mentions idempotency and optimistic revision checks but does not define the operation state machine or authoritative reconciliation outcomes.

**Risk:** A timeout or restart after a possible write could cause duplicate writes, new revisions, or false success.

**Required resolution:** Define one normative operation state machine and persistent operation identity. Include COMMITTED, NOT_COMMITTED, IN_PROGRESS, CONFLICT, and UNKNOWN outcomes; preserve the original operation ID and payload hash. Expired idempotency retention must never imply NOT_COMMITTED. Unknown outcomes must be reconciled before retry.

### DR-COMPAT-10 — Independent test evidence and acceptance traceability are incomplete

**Severity:** HIGH  
**Evidence:**
- v0.2.4 §8 requires test evidence including productionDataTouched and networkRequests; skipped tests are INCONCLUSIVE.
- v0.2.5 Blueprint §13 requires requirement-to-test traceability and independent verification; Bug Hunter or the implementation under test cannot be the sole verifier.
- Gap Closure Prototype B DR-10 requires fixture identity, verifier identity, build hash, provider version, failure injection, and reproducibility reference.
- Proposal v0.1 §12 provides a useful verification matrix but does not map each normative requirement to test IDs and independent evidence.

**Risk:** A design checklist could be mistaken for tested implementation. Mock success could be mistaken for real-provider compatibility.

**Required resolution:** Add a requirement-to-test traceability matrix with test ID, requirement ID, fixture, expected/actual result, failure injection, evidence reference, environment/build/provider version, production-data-touch flag, network-request flag, verifier identity, and reproducibility reference. Keep mock tests separate from real-provider integration tests. Independent verification is required for security, migration, restore, and repair claims.

## 3. Additional architecture decisions required

1. **Database privilege boundary:** Current authority runtime role is SELECT-only. The proposal must not assume it can write payloads or invoke authority transactions. Design a separately reviewed narrow API/role. If SECURITY DEFINER functions are used, specify fixed search_path, owner privileges, execution grants, and how caller identity is authenticated without trusting arbitrary actor IDs.
2. **Authority registry ownership:** Clarify whether owner/membership/operation authority and the payload store share one database and one transaction boundary. Schema separation is logical separation, not independent blast-radius or physical isolation.
3. **Project and principal provisioning:** Define how a stable principal is created, linked to an authenticated session, assigned as project owner, and how membership is provisioned/revoked. No request-body or model-supplied subject ID is trusted.
4. **Retention and deletion:** Define retention, archival, legal deletion, tombstone, backup expiry, and quarantine release policies before implementation.
5. **Cost and availability:** Record current provider quotas, sleep/cold-start, connection, backup/PITR, export, and retention constraints. Free-tier suitability must be evidence-based and rechecked. If security/recovery requirements cannot be met at $0, report NOT_READY rather than weaken controls.
6. **Legacy preservation:** No default project assignment, silent import, or local/Drive fallback. Ambiguous ownership is quarantined. Existing files remain untouched until separately approved migration and recovery gates pass.

## 4. Recommended next design sequence

1. Resolve DR-COMPAT-01 provider topology first; all storage and migration decisions depend on it.
2. Create the v0.2.4-to-v0.1 field/state compatibility matrix.
3. Reconcile owner-project access and external delegation with v0.2.5 P0-03.
4. Specify the exact database/audit transaction topology and v0.2.5 write-ahead recovery state machine.
5. Resolve canonical hash, authenticity, encryption, and key custody profiles.
6. Define principal/project provisioning, narrow database access, and retention.
7. Complete requirement-to-test traceability and independent verification plan.
8. Only after the design review and explicit user approval, create a separate versioned contract candidate. Implementation, migration, restore, merge, and deployment each remain separate approval gates.

## 5. Final review status

```text
V0.1_PROPOSAL_SOURCE_REVIEW=COMPLETE
V0.1_CONTRACT_COMPATIBILITY=FAIL
DESIGN_GAPS=10
BLOCKER_FINDINGS=7
HIGH_FINDINGS=3
PROVIDER_TOPOLOGY=UNRESOLVED
CANONICAL_SCHEMA=NOT_APPROVED
AUTHORIZATION_AND_DELEGATION=NOT_APPROVED
AUDIT_ATOMICITY=NOT_PROVEN
HASH_AND_AUTHENTICITY_PROFILE=NOT_APPROVED
ENCRYPTION_AND_KEY_CUSTODY=NOT_APPROVED
BACKUP_RESTORE=NOT_VERIFIED
INDEPENDENT_TEST_PLAN=INCOMPLETE
IMPLEMENTATION=NOT_AUTHORIZED
MIGRATION=NOT_AUTHORIZED
PRODUCTION_DEPLOYMENT=BLOCKED
```

**Conclusion:** Keep Proposal v0.1 as a design draft only. Do not create the payload schema, grant runtime write access, connect legacy routes, migrate data, or enable production writes until the blocker findings are reconciled in an explicitly reviewed HFM contract revision.
