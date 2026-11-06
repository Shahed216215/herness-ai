# MIRA HFM DATA PLANE — RECONCILED ARCHITECTURE PROPOSAL v0.2 (DESIGN CANDIDATE)

**Document date:** 2026-11-06  
**Status:** DESIGN CANDIDATE / NOT APPROVED / NOT IMPLEMENTED  
**Supersedes:** Proposal v0.1 as the preferred review draft only; v0.1 remains immutable review history  
**Normative references:** HFM Phase 2 Detailed Technical Contract v0.2.4; HFM v0.2.5 Design Revision Blueprint; HFM v0.2.5 Gap Closure Prototype B  
**Review input:** `MIRA-HFM-DATA-PLANE-CONTRACT-COMPATIBILITY-REVIEW-20261106.md`

> This document reconciles design requirements. It does not approve a provider selection, create a schema, grant privileges, configure secrets, access production Memory, migrate data, enable writes, merge a PR, or deploy.

## 1. Executive architecture position

Adopt a **provider-neutral canonical Memory Core** with a separately selected durable provider topology. Canonical record semantics, identity, project scope, authorization, trust, integrity, revision, lifecycle, audit, and recovery policy belong to Mira's Memory service. Provider-specific identifiers, APIs, capability limitations, and serialization belong in adapters.

This is a design boundary, not a claim that all providers are interchangeable or that any provider currently satisfies the contract.

The provider topology is deliberately **UNRESOLVED**. HFM v0.2.4 identifies Facebook Page as a proposed primary provider subject to permission/API verification, Facebook Group as secondary/manual import, public web as retrieval rather than durable Memory, and Google Drive as emergency backup only. HFM v0.2.5 requires provider-neutral core semantics and explicitly says provider neutrality does not imply equivalent capabilities. A PostgreSQL/Neon payload store is therefore only a candidate requiring an explicit contract-level decision and capability/security review; it is not silently substituted for the v0.2.4 provider proposal.

### Binding safety invariants

- No phone-local Memory, audit journal, or recovery fallback.
- No silent provider fallback or provider substitution.
- No hidden network requests; provider calls require explicit configured capability and authorization.
- Unknown write or audit outcomes remain UNKNOWN until reconciled.
- A plain hash proves neither authorship nor authenticity.
- No consequential Memory write without durable audit intent and a recoverable audit path.
- No unrestricted admin or agent access; project scope and operation authority are checked for every operation.
- Quarantined records are excluded from trusted retrieval.
- Skipped/unexecuted tests are INCONCLUSIVE, never PASS.
- Existing data remains preserved until migration and recovery are independently verified and separately authorized.

## 2. Provider topology decision register

| Component | v0.2.4 position | Reconciled v0.2 design role | Decision |
|---|---|---|---|
| Canonical Memory Core | Canonical schema and service | Provider-neutral policy and record semantics | REQUIRED |
| Facebook Page | Proposed primary provider, subject to permission/API verification | Candidate primary adapter only if required capabilities are verified | NOT VERIFIED / NOT SELECTED |
| Facebook Group | Secondary/manual import | Explicitly authorized import adapter; never assumed private access | LIMITED / NOT VERIFIED |
| Public Web Search | Retrieval, not durable Memory | Untrusted retrieval input; not a durable provider | RETRIEVAL ONLY |
| Google Drive | Emergency backup only | Backup/export adapter only; not primary read/write Memory | BACKUP ONLY / NOT VERIFIED |
| PostgreSQL / Neon | Not designated as primary by v0.2.4 | Candidate durable provider or transactional authority/audit substrate, only after explicit contract amendment and review | CANDIDATE / NOT APPROVED |
| Existing local JSON files | Existing legacy stores to preserve | Read-only migration source during separately approved migration; never fallback backend | LEGACY ONLY |
| Android/phone-local storage | Not approved Memory backend | No Memory, audit, or recovery fallback | PROHIBITED |

