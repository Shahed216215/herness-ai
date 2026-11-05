# Mira HFM v0.2 — Phase 6 Public Web Search Retrieval

Status: PUBLIC SEARCH RETRIEVAL TOOL, REGISTRY/POLICY INTEGRATION AND OFFLINE DISPATCH CONTRACT TESTS IMPLEMENTED; LIVE SEARCH AND RENDER RUNTIME NOT CERTIFIED.
Parent: Phase 5 Facebook Group manual import branch.
Version: v0.2 only.

## Existing capability reconciliation

Phase 4 already supplies Facebook Page-ID-bound public search, Page profile/post URL normalization, an untrusted local/Supabase research archive, and lexical archive lookup. Phase 6 reuses those contracts; it does not replace or duplicate them.

## Phase 6 additions

- Search by exact Memory ID and/or Project ID, scoped to a required numeric Facebook Page ID.
- Optional phrase search.
- Public Facebook Page profile/post result filtering using the existing Phase 4 URL and Page-ID normalizer.
- Exact identifier presence in indexed title/snippet/source URL.
- Duplicate URL elimination and bounded results.
- Search results remain untrusted and are not automatically archived by the autonomous retrieval tool.
- Archive writing remains a separate operation and is not exposed through this autonomous read tool pending a separately governed human-approval workflow.
- Explicit status for provider unavailable, search miss, partial provider degradation, and collected untrusted evidence.
- Search failure is not interpreted as Memory deletion or data loss.

## Security and trust boundary

- Uses an injected web-search provider; production tool delegates to the repository's existing web_search tool.
- Does not fetch Facebook URLs, use Meta Graph API, log in, use cookies, scrape, or access Groups/private content.
- Accepted results must be standard HTTPS Facebook hosts and supported Page-bound profile/post paths.
- Search snippets and IDs are untrusted external evidence; exact ID presence is a relevance filter, not proof of authorship, truth, or source ownership.
- Mira's system instruction rejects prompt-injection text inside public search results and archive entries, prohibits automatic trusted/canonical Memory promotion, and requires search failure to remain distinct from data loss.
- The server returns tool results to the model as tool-role context for the answer-generation loop; the integration test statically verifies this return path and trust-policy contract.
- Results retain SOURCE_RECORDED / UNVERIFIED / PENDING_REVIEW semantics.
- The autonomous retrieval tool performs no archive write, canonical HFM Memory write, or trust promotion.
- Provider keys/network execution are not used by offline tests.

## Runtime integration status

The tool is auto-discovered through tools/index.js and registered as an autonomous read operation. The runtime integration test statically verifies server generation-cycle dispatch but does not execute the complete registry, real model dispatch, or a full server generation cycle. Archive writing is not exposed by the autonomous retrieval tool. A separate named-admin, explicit-confirmation endpoint now performs reviewed imports through global policy and append-only audit.

## Verification

Offline tests:
- `node tests/mira-hfm-public-web-retrieval.test.js`
- `node tests/mira-hfm-public-web-retrieval-runtime-integration.test.js`
- `node tests/mira-facebook-public-web-research.test.js`
- `node tests/mira-hfm-tool-registry-policy-parity.test.js`

The service test injects synthetic search results and verifies the retrieval service is strictly read-only: archive imports are rejected before the provider is called, and normal retrieval always reports NOT_REQUESTED for archive writes. The runtime integration test exercises the actual autonomous tool module and policy with injected providers, verifies that the tool cannot trigger archive writes even if an extra importResults argument is supplied, statically verifies automatic tool discovery and server generation-cycle dispatch, and avoids loading unrelated application dependencies. It does not execute the complete registry or real model dispatch.

Latest observed Phase 6 GitHub Actions run before this scoped review correction: **41981363298**, completed SUCCESS on Node.js 24. The correction requires a fresh CI run before it can be considered verified. The workflow runs the retrieval service, tool/module and server-dispatch contract, existing Phase 4 public research/archive regression suite, and static tool-policy parity. Offline CI does not make a live web request or real model call.

