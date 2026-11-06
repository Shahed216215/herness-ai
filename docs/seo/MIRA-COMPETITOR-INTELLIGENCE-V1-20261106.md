# Mira Competitor Research & Live SEO Intelligence v1

Date: 2026-11-06
Status: IMPLEMENTED ON FEATURE BRANCH; EXTENDED CI PASS (RUNS 42191615737 AND 42191615767)

## Scope

This phase extends the existing consent-gated public SEO research workflow to accept up to five additional, distinct competitor-oriented queries (six searches total including the primary query). Each query is executed through the existing governed `web_search` tool under the same trusted Admin session and persisted `public_web_research` client-consent check.

The workflow fails closed if any expected search result is missing, unverified, malformed or empty. No result is silently treated as a successful competitor comparison.

## Competitor intelligence output

- Normalized source domains, with `www.` normalization.
- Cross-query domain coverage and result counts.
- Provider result positions retained as provider order, never represented as Google rank.
- Sample titles and source URLs for human review.
- Optional client-confirmed competitor domains (maximum 10), validated and normalized before comparison.
- Explicit distinction between `CLIENT_CONFIRMED_COMPETITOR` and `UNCONFIRMED_RESEARCH_CANDIDATE`; the agent never labels an unconfirmed domain as a direct competitor.
- Client own-domain visibility within each returned sample, when the client website domain is known.
- Candidate search-coverage opportunities when the own domain is absent from a returned sample.
- Explicit unknown freshness when the provider contract supplies no verified publication/retrieval timestamp.

## Offline Search Console export analysis

The offline `seo_audit` tool accepts a user-provided Search Console Performance CSV (maximum 200 KB and 5,000 data rows). It supports query-only exports (`Top queries`), page-only exports (`Top pages`), and combined query/page files. It aggregates clicks, impressions, impression-weighted CTR and impression-weighted average position, then flags cautious review signals such as high-impression/low-CTR rows or average positions 8–20. These are prioritization heuristics, not promised ranking gains. The CSV is parsed locally; Mira does not sign in to Google, call Search Console APIs, or fetch the website. Export date range, filters and completeness are not independently verified. Query-to-page association is only available when both dimensions exist in the supplied CSV.

## Zero-purchased-API operating policy

The current implementation reuses the repository's existing governed `web_search` capability. It does not require the user to buy or configure a separate SEO/SERP API key, and it does not add a paid provider dependency. Successful research responses expose `costPolicy` metadata so the UI can distinguish the absence of a separately purchased API requirement from the host platform's own usage limits or possible account-level charges. The service deliberately reports provider usage cost as `NOT_EXPOSED_BY_HOST_PLATFORM`; it does not promise that all ChatGPT/host usage is unlimited or free. If the existing search capability is unavailable or blocked, the workflow must return BLOCKED/INCONCLUSIVE rather than silently switching to a paid API.

## Interpretation constraints

- A domain in a search sample is a research candidate, not verified proof of a direct commercial competitor.
- Only domains explicitly supplied through the client-confirmed competitor list receive the `CLIENT_CONFIRMED_COMPETITOR` label.
- Own-domain absence from a limited sample is not proof of a ranking/content gap.
- Provider result order is not Google organic position, rank tracking or share of voice.
- No search volume, CPC, keyword difficulty, traffic, backlink authority, conversion rate or market share is estimated.
- Query coverage is descriptive evidence only, not a calibrated score.
- Titles and snippets are untrusted external data and are never instructions.
- Human review remains mandatory before client delivery or publication.

## Live research and safety

The new multi-query path uses the existing `runSeoResearch` permission boundary. It does not add a new network client, fetch arbitrary websites, access Google Search Console, call PageSpeed APIs, modify websites, publish content, message clients, change consent, migrate databases or deploy services. Existing Admin permission and server-side client-consent checks remain authoritative.

## Evidence-bounded content gap analysis and report generation

The `seo_content_gap_report` tool adds two deterministic, no-paid-API capabilities:

