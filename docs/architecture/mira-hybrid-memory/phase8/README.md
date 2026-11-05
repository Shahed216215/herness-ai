# Mira Hybrid Memory v0.2 — Phase 8: Learning & Evolution Governance Bridge

Status: P8-A EXPLICIT MAPPING CONTRACT + P8-B READ-ONLY WORK LEARNING ADAPTER IMPLEMENTED; SYNTHETIC CI PASS; SOURCE SNAPSHOT CAPTURE AND RUNTIME INTEGRATION REMAIN BLOCKED.

This phase is a working execution breakdown aligned to the v0.2 Phase 2 contract's Learning/Evolution integration requirements and the Phase 3 domain-scope review. It does not advance the release beyond v0.2. No production data, canonical writes, migration, live provider calls, deployment or autonomous code application are authorized.

## Objective

Bring Work Learning, Work Knowledge Consolidation, Experience Memory/Retrieval and Evolution under the HFM trust, identity, project-scope, provenance, conflict, approval and recovery boundaries without silently changing their existing stores or bypassing existing governance.

## Source-audit findings (current branch)

1. `services/mira-work-learning-engine.js` stores records with `learningId`, `taskId`, `executionId`, task/plan/execution/QA/lesson data and timestamps. The normalized task schema has no authoritative `projectId`. `learningId` is a local record identity, not proof of project ownership. The `safeValue` normalization redacts secret-like keys and truncates nested values, so it is not a lossless canonical source payload.
2. `services/mira-work-knowledge-consolidation.js` creates derived items whose IDs are content-fingerprint based; source records refer to learning/task/execution identifiers and do not independently establish project scope.
3. `services/mira-experience-memory.js` and `services/mira-experience-retrieval-engine.js` implement a derived projection over Work Learning. The experience ID follows the learning ID. Retrieval ranks records by relevance and task/QA filters; the inspected retrieval path does not enforce HFM project scope, trust eligibility or conflict quarantine.
4. `services/mira-cross-task-learning-engine.js` consumes Experience Retrieval and returns read-only/non-executable transfers, but its inspected request context is task-based rather than an HFM-authorized project-scoped request.
5. `knowledge-memory-evolution.js` has prepare/apply/rollback logic over local and Drive-backed state. The inspected entry points do not require the HFM project request context, canonical Memory facade, HFM idempotency reservation or HFM recovery point.
6. `services/mira-evolution-staging.js` stages an already approved proposal as an inactive artifact; it does not by itself prove that the source proposal was created from an HFM-authorized, project-scoped canonical record.

The Phase 3 domain-scope review explicitly marks Work Learning, Work Knowledge Consolidation and Experience Memory as BLOCKED / NOT_MAPPED. It prohibits inferring project scope from taskId, planId, opportunityId, client metadata, content fingerprints or titles.

## Non-negotiable boundaries

- Never infer or default a projectId. Require an explicit, immutable task/work-item-to-project authority mapping from a separately trusted host registry.
- Do not treat taskId, planId, learningId, experienceId or content fingerprints as project authorization.
- Preserve raw source records and source snapshots. A redacted/truncated projection must not be used as the lossless migration source.
- Work Knowledge and Experience Memory remain derived projections with explicit source lineage; they are not independent canonical namespaces.
- Filter project scope, access classification, lifecycle, integrity, trust and unresolved conflicts before relevance ranking or model-context delivery.
- Evolution remains proposal/prepare-only unless a separate authorized human approval, atomic idempotency claim, verified recovery point, audit and rollback contract is proven.
- No autonomous code activation, direct canonical write, provider cutover, deletion or migration in this phase's synthetic track.

## Execution gates

### P8-A — Authority and identity contract
Define a signed, short-lived, replay-protected mapping from exact task/work-item identity to projectId and tenantId, with source system, issuer, policy version, approver authority, validity and revocation evidence. The host must authenticate the actor and provide authoritative project ownership. A caller-supplied mapping alone is not trusted.

### P8-B — Lossless Work Learning source adapter
Read an exact immutable snapshot; bind each record to snapshot digest, stable learningId and source ordinal; preserve the full original record; reject duplicates, malformed records, digest drift and ambiguous identities. Do not call the existing normalized `safeValue` view as the source of canonical migration data.

### P8-C — Canonical mapping and review candidates
Map only records with explicit approved project authority into canonical v1.0.0 review candidates. Bind source digest, canonical digest, mapping digest, classification, provenance and approval evidence. Unmapped records remain preserved and BLOCKED.

### P8-D — Derived projection lineage
Bind Work Knowledge and Experience projections to source learning IDs, source digests, derivation version and inherited project scope. Any source or scope change invalidates the projection. Do not create a second canonical identity for a projection.

