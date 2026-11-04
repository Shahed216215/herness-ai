# MIRA HYBRID MEMORY
## Phase 4 — Facebook Page Connector Contract (v0.2)

Document ID: MIRA-HFM-PHASE4-FACEBOOK-PAGE-001
Status: IN PROGRESS — OFFLINE CONTRACT / MANUAL FALLBACK ONLY
Parent: MIRA-HFM Phase 3 Unified Memory Contract v0.2
Branch: work/mira-hfm-v02-phase4-facebook-page-connector

## 1. Scope and safety boundary

Phase 4 is the Facebook Page connector. This first implementation increment is an offline contract and manual workflow. It does not authenticate to Meta, access a Facebook Page, publish posts, fetch posts, or write canonical Memory.

No access token, app secret, OAuth credential, cookie, or private Page data may be committed or stored in Memory. Any later authenticated transport requires a separately approved credential-handling, permission, data-exposure and cost review.

## 2. Independent capability assessment

READ and WRITE are separate capabilities. A READ permission does not imply WRITE; a WRITE permission does not imply READ. Capability states are AVAILABLE, UNAVAILABLE, NOT_CONFIGURED, PERMISSION_DENIED, RATE_LIMITED and UNKNOWN.

Missing, stale, mismatched or incomplete evidence resolves to UNKNOWN or NOT_CONFIGURED. The current assessment accepts caller-supplied evidence only; it does not independently verify Meta permissions. It explicitly reports CALLER_SUPPLIED_NOT_INDEPENDENTLY_VERIFIED.

## 3. Manual posting fallback

A manual post draft can be generated only from a canonical record that is lifecycle ACTIVE, integrity VERIFIED and explicitly classified PUBLIC.

The result is PENDING_MANUAL_POST. The draft is not a published post. The user must review it, confirm Page visibility and ensure no restricted information is present before manual publication.

## 4. Manual URL import

Only HTTPS URLs on facebook.com, www.facebook.com or m.facebook.com using supported Page post permalink shapes are accepted. The supplied Page ID must match the expected Page ID.

URL parsing is local only. It does not establish that the post exists, is public, belongs to the Page, or still contains the supplied content. Imported content remains integrity UNVERIFIED, trust SOURCE_RECORDED, lifecycle PENDING_REVIEW and verification MANUAL_IMPORT_PENDING_INDEPENDENT_READBACK.

Manual content comparison may report a match or conflict, but it cannot promote the record to VERIFIED or trusted Memory. Mismatch must be quarantined/reviewed.

## 5. Automatic API operations

Automatic READ and WRITE are explicitly NOT_IMPLEMENTED_NO_LIVE_API_CALL. The Phase 4 adapter returns a fail-closed disposition even if caller-supplied capability evidence says AVAILABLE.

Future automatic transport must separately implement authenticated actor and Page binding, least-privilege scopes, access-token secrecy, permission revalidation, rate limits, timeouts, idempotency, uncertain-write reconciliation, provider revision handling, readback, source provenance and audit.

## 6. Acceptance status

|Requirement|Current status|
|---|---|
|Independent READ/WRITE capability assessment|IMPLEMENTED_OFFLINE_CONTRACT|
|Unknown/missing permission evidence fail-closed|IMPLEMENTED_OFFLINE_CONTRACT|
|Manual post draft generation|IMPLEMENTED — PUBLIC RECORDS ONLY|
|Manual post publication|MANUAL_USER_ACTION_NOT_PERFORMED|
|Page post URL shape validation|IMPLEMENTED_OFFLINE_ONLY|
|Manual import|IMPLEMENTED — UNVERIFIED / PENDING_REVIEW|
|Readback comparison|IMPLEMENTED — CANNOT_PROMOTE_TO_VERIFIED|
|Automatic READ / WRITE / UPDATE|NOT_IMPLEMENTED|
|Provider readback verification|NOT_IMPLEMENTED|
|Live Meta API permission verification|NOT_RUN|
|HFM persistent provider integration|NOT_IMPLEMENTED|
|Production migration / deployment|NOT_APPROVED|

## 7. Phase status

PHASE4=IN_PROGRESS
PHASE4_INCREMENT=OFFLINE_CAPABILITY_AND_MANUAL_FALLBACK
VERSION=v0.2
LIVE_META_API_CALLS=0
PRODUCTION_READINESS=NOT_CERTIFIED
