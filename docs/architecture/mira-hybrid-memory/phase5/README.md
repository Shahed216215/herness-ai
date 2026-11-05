# Mira HFM v0.2 — Phase 5 Facebook Group Manual Import

Status: IMPORT PIPELINE, SUPABASE STORE ADAPTER, ADMIN API ROUTES, MIGRATION, FOUR FOCUSED PHASE 5 TESTS, NINE DEPENDENCY-FREE STATIC REGRESSION TESTS, AND THE FULL CANONICAL 30-TEST `npm test` CHAIN PASS IN EXACT-HEAD CI. The four formerly absent test paths were recreated as scoped tests from current source contracts. A Render preflight also corrected duplicate Facebook Group route declaration/mount wiring and made the bind host production-aware. Supabase migration/persistence and live Render deployment/runtime verification remain deferred.

## Scope implemented

- Manual content import from explicitly user-supplied Group material. The importer never accesses Facebook, scrapes Groups, joins Groups, or reads private Group content.
- Supported Mira interchange formats: JSON, JSONL, and manual text. Compatibility with arbitrary native Meta export archives is not claimed until a representative user-provided export sample is available.
- Validates envelope schema, project/group scope, source URL binding, timestamps, bounded content, allowed record types, and canonical HFM record structure.
- Requires an explicit `authorizedAccess: true` attestation and a named authenticated administrator session. This is an attestation by the importer, not independent proof of Facebook membership or authorization.
- Maps imported records to `sourceType=facebook_group`, `PROJECT_PRIVATE`, `SOURCE_RECORDED`, `UNVERIFIED`, and `PENDING_REVIEW`.
- Detects exact duplicates across existing stored batches and within an import. Stable generated memory identity is based on Group ID plus source ID so content changes do not evade version conflict detection.
- Quarantines same-identity revision/content conflicts. Quarantined records remain in the immutable batch payload and are excluded from trusted Memory retrieval.
- Uses a dedicated Supabase store adapter with immutable create-only batch staging, project/group scoping, read-after-write verification, and conflict detection.
- Persists append-only import audit events in a separate Supabase table and verifies audit write readback.
- Provides an admin-only API for import and retrieval. Imported records are never written to canonical trusted Memory.

## Input formats

### JSON

Top-level object must contain exactly `schemaVersion` (`1.0.0`), `kind` (`MIRA_FACEBOOK_GROUP_MEMORY_IMPORT`), `groupId`, `projectId`, `exportId`, and `records` (1–500 items).

Each record supports only `memoryId`, `sourceId`, `sourceUrl`, `recordType`, `content`, `observedAt`, and `revision`.

### JSONL

The first non-empty line is the envelope metadata without `records`. Each subsequent non-empty line is one record object. Raw Meta export archives with other schemas are not silently guessed or auto-converted.

### Manual text

Pass exact user-supplied text with explicit Group ID, project ID, actor session, authorization attestation, source ID, and observed timestamp. A deterministic memory ID is derived when one is not supplied. An explicit observed timestamp is required so repeated imports remain deterministic.

## Admin API

Mounted under `/api/admin/facebook-group`, protected by `PERMISSIONS.SYSTEM_ADMIN`:

- `POST /import` — accepts `format`, `content`, `groupId`, `projectId`, and `authorizedAccess: true`; manual imports additionally accept `sourceId`, `sourceUrl`, `recordType`, `memoryId`, and `observedAt`.
- `GET /retrieve?projectId=...&groupId=...&query=...&limit=...` — retrieves only staged, digest-checked, untrusted Group records.

The import route requires a named authenticated administrator session for attribution. The 1 MiB JSON parser is installed behind the admin permission guard; other API routes retain the global 50 KiB JSON limit.

## Supabase persistence and migration

Migration file: `supabase/migrations/20261105090000_mira_facebook_group_import_batches.sql`

It creates two isolated tables:

- `mira_facebook_group_import_batches` — immutable import batch payloads and digests.
- `mira_facebook_group_import_audit_events` — append-only audit events linked to their import batch.

RLS is enabled. Public, anon, and authenticated roles receive no table privileges or policies. The service role receives SELECT and INSERT only; UPDATE and DELETE are not granted. The migration is source code only and has NOT been applied to the Supabase project.

