# Mira HFM v0.2 — Phase 8 Learning & Evolution Integration

Status: PROJECT-ISOLATED PROPOSAL BRIDGE, LOCAL DEVELOPMENT STORE, SUPABASE STORE CONTRACT, NAMED-ADMIN IMMUTABLE REVIEW, ADMIN API, PUBLIC-RETRIEVAL AND LEGACY-LEARNING EVIDENCE ADAPTERS, PRODUCTION FAIL-CLOSED GATE, READ-ONLY LEGACY COMPATIBILITY INSPECTOR AND OFFLINE TESTS IMPLEMENTED. LIVE SUPABASE MIGRATION, DEPLOYMENT, UI AND AUTOMATED GENERATION-CYCLE ORCHESTRATION NOT CERTIFIED.

## Objective

Connect existing Mira Learning and HFM evidence to a controlled learning/evolution proposal workflow without silently converting retrieved information into trusted knowledge or allowing autonomous self-modification.

## Implemented in this branch

- Bounded, versioned evidence-backed proposal schema with SHA-256 evidence and proposal digests.
- Strict project isolation, duplicate evidence rejection and immutable proposal IDs.
- Local development store with create-only files, restrictive permissions, fsync, read-after-write and tamper detection. It explicitly declares `durable=false` and `crossInstanceAtomicCreate=false`; it is not a production/Render multi-instance store.
- Supabase PostgREST store using the existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server-side environment variables. It uses project-scoped primary keys, insert-ignore/readback verification, content digests, immutable review records and a separate append-only audit-event table.
- SQL migration `supabase/migrations/20261105110000_mira_hfm_learning_proposals.sql`. It creates proposal, review and audit tables. RLS is enabled; only the service role receives SELECT/INSERT grants. No UPDATE or DELETE grant is provided.
- Production activation is fail-closed. It requires:
  - `MIRA_HFM_LEARNING_PROPOSAL_BACKEND=supabase`
  - `MIRA_HFM_LEARNING_PROPOSAL_PRODUCTION_READY=true`
  - Valid existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets
  - The migration to be applied and independently verified before setting the production-ready flag
- The production audit writer records both proposal staging and immutable human-review decisions in Supabase with deterministic event identity, duplicate-safe insert semantics and readback verification. Audit failure after proposal/review persistence is reported as committed/reconciliation-required; an identical retry can reconcile the audit event without overwriting the immutable record.
- Admin-only API requires a named authenticated administrator browser session. It supports explicit evidence submission, HFM public retrieval intake, legacy Learning Engine intake, Experience Retrieval intake, Consolidated Knowledge intake, immutable review decisions and proposal readback.
- HFM public retrieval adapter validates the provider/mode, successful or degraded-evidence status, zero-canonical-write declarations, exact numeric Page-ID-bound Facebook paths, declared source type, provenance and credential-free HTTPS URL. Imported evidence is forced to UNVERIFIED.
- Legacy Learning Engine adapter reads one requested record through the existing read/verify interfaces, requires matching successful integrity evidence, screens candidate text for likely secrets, and maps lesson/improvement candidates into UNVERIFIED HFM evidence. It does not modify the legacy record.
- Read-only compatibility inspector checks Learning Engine, Experience Memory, Experience Retrieval, Knowledge Consolidation and Evolution Snapshot/rollback interfaces without migration, rewrite, deletion, rollback or Drive/network calls.
- Added a fail-closed generation-cycle proposal orchestration adapter. It is disabled by default, requires an explicit opt-in and named authenticated admin context, validates the HFM public-retrieval report, and stages only an UNTRUSTED proposal for human review. It never approves, promotes trust, writes canonical Memory, executes learning or modifies code. The adapter is unit-tested but is not yet invoked by the live `/api/agent` generation/retrieval loop.
- Every proposal remains `PENDING_HUMAN_REVIEW` and `UNTRUSTED`. A named administrator may create one immutable `APPROVE_FOR_MANUAL_HANDOFF` or `REJECT` decision. Approval permits manual follow-up only; it does not promote trust, execute a learning action, change canonical Memory or modify code.

## Trust and governance

- Trust labels are provenance states, not instructions or proof that evidence is true.
- Retrieved web/Facebook and legacy learning content remains untrusted evidence. Prompt-like text inside evidence must never override system, developer, project or user policy.
- A proposal is a hypothesis for review, not a learned fact, approved policy, executable task or code patch.
- The bridge exposes one named-admin immutable review operation. `APPROVE_FOR_MANUAL_HANDOFF` records permission for a human to perform a separately controlled follow-up; it is not an autonomous approve/apply, promote, execute, merge or code-change operation. Any downstream application requires a separately scoped governance design and independent verification.
- Digests detect content changes; they do not authenticate the original source or prove factual correctness.
- Supabase service-role credentials are never returned to clients, written into proposal payloads, or logged by the adapter.

