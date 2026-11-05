# Mira HFM v0.2 — Phase 5 Facebook Group Manual Import

Status: IMPORT PIPELINE, SUPABASE STORE ADAPTER, ADMIN API ROUTES, MIGRATION, AND OFFLINE CONTRACT TESTS ARE IMPLEMENTED IN THE FEATURE BRANCH. RENDER DEPLOYMENT, MIGRATION APPLICATION, AND RUNTIME VERIFICATION ARE DEFERRED.

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

The tests use synthetic fixtures and injected mock storage. They make zero live Facebook requests and do not prove that the migration is applied or that the Render environment is configured. New code has not been runtime-tested in this continuation; its status remains INCONCLUSIVE until CI/Render reports actual output.

## Deferred Render verification

1. Confirm the Render service points to `Shahed216215/herness-ai` and branch `work/mira-hfm-v02-phase5-facebook-group-import` (the previously inspected service was connected to a different repository).
2. Review and explicitly apply the SQL migration to the intended Supabase project. Do not apply it automatically during deploy.
3. Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist in Render without exposing their values.
4. Deploy the reviewed branch and capture the exact deployment commit.
5. Run the mock contract tests in the Render build/runtime environment; do not make a live Facebook request as part of mock testing.
6. Verify admin authorization, import, persistent readback, audit readback, duplicate detection, quarantine persistence, and retrieval across a service restart.
7. Only after these checks, report the verified capability and remaining limitations. Do not label production certified unless all required evidence exists.

## Explicit exclusions

- No Facebook Graph API integration, scraping, Group joining, private Group access, or automatic native export download.
- No canonical Memory promotion or overwrite.
- No production database migration has been applied.
- No Render deployment, live Facebook request, or production certification has occurred.
- All work remains within Mira HFM v0.2.
