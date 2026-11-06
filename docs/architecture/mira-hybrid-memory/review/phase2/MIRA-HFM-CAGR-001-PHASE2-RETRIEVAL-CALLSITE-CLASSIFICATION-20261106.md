# Mira HFM v0.2 — Phase 2 Retrieval Callsite Classification

**Document ID:** MIRA-HFM-CAGR-001-PHASE2-RETRIEVAL-CALLSITE-CLASSIFICATION-20261106  
**Baseline:** Phase 9 head `da1c2ccc954cf686c6e1886a18719dd561ef0b8d`  
**Mode:** GitHub source review; no runtime invocation  
**Status:** `SOURCE_CLASSIFICATION_ADDED / UNIVERSAL_COVERAGE_REVIEW_REQUIRED`

## 1. Purpose and evidence boundary

This document classifies the 14 source files identified by the Phase 2 retrieval-callsite scanner as lacking both trusted-filter markers. The scanner is a discovery aid, not proof that each file contains a reachable vulnerability. Classification below is based on the inspected source callsites and their visible data-flow roles.

No production Memory or Knowledge data was read or changed. No Drive, Facebook, Supabase, model-provider, Render, or other external API was invoked. No migration, deployment, restore, merge, or trust promotion was performed. No runtime reachability is inferred from source text alone.

## 2. Source-backed callsite inventory

| File | Observed source boundary | Classification | Priority / disposition |
|---|---|---|---|
| `autonomous-learning-controlled-apply.js` | `readLocalKnowledge()` delegates to `getKnowledge()` (63–69); controlled apply reads local and Drive state (252–278, 364–374), then performs apply/rollback. | Controlled read-modify-write and provider reconciliation; not a general read-only search endpoint. | **P1 — REVIEW_REQUIRED.** Before apply, require authoritative project scope, current canonical identity/revision, conflict decision and provider concurrency evidence. Preserve rollback. |
| `google-drive.js` | Knowledge and Memory provider load/save methods (201–267). | Generic remote persistence adapter. It does not itself establish HFM project scope, trust, integrity or quarantine eligibility. | **P1 — REVIEW_REQUIRED.** Treat loaded records as provider data; never expose as trusted retrieval without a separate canonical filter. Remote CAS is not established by list/read/write helpers. |
| `knowledge-controlled-apply.js` | Reads local Knowledge and Drive preflight state (240–254); verifies post-apply local/Drive state (426–435, 483–493). | Controlled write/apply with snapshot and rollback behavior. | **P1 — REVIEW_REQUIRED.** Add canonical identity/project/conflict checks and concurrency protection before any future write integration; do not bypass existing approval and rollback. |
| `knowledge-memory-evolution.js` | Separate atomic persistence and Drive snapshot helpers (80–88, 138–232); local Memory/Knowledge load path (256–264). | Legacy Evolution persistence/reconciliation path with a distinct writer boundary. | **P1 — REVIEW_REQUIRED.** Reconcile with initialization guards, identity mapping and writer arbitration before any cutover. Do not remove or replace Drive behavior in this patch. |
| `knowledge.js` | Guarded local load and replacement (63–100); raw `searchKnowledge()` and `getKnowledge()` accessors (880–885, 1015–1017). | Core legacy Knowledge store. Initialization/corruption protection exists, but these accessors are not themselves a project-scoped canonical HFM facade. | **P0 for retrieval integration — REVIEW_REQUIRED.** Keep raw legacy access distinct from canonical trusted retrieval. |
| `memory.js` | Local Memory read/write (12–49); duplicate detection uses role/content equality (53–59). | Legacy local Memory store. The inspected legacy message shape does not provide canonical per-entry project identity. | **P1 — REVIEW_REQUIRED.** Do not synthesize projectId or immutable memoryId from content, role or timestamp. Keep records outside trusted canonical retrieval until an approved identity mapping exists. |
| `routes/knowledge-improvements.js` | Admin apply route reads current Knowledge directly (320–362) and delegates controlled apply. | Privileged administrative read/apply route. Admin role is not a substitute for HFM project scope or trusted-record filtering. | **P1 — REVIEW_REQUIRED.** Bind route actor to authoritative project scope and preserve separate review/apply gates. |
| `server.js` | Imports the Phase 9 prompt-boundary helpers (13); exposes Memory statistics and Knowledge/admin reads (441–453, 1155–1163, 1288–1296). | Mixed runtime, statistics and admin CRUD boundary. | **P0/P1 — REVIEW_REQUIRED.** The Phase 9 prompt-boundary integration is separate evidence; each remaining raw admin/statistics callsite must be classified independently. Do not infer that all server reads enter model context. |
| `services/learning.js` | Learning duplicate/improvement selection calls `searchKnowledge()` (355–361, 447–452). | Content retrieval used in model-assisted learning/improvement decisions. | **P0 — REVIEW_REQUIRED.** This consumer must use the same project-scoped trusted retrieval facade before retrieved Knowledge can influence a proposal. |
| `tools/knowledge-cleanup.js` | Inspect and exact-duplicate assessment read local Knowledge (6–14); removal replaces local data and syncs Drive (34–60); execution checks `checkToolSafety()` (106–115). | Human-side-effect cleanup tool; inspect is read-only, removal is write/provider-sync capable. | **P1 — BLOCKED_BY_TOOL_POLICY for execution unless separately authorized.** Keep inspect and remove distinct. Never infer that duplicate detection authorizes deletion of non-identical records. |
| `tools/knowledge-count.js` | Reads local Knowledge and returns a count (15–21). | Read-only metadata/count surface. | **P2 — REVIEW_REQUIRED.** Count-only output is lower risk than content retrieval but still needs an explicit scope/permission decision before exposing cross-project totals. |
| `tools/knowledge-improve.js` | Selects an existing local Knowledge entry (16–24, 107–129), then creates a pending improvement proposal. | Content-selection path for a proposal; it does not itself apply the change. | **P0 — REVIEW_REQUIRED.** Candidate selection must use project-scoped trusted retrieval; preserve pending-review and no-mutation behavior. |
| `tools/knowledge-search.js` | Reads local Knowledge and may replace it with a Drive array (45–55), then searches and returns content (68 onward, 141–150). | Direct legacy content-retrieval tool with a provider-source substitution path. | **P0 — REVIEW_REQUIRED.** Highest-priority retrieval boundary. It must not return local/Drive records as trusted evidence without authoritative project scope and the canonical trusted filter. |
| `tools/memory-count.js` | Reads local Memory and returns a count (18–25). | Read-only metadata/count surface. | **P2 — REVIEW_REQUIRED.** Determine whether counts are global, project-scoped or admin-only; do not expose cross-project metadata by default. |

