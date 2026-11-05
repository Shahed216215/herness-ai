# Mira HFM v0.2 — Phase 6 Public Web Search Retrieval

Status: PUBLIC SEARCH RETRIEVAL TOOL, REGISTRY/POLICY INTEGRATION, OFFLINE DISPATCH CONTRACT TESTS IMPLEMENTED; LIVE SEARCH AND RENDER RUNTIME NOT CERTIFIED.
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
- Optional import into the existing separate UNTRUSTED research archive.
- Explicit status for provider unavailable, search miss, partial provider degradation, and collected untrusted evidence.
- Search failure is not interpreted as Memory deletion or data loss.

## Security and trust boundary

- Uses an injected web-search provider; production tool delegates to the repository's existing web_search tool.
- Does not fetch Facebook URLs, use Meta Graph API, log in, use cookies, scrape, or access Groups/private content.
- Accepted results must be standard HTTPS Facebook hosts and supported Page-bound profile/post paths.
- Search snippets and IDs are untrusted external evidence; exact ID presence is a relevance filter, not proof of authorship, truth, or source ownership.
- Imported results remain SOURCE_RECORDED / UNVERIFIED / PENDING_REVIEW in the Phase 4 Research Archive.
- No canonical HFM Memory write or trust promotion occurs.
- Provider keys/network execution are not used by offline tests.

## Runtime integration status

The tool is auto-discovered through tools/index.js. The dedicated execution policy must register the new tool as a read/research operation. This isolated tool is not yet wired into a separate HTTP route or independently validated through a full server generation cycle.

## Verification

Offline tests:
- `node tests/mira-hfm-public-web-retrieval.test.js`
- `node tests/mira-hfm-public-web-retrieval-runtime-integration.test.js`
- `node tests/mira-facebook-public-web-research.test.js`
- `node tests/mira-hfm-tool-registry-policy-parity.test.js`

The service test injects synthetic search results and an in-memory archive writer. The runtime integration test exercises the actual tool module and policy with injected providers, statically verifies automatic tool discovery and server generation-cycle dispatch, and avoids loading unrelated application dependencies. It does not execute the complete registry or real model dispatch. Neither test makes a live web request or real model call.

Status handling distinguishes:
- `SEARCH_PROVIDER_UNAVAILABLE`: no query succeeded.
- `DEGRADED_SEARCH_NO_EVIDENCE`: at least one query failed and no evidence was found by the successful queries.
- `NOT_FOUND_BY_PUBLIC_SEARCH`: all attempted queries succeeded but returned no matching public result.
- `DEGRADED_WITH_UNTRUSTED_EVIDENCE`: some queries failed but other queries returned evidence.
- `PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED`: evidence returned without provider errors.

A search miss or provider failure is never interpreted as deletion or data loss. Query-attempt counts reflect actual executed queries, including early termination when the result limit is reached.

Offline contract verification does not establish live search quality, production archive durability, a real model answer cycle, Render deployment, or independent source authorship.