**Decision rule:** Before implementation, a versioned HFM contract decision must state whether PostgreSQL is (A) the canonical durable Memory provider, (B) an internal transactional repository behind the provider-neutral Memory service, or (C) only an authority/audit metadata store. The chosen option must explain how it coexists with the Facebook Page primary-provider proposal. No implementation may infer this decision from the presence of a Neon project.

Provider capability must be tested independently for READ, WRITE, SEARCH, VERIFY, BACKUP, and RESTORE. UNKNOWN, expired, unsupported, or permission-denied capability fails closed. Read permission never implies write permission.

## 3. Canonical record compatibility — preserve v0.2.4 schema

The v0.2.4 Memory JSON schema remains the canonical contract for this design candidate. Do not replace its public identifiers or security-state dimensions with the simplified v0.1 envelope.

Required canonical fields remain:
- `schemaVersion`
- `memoryId`
- `projectId`
- `recordType`
- `content`
- `source`
- `timestamps`
- `version`
- `integrity`
- `trust`
- `access`
- `lifecycle`

### Identifier policy

- `memoryId` remains the canonical logical identifier (string, v0.2.4 bounds).
- `projectId` remains the canonical project identifier (string, v0.2.4 bounds).
- Provider IDs remain adapter metadata and never replace `memoryId`.
- A relational database may use an internal surrogate UUID primary key for indexing/joins, but it must retain an immutable unique mapping to canonical `memoryId` and `projectId`. UUIDs must not silently replace canonical string identifiers.
- Any change to canonical field names, types, bounds, or requiredness requires an explicitly versioned schema/contract revision.

### Independent security dimensions

Keep these dimensions separate:
- Integrity: `UNVERIFIED`, `VERIFIED`, `FAILED`, `QUARANTINED`.
- Trust: `UNVERIFIED`, `SOURCE_RECORDED`, `SOURCE_REACHABLE`, `CONTENT_VERIFIED`, `HUMAN_VERIFIED`, `QUARANTINED`.
- Classification: `PUBLIC`, `PROJECT_PRIVATE`, `RESTRICTED`.
- Lifecycle: `ACTIVE`, `SUPERSEDED`, `ARCHIVED`, `QUARANTINED`, `PENDING_REVIEW`.

Do not compress these into one verified flag. Integrity verification does not promote source trust. Trust does not grant access. Classification does not grant operation permission. Lifecycle does not authorize deletion or restore.

The v0.2.5 explicit trust-state transition graph is required. Every transition records evidence, actor or verification mechanism, record revision, timestamp, reason, policy decision, and audit reference. Content/source mutation invalidates affected verification. Revision changes invalidate human verification tied to older revisions. QUARANTINED can be entered on integrity, provenance, policy, or security failure; release requires authorized review, sufficient evidence, policy approval, and audit. No automatic quarantine release.

## 4. Relational mapping boundary (if PostgreSQL is approved)

The relational model is a storage mapping of the canonical contract, not a new canonical contract.

Proposed logical tables, subject to separate schema review:
- canonical record envelope with canonical string `memory_id` and `project_id`;
- version/revision history preserving immutable prior revisions;
- provider references keyed by provider ID and provider record ID;
- operation/idempotency registry;
- durable audit intent/completion records, if and only if the selected audit topology is proven;
- migration batch and quarantine metadata.

An internal UUID may be used as a physical key. Enforce uniqueness for canonical `memory_id`, and scope all lookup/index patterns by canonical `project_id`. Preserve exact source provenance and original identifiers. JSONB may store the validated canonical record, but the database must validate schema version and security-sensitive fields at the trusted service boundary.

No DDL, migration SQL, role, grant, or database write is authorized by this proposal.

## 5. Owner-project access and external delegation

Implement the v0.2.5 P0-03 rules without weakening the v0.2.4 access model.

