# Mira HFM v0.2 — Supabase Free Research Archive Store Design

Status: OPTIONAL PROVIDER IMPLEMENTED; OFFLINE TESTS PENDING; NOT DEPLOYED
Version: v0.2 only
Parent: PR #8 — Facebook Public Web Research & Memory
Selected Page: Online canel (Page ID 118056109579206)
Cost target: USD 0/month

## 1. Decision

Keep the existing local immutable archive as the default and add an explicitly selected Supabase Postgres REST store as an optional backend. Do not silently switch providers and do not silently fall back from Supabase to local storage after a remote failure.

Configuration:
- MIRA_FACEBOOK_RESEARCH_MEMORY_BACKEND=local (default) or supabase
- MIRA_FACEBOOK_RESEARCH_MEMORY_DIR remains the local archive path override.
- SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required only when backend=supabase.
- Never log, return, or expose SUPABASE_SERVICE_ROLE_KEY.
- Never place service-role credentials in client-side code, repository files, workflow logs, or user-visible output.

The Render Free filesystem is ephemeral and has no Persistent Disk. Supabase Free is a candidate remote persistence layer, not a production durability guarantee.

## 2. Free-tier constraints and operational caveats

The currently published Supabase Free plan lists 500 MB database storage and pauses projects after one week of inactivity. Pausing retains data, but the project must be restored before use. Free plan automatic backups are not included. Render Free services have ephemeral filesystems, may spin down after inactivity, and may be suspended for unusually high service-initiated external traffic (including external database/API access).

Therefore:
- State must be treated as durable only after successful remote readback verification.
- Supabase paused/unavailable, network timeout, quota exhaustion, or HTTP errors must return ARCHIVE_UNAVAILABLE / LOOKUP_UNAVAILABLE, never PASS.
- No silent local fallback when supabase mode is selected.
- Provide explicit manual export/import and recommend periodic local export to Termux.
- Do not claim backup, high availability, SLA, or production readiness.
- Keep usage low and bounded; do not add polling/keep-alive traffic to prevent pausing.

## 3. Data model

Create one table: public.mira_facebook_research_archive

Columns:
- archive_id text PRIMARY KEY (64 lowercase hex)
- page_id text NOT NULL
- payload jsonb NOT NULL
- record_digest text NOT NULL (64 lowercase hex)
- archived_at timestamptz NOT NULL
- CHECK page_id is numeric and bounded
- CHECK archive_id and record_digest match the expected hex shape

Indexes:
- (page_id, archived_at DESC)
- Optional GIN index on payload only if query volume justifies the storage cost; omit initially.

The payload retains the existing record contract:
- schemaVersion=1.0.0
- archivePolicy=UNTRUSTED_RESEARCH_ONLY
- selected Page ID and source URL
- title, bounded snippet, sourceType, observedAt, publishedAt
- evidenceId, archiveId, contentDigest, recordDigest
- sourceIntegrity=NOT_INDEPENDENTLY_VERIFIED
- canonicalMemoryWrite=false
- trustStatus=SOURCE_RECORDED, integrityStatus=UNVERIFIED, lifecycle=PENDING_REVIEW are synthesized by the lookup response from the immutable source record; they are not written as separate mutable trust fields in the payload.

Do not store full Page content, credentials, cookies, private/group content, or user secrets.

## 4. Database security

Enable Row Level Security on the table.
- Revoke all table privileges from anon and authenticated roles.
- Do not create public read/write policies.
- Backend server accesses the table only with SUPABASE_SERVICE_ROLE_KEY over HTTPS.
- Service-role key bypasses RLS; its use is restricted to the server runtime and must never be exposed to browsers or model prompts.
- Limit accepted SUPABASE_URL to HTTPS and a valid Supabase project host; reject credentials, fragments, unexpected ports, and redirects.
- Use fixed table/path names and parameterized PostgREST query parameters.
- Enforce response size, timeout, bounded rows, bounded snippets and exact Page ID filtering.
- Never execute SQL from model output or user input.

