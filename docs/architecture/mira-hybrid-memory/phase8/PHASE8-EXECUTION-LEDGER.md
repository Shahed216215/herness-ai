# Phase 8 Execution Ledger — Mira HFM v0.2

Date: 2026-11-05
Repository: Shahed216215/herness-ai
Branch: work/mira-hfm-v02-phase7-emergency-backup
Release: v0.2
Status: SOURCE_AUDIT_COMPLETE_FOR_SELECTED_MODULES / IMPLEMENTATION_BLOCKED_PENDING_PROJECT_AUTHORITY

## Entry 001 — Phase 7 offline gate closed; Phase 8 source audit started

### Phase 7 prerequisite evidence
- Current Phase 7 code commit: `0c94bd0b4909946534760c041f966b16fddb8b1c`; run #127 `42043450318` SUCCESS; job `phase7-offline-contract` SUCCESS.
- Ledger follow-up commit `6398ff934d0152f7d80314bb817430b9d2d86f15`; run #128 `42044256555` SUCCESS.
- Phase 7 README reconciliation commit `6bdad8298ad3a0f70a9de0e4e741f63cc361d23b`; run #129 `42044417178` SUCCESS.
- The three commit-matched logs confirm all nine Phase 7 suites and all F7-SR-05 provenance markers. The latest retrieved run also confirms no network, no live Drive calls, no backup deletion, and no canonical Memory/Knowledge writes.
- Phase 7 offline contract gate: PASS. External KMS/HSM custody, trusted production snapshot source, issuer/replay governance, independent infrastructure provenance, host/container ACL review and live Drive/restore remain REVIEW_REQUIRED / NOT_APPROVED / NOT_RUN. Production readiness remains NOT_CERTIFIED.

### Source audit evidence
- `services/mira-work-learning-engine.js`: Work Learning records contain learningId/taskId/executionId and nested task/execution/QA/lesson data; normalized task shape does not contain projectId. `safeValue` redacts secret-like keys and truncates nested values; it is not a lossless canonical source.
- `services/mira-cross-task-learning-engine.js`: cross-task transfer uses task identity and Experience Retrieval; output is read-only/non-executable but no HFM project authorization is present in the inspected request path.
- `services/mira-experience-retrieval-engine.js`: reads the Experience Memory projection and ranks by relevance; inspected filters are taskId/status/qaStatus and limit, not HFM project/trust/conflict eligibility.
- `services/mira-evolution-staging.js`: stages only approved proposals into inactive artifacts, but does not itself enforce HFM project scope or canonical recovery/audit requirements.
- `knowledge-memory-evolution.js`: prepare/apply/rollback reads/writes local and Drive-backed state; inspected entry points are not wired to HFM request authorization, unified facade or Phase 7 encrypted recovery point.
- `docs/architecture/mira-hybrid-memory/phase3/MIRA-HFM-CAGR-001-PHASE3-DOMAIN-SCOPE-REVIEW-20261104.txt` explicitly classifies Work Learning, Work Knowledge and Experience Memory as NOT_MAPPED / BLOCKED and prohibits inferred project scope.

### Blockers and disposition
- No authoritative immutable task/work-item -> project/tenant registry is selected or integrated.
- The existing mapping contract intentionally rejects `work_learning`; do not relax it by inferring from taskId/planId/opportunityId/content.
- No lossless raw-source snapshot adapter exists for Work Learning in this branch.
- No project-scoped HFM retrieval adapter for Experience Memory is integrated.
- No HFM prepare-only Evolution bridge exists.
- No production writes, migrations, live Drive/API calls, or runtime routing changes were made.

### Next implementation order
1. Design a host-issued, signed, short-lived, replay-protected task/work-item-to-project authority contract.
2. Add a lossless, immutable Work Learning snapshot adapter and synthetic tests.
3. Add explicit owner-approved Work Learning mapping review candidates without production writes.
4. Bind derived Work Knowledge/Experience projections to source digests and inherited project scope.
5. Add project-scoped retrieval facade with filter-before-ranking and cross-project default deny.
6. Add Evolution prepare-only bridge; keep apply and external writers disabled.
7. Add negative/bypass tests and commit-matched CI evidence.

### Status
`PHASE8_SOURCE_AUDIT=COMPLETE_SELECTED_MODULES`
`WORK_LEARNING_PROJECT_AUTHORITY=NOT_ESTABLISHED`
`WORK_LEARNING_MAPPING=BLOCKED`
`EXPERIENCE_RETRIEVAL_HFM_INTEGRATION=NOT_IMPLEMENTED`
`EVOLUTION_HFM_BRIDGE=NOT_IMPLEMENTED`
`CANONICAL_WRITES=0`
`NETWORK_REQUESTS=0`
`PRODUCTION_READINESS=NOT_CERTIFIED`


