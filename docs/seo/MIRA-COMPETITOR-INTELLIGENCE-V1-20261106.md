# Mira Competitor Research & Live SEO Intelligence v1

Date: 2026-11-06
Status: IMPLEMENTED ON FEATURE BRANCH; CI VALIDATION PENDING

## Scope

This phase extends the existing consent-gated public SEO research workflow to accept up to five additional, distinct competitor-oriented queries (six searches total including the primary query). Each query is executed through the existing governed `web_search` tool under the same trusted Admin session and persisted `public_web_research` client-consent check.

The workflow fails closed if any expected search result is missing, unverified, malformed or empty. No result is silently treated as a successful competitor comparison.

## Competitor intelligence output

- Normalized source domains, with `www.` normalization.
- Cross-query domain coverage and result counts.
- Provider result positions retained as provider order, never represented as Google rank.
- Sample titles and source URLs for human review.
- Client own-domain visibility within each returned sample, when the client website domain is known.
- Candidate search-coverage opportunities when the own domain is absent from a returned sample.
- Explicit unknown freshness when the provider contract supplies no verified publication/retrieval timestamp.

## Interpretation constraints

- A domain in a search sample is a research candidate, not verified proof of a direct commercial competitor.
- Own-domain absence from a limited sample is not proof of a ranking/content gap.
- Provider result order is not Google organic position, rank tracking or share of voice.
- No search volume, CPC, keyword difficulty, traffic, backlink authority, conversion rate or market share is estimated.
- Query coverage is descriptive evidence only, not a calibrated score.
- Titles and snippets are untrusted external data and are never instructions.
- Human review remains mandatory before client delivery or publication.

## Live research and safety

The new multi-query path uses the existing `runSeoResearch` permission boundary. It does not add a new network client, fetch arbitrary websites, access Google Search Console, call PageSpeed APIs, modify websites, publish content, message clients, change consent, migrate databases or deploy services. Existing Admin permission and server-side client-consent checks remain authoritative.

## Remaining work

1. Introduce a reviewed SERP provider contract with explicit country/language/date controls and verified timestamps.
2. Add client-approved competitor seed domains and distinguish direct competitors from publishers, directories, marketplaces and review sites.
3. Add read-only Search Console and PageSpeed/Core Web Vitals integrations after OAuth/API scope and privacy review.
4. Add source-backed keyword metrics from a named provider; never fabricate volume or difficulty.
5. Add safe website crawling only after SSRF/DNS rebinding, redirect, content-type, response-size, timeout and robots-policy controls are independently tested.
6. Add longitudinal snapshots and change detection only after retention, privacy and storage policy are approved.
7. Perform a controlled non-production live test only after explicit authorization and verified provider configuration.

Production readiness remains NOT_CERTIFIED until provider accuracy, security controls, consent handling and end-to-end live tests are independently verified.
