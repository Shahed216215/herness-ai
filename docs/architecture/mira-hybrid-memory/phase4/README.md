# Mira HFM v0.2 — Phase 4 Facebook Page Connector

Status: IMPLEMENTED AS AN ISOLATED CONNECTOR AND ADMIN ROUTE SLICE. MOCK TESTS ARE INCLUDED BUT HAVE NOT BEEN EXECUTED IN THIS WORK SESSION. LIVE META VERIFICATION AND DEPLOYMENT ARE NOT APPROVED.

## Scope

- Read capability probe: GET Page identity; reports READ VERIFIED only when the returned Page ID matches.
- Write capability: remains NOT_VERIFIED until a separately approved publish/readback workflow succeeds. Capability detection never publishes.
- Manual posting: generates a PENDING_MANUAL_POST draft; no browser automation or Facebook write.
- Automatic posting: requires explicit route confirmation and connector approval. A successful POST returns PENDING_READBACK, never VERIFIED.
- Readback: retrieves the post and checks post ID and Page ownership when Meta supplies the author.
- URL import: accepts only HTTPS Facebook hostnames and supported numeric post ID URL patterns; then requires API readback.
- No canonical memory write. Research/source content remains external evidence and must be independently classified by the memory layer.

## Environment

- FACEBOOK_PAGE_ID
- FACEBOOK_PAGE_ACCESS_TOKEN
- META_GRAPH_API_VERSION (an explicit version such as vXX.X; select a version currently supported by Meta)

Never commit tokens. Store them only in the deployment secret manager.

## Safety

The module uses the repository's secureProviderRequest transport by default (HTTPS, DNS pinning, no redirects, bounded response). Tests inject mock requests/connectors and are designed to make zero live Facebook network calls. Graph API read and publish operations are not run by tests.

## Admin API routes

Mounted in server.js under `/api/admin/facebook-page` and protected by `PERMISSIONS.SYSTEM_ADMIN`:

- `GET /capabilities`
- `POST /draft`
- `POST /publish` (requires `confirmPublish: "PUBLISH_TO_FACEBOOK_PAGE"`)
- `POST /import-url`
- `POST /verify`

The publish route returns `PENDING_READBACK`; it does not claim verification.

## Current limitations

- The connector is integrated into the herness-ai branch only. Confirm the deployment repository and branch before any release; the previously inspected Render service was connected to a different repository.
- No Meta OAuth/token issuance or permission-grant flow is implemented.
- A non-mutating API probe cannot prove publish permission; write remains NOT_VERIFIED.
- The caller must separately authorize each publish action.
- Supported post URL parsing is intentionally narrow; unsupported permalink formats are rejected rather than guessed.
- No live Meta API verification, Page permission grant, deployment, or production certification has occurred.

## Tests

Included in the repository's `npm test` script:

- `node tests/mira-facebook-page-connector-test.js` — connector behavior with an injected mock transport.
- `node tests/mira-facebook-page-connector-route-test.js` — isolated route registration, admin guard mounting, publish confirmation boundary, and mock route behavior.

Expected mock test output includes `LIVE_FACEBOOK_REQUESTS=0`. Test inclusion is confirmed; execution must be performed in a compatible local/CI environment before marking tests PASS.