## Entry 002 — P8-A/P8-B Work Learning adapter implementation and CI

- Added explicit `work_learning -> mira_work_learning` domain support to `services/mira-memory-project-mapping-contract.js`. The mapping remains explicit and owner-approved; no project scope is inferred from taskId/planId/opportunityId.
- Extended `services/mira-legacy-memory-knowledge-adapter.js` to bind Work Learning `learningId` and require canonical `recordType=lesson`, preserving the complete source record.
- Added `services/mira-hfm-work-learning-adapter.js` to compose the owner-registry approval verifier, exact mapping validator, raw source digest check, source-file digest/ordinal binding, canonical candidate digest check and read-only legacy adapter.
- Candidate is always `PENDING_REVIEW`, `UNVERIFIED`, `SOURCE_RECORDED`. Secret-like fields are rejected recursively; duplicate identities, missing mappings, stale/forged digests, wrong ordinal, revoked owner registry and cross-project mapping fail closed.
- The adapter consumes already captured in-memory entries and a caller-supplied sourceFileDigest; it does not open/hash the source file. Production snapshot authenticity is therefore NOT_ESTABLISHED.
- New test: `tests/mira-hfm-work-learning-adapter.test.js`; Phase 8 workflow runs structural conflict assessment, mapping contract, owner approval contract, legacy adapter and Work Learning adapter suites.
- CI run #373 / ID `42045846125`, URL https://github.com/Shahed216215/herness-ai/actions/runs/42045846125, tested commit `e7ddac2a4a6ebe6c29487419439aecf94f8c12b8`, push event, conclusion SUCCESS. Job `phase8-learning-scope-contract` completed SUCCESS.
- Verified markers: `WORK_LEARNING_OWNER_APPROVED_MAPPING_AND_LOSSLESS_PAYLOAD_PASS`, `WORK_LEARNING_BATCH_SNAPSHOT_MAPPING_PASS`, `WORK_LEARNING_CROSS_PROJECT_MAPPING_BLOCK_PASS`, `WORK_LEARNING_SOURCE_TAMPER_BLOCK_PASS`, `WORK_LEARNING_FORGED_MAPPING_BLOCK_PASS`, `WORK_LEARNING_DUPLICATE_SOURCE_ID_BLOCK_PASS`, `WORK_LEARNING_MISSING_OWNER_MAPPING_BLOCK_PASS`, `WORK_LEARNING_SNAPSHOT_ORDINAL_DRIFT_BLOCK_PASS`, `WORK_LEARNING_REVOKED_OWNER_REGISTRY_BLOCK_PASS`, `WORK_LEARNING_NO_PROJECT_INFERENCE_PENDING_REVIEW_PASS`, `WORK_LEARNING_SECRET_FIELD_REJECTED_PASS`.
- Logs: `TESTS_FAILED=0`, `NETWORK_REQUESTS=0`, `CANONICAL_MEMORY_WRITTEN=NO`, `CANONICAL_KNOWLEDGE_WRITTEN=NO`.
- First adapter CI run #372 failed at the test's case-sensitive expected-error regex only; implementation threw the expected `Mapping digest mismatch.` error. Test assertion corrected; run #373 verified the correction. No code failure was observed in the failing run.
- P8-A/P8-B: PASS_CI_SYNTHETIC. Phase 8 overall: IN_PROGRESS.
- Remaining: authenticated snapshot file capture, trusted task/work-item-to-project authority source, Work Knowledge/Experience projection lineage, project-scoped retrieval, HFM Evolution prepare-only bridge, full bypass tests and independent review.


## Entry 003 — P8-E project-scoped retrieval contract and CI

