# Mira HFM v0.2 — Phase 6 Public Web Search Retrieval

Status: ISOLATED SEARCH-INDEX RETRIEVAL AND OFFLINE TESTS ADDED; END-TO-END RUNTIME WIRING AND LIVE SEARCH NOT CERTIFIED.
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

Run: node tests/mira-hfm-public-web-retrieval.test.js

The offline test injects synthetic search results and an in-memory archive writer. It does not establish live search quality, archive durability beyond the existing Phase 4 provider tests, production deployment, or complete E2E answer integration.
