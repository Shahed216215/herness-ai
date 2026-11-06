# Mira HFM Data-Plane Callsite Audit

Date: 2026-11-06
Branch: `work/hfm-runtime-integration-from-render-main-20261106`
PR: #64 (Draft; not merged)
Status: READ-ONLY SOURCE REVIEW — DATA-PLANE INTEGRATION NOT APPROVED

## Scope

Reviewed the PR #64 branch source for legacy Memory, Knowledge, Project, and Conversation persistence and selected Knowledge/learning maintenance paths. This is a source inspection only. No user data, local runtime files, Google Drive contents, Neon records, or Render environment were accessed or modified.

## Confirmed findings

### 1. Memory
- `memory.js` delegates reads and writes to `services/mira-local-memory-store.js`, which persists a JSON array to the configured local storage path.
- `tools/memory-save.js` calls `addMemory("user", content)` and does not accept or enforce trusted actor, project, membership, or operation-authority context.
- The underlying `addMemory` API is global and has no project or actor argument.
- The local Memory store has useful file-safety, atomic-write, backup-integrity, and restore-safety mechanisms. Those controls do not provide project isolation, durable multi-instance storage, or HFM authorization.
- The standalone Memory backup/restore implementation is not an HFM-authorized project-scoped export/restore path.

### 2. Knowledge
- `knowledge.js` stores the full Knowledge collection in one local JSON file. `loadKnowledge()` returns an empty array if parsing fails, which can make corrupted data appear indistinguishable from an empty store to callers.
- `saveLocalKnowledge()` writes the JSON file directly rather than using an atomic replacement/readback integrity pattern.
- `addKnowledge`, `addLearning`, `updateKnowledge`, `updateLearning`, and `deleteKnowledge` operate on the global collection; their inspected APIs do not require a trusted actor or project scope.
- The Knowledge save tool invokes `addKnowledge` without passing the tool runner's trusted context.
- The Knowledge search tool reads the global local collection and can replace its search source with the Google Drive collection when Drive returns an array. No HFM project authorization or quarantine gate is visible in this tool path.
- Knowledge backup, cleanup, improvement, and controlled-apply/evolution code paths operate on whole local/Drive state collections. Their approval, snapshot, and integrity controls are useful workflow controls, but are not substitutes for per-project authorization on every read/write/export/restore operation.

### 3. Project and Conversation
- `project-store.js` and `conversation-store.js` persist to local JSON files.
- Their inspected read/list/count/create/update/delete/message/context APIs do not accept a canonical HFM principal or perform owner/membership/operation-authority checks.
- Conversation message and context access is filtered by supplied identifiers, but identifier filtering alone is not authorization.
- Project acceptance/scope validation is business-state validation; it does not establish HFM ownership or project membership.

### 4. Identity and authority integration boundary
- The identity context transported through the execution stack is not consumed by the above legacy persistence APIs.
- The transactional authority primitive remains disconnected from these data-plane callsites.
- The current runtime database grant is SELECT-only; it cannot support the existing transaction primitive's writes. No application write-role or stored-procedure boundary was established in this audit.

## Risk classification

| Area | Finding | Status |
|---|---|---|
| Memory save/read | Global local-file store; no HFM project authorization | BLOCKED |
| Memory backup/restore | No project-scoped authority enforcement demonstrated | BLOCKED |
| Knowledge save/update/delete | Global local-file collection; no HFM project authorization | BLOCKED |
| Knowledge search | Global/local + Drive source selection; no project authorization/quarantine gate demonstrated | BLOCKED |
| Knowledge backup/evolution | Whole-collection operations; HFM authority not demonstrated | BLOCKED |
| Project store | Local-file persistence; no owner/member authorization | BLOCKED |
| Conversation store | Local-file persistence; no owner/member authorization | BLOCKED |
| Durable payload backend | Not implemented/approved | NOT_IMPLEMENTED |

These are architecture and access-control gaps confirmed from the inspected source. They are not a claim that a specific external attacker has exploited them.

## Required design gates before implementation

1. Approve the canonical versioned payload schema and adapter contract, including stable IDs, project scope, owner, classification, provenance, timestamps, retention, and schema evolution.
2. Decide and approve a durable payload backend independently of the authority metadata registry; document free-tier limits, availability, backup, restore, and data-residency implications.
3. Specify owner/membership provisioning, invitation/acceptance, revocation, role changes, authority grants, and audit/revision semantics.
4. Require transaction-scoped authorization for every get/list/count/search/update/delete/export/backup/restore path. Project IDs supplied by callers must never establish authority by themselves.
5. Enforce classification, quarantine, and trust filtering before retrieval ranking, snippet generation, model context injection, or export.
6. Define encryption at rest/in transit, key custody/rotation, secret separation, audit intent/completion, idempotency, retries, and reconciliation.
7. Design a non-destructive migration with immutable source snapshots, per-record mapping, duplicate/conflict quarantine, checksums, dry-run reports, independent verification, and explicit human approval before cutover.
8. Test cross-project denial, owner/member boundaries, revoked membership, expired sessions, replay, concurrent operations, partial failure, backup/restore, restart recovery, and rollback against isolated disposable fixtures.
9. Do not silently fall back to global local/Drive data when HFM authorization or the durable backend is unavailable.

## Recommended next work

Continue with a design-only ADR and threat model for the canonical payload/data-plane contract, then request explicit approval of that contract before implementing adapters or migrating any existing data. Keep the current global legacy stores unchanged and label them as legacy/unscoped until a separately verified migration and cutover.

## Release decision

`HFM_IDENTITY_TRANSPORT=CI_PASS`
`AUTHORITY_PRIMITIVE=OFFLINE_CONTRACT_TEST_PASS`
`LEGACY_DATA_PLANE_CALLSITE_AUDIT=SOURCE_REVIEW_COMPLETE`
`PROJECT_SCOPED_AUTHORIZATION=NOT_IMPLEMENTED`
`DURABLE_PAYLOAD_STORAGE=NOT_IMPLEMENTED`
`MIGRATION_AND_RECOVERY=NOT_IMPLEMENTED`
`PRODUCTION_DEPLOYMENT=BLOCKED`

No merge, deployment, database connection/write, migration execution, Render configuration change, secret change, or legacy data mutation was performed.