Status handling distinguishes:
- `SEARCH_PROVIDER_UNAVAILABLE`: no query succeeded.
- `DEGRADED_SEARCH_NO_EVIDENCE`: at least one query failed and no evidence was found by the successful queries.
- `NOT_FOUND_BY_PUBLIC_SEARCH`: all attempted queries succeeded but returned no matching public result.
- `DEGRADED_WITH_UNTRUSTED_EVIDENCE`: some queries failed but other queries returned evidence.
- `PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED`: evidence returned without provider errors.

A search miss or provider failure is never interpreted as deletion or data loss. Query-attempt counts reflect actual executed queries, including early termination when the result limit is reached.

Offline contract verification does not establish live search quality, production archive durability, a real model answer cycle, Render deployment, or independent source authorship.

## Archive-write authority correction (2026-11-05)

The inherited facebook_page_public_research tool previously performed automatic writes to the separate untrusted research archive and was classified as autonomous. This conflicted with the Phase 6 decision that archive writes require a separately governed human-approved workflow. The Phase 6 branch now fails closed: the legacy archive-writing tool is marked non-autonomous and human-approval-required in the shared tool policy, and its own execute entrypoint enforces that policy before making a provider search or archive call. The separate named-admin archive import route is now exposed at POST /api/admin/facebook-research-archive/import and requires the exact confirmation phrase, global file_modify approval, and audit records. Regression coverage asserts the tool returns BLOCKED and performs zero search/archive calls. The new mira_hfm_public_web_retrieval remains autonomous read-only.

A fresh CI run verified the policy correction on commit 4d5eb779173e2f9e80797356c0ed269f145be5fc (run 41987528842). A further hardening change now makes the retrieval service itself strictly read-only: importResults=true is rejected before provider execution, and archiveEvidence is no longer accepted. This change was verified by CI run 41988078968 on commit ccc1d4c899e0e5f4c1a1c229a4910f46c44dc5eb; the phase6-offline-retrieval job completed SUCCESS. No live search, Supabase, Render, Facebook, archive write, or canonical Memory write was performed.

## Strict read-only service hardening (2026-11-05)

The retrieval service itself now defaults to importResults=false and rejects importResults=true with HFM_WEB_RETRIEVAL_ARCHIVE_WORKFLOW_NOT_IMPLEMENTED before any provider call. The service no longer accepts an archiveEvidence callback and always reports archive status NOT_REQUESTED. This closes the direct-service bypass that would otherwise remain available even though the autonomous tool was read-only. A separate human-approved archive-write workflow is IMPLEMENTED as an admin-only endpoint; the autonomous retrieval tool remains read-only. The offline CI job passed for this hardening on 2026-11-05 (run 41988078968).

## Page URL binding regression correction (2026-11-05)

The Page URL validator normalizes query parameters away for storage, but the binding check must inspect the originally supplied URL before normalization. A valid profile.php?id=<selected Page ID> URL was previously rejected because the query parameter had already been stripped. The validator now checks the original query value while still returning the normalized URL, and regression coverage verifies both a matching and mismatching Page ID. The matching/mismatching Page-ID regression passed on commit c672e69de9c980ddb6aeb7c57d50a7317f8b1104 (CI run 41988212407).

## Explicitly gated live-provider smoke harness (2026-11-05)

Added scripts/mira-hfm-phase6-live-provider-smoke.js. By default it performs zero network calls. It requires the explicit --confirm-live CLI flag and a non-empty TAVILY_API_KEY before it makes exactly one fixed, non-user-specific Tavily query. Output contains only connection status, result count, and HTTPS host summaries; it never prints the API key, snippets, or raw provider payload. The harness asserts zero archive and canonical-memory writes. Its offline regression test covers no-confirmation, missing-key, one-call, redaction, and failure behavior without making a live request. Example: `node scripts/mira-hfm-phase6-live-provider-smoke.js` is offline; `node scripts/mira-hfm-phase6-live-provider-smoke.js --confirm-live` makes one real provider request and must only be run after separate explicit authorization and cost/config review. The script does not test AI model generation or deployed Render routing.