- `record.projectId` is the owning project; it is not by itself authorization.
- Ownership does not automatically grant every actor every operation. The owner project must authorize the actor and requested action.
- PUBLIC visibility does not imply write, update, delete, export, backup, restore, or administrative permission.
- PROJECT_PRIVATE is limited to authorized actors in the owning project, subject to policy.
- RESTRICTED may be accessed by authorized owner-project actors and explicitly delegated external projects, subject to policy.
- If `allowedProjectIds` is absent or empty, there is no external project delegation.
- An allowed-project entry only makes a project eligible for delegation. It does not itself authorize an actor or operation.

For every request validate, independently:
1. authenticated canonical actor subject;
2. active membership in the actor's own project;
3. owner-project authorization for the target record;
4. target classification and lifecycle;
5. external delegation existence and target project eligibility, if applicable;
6. delegated operation scope, purpose, expiry, revocation, issuing authority, and delegation-chain validity;
7. policy decision and provider capability;
8. resource/parent-child scope, including conversation and message;
9. audit requirements.

Search, caches, snippets, counts, exports, backups, and restores must enforce equivalent scope. Admin role alone never grants unrestricted payload access. Model/request-body actor IDs and roles are untrusted.

## 6. Adapter operation reconciliation and idempotency

Add the v0.2.5 normative adapter method:

`reconcileOperation(operationId, idempotencyKey, context)`

The reconciliation request must bind to the original operation:
- operationId;
- idempotencyKey;
- projectId;
- trusted actor;
- purpose;
- policyDecisionId;
- payloadHash;
- provider identity and original request reference, where supported.

Validate operation identity, idempotency key, project scope, payload hash, provider identity, revision, and evidence. Mismatched, incomplete, stale, or unverifiable responses cannot mark an operation complete.

Required outcomes:
- COMMITTED: authoritative provider evidence confirms the exact operation and revision.
- NOT_COMMITTED: authoritative provider evidence confirms no commit for the operation.
- IN_PROGRESS: provider confirms the same operation is still running.
- CONFLICT: operation identity or expected revision conflicts.
- UNKNOWN: no authoritative conclusion is possible.

Retention expiry never implies NOT_COMMITTED. UNKNOWN never triggers blind retry. Retries preserve the same operationId, idempotencyKey, and payloadHash. Same key with a different payload hash is rejected. Restart recovery must preserve operation identity and reconcile before retry.

## 7. Durable write-ahead audit and crash recovery

Do not claim payload-plus-audit distributed atomicity unless the selected infrastructure explicitly provides and verifies it.

The normative operation sequence is:
1. Validate identity, authority, project scope, provider capability, policy, payload, revision, and idempotency.
2. Check for an existing or unresolved operation.
3. Persist a durable authenticated audit intent with a stable audit operation/event identity.
4. Only after confirmed durable intent persistence, begin the consequential Memory write.
5. Reconcile uncertain provider outcomes using the original operation identity.
6. Read back and verify the committed record, digest, and revision.
7. Persist audit completion using the same stable audit identity.
8. Mark COMPLETED only after all required evidence is verified.

If audit intent persistence fails or is uncertain, the Memory write must not begin. If Memory commits but audit completion cannot be confirmed, enter `COMMITTED_AUDIT_PENDING`. This is not user-visible success and cannot silently become COMPLETED. Reconcile the same operation and audit identities; do not create a new operation ID, blindly repeat the write, or assume rollback.

Required states include:
`REQUESTED`, `AUTHORIZED`, `AUDIT_INTENT_RECORDED`, `EXECUTING`, `COMMIT_UNCERTAIN`, `VERIFYING`, `COMMITTED_AUDIT_PENDING`, `AUDIT_COMPLETION_RECORDED`, `COMPLETED`, `FAILED`, and `QUARANTINED`.

If no approved durable audit backend is available, consequential Memory writes remain disabled. Phone-local audit journal is prohibited.

### Transaction-topology decision

