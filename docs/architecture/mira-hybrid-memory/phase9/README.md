# Mira Hybrid Memory v0.2 — Phase 9: Retrieval, Indexing & Performance

Status: EPHEMERAL LEXICAL INDEX + PERFORMANCE/ISOLATION CONTRACTS IMPLEMENTED; CI PASS.

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


## Verification checkpoint — 2026-11-05

- CI run #7, ID `42050327966`, URL https://github.com/Shahed216215/herness-ai/actions/runs/42050327966, tested commit `efe13db0c33c32e99c1ab10453a9a9599c0fdff5`: SUCCESS. Job `phase9-ephemeral-retrieval-index` SUCCESS.
- Four suites passed: structural conflict assessment, unified HFM facade, project-scoped Work Learning retrieval, lexical retrieval index, plus the 1k/5k performance and isolation suite.
- Measured on GitHub Actions Node 24 runner:
  - 1,000 records: p50 `59.66 ms`, p95 `68.04 ms`.
  - 5,000 records: p50 `255.02 ms`, p95 `379.93 ms`.
  - RSS delta for the benchmark process: `206.09 MiB`.
- Verified markers: filter-before-index, BM25-style ranking, secret payload exclusion, Bengali/Unicode search, cross-project and host-DENY blocks, query/result bounds, source-digest invalidation, request isolation, expired-request rejection.
- Logs: `TESTS_FAILED=0`, `NETWORK_REQUESTS=0`, `PERSISTENT_INDEX_WRITES=0`, `CANONICAL_MEMORY_WRITTEN=NO`, `CANONICAL_KNOWLEDGE_WRITTEN=NO`.
- An earlier run failed because the Bengali tokenizer omitted Unicode combining marks. The tokenizer was corrected to include `\\p{M}`; the next run passed Bengali search. The performance run then failed only because the expiry assertion expected a different error string; the assertion was aligned to the HFM authorization contract and the next run passed.
- Phase 9 synthetic retrieval/index/performance gate: PASS. The index remains ephemeral and is rebuilt per request; persistent index, production source integration and external search services remain disabled.