Required existing environment variables are `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Keep the service-role key only in Render's secret settings; never commit or paste it into chat. No new secret is required by this phase.

## Integrity, quarantine, and trust

- Imported Group text is untrusted data, never system instruction.
- SHA-256 digests detect content or storage changes; they do not authenticate the Facebook source or prove authorship.
- Exact duplicates are skipped in retrieval.
- Identity/revision/content conflicts are stored with `QUARANTINED` disposition and reason codes; no existing record is overwritten.
- All imported records remain `SOURCE_RECORDED` / `UNVERIFIED` / `PENDING_REVIEW`.
- Retrieval does not promote trust and returns `retrievableAsTrustedMemory: false`.
- Private Group content may be imported only when supplied by an administrator who attests that access was authorized. The system does not bypass Group privacy controls.

## Offline contract tests

Included in the repository `npm test` and the dedicated GitHub Actions workflow:

- `tests/mira-facebook-group-memory-import.test.js` — schema, source binding, explicit authorization, duplicate/version conflict detection, quarantine, JSON/JSONL/manual parsing, and trust boundaries.
- `tests/mira-facebook-group-memory-supabase-store.test.js` — mocked Supabase atomic create, idempotency, conflict handling, durable audit readback, and retrieval.
- `tests/mira-facebook-group-memory-import-route.test.js` — admin guard, named actor, bounded parser, authorization attestation, import, audit, and retrieval routes.
- `tests/mira-facebook-group-memory-migration-structure.test.js` — offline static checks for table/key/digest constraints, RLS, and least-privilege grants; it is not a PostgreSQL parser or live migration test.

The tests use synthetic fixtures and injected mock storage. They make zero live Facebook requests and do not prove that the migration is applied or that the Render environment is configured.

### Dependency-free static regression

The following nine tests are also run by `npm run test:offline-static-regression` in the Phase 5 GitHub Actions workflow:

- `tests/provider-ui-error-contract-test.js`
- `tests/provider-rollback-contract-test.js`
- `tests/admin-permission-middleware-offline-test.js`
- `tests/provider-verify-fallback-contract.test.js`
- `tests/stage19-provider-transport-hardening-test.js`
- `tests/stage19-provider-url-policy-test.js` (DNS is injected in the test; no live DNS request is needed)
- `tests/stage-six-menu-ui-integration-test.js`
- `tests/provider-navigation-contract.js`
- `tests/mira-facebook-group-memory-migration-structure.test.js`

The `npm run test:offline-regression:available` script now covers all 30 test paths in the canonical `npm test` chain. After explicit approval, GitHub Actions installed the exact lockfile dependencies with `npm ci --ignore-scripts --no-audit --no-fund`; dependency lifecycle scripts were disabled. The canonical `npm test` command completed successfully on exact head `1d200056d26fc029ff46b7a69ee7e60e720e6a76`. Tests use temporary local files, mocked provider-health/request functions, and loopback-only local HTTP servers. CI logs report zero live Facebook requests, private Group access, canonical Memory writes, or production migration.

### Full test command integrity finding and resolution

The four test paths previously missing from the repository were not recoverable from the inspected Phase 4/Phase 5 branches or GitHub code search. They were recreated as new, scoped regression tests based on the current source contracts; they are **not represented as recovered historical originals**:

- `tests/change-management-regression-test.js` — proposal lifecycle, approval gating, terminal-state transitions, metadata secret redaction, and governance status.
- `tests/custom-provider-config-v1.test.js` — five-slot schema, endpoint allowlist, prohibited URL components/private hosts, secret exclusion, atomic persistence, and restrictive file mode.
- `tests/custom-provider-config-route-isolated.test.js` — isolated read/save/invalid-input route behavior and proof that saving metadata does not activate or rewrite runtime provider configuration.
- `tests/provider-claude-grok-contract.test.js` — Anthropic/Claude and xAI/Grok request shape, message filtering, model/credential requirements, and injected mock transport.

The canonical `npm test` script retains all 30 test entries, including `tests/server-startup-contract.test.js`. The separate `npm run test:offline-regression:available` command contains the same 30-file set; no test entry was silently removed. The workflow executes the canonical `npm test` command directly and includes `tests/**` in its pull-request path filters. GitHub Actions installed locked dependencies only after explicit approval using `npm ci --ignore-scripts --no-audit --no-fund`; no package installation was performed on the user's Termux device.

### Verified exact-head CI evidence (2026-11-05)

- Branch: `work/mira-hfm-v02-phase5-clean-restack-on-phase4-20261105`.
- Latest reviewed head: `1d200056d26fc029ff46b7a69ee7e60e720e6a76`.
- Exact-head GitHub Actions run: [42033146301](https://github.com/Shahed216215/herness-ai/actions/runs/42033146301) — SUCCESS.
- Job: `facebook-group-import-offline`; Node.js 24.
- All four focused Phase 5 suites, all nine dependency-free static regression tests, and the full canonical `npm test` chain (30 test files) passed.
- The server-startup regression test reported `SERVER_JAVASCRIPT_SYNTAX=PASS`, `FACEBOOK_GROUP_ROUTE_SINGLE_DECLARATION=PASS`, `FACEBOOK_GROUP_ROUTE_SINGLE_MOUNT=PASS`, `PRODUCTION_BIND_HOST_CONTRACT=PASS`, `LOCAL_LOOPBACK_BIND_CONTRACT=PASS`, and `SERVER_STARTUP_CONTRACT_TEST=PASS`.
- The first dependency-enabled run found incomplete isolated test fixtures: they did not copy `services/mira-json-state-store.js` and `services/mira-store-initialization-guard.js`, required by `audit-log.js`. Five isolated fixtures were corrected to include those dependencies; the final exact-head CI passed.
- Recorded boundary checks: `LIVE_FACEBOOK_REQUESTS=0`, `PRIVATE_GROUP_ACCESS=0`, `CANONICAL_MEMORY_WRITES=0`, and `PRODUCTION_MIGRATION=0`.
- The latest 30-test exact-head CI result is **PASS**. This is offline CI evidence only; it does not prove that Supabase migration or Render deployment/runtime has occurred.

## Render startup preflight finding (2026-11-05)

The pre-deployment source review found two duplicate declarations of `registerFacebookGroupMemoryImportRoutes` and two identical route-mount calls in `server.js`. The duplicate `const` declaration would prevent Node.js from parsing the server. The second declaration and second mount were removed, leaving one route declaration and one mount.

The same review found the server listening on `127.0.0.1` unconditionally. The bind host is now production-aware: `0.0.0.0` when `NODE_ENV=production`, and `127.0.0.1` for local development. A new `tests/server-startup-contract.test.js` test runs `node --check server.js` and verifies single route declaration/mount plus the production/local bind contract. It was added to both canonical `npm test` and `test:offline-regression:available`, increasing the chain from 29 to 30 test files. Exact-head CI run `42033146301` passed all 30 tests and the startup contract.

## Deferred Render verification

1. Confirm the Render service points to `Shahed216215/herness-ai` and the reviewed branch `work/mira-hfm-v02-phase5-clean-restack-on-phase4-20261105` (the previously inspected service was connected to a different repository).
2. Review and explicitly apply the SQL migration to the intended Supabase project. Do not apply it automatically during deploy.
3. Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist in Render without exposing their values.
4. Deploy the reviewed branch and capture the exact deployment commit.
5. Run the mock contract tests in the Render build/runtime environment; do not make a live Facebook request as part of mock testing.
6. Verify admin authorization, import, persistent readback, audit readback, duplicate detection, quarantine persistence, and retrieval across a service restart.
7. Only after these checks, report the verified capability and remaining limitations. Do not label production certified unless all required evidence exists.

## Current acceptance ledger

| Acceptance item | Status | Evidence / boundary |
|---|---|---|
| Phase 5 implementation files present on reviewed branch | PASS | Exact branch and commit above; PR #33 remains open/draft |
| Focused Phase 5 offline CI suites | PASS | Actions run `42008461380`, exact head SHA above |
| External-action boundaries in focused CI | PASS | Zero live Facebook requests, private Group access, canonical Memory writes, and production migrations |
| Dependency-free static regression suite | PASS | Nine tests passed in exact-head run `42029506505`; includes Stage 19 URL/transport contracts and UI/rollback contracts |
| Full canonical `npm test` regression set (30 tests) | PASS | Exact-head CI run `42033146301`; locked dependencies installed with lifecycle scripts disabled |
| Full repository `npm test` chain | PASS | All 30 referenced test files exist; four missing paths were redesigned as scoped tests and the startup contract test passed on exact head `1d200056d26fc029ff46b7a69ee7e60e720e6a76` |
| SQL migration static structure checks | PASS | New offline test verifies both tables, keys, digest constraints, RLS, and service-role SELECT/INSERT-only grants; no PostgreSQL parser/database execution was performed |
| Supabase migration application and real persistence/readback | DEFERRED | Requires explicit deployment-window approval and target-project verification |
| Render configuration, deployment, restart persistence, and runtime auth | DEFERRED | No Render deployment or runtime test performed |
| Native Meta export archive compatibility | NOT_IMPLEMENTED | Only documented JSON, JSONL, and manual-text interchange formats are supported |

**Phase 5 closure status:** `FOCUSED_PHASE5_PASS; NINE_STATIC_REGRESSION_PASS; CANONICAL_NPM_TEST_30_PASS; SERVER_STARTUP_CONTRACT_PASS; LIVE_DEPLOYMENT_DEFERRED`. Phase 5 is not fully closed or production-certified because Supabase/Render live verification remains deferred. All work remains within Mira HFM v0.2.

## Explicit exclusions

- No Facebook Graph API integration, scraping, Group joining, private Group access, or automatic native export download.
- No canonical Memory promotion or overwrite.
- No production database migration has been applied.
- No Render deployment, live Facebook request, or production certification has occurred.
- All work remains within Mira HFM v0.2.