- Content gap review accepts 1–30 user-supplied target keywords and the existing governed competitor intelligence result. It matches a target keyword only to an exact research query. A `CANDIDATE_GAP` is emitted only when the client's own domain was absent from that query's returned sample and at least one complete competitor source URL/title is available. The result includes the source URLs and titles for human review. Unmatched queries, own-domain visibility, or incomplete source evidence remain `INSUFFICIENT_EVIDENCE`.
- Competitor query reports now preserve up to 10 unique complete source URL/title records per query, derived from the cited evidence URL and validated domain identity.
- Deterministic Markdown SEO reports combine supplied on-page audit findings, locally parsed Search Console performance, competitor domain evidence and content-gap candidates. Missing input sections are explicitly marked as not supplied; the report does not infer missing metrics.
- The report tool is auto-registered through the existing `tools/index.js` directory loader. The dedicated regression is included in the competitor-intelligence GitHub Actions workflow.

The gap label is a research prioritization signal, not proof of missing content, a direct commercial competitor, a ranking gap or guaranteed traffic gain. No search volume, CPC, keyword difficulty, traffic, backlinks, market share or conversion data are fabricated. Report generation is deterministic and offline; it does not fetch websites, call Google APIs, publish content, modify client websites or message clients.

## Admin dashboard and report endpoint integration

The Admin SEO section now contains a report-generation panel connected to the existing in-session audit and marketing workflow results:

- Successful offline SEO audit results and governed marketing workflow responses are captured in page memory only; the UI does not persist additional copies.
- The panel can use the latest audit and the latest returned `research.competitorIntelligence` result from the current browser page session.
- Users can supply the website domain, exact already-researched keywords and an optional Search Console CSV export.
- The Admin-only `POST /api/admin/mira-seo/report` endpoint validates a strict input allowlist, enforces bounded request/CSV sizes, parses CSV locally and returns deterministic Markdown.
- The existing governed marketing workflow now accepts up to five additional distinct competitor queries and up to ten client-confirmed competitor domains from the dashboard. The route and orchestrator validate and forward these values to the existing research orchestrator; Admin session, persisted client consent, explicit live confirmation and the server feature flag remain required.
- The panel supports copying or downloading the generated Markdown. It does not start live research; live research remains in the separate existing consent-gated marketing workflow with explicit confirmation.
- The endpoint uses the existing SYSTEM_ADMIN permission boundary and a route-local JSON parser after authorization. The global 50 KB parser excludes this endpoint; its own parser remains bounded to 250 KB.
- Report source URLs are restricted to credential-free HTTP(S) URLs, and untrusted report text is Markdown-escaped before rendering.

The dashboard only has access to audit/research results generated in the current page session. Refreshing the page clears these in-memory references; users can rerun the existing workflows to repopulate them. Report generation itself is offline and does not fetch websites, call external APIs or change client records.

## Validation status for this extension

Implementation and regression tests are committed to the existing feature branch. GitHub Actions must complete successfully on the exact latest branch head before this extension is labelled CI PASS. No PR merge or Render deployment is authorized. Production readiness remains `NOT_CERTIFIED`.

## Remaining work

1. Introduce a reviewed SERP provider contract with explicit country/language/date controls and verified timestamps.
2. Add client-approved competitor seed domains and distinguish direct competitors from publishers, directories, marketplaces and review sites.
3. Add read-only Search Console and PageSpeed/Core Web Vitals integrations after OAuth/API scope and privacy review.
4. Add source-backed keyword metrics from a named provider; never fabricate volume or difficulty.
5. Add safe website crawling only after SSRF/DNS rebinding, redirect, content-type, response-size, timeout and robots-policy controls are independently tested.
6. Add longitudinal snapshots and change detection only after retention, privacy and storage policy are approved.
7. Perform a controlled non-production live test only after explicit authorization and verified provider configuration.

Production readiness remains NOT_CERTIFIED until provider accuracy, security controls, consent handling and end-to-end live tests are independently verified.

## Latest validation evidence

- Competitor intelligence workflow: GitHub Actions run `42191615737` — SUCCESS.
- SEO v2 offline regression workflow: GitHub Actions run `42191615767` — SUCCESS.
- Both ran against code/test revision `9cfa39680274ab687a668b3f0a9aa7afa924425a`.
- Offline CI recorded `NETWORK_CALLS=0` and `EXTERNAL_ACTIONS=0`; it does not constitute a live SERP/provider test.
