# Phase 9 Execution Ledger — Mira HFM v0.2

Date: 2026-11-05
Repository: Shahed216215/herness-ai
Branch: work/mira-hfm-v02-phase7-emergency-backup
Status: IMPLEMENTATION_STARTED / CI_PENDING

## Entry 001 — Ephemeral project-scoped lexical retrieval index

- Added `services/mira-hfm-retrieval-index.js`.
- The service calls the HFM unified facade first; no record reaches tokenization or ranking before request authorization, per-record READ authorization, project/access filtering, ACTIVE/VERIFIED/trust eligibility and conflict quarantine.
- Builds an in-memory inverted index and BM25-style ranking. Supports Unicode/Bengali tokens, secret-like JSON field exclusion, source provenance and record digest, request/project/actor-bound index digest, deterministic tie-breaking, and hard bounds on records, tokens, terms, postings, query terms and result count.
- Search result does not return canonical content. Index is ephemeral; persistence is false. No embeddings, network, external vector database or canonical writes.
- Added `tests/mira-hfm-retrieval-index.test.js` and dedicated workflow `.github/workflows/mira-hfm-phase9-retrieval-index.yml`.
- Initial implementation needs CI evidence before PASS.
- Remaining: incremental invalidation/rebuild, load/performance characterization, concurrency/request expiry, multilingual relevance corpus, persistent-index provider contract (still no persistent writes).


## Entry 002 — Retrieval index CI and performance characterization

- CI run #7 / ID `42050327966`, URL https://github.com/Shahed216215/herness-ai/actions/runs/42050327966, commit `efe13db0c33c32e99c1ab10453a9a9599c0fdff5`, push event, conclusion SUCCESS.
- Job `phase9-ephemeral-retrieval-index` SUCCESS; logs retrieved and inspected.
- 1,000-record performance: p50 59.66 ms; p95 68.04 ms.
- 5,000-record performance: p50 255.02 ms; p95 379.93 ms.
- Process RSS delta during benchmark: 206.09 MiB.
- Request-context isolation, index digest binding, expired request rejection and source-change digest invalidation passed.
- Bengali search initially exposed a tokenizer bug: Bengali vowel signs are Unicode combining marks. Regex now includes `\\p{M}`; Bengali search marker passed.
- Performance test initially expected the wrong error message for an expired request context. The test now matches the existing HFM authorization contract; final run passed.
- Verified: `HFM_INDEX_1K_5K_PERFORMANCE_BOUNDS_PASS`, `HFM_INDEX_REQUEST_ISOLATION_AND_DIGEST_BINDING_PASS`, `HFM_INDEX_EXPIRED_REQUEST_BLOCK_PASS`, `TESTS_FAILED=0`, `NETWORK_REQUESTS=0`, `PERSISTENT_INDEX_WRITES=0`, `CANONICAL_MEMORY_WRITTEN=NO`, `CANONICAL_KNOWLEDGE_WRITTEN=NO`.
- Phase 9 synthetic contract gate: PASS. No persistent index or production integration is enabled.