SQL bootstrap is an operator-run migration; no automated project creation or schema mutation from Mira.

## 5. Runtime contract

Implementation now exists in `services/mira-facebook-research-memory-provider.js`. The existing research and lookup tool names remain unchanged and dispatch through this provider selector. Local remains the default; Supabase is opt-in. The adapter uses the repository's hardened HTTPS provider transport, validates the exact Supabase project hostname, and supports an injected transport for offline tests.

When BACKEND=local:
- Preserve current filesystem archive behavior and existing tests.

When BACKEND=supabase:
- Fail closed if URL/key/schema is missing or malformed.
- Insert immutable rows with conflict-ignore semantics on archive_id.
- Read the row back and verify archive_id, page_id, payload digest and record digest before reporting ARCHIVE_WRITE_VERIFIED.
- On an existing archive_id, compare identity and digest; mismatches are conflicts requiring manual review.
- Lookup must filter exact page_id server-side, then apply bounded local keyword ranking to returned payloads.
- Never claim a successful write based only on HTTP 2xx.
- Do not fall back to local filesystem after any Supabase failure.
- Keep existing tool names and public tool contract stable.

## 6. Required environment configuration

Render Web Service environment (operator enters values directly in Render; never send secrets to ChatGPT):
- MIRA_FACEBOOK_RESEARCH_MEMORY_BACKEND=supabase
- SUPABASE_URL=https://<project-ref>.supabase.co
- SUPABASE_SERVICE_ROLE_KEY=<secret service-role key>

Do not configure MIRA_FACEBOOK_RESEARCH_MEMORY_DIR for Supabase mode. Keep local archive configuration independent for Termux.

## 7. Verification plan

Offline tests (no network, no secrets):
1. Local backend regression remains unchanged.
2. Supabase adapter uses an injected fake transport.
3. Reject HTTP, malformed URL, unexpected hostname, URL credentials, fragments and redirect responses.
4. Missing URL/key fails closed without exposing values.
5. Insert then readback verifies exact digest.
6. Duplicate insert is idempotent.
7. Conflicting duplicate fails closed.
8. Page ID isolation is enforced on read.
9. Bound result count, response bytes and snippet lengths.
10. Provider unavailable / paused / quota errors produce INCONCLUSIVE or unavailable status, never PASS.
11. No local fallback when remote backend selected.
12. Tool registry policy parity and full existing Phase 4 offline test suite pass.

Live verification (separate, explicit operator action):
- Create Supabase Free project and apply SQL manually.
- Add secrets directly in Render Dashboard.
- Execute one explicitly authorized smoke test using a synthetic fixture only; do not search Facebook or transmit real Page evidence during the smoke test.
- Verify write/readback, restart/redeploy persistence, and export.
- No secret values in logs or reports.

## 8. Acceptance and release gates

- Cost remains USD 0/month; no paid upgrades or usage overages authorized.
- Supabase Free inactivity pause and no-automatic-backup limitations are disclosed.
- Local archive mode remains backward-compatible.
- No silent fallback, trust promotion, Canonical HFM Memory write, Meta API, direct Facebook fetch, login, cookies, or publishing.
- All offline tests pass with actual CI evidence.
- Live storage test remains NOT_APPROVED until the user explicitly authorizes it.
- PR #8 stays open and unmerged until separate user approval.
- Version remains v0.2; no v0.3 work.

Current status:
SUPABASE_ADAPTER=IMPLEMENTED_OFFLINE_CONTRACT_PENDING
SUPABASE_PROJECT=NOT_CREATED_OR_VERIFIED
DATABASE_SCHEMA=NOT_APPLIED
RENDER_ENVIRONMENT=NOT_CONFIGURED
LIVE_DATABASE_TEST=NOT_RUN
COST=0_USD_MONTHLY_TARGET
PRODUCTION_DURABILITY=NOT_CERTIFIED
