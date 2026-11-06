# MIRA HFM — TOKEN-INDEPENDENT MEMORY PROVIDER TOPOLOGY DECISION
**Document date:** 2026-11-06  
**Status:** PROPOSED DECISION / NOT APPROVED / NOT IMPLEMENTED  
**Scope:** Facebook-token-independent Memory read/write capability  
**Applies to:** Mira Hybrid Memory Framework (HFM) v0.2  
**Related:** `MIRA-HFM-DATA-PLANE-ARCHITECTURE-PROPOSAL-V0.2-RECONCILED-20261106.md`; `MIRA-HFM-DATA-PLANE-CONTRACT-COMPATIBILITY-REVIEW-20261106.md`

> This is a decision proposal only. It does not create database objects, grant privileges, configure secrets, enable runtime writes, migrate data, access Facebook, merge a PR, or deploy.

## 1. Decision requested

Mira must be able to save, retrieve, search, revise, and audit its own authorized Memory even when no Facebook API token is configured, expired, revoked, or unavailable.

**Recommended target:** make the provider-neutral Mira Memory Core independent from Facebook. Select a durable database provider (Neon/PostgreSQL is the current $0-tier candidate, subject to limits and approval) as the canonical Memory persistence adapter. Facebook becomes an optional external source/import/export connector, never a required Memory dependency.

This requires a versioned amendment to the v0.2.4 provider topology, which previously described Facebook Page as a proposed primary provider subject to permission/API verification. The amendment is proposed here, not silently assumed.

## 2. Feasibility and hard boundary

| Capability | Without Facebook API token? | Required condition |
|---|---|---|
| Read Mira's own saved Memory | YES | Authorized Memory provider, actor identity, project scope and read policy |
| Write Mira's own Memory | YES | Approved durable writer, one-time operation authority, write-ahead audit and recovery |
| Search Mira's own Memory | YES | Project-scoped index/query path with the same authorization checks |
| Read Facebook Page/Group private or account-scoped content through Graph API | NO | Valid Facebook authorization and required permissions |
| Publish/write to Facebook Page/Group through API | NO | Valid Facebook authorization, required permissions and platform approval |
| Import accessible public web material | CONDITIONALLY | Lawful/public access, source provenance, policy checks; untrusted until verified |
| Continue Mira Memory when Facebook is disconnected | YES | Facebook adapter is optional and must fail independently |

No browser-cookie scraping, credential reuse, session hijacking, private-content bypass, or undocumented endpoint is permitted. Public web retrieval is not a substitute for authorized Facebook API access and must not be represented as Facebook account access.

## 3. Proposed target topology

```text
Mira UI / Agent / Run Agent
          |
          v
Authenticated Principal + Project Scope
          |
          v
HFM Memory API
  - authorize(actor, project, operation, purpose)
  - validate canonical record
  - enforce trust / integrity / classification / lifecycle
  - idempotency + operation reconciliation
          |
          +-----------------------------+
          |                             |
          v                             v
Canonical Memory Service          Durable Audit Service
          |                             |
          +-------------+---------------+
                        |
                        v
             Approved PostgreSQL Adapter
             (Neon candidate; NOT YET APPROVED)
                        |
          +-------------+-----------------------+
          |                                     |
          v                                     v
   Facebook Connector                    Other Source Adapters
   OPTIONAL / TOKEN-GATED                 Public Web / Manual Import
   no token => DISABLED                   retrieval/import only
          |
          v
   Facebook APIs only when valid
   token + permissions are present
```

The canonical Memory service must not call Facebook as a hidden fallback. If Facebook is disabled, Memory reads and writes continue through the approved Memory provider. If the database is unavailable, writes fail closed; no phone-local or unapproved Drive/JSON fallback is allowed.

## 4. Provider role recommendation

