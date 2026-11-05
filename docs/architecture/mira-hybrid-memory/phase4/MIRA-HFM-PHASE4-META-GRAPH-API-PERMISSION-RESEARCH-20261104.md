# MIRA HFM — Phase 4 Meta Graph API Permission Research (v0.2)

Date: 2026-11-04  
Status: RESEARCH_BASELINE_ONLY — NO LIVE API VALIDATION  
Branch: work/mira-hfm-v02-phase4-facebook-page-connector

## 1. Purpose and boundary

This note records public documentation research to inform a future Facebook Page connector. It does not authorize authentication, credential collection, OAuth, App Review submission, Page access, publishing, external reads, or persistent Memory writes.

The documentation content surfaced during research identifies Graph API v26.0 as the current version. Search-indexed renderings of Meta documentation were available, but the research environment did not independently authenticate to Meta developer tools or validate any app-specific permission grant. Recheck the live Meta developer portal before implementation.

## 2. Versioning

- Current Graph API version indicated by the versioning and changelog documentation: v26.0 (released 2026-07-29).
- Pin an explicit Graph API version in every future request; do not rely on an app-dashboard default or unversioned calls.
- Versioning policy allows versions to remain available for at least two years, but security/privacy changes may occur out of cycle.
- Do not hard-code v26.0 permanently. Store the chosen version in controlled configuration and define a review/upgrade process.

References:
- Meta for Developers — Platform Versioning: https://developers.facebook.com/docs/apps/versions/
- Meta for Developers — Graph API Changelog: https://developers.facebook.com/docs/graph-api/changelog/

## 3. Permission model — separate capabilities

The Pages permission reference indicates:

| Capability | Permission / feature indicated by documentation | Notes |
|---|---|---|
| Discover Pages managed by an identity | pages_show_list | Needed for Page selection/bootstrap flows. |
| Read Page-owned content and engagement | pages_read_engagement | Permission dependency for pages_manage_posts. |
| Create, edit and delete Page posts | pages_manage_posts | Depends on pages_read_engagement and pages_show_list; requires App Review/appropriate access for production use. |
| Read user-generated posts/comments on a Page | pages_read_user_content | Separate from reading Page-owned content; request only if that use case is actually required. |
| Read public Page posts not otherwise accessible | Page Public Content Access feature may be required | The Post reference describes additional conditions; do not infer public-read access from a Page ID alone. |

The Post reference also describes Page access token and Page-admin conditions for certain Page-post reads. Exact endpoint, Page type, visibility restrictions, actor role/tasks, app mode, access level and feature approval can change the effective requirements.

References:
- Meta for Developers — Permissions Reference: https://developers.facebook.com/docs/permissions/
- Meta for Developers — Post Graph API Reference: https://developers.facebook.com/docs/graph-api/reference/post/
- Meta for Developers — Page Graph API Reference: https://developers.facebook.com/docs/graph-api/reference/page/

## 4. Connector design consequences

1. READ and WRITE remain independent. Never infer READ from WRITE or WRITE from READ.
2. Model permission grants separately from Page task authorization and feature approvals.
3. A caller-supplied permission assertion is not independent proof. The existing connector correctly labels such evidence CALLER_SUPPLIED_NOT_INDEPENDENTLY_VERIFIED.
4. A future verifier must bind evidence to the exact app, actor, Page ID, operation, granted scopes, Page tasks, app access level and observation time.
5. Use least privilege. Do not request pages_read_user_content, pages_manage_engagement, insights, messaging, business_management or other scopes unless an explicitly approved feature requires them.
6. Public Page content access is not equivalent to unrestricted access to private, restricted, unpublished or user-generated content.
7. Keep tokens and app secrets out of source control, logs, browser/mobile clients and Memory records. Credential architecture requires a separate security review and explicit approval.
8. App Review, Advanced Access, Business Verification and Page task requirements must be checked against the exact intended deployment model before any live integration.

## 5. Implementation blockers / not verified

- No Meta app ID, Page ID, access token, app secret, OAuth session or user credential was supplied or used.
- No permission grant was checked.
- No Page task/role was checked.
- No App Review or Advanced Access status was checked.
- No live Graph API request was made.
- No endpoint contract, rate-limit header behavior, token lifecycle or retry behavior was exercised.
- No Facebook content was read or published.

Therefore:
- LIVE_PERMISSION_VERIFICATION=NOT_RUN
- LIVE_API_TEST=NOT_RUN
- AUTHENTICATED_TRANSPORT=NOT_IMPLEMENTED
- PRODUCTION_READINESS=NOT_CERTIFIED

## 6. Next safe implementation sequence

1. Keep the offline capability contract and manual fallback isolated.
2. Add a pure permission-evidence schema that distinguishes scopes, Page tasks, feature approval, app access level and Page binding without accepting a bare boolean as proof.
3. Add fixture-only tests for missing, extra, revoked, stale, mismatched and insufficient permissions.
4. Design a credential-provider interface that accepts opaque secret references only; do not implement secret storage or token exchange before explicit approval.
5. After informed approval, validate the exact Meta app and Page in a dedicated test environment, then implement one read-only operation before any write capability.
6. Keep publishing disabled until explicit write approval, idempotency/reconciliation design, and post-publication readback tests are accepted.

Version remains v0.2. This research note does not mark Phase 4 complete.


## 7. Offline permission evidence contract

Added `services/mira-facebook-page-permission-contract.js` and fixture tests. The evaluator requires an exact evidence schema and separately supplied expected app/actor/Page/operation context. It reports missing declared scopes, Page tasks and feature approvals; stale or future-dated evidence fails closed.

Operation profiles currently model:
- `READ_PAGE_OWNED`: `pages_read_engagement`.
- `READ_PUBLIC_PAGE_CONTENT`: explicit `PAGE_PUBLIC_CONTENT_ACCESS` feature approval.
- `READ_USER_CONTENT`: separate `pages_read_user_content` permission.
- `WRITE_PAGE_POST`: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, and `CREATE_CONTENT` Page task.

These are conservative connector planning profiles, not universal guarantees for every endpoint or app configuration. Reconfirm the exact endpoint-specific Meta permission reference before implementing transport.

The evaluator always returns:
- `evidenceTrust=CALLER_SUPPLIED_NOT_INDEPENDENTLY_VERIFIED`
- `authorizationState=NOT_AUTHORIZED_OFFLINE_EVIDENCE_ONLY`
- `mayCallApi=false`

It does not authenticate, parse tokens, make API calls, or grant authorization. Even complete caller-supplied fixture evidence cannot enable transport.


## 8. Version-pinned request planning

The offline permission contract now provides `buildMetaGraphRequestPlan`. It requires an explicit Graph API version and numeric target Page ID, returns the planned method/path/required permission profile, and refuses non-PUBLIC records for a future Page-post write plan.

Every plan is marked `REQUEST_PLAN_ONLY`, `transportEnabled=false`, `mayCallApi=false`, and `credentialIncluded=false`. No HTTP client, token injection, OAuth exchange, request execution, retry or write operation exists in this planner. Endpoint paths and field requirements must still be confirmed against the current version-specific Meta reference before transport implementation.
