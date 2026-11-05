# Mira HFM v0.2 — Phase 9 Retrieval & Capacity Optimization

Status: ISOLATED RETRIEVAL OPTIMIZER, READ-ONLY ADAPTER CONTRACTS FOR EXISTING HFM CANONICAL/PUBLIC ARCHIVE/GROUP IMPORT INTERFACES, INJECTABLE MODEL TOKENIZER COUNTER, SYNTHETIC 1x/10x/100x BENCHMARKS AND PROMPT-INJECTION BOUNDARY REGRESSION ADDED; LIVE PROVIDER EXECUTION, DEPLOYED TOKENIZER CALIBRATION AND PRODUCTION CAPACITY NOT CERTIFIED.
Parent: Phase 8 learning/evolution integration branch.
Version: v0.2 only.

## Scope

Phase 9 adds an opt-in, dependency-injected, read-only retrieval optimizer. Existing canonical storage, provider adapters, Facebook retrieval, manual Group import, legacy Experience Retrieval and Phase 8 proposal workflows remain unchanged.

## Implemented contract

- Token-aware context selection uses a conservative UTF-8 byte heuristic (ceil(bytes / 3) + 4). This is not a model tokenizer and must be calibrated against the deployed model before production use.
- Multi-source retrieval uses caller-injected adapters. Each adapter receives only query, project scope, result limit and readOnly=true.
- `mira-hfm-retrieval-provider-adapters.js` supplies read-only wrappers for the existing authorized canonical HFM facade report, Facebook Public Research Archive lookup and manual Facebook Group Import retrieval service. Callers must inject the existing facade/service methods; the module creates no clients, reads no credentials and registers no automatic runtime hook.
- Canonical records are admitted only when the supplied facade report includes exactly one matching provenance item and `ELIGIBLE/AUTHORIZED_READ` decision, with `integrity.status=VERIFIED` and `lifecycle=ACTIVE`.
- Public archive results are restricted to the configured Page ID, exact project-ID token matches in source-linked public metadata, and HTTPS source URLs. They remain UNVERIFIED.
- Group results must match project and group scope and retain `SOURCE_RECORDED`, `UNVERIFIED`, `PENDING_REVIEW` boundaries. They remain untrusted.
- `createModelTokenizerCounter` accepts a synchronous encoder from the deployed model tokenizer. The optimizer can use this injected counter and reports the tokenizer model ID. The default remains an explicitly labelled UTF-8 heuristic.
- Project ID equality is mandatory. Foreign-project results are discarded.
- Lexical relevance ranking uses inverse-document-frequency weighting, title boost, query coverage and deterministic tie-breaks.
- Duplicate reduction uses project/memory identity, digest and normalized HTTPS source URL.
- Conflicting versions/digests for one memory identity are quarantined from results and reported as CONFLICT; no last-write-wins selection.
- Source failure is reported per source. Partial provider failure becomes DEGRADED; total source failure becomes FAILED; an empty result is EMPTY, not data loss.
- VERIFIED is preserved only when supplied by the source; all other trust labels normalize to UNVERIFIED. includeUnverified=false permits strict trusted-only selection.
- Results retain source ID/type, URL/reference, version, digest, trust state and lifecycle.
- Hard token budget and result-count caps apply. Items that exceed the remaining budget are skipped rather than truncated into potentially misleading evidence.

## Governance boundary

- The adapters are read-only wrappers. Invoking an injected Supabase archive lookup may perform a read-only network request; the adapter tests use in-memory mocks and make no live requests. No Facebook API call, storage write, canonical Memory mutation, trust promotion, learning execution or self-modification is performed by the adapters.
- Source adapters are injected by the caller; no default connector or automatic runtime hook is registered.
- External snippets remain untrusted evidence. Text found in a Memory record is data, never an instruction to override system, developer, project or user policy.
- The new prompt-injection regression test feeds hostile instruction-like text and adversarial provider fields through the optimizer. It verifies the content remains unchanged data, trust stays UNVERIFIED, non-schema action fields are not propagated, and no external action/canonical write occurs in the test harness.
- This regression does NOT prove that a downstream LLM prompt builder, tool router, or generation lifecycle safely isolates retrieved text. Downstream prompt-boundary/E2E testing remains NOT TESTED and must be independently implemented before runtime integration.
- Search failure is not evidence of deletion or data loss.
- Conflicts are surfaced, not silently merged.

## Capacity measurement

`measureCapacity` reports the ratio of observed record count to a declared baseline. The provider-adapter benchmark exercises synthetic 100-record (1x), 1,000-record (10x), and 10,000-record (100x) corpora, with three in-process samples per size and p50/p95 elapsed time reporting. This is a reproducible local algorithm benchmark only. It does not establish provider latency, production throughput, durability, storage quota, concurrency behavior, recall quality, failure/recovery behavior or 100x end-to-end capacity. The synthetic tokenizer used by tests is not the deployed model tokenizer.

## Offline verification

Run:
- `node tests/mira-hfm-phase9-retrieval-optimizer.test.js`
- `node tests/mira-hfm-phase9-provider-adapters-benchmark.test.js`
- `node tests/mira-hfm-phase9-prompt-injection-regression.test.js`

The tests use mock facade/archive/group services and synthetic in-memory adapters, including 100/1,000/10,000-record scale cases. They do not access local user data, Facebook, Google Drive, Supabase, Render, external APIs or production storage.

## Remaining work

1. Execute the adapters against the actual authorized local/HFM and Supabase provider instances only after explicit live-test authorization; the current tests use mocks.
2. Supply the exact deployed model tokenizer encoder and reserve prompt/system/tool overhead in the generation layer.
3. Run representative provider benchmarks at 1x/10x/100x and measure p50/p95 latency, memory, candidate recall, token use, concurrency and failure/recovery behavior.
4. Independently test the downstream prompt builder and tool router with hostile retrieved content; this test suite covers optimizer data handling only.
5. Integrate into the Mira generation lifecycle only after Phase 8 live Supabase integration and governance gates are completed.
6. Do not certify 100x end-to-end capacity until provider/runtime measured evidence exists.

VERSION=v0.2
PHASE9=RETRIEVAL_OPTIMIZER_AND_READ_ONLY_PROVIDER_ADAPTER_CONTRACTS_IMPLEMENTED
PROMPT_INJECTION_OPTIMIZER_BOUNDARY=REGRESSION_TEST_ADDED
DOWNSTREAM_PROMPT_ISOLATION=NOT_TESTED
LIVE_PROVIDER_EXECUTION=NOT_CERTIFIED
DEPLOYED_MODEL_TOKENIZER=NOT_CONFIGURED
SYNTHETIC_1X_10X_100X_BENCHMARK=ADDED
CAPACITY_100X_END_TO_END=NOT_VERIFIED
PRODUCTION=NOT_APPROVED
