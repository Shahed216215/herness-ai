# Mira HFM v0.2 — Phase 8 Learning & Evolution Integration

Status: PROJECT-ISOLATED PROPOSAL BRIDGE, LOCAL DEVELOPMENT STORE, SUPABASE STORE CONTRACT, ADMIN API, PUBLIC-RETRIEVAL AND LEGACY-LEARNING EVIDENCE ADAPTERS, PRODUCTION FAIL-CLOSED GATE, READ-ONLY LEGACY COMPATIBILITY INSPECTOR AND OFFLINE TESTS IMPLEMENTED. LIVE SUPABASE MIGRATION, DEPLOYMENT AND AUTOMATED GENERATION-CYCLE ORCHESTRATION NOT CERTIFIED.

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
- The production audit writer records proposal staging in Supabase and performs readback verification. Audit failure after proposal persistence is reported as committed/reconciliation-required.
- Admin-only API requires a named authenticated administrator browser session. It supports explicit evidence submission, HFM public retrieval evidence intake, legacy Learning Engine evidence intake, immutable review decisions and proposal readback.
- HFM public retrieval adapter validates the provider/mode, successful or degraded-evidence status, zero-canonical-write declarations, exact numeric Page-ID-bound Facebook paths, declared source type, provenance and credential-free HTTPS URL. Imported evidence is forced to UNVERIFIED.
- Legacy Learning Engine adapter reads one requested record through the existing read/verify interfaces, requires matching successful integrity evidence, screens candidate text for likely secrets, and maps lesson/improvement candidates into UNVERIFIED HFM evidence. It does not modify the legacy record.
- Read-only compatibility inspector checks Learning Engine, Experience Memory, Experience Retrieval, Knowledge Consolidation and Evolution Snapshot/rollback interfaces without migration, rewrite, deletion, rollback or Drive/network calls.
- Every proposal remains `PENDING_HUMAN_REVIEW` and `UNTRUSTED`. A named administrator may create one immutable `APPROVE_FOR_MANUAL_HANDOFF` or `REJECT` decision. Approval permits manual follow-up only; it does not promote trust, execute a learning action, change canonical Memory or modify code.

## Trust and governance

- Trust labels are provenance states, not instructions or proof that evidence is true.
- Retrieved web/Facebook and legacy learning content remains untrusted evidence. Prompt-like text inside evidence must never override system, developer, project or user policy.
- A proposal is a hypothesis for review, not a learned fact, approved policy, executable task or code patch.
- The current bridge exposes no approve, promote, execute, merge or apply method. A future governance phase must add a separate authenticated approval/review record before any controlled downstream application.
- Digests detect content changes; they do not authenticate the original source or prove factual correctness.
- Supabase service-role credentials are never returned to clients, written into proposal payloads, or logged by the adapter.

## API

Base: `/api/admin/mira-hfm-learning-evolution`

- `POST /proposals` — stage explicitly supplied evidence.
- `POST /proposals/from-public-retrieval` — adapt an already-produced HFM public retrieval result. It does not perform a search and cannot cryptographically prove the submitted report came from the provider.
- `POST /proposals/from-legacy-learning` — read and verify a requested legacy Learning Engine record, then stage its eligible candidates as untrusted evidence.
- `POST /proposals/:projectId/:proposalId/review` — record one named-admin `APPROVE_FOR_MANUAL_HANDOFF` or `REJECT` decision with a reason.
- `GET /proposals/:projectId/:proposalId` — read and re-verify a stored proposal and its optional review.

## Deployment and cost boundary

The implementation reuses the existing Supabase Free project and existing server-side Supabase environment variables; it introduces no paid vendor or paid API. The design target remains $0/month while usage stays within the existing free-tier quotas. Free-tier capacity, inactivity/pause behavior and storage limits still apply; exceeding a quota must not trigger a paid upgrade automatically.

The migration has been committed to the branch only. It has NOT been applied to the live Supabase project. No Supabase request, OAuth, credential read, deployment or live persistence/restart test was performed in this work. Do not set the production-ready flag until migration and live verification are explicitly authorized and completed.

## Remaining Phase 8 work

1. Apply the SQL migration in the approved Supabase project and verify RLS, grants, primary-key uniqueness and foreign-key behavior.
2. Run an authorized live integration test: insert, duplicate conflict, cross-project isolation, audit readback, restart/reconnect recovery and fail-closed behavior. This has not been done.
3. Wire proposal intake into the actual Mira generation/retrieval cycle under explicit governance, instead of requiring a trusted caller to submit the evidence payload.
4. Wire the approved manual handoff into the existing learning/evolution orchestration only after a separately scoped governance review; do not automatically apply canonical Memory changes.
5. Add UI visibility and independent end-to-end verification for the complete HFM → evidence → proposal → review → controlled learning path.
6. Verify Render instance/restart behavior and Supabase free-tier capacity without exceeding the $0/month constraint.

## Offline verification

- `node tests/mira-hfm-learning-evolution-bridge.test.js`
- `node tests/mira-hfm-learning-evolution-route-contract.test.js`
- `node tests/mira-hfm-learning-legacy-compatibility.test.js`
- `node tests/mira-hfm-learning-supabase-store.test.js`

The Supabase adapter test uses an injected mock PostgREST request. It does not contact Supabase. Local filesystem tests use a temporary directory. No production data is accessed.

VERSION=v0.2
PHASE8=PROPOSAL_BRIDGE_AND_SUPABASE_ADAPTER_IMPLEMENTED
CANONICAL_MEMORY_WRITES=0
AUTOMATIC_PROMOTION=0
AUTOMATIC_EXECUTION=0
LIVE_SUPABASE_MIGRATION=NOT_APPLIED
PRODUCTION_INTEGRATION=NOT_CERTIFIED