## Human-approved archive import workflow (2026-11-05)

A separate admin-only import endpoint is now implemented at POST /api/admin/facebook-research-archive/import. It requires the existing SYSTEM_ADMIN permission plus a named authenticated admin browser session (session role admin and non-empty username), and the exact confirmation field confirmArchiveImport=ARCHIVE_UNTRUSTED_RESEARCH_EVIDENCE. It accepts only 1–10 evidence records and delegates to the existing archive provider, whose validators enforce Facebook Page binding and untrusted-only metadata. The workflow passes the global file_modify policy with permissionGranted=true and approved=true, records approval intent before the write and records the verified outcome after readback. Audit failure before write blocks the write; post-write audit failure is returned as ARCHIVE_WRITE_VERIFIED_AUDIT_INCOMPLETE with stateCommitted=true so the caller is warned not to blindly retry. The endpoint is not registered as an AI tool and cannot be called by autonomous model dispatch. It never writes canonical Memory or promotes trust. Offline route/service regression coverage passed in Phase 6 CI runs 41988783821 and 41988792329 on commit 9fc3cbaad2070cac50a3b139ec0170b8ecc8fa20. No live archive write or Supabase request was performed.

## Production storage and Render bind-host safeguards (2026-11-05)

The approved archive workflow now blocks production local-backend writes unless MIRA_FACEBOOK_RESEARCH_MEMORY_DURABLE_STORAGE_CONFIRMED=true is explicitly configured after verifying a persistent mount. A production Supabase backend remains subject to its HTTPS project URL, service-role configuration, secure provider transport, and readback checks. This prevents an unverified ephemeral local filesystem from being treated as durable archive storage. Added services/mira-server-bind-host.js: production NODE_ENV selects 0.0.0.0 for platform ingress; development/test defaults to 127.0.0.1. server.js now uses this resolver. Offline tests cover both host modes and the production-local-storage fail-closed guard. CI run 41989039484 (code commit 6effa516fad28c668ed5824cc90cef72f3889195) and run 41989052454 (documentation-updated head 47299704b35cb4ff18cfc7bfc583cb1cdcdfb4a4) completed SUCCESS.

## Secret-safe Render deployment preflight (2026-11-05)

Added scripts/mira-hfm-phase6-deployment-preflight.js. It performs no network requests and prints only PASS/FAIL/REVIEW_REQUIRED checks, never secret values. It checks Node.js 24+, NODE_ENV=production, MIRA_SESSION_SECRET length, production bind host, Tavily key presence, selected AI provider credential/model readiness, and archive backend durability/configuration. A local archive backend in production is blocked unless MIRA_FACEBOOK_RESEARCH_MEMORY_DURABLE_STORAGE_CONFIRMED=true; Supabase configuration is structurally validated without sending a request. Custom AI providers remain REVIEW_REQUIRED. Run in the deployed service shell before any live test: `node scripts/mira-hfm-phase6-deployment-preflight.js`. A READY_FOR_LIVE_TEST result is configuration preflight only, not proof of live provider access, deployment health, or successful model generation. CI pending.

The preflight additionally requires an explicit model ID for OpenAI, Anthropic, and xAI; supported providers with code-defined defaults are checked accordingly. Managed OpenAI credentials are inspected only for presence/model availability and are never printed. CI coverage includes missing and configured OpenAI model cases.

## Latest offline verification (2026-11-05)

The full Phase 6 offline workflow, including the strict read-only retrieval service, named-admin archive approval, production storage guard, production bind-host selection, live-provider smoke confirmation gate, secret-safe deployment preflight, and OpenAI model readiness checks, completed SUCCESS on exact head commit fe8e24b55014133bfe8440014138c74a1df01458 (GitHub Actions runs 41989316276 and 41989325323). This remains offline CI only. No live Tavily request, AI model request, Supabase archive write, Render deployment, or deployed E2E was performed.
