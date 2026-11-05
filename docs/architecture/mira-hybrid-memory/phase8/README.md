# Mira HFM v0.2 — Phase 8 Learning & Evolution Integration

Status: ISOLATED PROPOSAL-ONLY BRIDGE AND SYNTHETIC OFFLINE TESTS ADDED; PRODUCTION HFM/Evolution WIRING NOT CERTIFIED.

## Objective

Connect evidence held by Mira Hybrid Memory to Mira's learning/evolution workflow without silently converting retrieved information into trusted knowledge or allowing autonomous self-modification.

## First implementation slice

- Builds a bounded, versioned learning/evolution proposal from explicitly supplied evidence.
- Requires each evidence item to include evidence ID, project ID, source type, trust state, source reference and content.
- Enforces strict project isolation and rejects duplicate evidence IDs.
- Computes SHA-256 digests for evidence and the complete proposal.
- Stores proposals only through an injected adapter declaring project isolation, create-only semantics, immutable versions and read-after-write.
- Requires an audit-writer callback; actual durability and tamper resistance remain the host adapter's responsibility and are not certified here.
- Marks proposals PENDING_HUMAN_REVIEW and UNTRUSTED.
- Automatic trust promotion, execution, canonical Memory writes and self-modification are disabled.

## Trust and governance

- Trust labels are provenance states, not instructions or proof that evidence is true.
- Retrieved web/Facebook/imported content remains untrusted evidence. Prompt-like text inside evidence must never override system, developer, project or user policy.
- A proposal is a hypothesis for review, not a learned fact, approved policy, executable task or code patch.
- Human approval must be a separate authenticated governance action. This bridge exposes no approve, promote, execute, merge or apply method.
- Digests detect content changes; they do not authenticate the source or validate factual correctness.

## Adapter contract

A production adapter must provide project-scoped atomic create-only writes, immutable proposal versions and read-after-write verification. The host must separately prove durable, tamper-resistant audit emission. Current tests use an in-memory synthetic adapter and an in-memory audit callback only. No production database, durable audit provider or canonical Memory adapter is connected.

## Explicit exclusions

- No automatic learning/training, trust promotion, policy mutation, code generation/application, self-repair or self-modification.
- No canonical Memory writes or changes to existing Memory records.
- No server route, orchestration, runtime generation-cycle integration, UI or production store wiring in this slice.
- No live provider, model, network, deployment, migration or secret access.
- No change to Phase 7 emergency backup or routine Google Drive synchronization.

## Offline verification

Run: node tests/mira-hfm-learning-evolution-bridge.test.js

Tests use synthetic evidence, an in-memory adapter and an in-memory audit callback. They do not establish durable persistence, production audit durability, runtime integration, learning quality or production readiness.

VERSION=v0.2
PHASE8=PROPOSAL_ONLY_BRIDGE_IMPLEMENTED
CANONICAL_MEMORY_WRITES=0
AUTOMATIC_PROMOTION=0
AUTOMATIC_EXECUTION=0
PRODUCTION_INTEGRATION=NOT_CERTIFIED