### P8-E — Project-scoped learning retrieval
Require HFM request authorization and apply project/access/trust/integrity/conflict filters before ranking. Cross-task transfer is allowed only within the authorized project unless a separately governed cross-project policy explicitly permits it. Default is deny.

### P8-F — Evolution governance bridge
Require proposal provenance, project scope, expected revision, idempotency identity, human approval, verified recovery point, audit and rollback evidence. First deliver a prepare-only bridge; do not call existing apply/Drive writers from the HFM path.

### P8-G — Independent negative/bypass tests
Test missing/forged/expired/revoked authority, cross-project task substitution, duplicate learning IDs, source snapshot drift, lossy normalization, projection staleness, quarantine bypass, unauthorized cross-task transfer, stale revision, duplicate idempotency, failed audit and failed recovery. Tests must use isolated synthetic fixtures and prove zero canonical writes/network calls.

## Entry criteria and blockers

- Phase 3 currently reports `PHASE3=COMPLETE_SYNTHETIC_CONTRACT_ONLY`, not production integration.
- The current mapping contract supports General Memory, Knowledge and CRM Conversation only; Work Learning is explicitly rejected as an unreviewed domain.
- The authoritative project-owner registry, host authentication/replay protection and production persistence/CAS are not established.
- Therefore P8-A must be designed and tested synthetically first. Runtime integration is blocked until a trusted host authority provider and independent policy review exist.

## Exit criteria

- All P8-A through P8-G contracts have exact schemas, threat boundaries and traceability.
- Synthetic tests prove every deny-by-default case and no canonical writes/network calls.
- Independent source review confirms no raw Work Learning/Experience bypass path was introduced.
- The phase ledger records commit-matched CI logs, exact test markers and unresolved limitations.
- No claim of production readiness; live provider/host authority remains a separate approved deployment gate.

## Current disposition

- Source audit: COMPLETE for the listed modules only; repository-wide semantic caller coverage remains REVIEW_REQUIRED.
- Authoritative project scope for Work Learning: NOT_ESTABLISHED.
- Canonical Work Learning mapping: NOT_IMPLEMENTED.
- HFM project-scoped Experience Retrieval: NOT_INTEGRATED.
- HFM Evolution prepare-only bridge: NOT_INTEGRATED.
- Production integration: NOT_APPROVED.


## Implementation checkpoint — P8-A / P8-B (2026-11-05)

- Extended the read-only mapping contract with the explicit `work_learning` domain and fixed source system `mira_work_learning`. Unknown derived domains such as Work Knowledge Consolidation remain rejected.
- Added `services/mira-hfm-work-learning-adapter.js`. It validates an exact owner-approved mapping through the existing project-owner registry verifier, binds `learningId`, source ordinal, caller-supplied source snapshot digest, raw record digest and canonical candidate digest, and emits only a canonical `lesson` candidate.
- Candidate state is fixed to `PENDING_REVIEW`, `integrity=UNVERIFIED`, `trust=SOURCE_RECORDED`; no canonical write or activation is possible through this adapter.
- Full raw Work Learning payload is preserved, but records containing secret-like field names are rejected before candidate construction. Bounded recursive scan rejects excessive depth/node count and cyclic objects.
- Batch adaptation rejects duplicate learning IDs, missing/unused mappings, duplicate canonical IDs, source ordinal drift, cross-project mappings, revoked owner registry evidence, forged mapping digests and source digest changes.
- Important limitation: this adapter does not open or hash the source file itself. The caller-supplied `sourceFileDigest` must come from a separately verified immutable snapshot-capture component. This is not yet implemented or authenticated in production.
- CI run #373, ID `42045846125`, commit `e7ddac2a4a6ebe6c29487419439aecf94f8c12b8`: SUCCESS. Job `phase8-learning-scope-contract` SUCCESS. Logs verified the four suites, all Work Learning markers, `TESTS_FAILED=0`, `NETWORK_REQUESTS=0`, `CANONICAL_MEMORY_WRITTEN=NO`, and `CANONICAL_KNOWLEDGE_WRITTEN=NO`.
- Earlier run #372 (ID `42045571144`) failed only on a case-sensitive test assertion for the expected error text. The assertion was corrected in the next commit and run #373 passed. The earlier failed run remains in history.
- P8-A mapping contract and P8-B in-memory source adaptation: PASS_CI_SYNTHETIC.
- Trusted production owner-registry provider, source-file capture/authenticity, task/work-item authority source, and runtime project-scoped retrieval remain REVIEW_REQUIRED / NOT_APPROVED / NOT_IMPLEMENTED.


## P8-E implementation checkpoint — project-scoped learning retrieval (2026-11-05)

