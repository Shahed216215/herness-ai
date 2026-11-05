# Mira HFM v0.2 — Phase 8 Learning & Evolution Integration

Status: PROJECT-ISOLATED PROPOSAL BRIDGE, ADMIN API, PUBLIC-RETRIEVAL EVIDENCE GATE, PRODUCTION FAIL-CLOSED GATE, READ-ONLY LEGACY COMPATIBILITY INSPECTOR AND OFFLINE TESTS IMPLEMENTED; DURABLE PRODUCTION INTEGRATION AND AUTOMATED ORCHESTRATION NOT CERTIFIED.

## Objective

Connect evidence held by Mira Hybrid Memory to Mira's learning/evolution workflow without silently converting retrieved information into trusted knowledge or allowing autonomous self-modification.

## First implementation slice

- Builds a bounded, versioned learning/evolution proposal from explicitly supplied evidence.
- Requires each evidence item to include evidence ID, project ID, source type, trust state, source reference and content.
- Enforces strict project isolation and rejects duplicate evidence IDs.
- Computes SHA-256 digests for evidence and the complete proposal.
- Stores proposals in a project-hash-partitioned local store using create-only file creation, restrictive permissions, fsync and read-after-write.
- Exposes an admin-only API for staging and reading proposals; the existing global autonomous-learning and Knowledge stores are not modified.
- Includes an adapter for the existing HFM public Facebook search-retrieval result format. It validates successful/degraded-evidence status, provider/mode/zero-canonical-write declarations, exact Page-ID-bound Facebook profile/post paths, source type, provenance state and credential-free HTTPS URLs, then forces every imported item to UNVERIFIED.
- Adds a read-only compatibility inspector for the existing Learning Engine, Experience Memory, Experience Retrieval, Knowledge Consolidation, and Evolution Snapshot/rollback interfaces. It checks legacy record integrity and snapshot verification without migrating, rewriting, deleting, rolling back, or calling Drive/network services. It also checks the indexed Facebook URL is bound to the reported numeric Page ID.
- Uses Mira's existing audit-log append/integrity path for non-production proposal-staging events; audit failure after persistence is surfaced as committed/reconciliation-required.
- Requires a named authenticated administrator browser session and records the actor ID in the audit event.
- Production mode fails closed: the local single-instance proposal store and local audit callback are never used as production fallbacks. Production requires an explicitly marked durable, cross-instance, project-isolated create-only store and a durable audit writer.
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
- The legacy compatibility inspector is an explicit read-only audit utility; it is not a live route and does not automatically import legacy records into HFM proposals.
- Evidence must be supplied to the admin API by a trusted caller; the API does not independently prove that a claimed public-web retrieval occurred.
- No live provider, model, network, deployment, migration or secret access.
- No change to Phase 7 emergency backup or routine Google Drive synchronization.

## Offline verification

Run: node tests/mira-hfm-learning-evolution-bridge.test.js

Admin API base: `/api/admin/mira-hfm-learning-evolution`
- `POST /proposals` stages explicitly supplied evidence.
- `POST /proposals/from-public-retrieval` adapts an existing HFM public retrieval result.
- `GET /proposals/:projectId/:proposalId` reads and re-verifies a stored proposal.

Tests use synthetic evidence and a temporary local filesystem adapter, including process-level reopen, immutable create-only behavior and stored-tamper detection. Additional offline tests verify the production fail-closed gate, named-admin attribution, public source/Page-ID binding, and read-only compatibility/integrity inspection of Learning, Experience, Knowledge Consolidation and Evolution snapshots.

Latest GitHub Actions run **41967451926: SUCCESS** (Node.js 24). The syntax gate and all three test suites passed. Logs report TESTS_FAILED=0, LIVE_NETWORK_CALLS=0, PRODUCTION_DATABASE_ADAPTER=0, no migration, no rollback, and zero canonical Memory writes. These are synthetic contract tests, not production data verification.

VERSION=v0.2
PHASE8=PROPOSAL_BRIDGE_AND_READ_ONLY_LEGACY_COMPATIBILITY_IMPLEMENTED
CANONICAL_MEMORY_WRITES=0
AUTOMATIC_PROMOTION=0
AUTOMATIC_EXECUTION=0
PRODUCTION_INTEGRATION=NOT_CERTIFIED


## Production readiness gate

The local proposal store explicitly advertises `durable=false` and `crossInstanceAtomicCreate=false`. In `NODE_ENV=production`, routes return `HFM_LEARNING_PRODUCTION_ADAPTER_NOT_CONFIGURED` unless an injected provider is explicitly marked production-ready and satisfies project isolation, create-only, immutable-version, read-after-write, durable, cross-instance atomic-create and durable-audit capabilities. The production fallback to ephemeral local files is prohibited.

The current branch contains no production HFM proposal database adapter or durable audit provider. Therefore the production route remains intentionally unavailable until those adapters are independently implemented and verified.
