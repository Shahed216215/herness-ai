# MIRA HFM v0.2 — CONTRACT AMENDMENT PROPOSAL
## Facebook-Independent Canonical Memory Provider
**Amendment ID:** HFM-CA-2026-11-06-01  
**Date:** 2026-11-06  
**Status:** PROPOSED / NOT APPROVED / NOT IMPLEMENTED  
**Target contract:** HFM Phase 2 Detailed Technical Contract v0.2.4  
**Design alignment:** HFM v0.2.5 Design Revision Blueprint and Gap Closure Prototype B  
**Companion decision:** `MIRA-HFM-TOKEN-INDEPENDENT-MEMORY-PROVIDER-TOPOLOGY-DECISION-20261106.md`  
**Reconciled proposal:** `MIRA-HFM-DATA-PLANE-ARCHITECTURE-PROPOSAL-V0.2-RECONCILED-20261106.md`

> This is an additive contract amendment proposal for review. It does not amend the approved baseline by itself. Until explicitly approved and versioned by the contract owner, v0.2.4 remains authoritative. This document authorizes no schema change, database write, role/grant, secret, migration, merge, or deployment.

## 1. Purpose

Mira's own durable Memory MUST NOT depend on a Facebook API token. Mira MUST be able to read, search, save and revise its own authorized Memory through its canonical Memory service when the Facebook connector is absent, disabled, expired, revoked, rate-limited or unavailable.

Facebook access is an external integration capability. It is not Mira's Memory identity, storage authority, or availability dependency.

This amendment proposes a deliberate change to the v0.2.4 provider topology, which described Facebook Page as a proposed primary provider subject to permission/API verification. It does not silently reinterpret that existing contract.

## 2. Normative terminology

The terms MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are normative within this proposed amendment only. They become binding only after formal approval and incorporation into a new contract revision.

- **Canonical Memory Provider:** the approved durable provider that stores Mira's canonical Memory records.
- **Memory Core:** provider-neutral Mira service enforcing canonical schema, project scope, trust, integrity, lifecycle, policy and audit.
- **External Source Adapter:** a connector that imports or retrieves material from an external service.
- **External Action Adapter:** a connector that performs authorized actions in an external service.
- **Provider Capability:** independently verified READ, WRITE, SEARCH, VERIFY, BACKUP or RESTORE ability.
- **Token-independent operation:** Memory functionality that does not require a Facebook token or Facebook API availability.

## 3. Proposed provider-topology amendment

Replace the v0.2.4 proposed topology only after approval as follows:

| Component | Proposed amended role | Required boundary |
|---|---|---|
| Canonical Memory Core | Required provider-neutral service | Owns canonical record semantics and authorization |
| Durable canonical provider | One explicitly approved durable backend | Must pass capability, security, audit and recovery gates |
| Neon/PostgreSQL | Preferred candidate, not yet selected | No production write until separately approved |
| Facebook Page API | Optional external source/action adapter | Disabled without valid token, scopes and permissions |
| Facebook Group | Optional limited/manual import adapter | No assumed private access or general write capability |
| Public Web | Retrieval/import source only | Untrusted until provenance and content checks complete |
| Google Drive | Emergency backup/export candidate only | Not a live Memory provider; backup/restore must be verified |
| Legacy local JSON | Read-only migration source | No live fallback |
| Phone-local storage | Prohibited as canonical Memory/audit/recovery store | No fallback |

**Provider selection remains unresolved.** The amendment proposes Neon/PostgreSQL as the preferred candidate because it can be independent of Facebook and supports transactional persistence patterns. This is not approval to use Neon as the canonical payload provider. The exact role—canonical payload store, internal repository behind Memory Core, or authority/audit-only substrate—must be explicitly selected after a capability and security review.

## 4. Facebook-token independence invariants

4.1 The Memory Core MUST NOT require a Facebook token to authenticate a Mira user, authorize a Mira project, read Mira Memory, search Mira Memory, or write Mira Memory.