## API

Base: `/api/admin/mira-hfm-learning-evolution`

- `POST /proposals` — stage explicitly supplied evidence.
- `POST /proposals/from-public-retrieval` — adapt an already-produced HFM public retrieval result. It does not perform a search and cannot cryptographically prove the submitted report came from the provider.
- `POST /proposals/from-legacy-learning` — read and verify a requested legacy Learning Engine record, then stage its eligible candidates as untrusted evidence.
- `POST /proposals/from-experience-retrieval` — validate the integrity of explicitly selected legacy Experience records and stage lesson, feedback, QA and recovery signals as untrusted evidence.
- `POST /proposals/from-consolidated-knowledge` — require a valid Knowledge Consolidation store integrity result and source-record provenance before staging one selected item as untrusted evidence.
- `POST /proposals/:projectId/:proposalId/review` — record one named-admin `APPROVE_FOR_MANUAL_HANDOFF` or `REJECT` decision with a reason.
- `GET /proposals/:projectId/:proposalId` — read and re-verify a stored proposal and its optional review.

## Deployment and cost boundary

The implementation reuses the existing Supabase Free project and existing server-side Supabase environment variables; it introduces no paid vendor or paid API. The design target remains $0/month while usage stays within the existing free-tier quotas. Free-tier capacity, inactivity/pause behavior and storage limits still apply; exceeding a quota must not trigger a paid upgrade automatically.

The migration has been committed to the branch only. It has NOT been applied to the live Supabase project. No Supabase request, OAuth, credential read, deployment or live persistence/restart test was performed in this work. Do not set the production-ready flag until migration and live verification are explicitly authorized and completed.

## Remaining Phase 8 work

1. Apply the SQL migration in the approved Supabase project and verify RLS, grants, primary-key uniqueness and foreign-key behavior.
2. Run an authorized live integration test: insert, duplicate conflict, cross-project isolation, audit readback, restart/reconnect recovery and fail-closed behavior. This has not been done.
3. Wire the tested generation-cycle adapter into the actual Mira `/api/agent` retrieval lifecycle. The adapter exists but is not yet called by the live request loop; current intake remains an explicit admin API call.
4. Add UI visibility and independent end-to-end verification for the complete HFM → evidence → proposal → review → human-controlled handoff path.
5. Verify Render instance/restart behavior and Supabase free-tier capacity without exceeding the $0/month constraint.

## Offline verification

- `node tests/mira-hfm-learning-evolution-bridge.test.js`
- `node tests/mira-hfm-learning-evolution-route-contract.test.js`
- `node tests/mira-hfm-learning-legacy-compatibility.test.js`
- `node tests/mira-hfm-learning-supabase-store.test.js`

The Supabase adapter test uses an injected mock PostgREST request. It does not contact Supabase. Local filesystem tests use a temporary directory. No production data is accessed.

VERSION=v0.2
PHASE8=PROPOSAL_BRIDGE_IMMUTABLE_REVIEW_AND_GATED_GENERATION_ADAPTER_IMPLEMENTED
CANONICAL_MEMORY_WRITES=0
AUTOMATIC_PROMOTION=0
AUTOMATIC_EXECUTION=0
LIVE_SUPABASE_MIGRATION=NOT_APPLIED
PRODUCTION_INTEGRATION=NOT_CERTIFIED


## Supabase production adapter

Migration source: `supabase/migrations/20261105110000_mira_hfm_learning_proposals.sql`.

Tables:
- `mira_hfm_learning_proposals`: immutable project-scoped proposal payloads.
- `mira_hfm_learning_proposal_reviews`: immutable one-review-per-proposal human decisions.
- `mira_hfm_learning_proposal_audit_events`: append-only stage/review audit records.

RLS is enabled. Public/anon/authenticated roles have no grants or policies. The service role receives SELECT/INSERT only; no UPDATE/DELETE is granted. The migration is source code only and has not been applied.

Production configuration selects the backend with `MIRA_HFM_LEARNING_PROPOSAL_BACKEND=supabase` and requires `MIRA_HFM_LEARNING_PROPOSAL_PRODUCTION_READY=true`, plus the existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the host's secret settings. Do not place secrets in source control or chat. The local backend is prohibited in production.

## Immutable human review

- Admin browser session must be authenticated, have role `admin`, and include a named username.
- `POST /proposals/:projectId/:proposalId/review` accepts only `APPROVE_FOR_MANUAL_HANDOFF` or `REJECT`, with a reason.
- A second different review is rejected. Identical retries can reconcile the audit event when the writer is idempotent.
- Review status never changes proposal trust state; `trustState=UNTRUSTED`, `canonicalMemoryWrites=0`, and `automaticExecution=false` remain enforced.