A same-PostgreSQL transaction for payload and audit may be considered only if:
- both records are actually written in the same transaction boundary;
- the database privilege model allows the exact operation through a narrow trusted API;
- identity/authority checks are performed within the trusted transaction;
- crash, rollback, connection-loss, and ambiguous-commit behavior are tested against a disposable database;
- the audit durability and recovery guarantees are independently verified.

If Memory and Audit are different providers, use the write-ahead/reconciliation protocol above. Do not describe it as distributed atomicity. Current read-only runtime grants do not authorize writes; no write integration is implied.

## 8. ContentHash, RecordHash, and authenticity

Adopt the v0.2.5 separation as the design target, subject to cryptographic review:

- **ContentHash:** SHA-256 over UTF-8 bytes of RFC 8785 JSON Canonicalization Scheme serialization of content.
- **RecordHash:** SHA-256 over UTF-8 bytes of canonical serialization under an explicitly versioned record-field profile.
- **AuthenticityProof:** an approved digital signature or MAC over a defined digest and context. A plain hash is not proof of authorship/authenticity.

Before implementation, freeze testable profile details:
- included and excluded fields;
- schema/profile version and domain separation;
- null handling;
- timestamp normalization;
- Unicode and number serialization;
- array ordering;
- unsupported/circular value rejection;
- whether RecordHash belongs in the canonical schema or a versioned integrity envelope;
- signature/MAC algorithm profile, key ID/version, signed digest, trust-anchor reference, revocation, and historical verification policy.

No secret key material may be stored in records, manifests, source code, or ordinary audit logs. Unknown or invalid profiles fail closed. Do not claim authenticity based on SHA-256 alone.

## 9. Encryption and key custody

Retain v0.2.4 envelope-encryption requirements: DEK/KEK separation, key material separate from payloads, rotation, revocation, recovery, and fail-closed key loss.

Each encrypted object must identify the approved encryption profile, key ID/version, algorithm, nonce, authentication tag, and ciphertext integrity metadata. Define:
- approved cryptographic algorithm/profile;
- key generation and custody boundary;
- which identity may encrypt/decrypt/rewrap;
- rotation and re-encryption/rewrap sequence;
- revocation and compromise response;
- backup/escrow and recovery material separation;
- key-loss behavior (no plaintext fallback);
- audit evidence and independent verification.

The exact provider, algorithm profile, custody, escrow, and recovery mechanism remain NOT APPROVED pending security review. Provider encryption at rest alone does not satisfy the full Mira control. Restricted data storage is blocked until the approved design is implemented and independently verified.

## 10. Backup, manifest authenticity, and restore

Google Drive remains emergency backup only unless a future contract revision explicitly changes that role. Backup is not a second live Memory provider.

Manifest must bind at minimum:
- backup format and canonical schema versions;
- backup/snapshot identity and creation time;
- project ID and source/provider identity;
- record count and canonical record IDs/revisions;
- payload hash and manifest hash profile;
- encryption profile and key ID/version;
- producer identity;
- authenticity proof and trust-anchor reference;
- source revision/recovery point;
- verification evidence.

A hash-only manifest is not authenticated. Verify authenticity proof separately from payload integrity. Unknown formats fail closed; supported older formats require a reviewed deterministic converter, and the original backup remains immutable.

Restore flow:
1. authorize RESTORE independently;
2. verify manifest authenticity, integrity, format, project scope, provider capability, and key availability;
3. preview/dry-run conflicts, revisions, ownership, and retention;
4. create and verify a recovery point;
5. obtain explicit human approval bound to the exact snapshot/manifest digest and target project;
6. apply controlled restore;
7. read back and independently verify counts, hashes, IDs, revisions, and access boundaries;
8. record audit completion.

Failed readback cannot be COMPLETED. Restore approval does not authorize migration, deletion, or deployment. RPO/RTO remain NOT_APPROVED until provider quotas and real disposable restore drills are measured.