4.2 Facebook token absence, expiry, revocation, invalid scope, provider outage or rate limit MUST NOT redirect Memory operations to another provider.

4.3 The Facebook adapter MUST report a distinct disabled/unavailable/unauthorized state. It MUST NOT cause canonical Memory reads or writes to fail merely because Facebook is unavailable.

4.4 A Facebook token MUST NOT be treated as Mira actor identity, project membership, Memory permission, or proof of record ownership.

4.5 A Mira Memory authorization MUST NOT imply Facebook authorization. Facebook actions require separate explicit connector capability, valid token, required permissions and applicable human approval.

4.6 Without valid Facebook authorization, private/account-scoped Page or Group data MUST NOT be fetched, and Facebook content MUST NOT be published or modified through API. No cookie scraping, session reuse, undocumented endpoint, or access-control bypass is permitted.

4.7 Public Web retrieval MAY continue independently where lawful and available. Retrieved material is untrusted external input, not an authenticated Facebook record and not automatically canonical Memory.

## 5. Canonical schema and security-state preservation

This amendment does not change the canonical v0.2.4 record schema or identifier policy. Required fields remain:

- `schemaVersion`, `memoryId`, `projectId`, `recordType`, `content`, `source`, `timestamps`, `version`, `integrity`, `trust`, `access`, `lifecycle`.

Canonical `memoryId` and `projectId` remain bounded strings. Provider record IDs remain adapter metadata. A relational backend MAY use an internal UUID surrogate only if it preserves an immutable mapping to canonical IDs.

Keep security dimensions independent:
- Integrity: `UNVERIFIED`, `VERIFIED`, `FAILED`, `QUARANTINED`.
- Trust: `UNVERIFIED`, `SOURCE_RECORDED`, `SOURCE_REACHABLE`, `CONTENT_VERIFIED`, `HUMAN_VERIFIED`, `QUARANTINED`.
- Classification: `PUBLIC`, `PROJECT_PRIVATE`, `RESTRICTED`.
- Lifecycle: `ACTIVE`, `SUPERSEDED`, `ARCHIVED`, `QUARANTINED`, `PENDING_REVIEW`.

No provider substitution may weaken these states. A provider's successful read does not promote trust; a hash does not prove authorship; a token does not grant project access.

## 6. Required Memory read contract

Every read/search/list/count/snippet/cache/export/backup/restore operation MUST:

1. Resolve a server-verified canonical actor subject.
2. Validate active membership and requested operation authority.
3. Enforce owning project, classification, delegation, lifecycle and policy.
4. Query only the selected canonical provider through the trusted Memory service.
5. Apply equivalent project scope to search indexes, caches, counts and derived results.
6. Validate canonical record identity, schema, integrity and provenance.
7. Exclude quarantined, failed-integrity and policy-disallowed records from trusted retrieval.
8. Produce the required audit evidence without leaking unauthorized existence or counts.

Missing Facebook credentials MUST NOT change this sequence.

## 7. Required Memory write contract

Every consequential write MUST:

1. Resolve authenticated actor, active membership, owner-project authorization and exact one-time operation authority.
2. Validate the canonical record and permitted state transitions.
3. Bind stable operation ID, idempotency key, project ID, actor, purpose, policy decision and payload hash.
4. Persist durable audit intent before beginning the payload write.
5. Write only through a narrow, reviewed trusted database API/role.
6. Read back and verify the exact canonical record and revision.
7. Persist audit completion against the same stable operation identity.
8. Reconcile uncertain commits; never blindly retry with a new identity.
9. Remain `COMMITTED_AUDIT_PENDING` if payload commit is confirmed but audit completion is unresolved.

If durable audit intent cannot be confirmed, the payload write MUST NOT begin. If provider or audit outcome is UNKNOWN, the operation remains unresolved until reconciled. A normal success response MUST NOT be returned before required commit and audit evidence are verified.

## 8. Database privilege and transaction boundary

The current Neon runtime role is read-only and MUST remain read-only. It MUST NOT be granted broad DML as a shortcut.