| Candidate | Proposed role | Strength | Limitation / gate |
|---|---|---|---|
| Neon/PostgreSQL | Preferred canonical Memory persistence candidate | Independent of Facebook; supports transactional records, project indexes and audit patterns | Current runtime role is read-only; write API/role, key custody, backup/restore and cost/limits need approval and verification |
| Facebook Page API | Optional source connector | Authorized Page content can be imported/read and permitted Page actions can be performed | Requires valid token, app review/permissions and API availability; cannot be a dependency for Mira's own Memory |
| Facebook Group | Optional restricted/manual import | Can ingest material when access and permissions permit | API access is limited; no assumption of private Group read/write |
| Google Drive | Emergency backup/export candidate only | Can hold independently verified backup artifacts | Not live primary Memory; OAuth/restore and authenticity are unverified |
| Existing local JSON | Legacy migration source only | Preserves historical data for inventory | Not a live fallback or approved durable backend |
| Public Web | Retrieval-only source | Can gather accessible public information | Untrusted input; not canonical Memory storage |

**Recommendation:** choose Neon/PostgreSQL as the canonical persistence candidate only after HFM contract amendment, disposable-branch verification, narrow write authority, audit topology, cryptographic review and recovery tests. Until then, provider selection remains NOT APPROVED and runtime writes remain disabled.

## 5. Read path requirements

1. Resolve a server-verified actor subject; never trust actor/project IDs from model arguments.
2. Resolve active project membership and the requested operation authority.
3. Enforce record owner project, classification, delegation, lifecycle and trust policy.
4. Query only the approved durable provider using project-scoped predicates.
5. Verify canonical schema, record identity, integrity profile and provenance.
6. Exclude QUARANTINED, FAILED-integrity and otherwise disallowed records from trusted retrieval.
7. Record the read/audit event according to the approved audit policy.
8. Return only authorized records; counts, snippets, search results, caches and exports receive equivalent scope enforcement.

Facebook token absence must not alter this path.

## 6. Write path requirements

1. Resolve authenticated actor, active membership, owner-project policy and exact one-time operation authority.
2. Validate canonical v0.2.4 record fields and independent security dimensions.
3. Bind a stable operation ID, idempotency key, project ID, actor, purpose, policy decision and payload hash.
4. Persist durable audit intent before the consequential payload write.
5. Execute the write through a narrow database API/role; never grant broad direct DML to the general runtime.
6. Read back the exact record/revision and verify its integrity.
7. Persist audit completion under the same stable operation identity.
8. On uncertain outcomes, reconcile; do not blindly retry.
9. If payload committed but audit completion is uncertain, retain `COMMITTED_AUDIT_PENDING`; never report full success until reconciled.

No write is allowed if durable audit intent cannot be confirmed. Current read-only Neon runtime grants must remain read-only. A separately reviewed, narrowly scoped writer or database procedure is required.

## 7. Existing implementation facts and blockers

Known repository/runtime findings at the time of this proposal:

- `tools/memory-save.js` still calls legacy `addMemory` and does not enforce trusted actor/project context.
- `tools/knowledge-save.js` still calls legacy `addKnowledge` and does not enforce trusted actor/project context.
- `tools/knowledge-search.js` still searches legacy global Knowledge and may replace results with Google Drive content without HFM project authorization.
- `services/mira-local-memory-store.js`, `project-store.js`, and `conversation-store.js` remain local-file stores.
- The HFM authority transaction primitive is not wired into Memory/Knowledge routes or tools.
- The current Neon runtime role is SELECT-only. It cannot write payloads or execute the required authority transaction.
- Owner/membership/authority provisioning and existing-project assignment are not implemented.
- The retrieval bridge importing missing `mira-memory-unified-facade` is NOT_VERIFIED and must not be treated as a working fallback.
- Render Free local filesystem is ephemeral; local JSON is not a durable production Memory backend.

Therefore the target is feasible, but the current runtime does **not** yet satisfy token-independent durable read/write.

## 8. Contract amendment required

Before implementation, revise the provider topology in a versioned HFM contract amendment:

- Replace “Facebook Page is proposed primary durable Memory provider” with “Facebook Page is an optional external source/action adapter, enabled only with valid scoped authorization.”
- Define the approved durable provider separately from external source adapters.
- Select Neon/PostgreSQL only after its own capability, security, cost and recovery review.
- Preserve canonical v0.2.4 record schema, canonical string IDs and trust/integrity/classification/lifecycle vocabularies.
- Explicitly prohibit silent fallback among PostgreSQL, Facebook, Drive and local JSON.
- Define READ, WRITE, SEARCH, VERIFY, BACKUP and RESTORE capabilities independently.
- Require Facebook token absence/expiry/revocation tests proving Mira Memory remains functional and Facebook actions fail closed.

