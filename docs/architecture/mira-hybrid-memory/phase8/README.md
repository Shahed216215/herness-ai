# Mira HFM v0.2 — Phase 8 Learning & Evolution Integration

Status: PROJECT-ISOLATED LOCAL PROPOSAL STORE, ADMIN API AND OFFLINE TESTS ADDED; AUTOMATED HFM RETRIEVAL-TO-LEARNING ORCHESTRATION NOT CERTIFIED.

## Objective

Connect evidence held by Mira Hybrid Memory to Mira's learning/evolution workflow without silently converting retrieved information into trusted knowledge or allowing autonomous self-modification.

## First implementation slice

- Builds a bounded, versioned learning/evolution proposal from explicitly supplied evidence.
- Requires each evidence item to include evidence ID, project ID, source type, trust state, source reference and content.
- Enforces strict project isolation and rejects duplicate evidence IDs.
- Computes SHA-256 digests for evidence and the complete proposal.
- Stores proposals in a project-hash-partitioned local store using create-only file creation, restrictive permissions, fsync and read-after-write.
- Exposes an admin-only API for staging and reading proposals; the existing global autonomous-learning and Knowledge stores are not modified.
- Includes an adapter for the existing HFM public Facebook search-retrieval result format. It validates the provider/mode/zero-canonical-write declarations, page binding and HTTPS Facebook source URLs, then forces every imported item to UNVERIFIED. It also checks the indexed Facebook URL is bound to the reported numeric Page ID.
- Uses Mira's existing audit-log append/integrity path for proposal-staging events; audit failure after persistence is surfaced as committed/reconciliation-required.
- Requires an audit-writer callback. The production route uses the existing audit-log integrity chain; an HMAC anchor is conditional on the audit key being configured.
- Marks proposals PENDING_HUMAN_REVIEW and UNTRUSTED.
- Automatic trust promotion, execution, canonical Memory writes and self-modification are disabled.

## Trust and governance

- Trust labels are provenance states, not instructions or proof that evidence is true.
- Retrieved web/Facebook/imported content remains untrusted evidence. Prompt-like text inside evidence must never override system, developer, project or user policy.
- A proposal is a hypothesis for review, not a learned fact, approved policy, executable task or code patch.
- Human approval must be a separate authenticated governance action. This bridge exposes no approve, promote, execute, merge or apply method.
- Digests detect content changes; they do not authenticate the source or validate factual correctness.

## Adapter contract

The local adapter provides project-scoped create-only files and immutable proposal IDs on a single filesystem, with read-after-write and content-digest verification. It is not a distributed database and does not establish cross-instance atomicity on Render. The production route calls Mira's existing append-only audit log; its HMAC anchor is conditional on the configured audit key. No Supabase table, multi-instance coordination, canonical Memory adapter or automatic HFM archive reader is connected.

## Explicit exclusions

- No automatic learning/training, trust promotion, policy mutation, code generation/application, self-repair or self-modification.
- No canonical Memory writes or changes to existing Memory records.
- The admin route is registered in server.js. The `/proposals/from-public-retrieval` endpoint accepts an already-produced HFM public retrieval result; it does not execute a search itself and does not cryptographically attest that the supplied result came from the provider.
- No existing AI generation-cycle, retrieval tool, autonomous-learning queue, Knowledge store, or UI is wired to submit automatically.
- Evidence must be supplied to the admin API by a trusted caller; the API does not independently prove that a claimed public-web retrieval occurred.
- No live provider, model, network, deployment, migration or secret access.
- No change to Phase 7 emergency backup or routine Google Drive synchronization.

## Offline verification

Run: node tests/mira-hfm-learning-evolution-bridge.test.js

Admin API base: `/api/admin/mira-hfm-learning-evolution`
- `POST /proposals` stages explicitly supplied evidence.
- `POST /proposals/from-public-retrieval` adapts an existing HFM public retrieval result.
- `GET /proposals/:projectId/:proposalId` reads and re-verifies a stored proposal.

Tests use synthetic evidence and a temporary local filesystem adapter, including process-level reopen, immutable create-only behavior and stored-tamper detection. They do not establish Render multi-instance durability, Supabase persistence, automated retrieval orchestration, learning quality or production readiness.

VERSION=v0.2
PHASE8=LOCAL_PROJECT_ISOLATED_PROPOSAL_API_IMPLEMENTED
CANONICAL_MEMORY_WRITES=0
AUTOMATIC_PROMOTION=0
AUTOMATIC_EXECUTION=0
PRODUCTION_INTEGRATION=NOT_CERTIFIED
