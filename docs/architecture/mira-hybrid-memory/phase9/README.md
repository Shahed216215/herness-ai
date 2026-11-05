# Mira Hybrid Memory v0.2 — Phase 9: Retrieval, Indexing & Performance

Status: IMPLEMENTATION STARTED — EPHEMERAL LEXICAL INDEX CONTRACT ADDED — CI PENDING.

## Objective

Add a bounded, project-scoped retrieval index that ranks only records already authorized and proven eligible by the HFM unified facade. Keep indexing rebuildable and ephemeral until a separately approved persistent index design exists.

## Design

1. Request LIST authorization and per-record READ authorization are performed by `retrieveCanonicalRecordsWithReport`.
2. Project scope, access classification, lifecycle, integrity, trust eligibility and unresolved-conflict quarantine are applied before tokenization/indexing.
3. The Phase 9 index uses a local in-memory inverted index with BM25-style term scoring. It does not call embeddings, external vector databases or live APIs.
4. Work Learning JSON payloads are secret-field scanned and only task/lesson text is indexed. Secret-bearing JSON records are excluded.
5. Search results contain IDs, project, type, revision, classification, source provenance, digest, score and matched terms. Raw canonical content is not returned.
6. The index is request-scoped and ephemeral. Its digest binds algorithm version, project, actor, request ID and eligible source record digests. No index persistence or cross-project search is allowed.
7. Hard bounds: 5,000 eligible records, 5,000 tokens per record, 250,000 unique terms, 1,000,000 postings, 32 query terms and 50 results.

## Implemented

- `services/mira-hfm-retrieval-index.js`
- `tests/mira-hfm-retrieval-index.test.js`
- `.github/workflows/mira-hfm-phase9-retrieval-index.yml`

## Required tests

- Filter-before-index: host authorization, project/access scope, ACTIVE/VERIFIED/trusted state and conflict quarantine.
- Secret-bearing JSON exclusion.
- BM25-style deterministic ranking and source provenance.
- Bengali/Unicode tokenization.
- Cross-project request-context rejection and host DENY fail-closed.
- Query/result/index capacity bounds.
- Source revision/content change invalidates index digest.
- Zero network, persistent index writes and canonical writes.

## Remaining Phase 9 work

- Incremental index invalidation/rebuild plan with source revision and tombstone/conflict handling.
- Load/performance characterization with deterministic synthetic datasets (1k/5k records), p50/p95 timing and memory bounds.
- Concurrent request isolation and stale-index/request-expiry tests.
- Search quality regression corpus, multilingual relevance checks and tie-break determinism.
- Integration contract for future persistent index provider; persistent writes remain disabled until independent security review and explicit approval.

## Boundaries

No production source reads, live model calls, embeddings API, external vector database, persistent index, canonical Memory/Knowledge writes, migration, deletion, deployment or Evolution application.

Phase 9 can be marked synthetic-contract complete only after all tests and performance gates pass with commit-matched CI logs. Production readiness remains NOT_CERTIFIED until external infrastructure gates are reviewed.
