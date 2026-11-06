# HFM Memory / Knowledge Runtime Integration Gap Report

Date: 2026-11-06
Branch: `work/hfm-runtime-integration-from-render-main-20261106`
Status: READ-ONLY SOURCE AUDIT — IMPLEMENTATION BLOCKED AT DATA-PLANE BOUNDARY

## Confirmed findings

1. `tools/memory-save.js` calls the legacy `addMemory` function and ignores the trusted context argument passed by the tool runner.
2. `tools/knowledge-save.js` calls legacy `addKnowledge` and ignores trusted actor/project context.
3. `tools/knowledge-search.js` searches the global local Knowledge store and may replace it with Google Drive content. It has no HFM project authorization parameter.
4. `services/mira-local-memory-store.js` persists to a local JSON file. This is not an approved durable HFM production backend under the Phase 2 v0.2.4 contract.
5. `project-store.js` and `conversation-store.js` remain local-file stores. No PostgreSQL migration or project-scoped durable data adapter was proven.
6. `services/mira-hfm-work-learning-retrieval.js` imports `./mira-memory-unified-facade`, but that module is absent on this branch. Its associated test is not part of the configured `npm test` chain. Treat this retrieval bridge as unusable / NOT_VERIFIED.
7. `services/mira-hfm-authority-transaction.js` is not called by Memory, Knowledge, Project, or Conversation routes/tools.
8. `migrations/hfm/002_runtime_readonly_grants.sql` grants SELECT-only access to the runtime role. This is intentionally incompatible with using that role for the current authority transaction's UPDATE/INSERT operations. A separately reviewed narrowly scoped write role or database-side procedure is required before write integration.

## Security consequence

Passing trusted identity through the work engine is transport plumbing, not authorization. Existing Memory/Knowledge tool implementations ignore the extra context and continue to use global legacy stores. They must not be described as HFM-protected or project-scoped.

## Contract alignment

The HFM Phase 2 v0.2.4 contract says phone-local storage is not an approved Mira Memory backend, preserves existing data until a separately verified migration, requires project scope on every operation, prohibits silent fallback, and requires independent approval for migration/restore. The v0.2.5 revision blueprint is marked PROPOSED / NOT APPROVED / NOT STARTED. It must not be treated as an approved implementation contract without review.

## Next implementation boundary

Before touching Memory or Knowledge payloads:
- approve a versioned canonical record schema and adapter contract;
- define a durable payload backend separate from the authority metadata registry;
- define owner/membership provisioning and operation grant lifecycle;
- implement transactional authorization for every read/write/search/list/count/export/backup/restore surface;
- enforce access classification and quarantine before ranking or returning snippets;
- define encryption, key custody, durable audit intent/completion, idempotency and reconciliation;
- add isolated migration fixtures and independent recovery/restore tests.

No existing Memory, Knowledge, Project, or Conversation records were read or modified by this audit.
No provider/API calls, Render changes, database writes, migration execution, merge, or deployment were performed.


## Retrieval inventory evidence

Latest CI run: https://github.com/Shahed216215/herness-ai/actions/runs/42194208479

- `MIRA_HFM_RETRIEVAL_CALL_COUNT=36`
- `MIRA_HFM_RETRIEVAL_CONSUMER_FILE_COUNT=15`
- `MIRA_HFM_RETRIEVAL_FILES_WITHOUT_BOTH_FILTER_MARKERS=15`
- `MIRA_HFM_RETRIEVAL_TRUST_FILTER_COVERAGE=REVIEW_REQUIRED`

The 15 files flagged by this conservative source-marker inventory are:
- `autonomous-learning-controlled-apply.js`
- `google-drive.js`
- `knowledge-controlled-apply.js`
- `knowledge-memory-evolution.js`
- `knowledge.js`
- `memory.js`
- `routes/knowledge-improvements.js`
- `server.js`
- `services/learning.js`
- `tools/knowledge-backup.js`
- `tools/knowledge-cleanup.js`
- `tools/knowledge-count.js`
- `tools/knowledge-improve.js`
- `tools/knowledge-search.js`
- `tools/memory-count.js`

This scanner only checks for trust/quarantine marker presence at file level. It is a triage inventory, not proof that a specific callsite is vulnerable or safe. Each callsite requires contextual control-flow and authorization review.

The same CI run completed successfully:
- locked dependency install: PASS
- runtime syntax checks: PASS
- canonical identity contracts: PASS
- retrieval callsite inventory: generated; coverage remains REVIEW_REQUIRED
- configured repository regression suite: PASS

## Status

`HFM_IDENTITY_TRANSPORT=CI_PASS`
`AUTHORITY_PRIMITIVE=OFFLINE_CONTRACT_TEST_PASS`
`MEMORY_KNOWLEDGE_AUTHORIZATION=NOT_IMPLEMENTED`
`DURABLE_PAYLOAD_STORAGE=NOT_IMPLEMENTED`
`PROJECT_SCOPED_RETRIEVAL=BLOCKED`
`PRODUCTION_DEPLOYMENT=BLOCKED`