## 3. Important distinctions

1. **Not all 14 files are retrieval endpoints.** The list includes stores, provider adapters, controlled writers, admin routes, content consumers and count-only tools. A single blanket code change would be unsafe.
2. **A filter-marker scan is not semantic proof.** Missing marker text does not prove a reachable bypass; marker presence would not prove correct project identity, authorization or runtime coverage.
3. **The legacy Knowledge and Memory stores are not automatically canonical HFM records.** Their existing initialization, backup and rollback protections must be preserved while identity and project mapping are unresolved.
4. **The local conflict-quarantine registry is explicitly a local prototype and is not wired into production Memory/Knowledge/provider adapters.** Its presence must not be treated as production quarantine enforcement.
5. **The Phase 9 retrieval optimizer/provider adapters are dependency-injected, read-only contracts.** Their tests do not establish automatic wiring of these legacy consumers.
6. **The Phase 9 prompt-boundary regression is scoped to the tested `/api/agent` integration.** It does not prove every admin, tool, Learning, Evolution, Drive or count path is covered.

## 4. Required integration contract before enabling a legacy retrieval consumer

A future HFM retrieval integration must require all of the following; missing inputs fail closed:

- Authenticated actor identity from the server request/session, not model-supplied arguments.
- Authoritative `projectId` from an approved persistent owner/project mapping. No guessed, default or content-derived project ID.
- Explicit purpose, request ID and read-only access intent.
- Canonical record validation, exact project match, `ACTIVE` lifecycle, `VERIFIED` integrity, permitted trust state and exclusion of pending/quarantined/conflicted records.
- Access authorization using the authenticated actor context.
- Source provenance retained in the result; external or legacy content remains data, never executable instruction.
- Provider-specific failure reported as unavailable/degraded/failed, never converted into an empty successful result or interpreted as deletion.
- For write/apply consumers: expected revision/digest checks, conflict arbitration, append-only audit evidence and rollback/recovery behavior. Local locking is not evidence of remote or multi-instance CAS.

## 5. Safe implementation order

1. Resolve the authoritative runtime identity and persistent owner/project mapping as a separately reviewed contract.
2. Expose one canonical, read-only retrieval facade that requires actor context and project scope and returns only eligible records.
3. Integrate the facade first into `tools/knowledge-search.js`, `services/learning.js` and `tools/knowledge-improve.js`, with isolated cross-project, pending-review, quarantine, integrity-failure and provider-failure tests.
4. Review server admin/statistics routes and count-only tools separately; do not assume their permission model is identical to model retrieval.
5. Integrate controlled apply/Evolution/Drive paths only after identity, conflict arbitration, audit and rollback contracts are proven.
6. Re-run the integrated offline suites on the exact candidate head. Keep live provider, production persistence, deployment and restore tests unexecuted until their separate authorization gates are met.

## 6. Disposition

- 14 scanner candidate files: **SOURCE_CLASSIFIED** at the inspected callsite level.
- Universal dynamic/runtime caller coverage: **REVIEW_REQUIRED**.
- Authoritative runtime project identity for every legacy consumer: **NOT_ESTABLISHED**.
- Production quarantine/provider/audit integration: **NOT_CERTIFIED**.
- Production Memory/Knowledge writes, migration, restore and deployment: **NOT_AUTHORIZED / NOT_PERFORMED**.
- Phase 2: **IN_PROGRESS / REVIEW_REQUIRED**.
- HFM v0.2 production readiness: **NOT_CERTIFIED**.
