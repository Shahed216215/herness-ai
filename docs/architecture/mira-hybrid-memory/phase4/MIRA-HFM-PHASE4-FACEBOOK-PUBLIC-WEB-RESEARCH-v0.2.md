# Mira HFM v0.2 — Facebook Public Web Research Mode

Status: IMPLEMENTATION CONTRACT / SEARCH-INDEX-ONLY
Parent: Phase 4 Facebook Page connector
Target Page: Online canel — Page ID 118056109579206
Version: v0.2 (no v0.3 transition)

## Purpose

Provide a no-Meta-token fallback so Mira can discover publicly indexed information associated with the selected Facebook Page and prepare source-linked evidence for answering questions. This mode uses the repository's existing web-search provider through an injected function. It does not use a Meta Graph API token.

## Retrieval behavior

1. Validate the numeric Page ID.
2. Search for the exact Page ID and, when supplied, the Page name / known public Page URL.
3. Accept only standard HTTPS results on facebook.com, www.facebook.com or m.facebook.com.
4. Bind a result to the requested Page only when the exact numeric Page ID appears in the indexed URL, title or snippet.
5. Accept only a Page root profile path or supported Page post permalink shape. Exclude groups, personal profiles and unrelated Facebook URLs.
6. Deduplicate results, cap result count and snippet length, and preserve source URL and observation time.
7. Return an evidence context suitable for a downstream answer generator. Every item remains SOURCE_RECORDED / UNVERIFIED / PENDING_REVIEW.

## Hard boundaries

- No direct HTTP fetch of Facebook pages.
- No Facebook login, session cookies, browser automation, scraping, CAPTCHA/rate-limit bypass or private-content access.
- No Meta Graph API call, OAuth flow, Page Access Token or publishing permission.
- No automatic persistent Memory write. The report is ephemeral, source-linked and untrusted; it must pass human review and independent verification before any governed HFM promotion.
- Search provider configuration is separate from Meta credentials. The existing web-search integration may require its own provider key (for example, the configured Tavily key); without a configured provider, status is unavailable rather than pretending a search occurred.
- Search-engine snippets may be stale, incomplete, truncated or incorrectly attributed. Exact Page-ID presence is a minimum identity filter, not proof of authorship, ownership, current visibility or truth.

## Answer policy

Mira may answer from the evidence context only with explicit attribution and uncertainty. It must distinguish indexed public Page profile evidence, indexed Page post evidence, independent third-party corroboration, and unavailable / unverified details.

It must not state that it read the full Facebook profile or all Page posts when only search snippets were returned. If no Page-ID-bound result is found, it should ask for the public Page URL or report no indexed evidence.

## Acceptance

| Requirement | Status |
|---|---|
| Numeric Page ID validation | Implemented in isolated service |
| Search-provider injection | Implemented in isolated service |
| Exact Page-ID result binding | Implemented |
| Facebook HTTPS host allowlist | Implemented |
| Page-root and Page-post path filtering | Implemented |
| Group / personal-profile exclusion | Implemented |
| Bounded snippets and result count | Implemented |
| Evidence provenance and untrusted status | Implemented |
| Direct Facebook fetch / login / cookies | Prohibited; zero in contract tests |
| Meta API token dependency | None |
| Canonical HFM Memory write | Not implemented / prohibited in this mode |
| Live search-provider execution | Not run by offline tests |
| End-to-end answer integration | Pending separate integration and verification |

VERSION=v0.2
PHASE4_PUBLIC_WEB_RESEARCH=OFFLINE_CONTRACT
META_TOKEN_REQUIRED=NO
LIVE_SEARCH=NOT_RUN
CANONICAL_MEMORY_WRITE=NOT_ALLOWED