Before enabling writes, the design MUST select and review one of:
- a narrow stored procedure/API with fixed operation scope and trusted identity context; or
- a separately isolated least-privilege writer service/role with a reviewed transaction boundary.

Required controls include:
- no superuser, table ownership, schema CREATE or broad DML;
- actor identity derived from server-held principal, never model/request-supplied actor ID;
- project membership and one-time authority enforced at the trusted boundary;
- append-only audit constraints;
- direct SQL bypass and privilege-escalation tests;
- tested rollback, ambiguous commit, restart and reconciliation behavior.

A read-only metadata adapter is not a payload writer. A mocked authority test does not prove actual database isolation or concurrency.

## 9. Provider capability and failure behavior

READ, WRITE, SEARCH, VERIFY, BACKUP and RESTORE MUST be assessed independently for each provider. One capability MUST NOT be inferred from another.

| Condition | Canonical Memory behavior | Facebook adapter behavior |
|---|---|---|
| Facebook token absent | Continue through canonical provider if available and authorized | DISABLED |
| Token expired/revoked | Continue through canonical provider | DISABLED / REAUTH_REQUIRED |
| Facebook API unavailable/rate-limited | Continue through canonical provider | UNAVAILABLE / RETRY_POLICY |
| Canonical provider unavailable | Controlled failure; preserve unresolved operation state | No fallback to Facebook/local JSON |
| Canonical provider write outcome uncertain | Reconcile same operation identity | Irrelevant to Memory commit |
| Audit intent unavailable/uncertain | Do not begin payload write | No bypass |
| No verified restore path | Restore remains disabled | Facebook is not a restore substitute |

No silent fallback among Neon, Facebook, Google Drive and local JSON is permitted.

## 10. Migration and legacy compatibility

This amendment authorizes no migration. Existing local JSON, global Memory/Knowledge and Drive content MUST remain untouched until a separate migration authorization.

Before migration:
- perform read-only source inventory;
- preserve immutable snapshots and source digests;
- establish owner/project evidence without guessing;
- quarantine ambiguous or conflicting records;
- dry-run canonical mapping;
- import synthetic fixtures to a disposable target;
- independently verify counts, identities, revisions, hashes and access boundaries;
- complete a restore drill;
- obtain approval bound to exact source snapshot, mapping revision, target project and cutover plan.

Legacy global Memory/Knowledge MUST NOT be described as HFM project-scoped until all callsites are integrated and tested. No local-file fallback may be introduced to keep the service appearing available.

## 11. Facebook connector contract

The Facebook adapter MUST be independently switchable and expose capability state without disclosing token values.

Minimum connector states:
- `NOT_CONFIGURED`
- `DISABLED_NO_TOKEN`
- `TOKEN_PRESENT_UNVERIFIED`
- `AUTHORIZED_READ_ONLY`
- `AUTHORIZED_SCOPED_WRITE`
- `EXPIRED`
- `REVOKED`
- `PERMISSION_DENIED`
- `RATE_LIMITED`
- `UNAVAILABLE`

Token material MUST be stored only in an approved secret-management boundary, never in Memory records, prompts, logs, source code or ordinary audit payloads. Token presence alone does not prove a permission. Read and write scopes MUST be tested separately. Facebook adapter failure MUST NOT change Memory Core availability.

## 12. Acceptance and regression evidence

The following tests are mandatory before declaring token-independent Memory complete:

