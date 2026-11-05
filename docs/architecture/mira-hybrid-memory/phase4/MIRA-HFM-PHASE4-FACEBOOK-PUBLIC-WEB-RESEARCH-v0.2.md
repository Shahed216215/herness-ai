# Mira HFM v0.2 — Facebook Public Web Research Mode

Status: IMPLEMENTATION CONTRACT / SEARCH-INDEX-ONLY\nOffline contract service and regression suite are included on the public-web-research branch.
Parent: Phase 4 Facebook Page connector
Target Page: Online canel — Page ID 118056109579206
Version: v0.2 (no v0.3 transition)

## Purpose

Provide a no-Meta-token fallback so Mira can discover publicly indexed information associated with the selected Facebook Page and prepare source-linked evidence for answering questions. This mode uses the repository's existing web-search provider through an injected function. It does not use a Meta Graph API token.

## Retrieval behavior

1. Validate the numeric Page ID.
2. Search for the exact Page ID and, when supplied, the Page name / known public Page URL.
3. Accept only standard HTTPS results on facebook.com, www.facebook.com or m.facebook.com.
4. Bind a result to the requested Page only when the exact numeric Page ID appears in the indexed URL, title or snippet. Supported URL-bound forms include numeric Page roots, profile.php?id=PAGE_ID, /pages/SLUG/PAGE_ID, and Page-ID-bound post permalink forms.
5. Accept only a Page root profile path or supported Page post permalink shape. Exclude groups, personal profiles and unrelated Facebook URLs.
6. Deduplicate results, cap result count and snippet length, and preserve source URL and observation time.
7. Return an evidence context suitable for a downstream answer generator. Every item remains SOURCE_RECORDED / UNVERIFIED / PENDING_REVIEW.
8. Expose facebook_page_public_research as a Mira tool, defaulting to the selected Page ID and name. It archives accepted snippets in a separate local research store.
9. Expose facebook_research_lookup as an offline retrieval tool. It searches the archive by Page ID and query, returning source URLs and explicit unverified status.
10. Both tools are auto-discovered by tools/index.js and their declarations are supplied to the AI generation loop in server.js; lookup guidance directs Mira to retrieve first and refresh public search only when no matching archive entry exists.
9. Expose facebook_research_lookup as an offline retrieval tool. It searches the archive by Page ID and query, returning source URLs and explicit unverified status.

## Hard boundaries

- No direct HTTP fetch of Facebook pages.
- No Facebook login, session cookies, browser automation, scraping, CAPTCHA/rate-limit bypass or private-content access.
- No Meta Graph API call, OAuth flow, Page Access Token or publishing permission.
- Search evidence is persisted in an isolated, append-only, owner-only local Research Archive, not in Canonical HFM Memory. Archive records remain UNTRUSTED_RESEARCH_ONLY / SOURCE_RECORDED / UNVERIFIED / PENDING_REVIEW.
- The default archive directory is `~/.mira/facebook-research-memory`; `MIRA_FACEBOOK_RESEARCH_MEMORY_DIR` can override it. The directory must be owner-only (0700), and files are owner-only (0600).
- Archive writes are immutable and idempotent, capped at 300 records per Page and 10,000 files per archive scan. No automatic pruning or trust promotion occurs.
- The archive contains bounded search-result snippets, titles, source URLs, timestamps and digests. It does not fetch or store full Facebook Page content, private content, credentials or cookies.
- The archive is local to the running Mira installation. It is not synchronized across devices or cloud instances unless the operator separately configures persistent storage.
- Research Archive entries must pass independent verification and a separate governed HFM promotion workflow before they can become Canonical Memory.
- Search provider configuration is separate from Meta credentials. The existing web-search integration may require its own provider key (for example, the configured Tavily key); without a configured provider, status is unavailable rather than pretending a search occurred.
- Search-engine snippets may be stale, incomplete, truncated or incorrectly attributed. Exact Page-ID presence is a minimum identity filter, not proof of authorship, ownership, current visibility or truth.

## Answer policy

Mira may answer from the evidence context only with explicit attribution and uncertainty. It must distinguish indexed public Page profile evidence, indexed Page post evidence, independent third-party corroboration, and unavailable / unverified details.

It must not state that it read the full Facebook profile or all Page posts when only search snippets were returned. If no Page-ID-bound result is found, it should ask for the public Page URL or report no indexed evidence.

## Acceptance

| Requirement | Status |
|---|---|
| Numeric Page ID validation | Implemented in isolated service |
| Search-provider injection | Implemented in isolated service and registered Mira tool |
| Exact Page-ID result binding | Implemented |
| Facebook HTTPS host allowlist | Implemented |
| Numeric, profile.php and pages-directory URL formats | Implemented and regression-tested |
| Page-root and Page-post path filtering | Implemented |
| Group / personal-profile exclusion | Implemented |
| Bounded snippets and result count | Implemented |
| Evidence provenance and untrusted status | Implemented |
| Direct Facebook fetch / login / cookies | Prohibited; zero in contract tests |
| Meta API token dependency | None |
| Isolated immutable UNTRUSTED research archive | Implemented; owner-only directory/files; capped and idempotent |
| Offline retrieval from research archive | Implemented via facebook_research_lookup |
| Canonical HFM Memory write | Not implemented / prohibited in this mode |
| Live search-provider execution | Not run by offline tests |
| Mira tool registration and explicit execution policy | Implemented; offline CI verified |
| Runtime auto-discovery and AI function declaration wiring | Verified by source inspection (`tools/index.js` → `server.js` `generate`) |
| End-to-end answer integration | Pending separate integration and verification |

VERSION=v0.2
PHASE4_PUBLIC_WEB_RESEARCH=UNTRUSTED_ARCHIVE_AND_RETRIEVAL_OFFLINE_CONTRACT
META_TOKEN_REQUIRED=NO
LIVE_SEARCH=NOT_RUN
CANONICAL_MEMORY_WRITE=NOT_ALLOWED
