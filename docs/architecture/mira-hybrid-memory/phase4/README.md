# Mira HFM v0.2 — Phase 4 Facebook Page Connector

Status: IMPLEMENTED AS AN ISOLATED, MOCK-TESTED CONNECTOR MODULE; SERVER ROUTE INTEGRATION AND LIVE META VERIFICATION NOT APPROVED.

## Scope

- Read capability probe: GET Page identity; only reports READ VERIFIED when the returned Page ID matches.
- Write capability: deliberately remains NOT_VERIFIED until a real, separately approved publish/readback workflow succeeds. Detection never publishes.
- Manual posting: generates a PENDING_MANUAL_POST draft; no browser automation or Facebook write.
- Automatic posting: requires the caller to pass approved: true. A successful POST returns PENDING_READBACK, never VERIFIED.
- Readback: retrieves the post and checks post ID and Page ownership when Meta supplies the author.
- URL import: accepts only HTTPS Facebook hostnames and supported numeric post ID URL patterns; then requires API readback.
- No canonical memory write. Research/source content remains external evidence and must be independently classified by the memory layer.

## Environment

- FACEBOOK_PAGE_ID
- FACEBOOK_PAGE_ACCESS_TOKEN
- META_GRAPH_API_VERSION (explicit version such as vXX.X; must be selected from Meta's currently supported versions)

Never commit tokens. Store them only in the deployment secret manager.

## Safety

The module uses the repository's secureProviderRequest transport by default (HTTPS, DNS pinning, no redirects, bounded response). Unit tests inject a mock request and make zero live network calls. Graph API read and publish operations are not run by tests.

## Current limitations

- No Express route is mounted yet.
- No Meta OAuth/token issuance or permission-grant flow is implemented.
- A non-mutating API probe cannot prove publish permission; write remains NOT_VERIFIED.
- The caller must separately authorize each publish action.
- Supported post URL parsing is intentionally narrow; unsupported permalink formats are rejected rather than guessed.
- No live Meta API verification, Page permission grant, deployment, or production certification has occurred.

## Test

Run: `node tests/mira-facebook-page-connector-test.js`

Expected output is mock-only and explicitly reports LIVE_FACEBOOK_REQUESTS=0.
