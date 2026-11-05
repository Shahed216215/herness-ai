# Mira HFM v0.2 — Phase 6 Public Web Search Retrieval

Status: PUBLIC SEARCH RETRIEVAL TOOL, REGISTRY/POLICY INTEGRATION AND OFFLINE DISPATCH CONTRACT TESTS IMPLEMENTED; LIVE SEARCH AND RENDER RUNTIME NOT CERTIFIED.
Parent: Phase 5 Facebook Group manual import branch.
Version: v0.2 only.

## Existing capability reconciliation

Phase 4 already supplies Facebook Page-ID-bound public search, Page profile/post URL normalization, an untrusted local/Supabase research archive, and lexical archive lookup. Phase 6 reuses those contracts; it does not replace or duplicate them.

## Phase 6 additions

- Search by exact Memory ID and/or Project ID, scoped to a required numeric Facebook Page ID.
- Optional phrase search.
- Public Facebook Page profile/post result filtering using the existing Phase 4 URL and Page-ID normalizer.
- Exact identifier presence in indexed title/snippet/source URL.
- Duplicate URL elimination and bounded results.
- Search results remain untrusted and are not automatically archived by the autonomous retrieval tool.
- Archive writing remains a separate operation and is not exposed through this autonomous read tool pending a separately governed human-approval workflow.
- Explicit status for provider unavailable, search miss, partial provider degradation, and collected untrusted evidence.
- Search failure is not interpreted as Memory deletion or data loss.

## Security and trust boundary

- Uses an injected web-search provider; production tool delegates to the repository's existing web_search tool.
- Does not fetch Facebook URLs, use Meta Graph API, log in, use cookies, scrape, or access Groups/private content.
- Accepted results must be standard HTTPS Facebook hosts and supported Page-bound profile/post paths.
- Search snippets and IDs are untrusted external evidence; exact ID presence is a relevance filter, not proof of authorship, truth, or source ownership.
- Mira's system instruction rejects prompt-injection text inside public search results and archive entries, prohibits automatic trusted/canonical Memory promotion, and requires search failure to remain distinct from data loss.
- The server returns tool results to the model as tool-role context for the answer-generation loop; the integration test statically verifies this return path and trust-policy contract.
- Results retain SOURCE_RECORDED / UNVERIFIED / PENDING_REVIEW semantics.
- The autonomous retrieval tool performs no archive write, canonical HFM Memory write, or trust promotion.
- Provider keys/network execution are not used by offline tests.

## Runtime integration status

The tool is auto-discovered through tools/index.js and registered as an autonomous read operation. The runtime integration test statically verifies server generation-cycle dispatch but does not execute the complete registry, real model dispatch, or a full server generation cycle. Archive writing is intentionally not exposed by this tool until a separate human-approved write path is implemented and tested.

## Verification

Offline tests:
- `node tests/mira-hfm-public-web-retrieval.test.js`
- `node tests/mira-hfm-public-web-retrieval-runtime-integration.test.js`
- `node tests/mira-facebook-public-web-research.test.js`
- `node tests/mira-hfm-tool-registry-policy-parity.test.js`

The service test injects synthetic search results and verifies the retrieval service is strictly read-only: archive imports are rejected before the provider is called, and normal retrieval always reports NOT_REQUESTED for archive writes. The runtime integration test exercises the actual autonomous tool module and policy with injected providers, verifies that the tool cannot trigger archive writes even if an extra importResults argument is supplied, statically verifies automatic tool discovery and server generation-cycle dispatch, and avoids loading unrelated application dependencies. It does not execute the complete registry or real model dispatch.

Latest observed Phase 6 GitHub Actions run before this scoped review correction: **41981363298**, completed SUCCESS on Node.js 24. The correction requires a fresh CI run before it can be considered verified. The workflow runs the retrieval service, tool/module and server-dispatch contract, existing Phase 4 public research/archive regression suite, and static tool-policy parity. Offline CI does not make a live web request or real model call.

Status handling distinguishes:
- `SEARCH_PROVIDER_UNAVAILABLE`: no query succeeded.
- `DEGRADED_SEARCH_NO_EVIDENCE`: at least one query failed and no evidence was found by the successful queries.
- `NOT_FOUND_BY_PUBLIC_SEARCH`: all attempted queries succeeded but returned no matching public result.
- `DEGRADED_WITH_UNTRUSTED_EVIDENCE`: some queries failed but other queries returned evidence.
- `PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED`: evidence returned without provider errors.

A search miss or provider failure is never interpreted as deletion or data loss. Query-attempt counts reflect actual executed queries, including early termination when the result limit is reached.

Offline contract verification does not establish live search quality, production archive durability, a real model answer cycle, Render deployment, or independent source authorship.

## Archive-write authority correction (2026-11-05)

The inherited facebook_page_public_research tool previously performed automatic writes to the separate untrusted research archive and was classified as autonomous. This conflicted with the Phase 6 decision that archive writes require a separately governed human-approved workflow. The Phase 6 branch now fails closed: the legacy archive-writing tool is marked non-autonomous and human-approval-required in the shared tool policy, and its own execute entrypoint enforces that policy before making a provider search or archive call. Direct archive service functions remain available to a future separately authenticated/approved workflow; no such workflow is exposed by this change. Regression coverage asserts the tool returns BLOCKED and performs zero search/archive calls. The new mira_hfm_public_web_retrieval remains autonomous read-only.

A fresh CI run verified the policy correction on commit 4d5eb779173e2f9e80797356c0ed269f145be5fc (run 41987528842). A further hardening change now makes the retrieval service itself strictly read-only: importResults=true is rejected before provider execution, and archiveEvidence is no longer accepted. This change was verified by CI run 41988078968 on commit ccc1d4c899e0e5f4c1a1c229a4910f46c44dc5eb; the phase6-offline-retrieval job completed SUCCESS. No live search, Supabase, Render, Facebook, archive write, or canonical Memory write was performed.

## Strict read-only service hardening (2026-11-05)

The retrieval service itself now defaults to importResults=false and rejects importResults=true with HFM_WEB_RETRIEVAL_ARCHIVE_WORKFLOW_NOT_IMPLEMENTED before any provider call. The service no longer accepts an archiveEvidence callback and always reports archive status NOT_REQUESTED. This closes the direct-service bypass that would otherwise remain available even though the autonomous tool was read-only. A separate human-approved archive-write workflow remains NOT_IMPLEMENTED and must not be inferred from the underlying Phase 4 archive storage primitives. The offline CI job passed for this hardening on 2026-11-05 (run 41988078968).