## 11. Migration and legacy preservation

Migration is a separate authorization project, not part of provider setup.

Stages:
A. Read-only inventory of every source, owner/project evidence, count, size, IDs, timestamps, dependencies, and read errors.  
B. Immutable source snapshot with verified digests; preserve original bytes and metadata.  
C. Deterministic mapping to canonical v0.2.4 records; do not invent ownership/project assignment.  
D. Unknown, ambiguous, unsupported, or conflicting records enter quarantine.  
E. Dry-run report: accepted/rejected/quarantined counts, mapping decisions, conflicts, digest results, and projected cost.  
F. Synthetic/approved fixture import into a disposable target.  
G. Independent source-target verification and restore drill.  
H. Explicit human approval bound to source snapshot, mapping version, target project, manifest digest, and cutover plan.  
I. Controlled cutover with rollback/recovery; preserve source snapshot.  
J. Legacy retirement/deletion requires a separate approval.

No silent fallback to local JSON, Google Drive, Facebook, or another provider. Existing local files remain untouched. No migration or production data access is authorized.

## 12. Database trust and least-privilege boundary

If PostgreSQL is approved, database access must be through a narrow trusted service/API. The current authority runtime role is read-only and remains read-only. Do not assume it can write payloads or invoke authority transactions.

Any new runtime role or stored procedure requires separate review:
- no superuser, table ownership, schema CREATE, or broad DML grants;
- fixed search_path and reviewed SECURITY DEFINER ownership if applicable;
- caller identity cannot be an arbitrary actor ID supplied by a request/model;
- authorization and payload/audit changes must use the intended transaction boundary;
- RLS is defense in depth, not sufficient when the application can set arbitrary actor/project session variables;
- direct SQL bypass, forged context, revoked membership, and privilege escalation tests are mandatory.

Schema separation is logical separation, not physical isolation. Database selection must account for blast radius, backup, residency, connection, compute, retention, and recovery limits.

## 13. Retention, deletion, and quarantine

Before implementation, define versioned policies for:
- record retention and archival;
- superseded revision retention;
- deletion eligibility, tombstones, and legal/contractual holds;
- backup retention and expiry;
- audit retention/export;
- quarantine evidence preservation and release;
- secure deletion and key destruction;
- restore interaction with deleted/expired records.

No deletion is inferred from ARCHIVED, SUPERSEDED, or QUARANTINED. No automatic quarantine release. No record or backup deletion until a separately authorized retention workflow is designed and tested.

## 14. Requirement-to-test traceability

Every normative requirement must map to one or more test IDs and evidence. At minimum capture:
- requirement ID and test ID;
- fixture identity and fixture digest;
- expected and actual result;
- failure injection and restart point;
- environment, build SHA, schema/profile version, provider/version;
- productionDataTouched and networkRequests;
- evidence reference and reproducibility command;
- verifier identity, independent of the implementation under test.

Separate offline mock contract tests, disposable PostgreSQL integration tests, provider sandbox tests, and production readiness evidence. A mock cannot prove real-provider capability. Bug Hunter/implementation code cannot be the sole independent verifier.

Minimum coverage includes:
- cross-project read/list/count/search/cache/export/backup/restore denial;
- owner-project checks, delegation absent/empty/revoked/expired/wrong-purpose/wrong-operation;
- trust-state transitions, invalidation, quarantine and authorized release;
- canonical serialization/hash vectors and authenticity failure;
- encryption key missing/revoked/rotated/recovery failure;
- idempotency reuse, revision conflict, timeout-after-commit, retention expiry, restart reconciliation;
- audit intent failure, uncertain intent, commit uncertainty, COMMITTED_AUDIT_PENDING, audit append uncertainty and recovery;
- backup tamper/forgery/unknown format/wrong project/failed readback;
- migration mapping ambiguity, duplicate, unsupported schema, rollback and source preservation;
- database direct-SQL bypass and narrow privilege enforcement.

