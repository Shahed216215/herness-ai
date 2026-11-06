# HFM Memory / Knowledge Integration — Implementation Gate

Date: 2026-11-06
Release-candidate branch: `work/hfm-release-candidate-reconciliation-20261106`
Status: `IMPLEMENTATION_BLOCKED_BY_UNRESOLVED_NORMATIVE_DECISION`

## Work performed

Read-only source inspection was continued against runtime-foundation commit `88190a59bad4eb0590f75122978943e5a5c7fe76`, including:
- `tools/memory-save.js`
- `tools/knowledge-save.js`
- `tools/knowledge-search.js`
- `memory.js` and `knowledge.js`
- `services/mira-hfm-runtime-identity-context.js`
- `services/mira-memory-host-identity-contract.js`
- `services/mira-hfm-authority-transaction.js`
- `services/mira-hfm-postgres.js`
- HFM v0.2.4 Phase 2 contract
- Data Plane contract compatibility review
- Reconciled Data Plane proposal v0.2
- Facebook-independent canonical Memory amendment

No source code, runtime configuration, production data, database schema, or deployment was changed in this step.

## Confirmed code-level gaps

1. `memory_save` ignores its trusted-context argument and writes to the global legacy local Memory store through `addMemory`.
2. `knowledge_save` ignores trusted actor/project context and writes to the global legacy Knowledge store; it also performs a Google Drive sync.
3. `knowledge_search` reads the global local Knowledge store and may replace the result set with Google Drive content. It has no project authorization or classification filter.
4. Legacy `memory.js` and `knowledge.js` are global file-backed services; no project isolation exists at those storage boundaries.
5. Runtime identity context can resolve a server-issued actor, but identity transport is not project authorization.
6. The authority transaction primitive is not wired to these tools. Its database transaction requires UPDATE/INSERT, while the current HFM runtime role is explicitly SELECT-only.
7. The retrieval bridge imports `mira-memory-unified-facade`, which is absent at the inspected runtime-foundation commit. The bridge must remain NOT_VERIFIED and must not be enabled.
8. Facebook and Google Drive provider paths must not be used as implicit fallback for canonical Memory operations.

## Normative architecture blocker

The v0.2.4 contract identifies Facebook Page as a proposed primary provider, Google Drive as emergency backup only, public web as retrieval only, and phone-local storage as not an approved Memory backend.

The reconciled v0.2 data-plane proposal is explicitly DESIGN CANDIDATE / NOT APPROVED / NOT IMPLEMENTED. It requires an explicit versioned decision selecting the role of PostgreSQL/Neon:
- A. canonical durable Memory payload provider;
- B. internal durable repository behind a provider-neutral Memory Core, with provider adapters separately defined;
- C. authority/audit metadata store only.

The proposal explicitly prohibits inferring this choice merely because a Neon project exists. It also prohibits silently replacing the v0.2.4 Facebook Page proposal, phone-local fallback, provider substitution, and hidden network requests.

The Facebook-independent amendment confirms that Facebook credentials must not be required to authenticate Mira users, authorize projects, read/search/write canonical Memory, and Facebook token absence must not redirect operations to another provider. However, that amendment does not by itself approve Neon as the canonical payload provider.

## Safe next implementation sequence after the topology decision

1. Record the selected provider topology in a versioned, explicitly approved HFM contract amendment.
2. Define and approve a durable payload repository boundary and narrow write API/role; keep the current runtime metadata role read-only.
3. Implement canonical v0.2.4 record validation without changing its identifiers or independent integrity/trust/classification/lifecycle states.
4. Implement owner-project access, membership, delegation, classification, lifecycle, policy and one-time operation authority checks for every read/write/search/list/count/export/backup/restore path.
5. Add durable audit-intent, operation identity, idempotency and UNKNOWN-outcome reconciliation before enabling writes.
6. Add isolated fixture tests for cross-project denial, missing/expired/revoked membership, delegation scope, quarantine exclusion, search/count/cache scope, integrity failure, replay, concurrency, uncertain commit, restart and recovery.
7. Only then connect tool wrappers and routes to the canonical service. Legacy stores remain preserved and must not be silently read as fallback.
8. Run exact-head CI and independent review. Production migration and deployment remain separate approval gates.

## Decision required to unblock implementation

Select one topology explicitly:
- **A — Neon/PostgreSQL is the canonical durable Memory payload provider.** Facebook Page remains an optional external source/connector, not a prerequisite for core Memory.
- **B — Neon/PostgreSQL is an internal repository behind a provider-neutral Memory Core.** The Memory Core remains the canonical service boundary and adapters are selected separately.
- **C — Neon/PostgreSQL is authority/audit metadata only.** A different canonical payload provider must be selected and verified.

Until this is decided and recorded in a versioned contract amendment:
`MEMORY_KNOWLEDGE_IMPLEMENTATION=BLOCKED`
`LEGACY_DATA=READ_ONLY_PRESERVE`
`FACEBOOK_TOKEN_REQUIRED_FOR_CORE_MEMORY=NO`
`SILENT_FALLBACK=PROHIBITED`
`PRODUCTION_MIGRATION=NOT_APPROVED`
`DEPLOYMENT=BLOCKED`

No scheduled task, reminder, or automation was created.