| ID | Scenario | Expected |
|---|---|---|
| HFM-TIM-001 | No Facebook token; authorized Memory read | Read succeeds from canonical provider |
| HFM-TIM-002 | No Facebook token; authorized Memory write | Write succeeds only after writer/audit gates |
| HFM-TIM-003 | No token; Facebook read/write requested | Connector fails closed |
| HFM-TIM-004 | Expired/revoked token | Memory remains independent; connector disabled |
| HFM-TIM-005 | Facebook outage/rate limit | Memory remains independent |
| HFM-TIM-006 | Cross-project read/search/count/cache/export | Denied |
| HFM-TIM-007 | Cross-project write/update/delete | Denied |
| HFM-TIM-008 | Missing membership/authority | Denied |
| HFM-TIM-009 | Audit intent failure or uncertainty | No payload write |
| HFM-TIM-010 | Timeout after provider commit | Reconcile same operation; no duplicate |
| HFM-TIM-011 | Commit with uncertain audit completion | `COMMITTED_AUDIT_PENDING` |
| HFM-TIM-012 | Read-only runtime role attempts write | Denied |
| HFM-TIM-013 | Canonical provider outage | Controlled failure; no local/Facebook fallback |
| HFM-TIM-014 | Restart at every write state | Recovery/reconciliation is deterministic |
| HFM-TIM-015 | Tampered or invalid record | Quarantined and excluded from trusted retrieval |
| HFM-TIM-016 | Token value in logs/status/audit | No secret disclosure |

Evidence must identify exact source commit, schema/profile version, environment, fixture digest, expected/actual results, network/production-data touch status and independent verifier. Offline mocks, disposable PostgreSQL integration, provider sandbox and production evidence are separate categories. Unexecuted tests are INCONCLUSIVE, never PASS.

## 13. Approval and implementation gates

This amendment remains proposed until all of the following are recorded:

A. Contract owner approves the topology change and publishes a new versioned HFM contract.  
B. Provider decision selects the canonical durable provider and defines audit topology.  
C. Provider plan limits, availability, retention, backup/PITR, export/restore, region and cost are verified.  
D. Cryptographic profile, key custody, retention and backup authenticity are reviewed.  
E. A disposable database validates narrow write privileges, transactional authority, append-only audit, concurrency and crash recovery.  
F. HFM Memory API is integrated with every relevant Memory/Knowledge read/write/search callsite.  
G. Independent tests pass, including no-token, expired-token and provider-outage cases.  
H. Migration, merge and deployment receive separate explicit approvals.

No implementation, migration, secret configuration, production database write, merge or deployment is authorized by this proposal.

## 14. Current implementation gap snapshot

At proposal time:
- legacy Memory/Knowledge save tools still call global legacy stores and ignore trusted actor/project context;
- legacy Knowledge search can read global local/Drive data without HFM project authorization;
- local JSON Memory, Project and Conversation stores remain;
- HFM transactional authority is not wired into Memory/Knowledge routes/tools;
- current Neon runtime grants are SELECT-only;
- owner/membership/authority provisioning and existing-project assignment are incomplete;
- the retrieval bridge importing a missing unified facade is NOT_VERIFIED;
- Render Free filesystem is ephemeral.

Therefore token-independent Memory is **architecturally feasible but not currently implemented**. No claim of live token-independent read/write capability is made.

## 15. Proposed decision record

```text
AMENDMENT_ID=HFM-CA-2026-11-06-01
AMENDMENT_STATUS=PROPOSED_NOT_APPROVED
FACEBOOK_REQUIRED_FOR_MIRA_MEMORY=NO
FACEBOOK_ROLE=OPTIONAL_TOKEN_GATED_EXTERNAL_ADAPTER
CANONICAL_PROVIDER=UNRESOLVED
NEON_POSTGRES= PREFERRED_CANDIDATE_NOT_APPROVED
CANONICAL_SCHEMA=V0.2.4_PRESERVED
CURRENT_RUNTIME_WRITE=NOT_PERMITTED_READ_ONLY
HFM_MEMORY_READ_WRITE_INTEGRATION=NOT_IMPLEMENTED
LEGACY_MEMORY_KNOWLEDGE_SCOPE=GLOBAL_NOT_HFM_PROJECT_SCOPED
MIGRATION=NOT_AUTHORIZED
MERGE=NOT_AUTHORIZED
PRODUCTION_DEPLOYMENT=BLOCKED
```

**Decision requested from the contract owner:** approve or reject this amendment and, if approved, authorize a separate provider-selection and disposable-database implementation plan.