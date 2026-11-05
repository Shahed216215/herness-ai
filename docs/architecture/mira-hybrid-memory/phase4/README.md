# Mira HFM v0.2 — Phase 4 Facebook Page Connector

Status: IMPLEMENTATION COMPLETE IN THE FEATURE BRANCH. RUNTIME TESTING, META PERMISSION VERIFICATION, RENDER DEPLOYMENT, AND PRODUCTION CERTIFICATION ARE DEFERRED TO THE LATER DEPLOYMENT WINDOW.

## Scope implemented

- Read capability probe: GET Page identity; reports READ VERIFIED only when the returned Page ID matches.
- Write capability: remains NOT_VERIFIED until a separately approved publish/readback workflow succeeds. Capability detection never publishes and does not pretend a non-mutating probe can prove publishing permission.
- Manual posting: generates a PENDING_MANUAL_POST draft; no browser automation or Facebook write.
- Automatic posting: requires the admin route confirmation string and connector approval. A successful POST returns PENDING_READBACK, never VERIFIED.
- Readback: retrieves the post, checks the post ID, and requires Meta to return an author ID matching the configured Page. Missing or mismatched ownership is rejected.
- URL import: accepts only standard-port HTTPS Facebook hostnames and supported numeric post ID URL patterns; then requires API readback.
- No canonical memory write. Imported Facebook content remains external/untrusted evidence and must be independently classified by the memory layer.
- Admin routes are registered in server.js and protected by PERMISSIONS.SYSTEM_ADMIN.

## Admin API routes

Mounted under `/api/admin/facebook-page`:

- `GET /capabilities`
- `POST /draft`
- `POST /publish` (requires `confirmPublish: "PUBLISH_TO_FACEBOOK_PAGE"`)
- `POST /import-url`
- `POST /verify`

The publish route returns PENDING_READBACK; it does not claim verification.

## Environment

- `FACEBOOK_PAGE_ID`
- `FACEBOOK_PAGE_ACCESS_TOKEN`
- `META_GRAPH_API_VERSION` (an explicit version such as vXX.X; select a version currently supported by Meta)

Never commit tokens or place them in source files, URLs, logs, or test fixtures. Configure secrets only in the deployment secret manager. Do not paste secrets into chat.

## Safety

The module uses the repository's `secureProviderRequest` transport by default (HTTPS, DNS pinning, no redirects, bounded response). Tests inject mock requests/connectors and are designed to make zero live Facebook network calls. No live Meta API call or Facebook post was made during implementation.

## Tests and verification state

Included in the repository's `npm test` script:

- `node tests/mira-facebook-page-connector-test.js` — mock connector behavior, approval boundary, ownership verification, and URL validation.
- `node tests/mira-facebook-page-connector-route-test.js` — isolated route registration, SYSTEM_ADMIN guard mounting, publish confirmation boundary, and mock route behavior.

Test source and package-script inclusion have been inspected and confirmed. The tests have NOT been executed in this work session. Their runtime status is INCONCLUSIVE, not PASS. Run the repository test suite in the later Render-compatible verification window; mock tests must remain network-isolated.

## Deferred Render deployment and test checklist

Deployment is intentionally deferred at the user's request. Before deploying:

1. Confirm the intended Render service is connected to `Shahed216215/herness-ai` and branch `work/mira-hfm-v02-phase4-public-web-research`. The previously inspected Render service was connected to a different repository, `Shahed216215/ai-agent`; do not assume this feature branch is live there.
2. Confirm the correct service/root directory and build/start commands for this repository.
3. Add the three environment variables above through Render's secret/environment settings only. Never commit or disclose the Page access token.
4. Deploy only after reviewing the target service, branch, and environment configuration.
5. Run the mock tests in the deployed repository/build environment and capture actual output. A test must not contact Facebook.
6. Separately, only after explicit user approval, perform a minimal live Page read/capability check. Do not publish a real post as a permission test.
7. Verify any approved real post by readback. If author/Page ownership is absent or mismatched, keep status unverified.
8. Record deployment commit, test output, live-read result, and any remaining limitation. Do not label production certified unless all required evidence exists.

## Known limitations

- No Meta OAuth/token issuance or permission-grant flow is implemented.
- A non-mutating API probe cannot prove publish permission; write remains NOT_VERIFIED until an explicitly approved publish/readback flow is completed.
- The caller must separately authorize each publish action.
- Supported post URL parsing is intentionally narrow; unsupported permalink formats are rejected rather than guessed.
- No deployment, live Meta API verification, Page permission grant, or production certification has occurred.
