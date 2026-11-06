# Mira SEO Agent v2 — Implementation and Capability Boundaries

Date: 2026-11-06
Status: OFFLINE SEO ENGINE ENHANCED; LIVE RESEARCH REMAINS GOVERNED; PRODUCTION NOT CERTIFIED

## What was already present

- Offline keyword intent classification for English and Bengali.
- User-supplied HTML, robots.txt and sitemap analysis.
- Governed public web research behind a named Admin session, feature flag, explicit request confirmation and persisted client consent.
- Marketing workflow composition, content calendar/persona generation and structural quality review.
- Workflow history and versioned human review decisions.
- Review approval does not authorize website edits or publication.

## v2 changes

The offline audit engine now additionally reports:

- HTML language, charset and responsive viewport metadata.
- Meta robots noindex/nofollow directives.
- Canonical URL syntax and optional same-origin comparison against a supplied page URL.
- Open Graph and Twitter Card field coverage.
- Hreflang alternate-link syntax diagnostics.
- JSON-LD parse validity and discovered @type labels (including @graph).
- Heading-level skips, internal/external anchor counts, nofollow count and malformed/missing href counts.
- Visible-word-count review heuristic.
- Duplicate and invalid sitemap loc diagnostics.
- Public search-evidence normalization now preserves provider result order, extracts normalized source domains, flags repeated URLs/domains, and reports exact-token query overlap as a clearly labelled heuristic.
- Severity-labelled findings and a larger deterministic checklist.

The optional pageUrl is parsed locally only. It is never fetched. The audit and its tests perform no network requests.

## Interpretation and limitations

- The checklist score is structural diagnostic coverage, not a Google ranking score.
- A low visible-word count is only a review prompt; it is not a universal ranking threshold.
- JSON-LD is checked for JSON syntax and @type labels, not full Schema.org vocabulary or rich-result eligibility.
- Hreflang checks are syntactic and do not verify reciprocal alternate URLs.
- Link counts do not test HTTP status, redirects, crawlability or rendered DOM.
- Regex-based HTML extraction is intentionally bounded and is not a full browser parser.
- Keyword intent classification is heuristic. It does not establish real SERP intent, search volume, CPC, keyword difficulty or ranking opportunity.
- Current public research uses the existing governed web_search execution. Evidence diagnostics describe provider-returned result order, source-domain repetition and lexical query overlap; they do not certify organic SERP rank, competitor market share or source authority. The workflow does not yet provide a calibrated multi-competitor SERP dataset, reliable volume/difficulty metrics or Google Search Console performance data.
- Core Web Vitals, rendered JavaScript, backlinks, crawl-depth/site-wide link graphs and live HTTP diagnostics are not implemented in this offline engine.

## Remaining work — separate approval and evidence required

1. Add a safe, allowlisted website fetcher with DNS/IP rebinding protections, redirect limits, response-size/time limits, content-type checks and explicit client consent before any URL is fetched.
2. Build multi-competitor SERP extraction with source deduplication, result-position preservation, query-to-page mapping and evidence freshness.
3. Integrate Google Search Console only after OAuth scope, client ownership and read-only access are reviewed.
4. Add PageSpeed Insights / Core Web Vitals data with explicit API configuration, quotas, privacy review and clear field-vs-lab distinctions.
5. Add keyword volume/CPC/difficulty only from an identified provider with source attribution; never invent estimates.
6. Add full Schema.org validation and reciprocal hreflang/site-wide sitemap checks using reviewed libraries or provider-backed evidence.
7. Add semantic content brief scoring for intent coverage, factual sourcing, topical completeness and originality review without pretending to detect plagiarism conclusively.
8. Run a controlled non-production live test after explicit authorization; do not enable the feature flag or make external calls as part of offline CI.

## Safety boundary

No live provider request, website fetch, Google API call, client message, publication, website mutation, consent change, database migration, deployment or production change is performed by this v2 offline enhancement. Human review remains mandatory before client delivery or publication.