## 9. Acceptance tests before enabling any runtime write

| Test | Expected outcome |
|---|---|
| No Facebook token; authorized Memory read | PASS: reads from approved Memory provider |
| No Facebook token; authorized Memory write | PASS only after durable writer and audit gates are approved |
| No Facebook token; Facebook read/write request | FAIL_CLOSED / connector disabled |
| Expired/revoked Facebook token | Memory remains available; Facebook connector disabled |
| Cross-project read/search/count | DENY |
| Cross-project write/update/delete | DENY |
| Missing membership or one-time authority | DENY |
| Audit intent unavailable/uncertain | No payload write |
| Timeout after provider commit | Reconcile same operation; no blind duplicate |
| Commit succeeded, audit completion uncertain | `COMMITTED_AUDIT_PENDING`; no success claim |
| Runtime read-only role attempts write | DENY |
| Database/provider unavailable | Read/write returns controlled unavailable; no local fallback |
| Restart during every write state | Recover/reconcile without duplicate or lost audit |
| Tampered/invalid record | Quarantine; exclude from trusted retrieval |

Tests must run first offline, then against a disposable database. Independent verification is required. Skipped tests are INCONCLUSIVE, not PASS.

## 10. Phased implementation plan

**Phase A — Contract and provider decision**
- Review and approve this topology amendment.
- Confirm Neon plan limits, region, backup/PITR, storage/compute/connection limits and data residency.
- Approve canonical provider role and audit transaction topology.

**Phase B — Isolated database foundation**
- Create/verify schema only on a disposable branch after approval.
- Keep the current runtime role read-only.
- Add a separately reviewed narrow write API/role; prohibit broad DML.
- Verify owner/membership/authority and append-only audit constraints.

**Phase C — HFM Memory API**
- Implement project-scoped read/search/write through the canonical Memory service.
- Integrate trusted actor context and transactional authority.
- Implement durable audit intent, idempotency, reconciliation and restart recovery.
- Do not route through legacy global Memory/Knowledge tools.

**Phase D — Optional Facebook connector**
- Keep connector disabled when token/permissions are absent.
- Add explicit capability checks and token health states.
- Never block canonical Memory operations on Facebook availability.
- Test permitted API operations only when the user configures valid credentials and permissions.

**Phase E — Migration and production readiness**
- Inventory legacy Memory/Knowledge read-only.
- Preserve immutable source snapshots and quarantine ambiguous ownership.
- Run dry-run, disposable import, independent comparison and restore drill.
- Obtain separate migration, merge and deployment approvals.

## 11. Decision status

```text
TOKEN_INDEPENDENT_MEMORY=FEASIBLE
FACEBOOK_TOKEN_REQUIRED_FOR_MIRA_MEMORY=NO
FACEBOOK_API_ACCESS_WITHOUT_TOKEN=NOT_AVAILABLE
FACEBOOK_CONNECTOR_ROLE=OPTIONAL / TOKEN_GATED
NEON_POSTGRES_ROLE=PREFERRED CANDIDATE / NOT APPROVED
CURRENT_NEON_RUNTIME_WRITE=NOT PERMITTED (READ_ONLY)
CURRENT_HFM_MEMORY_READ_WRITE_INTEGRATION=NOT IMPLEMENTED
LEGACY_GLOBAL_MEMORY_KNOWLEDGE=NOT HFM PROJECT-SCOPED
RUNTIME_WRITE_ENABLEMENT=NOT AUTHORIZED
MIGRATION=NOT AUTHORIZED
MERGE=NOT AUTHORIZED
PRODUCTION_DEPLOYMENT=BLOCKED
```

**Conclusion:** Mira can and should own its Memory independently of Facebook. The correct target is an HFM-controlled, project-scoped durable Memory service with Facebook as an optional connector. This document recommends that architecture but does not claim it is already implemented or safe to enable.