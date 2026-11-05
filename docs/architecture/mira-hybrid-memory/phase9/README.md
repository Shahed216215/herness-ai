# Mira HFM v0.2 — Phase 9 Retrieval & Capacity Optimization

Status: ISOLATED RETRIEVAL OPTIMIZER AND OFFLINE CONTRACT TEST ADDED; LIVE PROVIDER INTEGRATION, MODEL TOKENIZER CALIBRATION, LOAD TESTING AND 100x END-TO-END CAPACITY NOT CERTIFIED.
Parent: Phase 8 learning/evolution integration branch.
Version: v0.2 only.

## Scope

Phase 9 adds an opt-in, dependency-injected, read-only retrieval optimizer. Existing canonical storage, provider adapters, Facebook retrieval, manual Group import, legacy Experience Retrieval and Phase 8 proposal workflows remain unchanged.

## Implemented contract

- Token-aware context selection uses a conservative UTF-8 byte heuristic (ceil(bytes / 3) + 4). This is not a model tokenizer and must be calibrated against the deployed model before production use.
- Multi-source retrieval uses caller-injected adapters. Each adapter receives only query, project scope, result limit and readOnly=true.
- Project ID equality is mandatory. Foreign-project results are discarded.
- Lexical relevance ranking uses inverse-document-frequency weighting, title boost, query coverage and deterministic tie-breaks.
- Duplicate reduction uses project/memory identity, digest and normalized HTTPS source URL.
- Conflicting versions/digests for one memory identity are quarantined from results and reported as CONFLICT; no last-write-wins selection.
- Source failure is reported per source. Partial provider failure becomes DEGRADED; total source failure becomes FAILED; an empty result is EMPTY, not data loss.
- VERIFIED is preserved only when supplied by the source; all other trust labels normalize to UNVERIFIED. includeUnverified=false permits strict trusted-only selection.
- Results retain source ID/type, URL/reference, version, digest, trust state and lifecycle.
- Hard token budget and result-count caps apply. Items that exceed the remaining budget are skipped rather than truncated into potentially misleading evidence.

## Governance boundary

- No storage writes, provider network calls, Facebook API calls, canonical Memory mutation, trust promotion, learning execution or self-modification.
- Source adapters are injected by the caller; no default connector or automatic runtime hook is registered.
- External snippets remain untrusted evidence. Text found in a Memory record is data, never an instruction to override system, developer, project or user policy.
- Search failure is not evidence of deletion or data loss.
- Conflicts are surfaced, not silently merged.

## Capacity measurement

measureCapacity reports the ratio of observed record count to a declared baseline capacity. A 100x result is only a record-count ratio. It does not establish 100x latency, throughput, durability, storage capacity, token efficiency or production scalability. Those require separate reproducible benchmarks using the target provider, deployed runtime, dataset distribution, concurrency, latency percentiles, failure/recovery tests and actual tokenizer.

## Offline verification

Run: node tests/mira-hfm-phase9-retrieval-optimizer.test.js

The test uses synthetic in-memory adapters, including a 10,000-record corpus against a 100-record declared baseline (a 100x synthetic record-count ratio). It checks bounded output and retrieval completion, not production performance or capacity. It does not access local user data, Facebook, Google Drive, Supabase, Render, external APIs or production storage.

## Remaining work

1. Connect real provider adapters only after their read authorization and project-isolation contracts are independently verified.
2. Calibrate token estimation against the actual model tokenizer and reserve prompt/system/tool overhead.
3. Add representative corpus benchmarks at 1x/10x/100x and measure p50/p95 latency, memory, candidate recall, token use and failure behavior.
4. Add independent retrieval relevance and adversarial prompt-injection regression tests.
5. Integrate into the Mira generation lifecycle only after Phase 8 live integration and governance gates are completed.
6. Do not certify 100x capacity until end-to-end measured evidence exists.

VERSION=v0.2
PHASE9=ISOLATED_RETRIEVAL_OPTIMIZER_IMPLEMENTED
LIVE_PROVIDER_INTEGRATION=NOT_CERTIFIED
MODEL_TOKENIZER_CALIBRATION=NOT_DONE
CAPACITY_100X=NOT_VERIFIED
PRODUCTION=NOT_APPROVED