Skipped/unexecuted tests are INCONCLUSIVE. No PASS without captured evidence.

## 15. Hosting, cost, and availability

The existing Neon project is a candidate only. Before selecting it, record current plan limits and measured behavior for compute, storage, branches, connections, idle suspension/cold start, backup/PITR, retention, export, restore, and data residency. Recheck at decision time; do not assume permanent free service or production-grade durability.

No paid service, second database, vector database, object store, or paid AI API is approved by this proposal. If $0 infrastructure cannot satisfy the approved security, audit, and recovery requirements, report NOT_READY; do not weaken controls to preserve a zero-cost target.

## 16. Implementation sequence after approval only

1. Approve a versioned provider topology and contract amendment.
2. Freeze canonical schema/state/transition/hash profiles.
3. Approve principal, owner, membership, delegation, and provisioning lifecycle.
4. Approve database/audit transaction topology and least-privilege API.
5. Approve cryptographic profile, key custody, retention, and backup authenticity.
6. Implement provider capability/reconciliation contract in isolated fixtures.
7. Implement durable audit intent/recovery state machine.
8. Implement project-scoped data plane and retrieval enforcement.
9. Run independent disposable DB/provider tests and failure-injection/restart tests.
10. Build read-only migration inventory and dry-run; do not import.
11. Obtain separate migration/restore approval and verify recovery.
12. Obtain separate merge and deployment approval.

No step in this list is authorized by this design candidate.

## 17. Decision register and release posture

| Decision | Current status |
|---|---|
| Provider-neutral canonical Memory Core | DESIGN REQUIREMENT |
| Facebook Page primary adapter | PROPOSED BY v0.2.4; CAPABILITY NOT VERIFIED |
| PostgreSQL/Neon durable payload role | UNRESOLVED / NOT APPROVED |
| Google Drive | EMERGENCY BACKUP ONLY |
| Canonical v0.2.4 schema | PRESERVE |
| UUID internal database key | OPTIONAL IMPLEMENTATION DETAIL; NOT CANONICAL ID |
| Owner-project and external delegation | DESIGN REQUIRED; NOT IMPLEMENTED |
| Write-ahead audit/reconciliation | DESIGN REQUIRED; NOT IMPLEMENTED |
| Hash/authenticity profile | DESIGN TARGET; SECURITY REVIEW REQUIRED |
| Encryption/key custody | NOT APPROVED |
| Backup authenticity and restore | NOT VERIFIED |
| Retention/deletion | NOT APPROVED |
| Migration | NOT AUTHORIZED |
| Runtime write role/API | NOT APPROVED |
| Production deployment | BLOCKED |

```text
RECONCILED_DESIGN_DRAFT=CREATED
V0_2_4_CANONICAL_SCHEMA=RETAINED
V0_2_5_PROVIDER_NEUTRAL_CORE=INCORPORATED
PROVIDER_TOPOLOGY=UNRESOLVED
POSTGRES_PAYLOAD_ROLE=NOT_APPROVED
OWNER_PROJECT_DELEGATION=DESIGN_REQUIRED
WRITE_AHEAD_AUDIT=DESIGN_REQUIRED
OPERATION_RECONCILIATION=DESIGN_REQUIRED
HASH_AUTHENTICITY=SECURITY_REVIEW_REQUIRED
ENCRYPTION_KEY_CUSTODY=NOT_APPROVED
BACKUP_RESTORE=NOT_VERIFIED
MIGRATION=NOT_AUTHORIZED
IMPLEMENTATION=NOT_AUTHORIZED
PRODUCTION_DEPLOYMENT=BLOCKED
```

**Conclusion:** This v0.2 document is a reconciled design candidate, not an approved implementation contract. The provider-topology decision and cryptographic/key-custody profile remain explicit open decisions. Do not create schemas, grants, secrets, runtime writes, migration jobs, or production changes until those decisions are reviewed and separately approved.