- Added `services/mira-hfm-work-learning-retrieval.js` over `retrieveCanonicalRecordsWithReport`.
- The facade performs LIST authorization and per-record READ authorization, project/access checks, ACTIVE + VERIFIED + retrievable trust-state checks, and unresolved conflict exclusion before the retrieval adapter calculates relevance.
- Adapter admits only canonical `lesson` records whose serialized payload declares `domain=work_learning` and whose payload learningId matches canonical sourceId. It excludes the current task, returns source provenance and revision, and marks all output read-only/non-executable.
- Test fixture proves same-task exclusion, cross-project isolation, pending-review exclusion, quarantine exclusion, non-learning record exclusion, host denial, missing authorization, bounded limit, provenance retention and immutable output.
- CI run #377, ID `42046629438`, URL https://github.com/Shahed216215/herness-ai/actions/runs/42046629438, commit `f5b013f2c03177fb3cd9526f73971880bc194d81`, push event, conclusion SUCCESS. Job `phase8-learning-scope-contract` SUCCESS.
- Verified markers: `WORK_LEARNING_PROJECT_SCOPED_FILTER_BEFORE_RANKING_PASS`, `WORK_LEARNING_CROSS_PROJECT_REQUEST_CONTEXT_BLOCK_PASS`, `WORK_LEARNING_MISSING_HOST_AUTHORIZATION_BLOCK_PASS`, `WORK_LEARNING_RETRIEVAL_LIMIT_BOUND_PASS`, `WORK_LEARNING_HOST_DENY_BLOCKS_RETRIEVAL_PASS`, `WORK_LEARNING_RETRIEVAL_PROVENANCE_AND_IMMUTABILITY_PASS`.
- Logs confirm `TESTS_FAILED=0`, `NETWORK_REQUESTS=0`, `CANONICAL_MEMORY_WRITTEN=NO`, `CANONICAL_KNOWLEDGE_WRITTEN=NO`.
- Earlier run #376 failed only because a test expected host DENY to return an empty result; the authorization contract correctly throws on LIST denial. Test was corrected to assert fail-closed denial and run #377 passed.
- P8-E: PASS_CI_SYNTHETIC. Runtime source integration and production authorization are NOT_IMPLEMENTED / NOT_APPROVED.
- Phase 8 remains IN_PROGRESS. P8-D derived projection lineage and P8-F Evolution governance bridge remain open.


## Entry 004 — P8-B signed staging source, P8-C end-to-end mapping, P8-F Evolution prepare-only

- Added `services/mira-hfm-work-learning-staging-source.js` and `tests/mira-hfm-work-learning-staging-source.test.js`.
- Staging source pins its root directory descriptor, enforces directory 0700/owner-group policy and source file 0600/owner-group/single-link policy, opens via `O_NOFOLLOW`, checks descriptor and named-file identity/metadata around reads, enforces 25 MiB and 5,000-record limits, validates store schema, unique learningId/taskId, and rejects secret-like fields.
- Source requires signed `backup:read` authorization, independently pinned issuer trust, replay guard, staging-only Ed25519 signer and six explicit provenance dimensions. It signs source revision, exact payload digest, record count, request/nonce/actor/project context and authorization issuer evidence.
- The captured Work Learning store remains raw and unassigned to any project. The request project is authorization context only; record ownership is established later through owner-approved mapping.
- Added an end-to-end test that calls `captureAuthorizedSnapshot`, takes the exact captured `sourceFileDigest` and raw record array, verifies an owner-registry-approved mapping, and creates a full-payload canonical lesson candidate in `PENDING_REVIEW` / `UNVERIFIED` / `SOURCE_RECORDED`. No canonical write is performed.
- Added `services/mira-hfm-evolution-prepare.js` and tests. It accepts only an HFM-authorized active verified Work Learning lesson, binds expected revision/digest and a separately verified backup recovery point, and emits `PREPARED_NOT_COMMITTED` with approval, audit and atomic idempotency plans. It cannot apply, execute or persist Evolution changes.
- P8-D projection service and P8-E retrieval service are read-only, rebuildable and project-scoped. Projection IDs bind source digest/revision/algorithm; retrieval filters project, host authorization, trust, integrity and quarantine before relevance ranking. Secret-bearing learning payloads are excluded.
- CI run #392, ID `42048984664`, URL https://github.com/Shahed216215/herness-ai/actions/runs/42048984664, commit `97136cc43c50dba92d1956d42119a7bd35b19443`, push event, conclusion SUCCESS. Job `phase8-learning-scope-contract` SUCCESS.
- Verified end-to-end marker: `WORK_LEARNING_SIGNED_SNAPSHOT_TO_OWNER_APPROVED_CANDIDATE_E2E_PASS`; staging source markers: signed snapshot capture, no project inference, replay block, auth denial before file read, duplicate ID block, secret field block, root/file permission blocks, production environment block; Evolution markers: approval/recovery gate, stale revision block, digest mismatch block, unverified/expired recovery block, cross-project block and idempotency requirement.
- Logs confirm `TESTS_FAILED=0`, `NETWORK_REQUESTS=0`, `PRODUCTION_MEMORY_TOUCHED=NO`, `CANONICAL_MEMORY_WRITTEN=NO`, `CANONICAL_KNOWLEDGE_WRITTEN=NO`, `EVOLUTION_APPLIED=NO`.
- P8-B/P8-C/P8-D/P8-E/P8-F/P8-G synthetic contracts: PASS_CI. Phase 8 synthetic contract gate: PASS.
- Runtime integration remains NOT_APPROVED: no production host-issued owner registry, no production snapshot issuer/KMS custody, no durable shared replay guard, no actual canonical storage adapter/CAS/audit integration, and no Evolution apply path approval.
- Phase 8 overall: SYNTHETIC_CONTRACTS_COMPLETE / RUNTIME_INTEGRATION_NOT_APPROVED / PRODUCTION_NOT_CERTIFIED.