- Added `services/mira-hfm-work-learning-retrieval.js`, a read-only retrieval bridge over the existing synthetic HFM unified facade.
- The unified facade performs LIST and per-record READ authorization, project/access checks, ACTIVE lifecycle, VERIFIED integrity, trusted-state and unresolved-conflict filtering before relevance ranking. The new adapter ranks only eligible canonical `lesson` records after those checks.
- The adapter validates the serialized Work Learning domain, binds payload `learningId` to canonical sourceId, requires a taskId and lesson array, excludes the current task, preserves source provenance/revision/digest, and returns read-only/non-executable results.
- Cross-project records, pending/unverified records, quarantined records, same-task records, host-denied requests and invalid limits are rejected or excluded. Output is detached and frozen.
- CI run #377, ID `42046629438`, commit `f5b013f2c03177fb3cd9526f73971880bc194d81`: SUCCESS. Job `phase8-learning-scope-contract` SUCCESS. Logs verified all four earlier suites plus the new retrieval suite; `TESTS_FAILED=0`, `NETWORK_REQUESTS=0`, `CANONICAL_MEMORY_WRITTEN=NO`, `CANONICAL_KNOWLEDGE_WRITTEN=NO`.
- Earlier run #376 failed because the test expected a denied LIST authorization to return an empty array. The HFM request-authorization contract correctly throws on denial; the test was corrected to assert fail-closed behavior. Run #377 passed.
- P8-E synthetic retrieval contract: PASS_CI. This is not connected to the live Work Learning store or production canonical Memory service.
- P8-D derived Work Knowledge/Experience projection lineage, authenticated source-file capture, real host identity/project registry, and runtime integration remain OPEN / NOT_APPROVED.


## P8-B through P8-G implementation checkpoint — 2026-11-05

- Added `services/mira-hfm-work-learning-staging-source.js`: staging-only raw Work Learning store snapshot capture. It pins a Linux directory descriptor, requires directory mode 0700 and owner/group match, requires a single-link workload-owned source file with mode 0600, opens with `O_NOFOLLOW`, checks file identity/size/timestamps before and after read, bounds file size and record count, rejects duplicate learning IDs and secret-like fields, and signs the exact snapshot with the injected Ed25519 snapshot signer.
- The source requires a signed, short-lived, replay-protected `backup:read` decision from a separately pinned authorization issuer. `captureAuthorizedSnapshot` verifies the source signature and binds request ID, nonce, actor, project context, source revision, record count and payload digest.
- The captured raw store does not contain an inferred `projectId`. The attestation project context only authorizes the store snapshot read; each learning record still requires its own explicit owner-approved project mapping.
- Added an end-to-end synthetic test that composes signed Work Learning snapshot capture with owner-registry-approved per-record mapping and creates only `PENDING_REVIEW` canonical lesson candidates. No canonical writes occur.
- P8-C mapping candidates, P8-D rebuildable Work Knowledge/Experience projections, P8-E project-scoped retrieval, P8-F Evolution prepare-only proposal and P8-G negative/bypass tests are implemented as synthetic/read-only contracts.
- Evolution bridge requires an independently supplied recovery-point verifier, binds the exact source memory/revision/digest, emits only `PREPARED_NOT_COMMITTED`, and hard-disables apply, execution and persistence.
- CI run #392, ID `42048984664`, URL https://github.com/Shahed216215/herness-ai/actions/runs/42048984664, tested commit `97136cc43c50dba92d1956d42119a7bd35b19443`: SUCCESS. Job `phase8-learning-scope-contract` SUCCESS. Logs verified all six test suites and the end-to-end marker `WORK_LEARNING_SIGNED_SNAPSHOT_TO_OWNER_APPROVED_CANDIDATE_E2E_PASS`; `TESTS_FAILED=0`, `NETWORK_REQUESTS=0`, `PRODUCTION_MEMORY_TOUCHED=NO`, `CANONICAL_MEMORY_WRITTEN=NO`, `CANONICAL_KNOWLEDGE_WRITTEN=NO`, `EVOLUTION_APPLIED=NO`.
- Earlier runs #388–#390 exposed test-harness integration mistakes: the authoritative snapshot wrapper only accepts its established `backup:read` scope, and its provenance is returned under `evidence.provenance` rather than a raw `attestation` property. The adapter and test were aligned with those existing contracts; run #391/#392 logs passed.
- Phase 8 synthetic contract gate: PASS. Actual application-store routing, authenticated host owner registry, production source capture, durable replay guard, canonical persistence/CAS, audit writer and approved Evolution application remain NOT_IMPLEMENTED / NOT_APPROVED. No live store or production data was read.
- Phase 8 disposition: `SYNTHETIC_CONTRACTS=PASS`; `RUNTIME_INTEGRATION=NOT_APPROVED`; `PRODUCTION_READINESS=NOT_CERTIFIED`.
