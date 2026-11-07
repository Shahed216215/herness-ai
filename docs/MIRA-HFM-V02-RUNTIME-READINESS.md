# Mira HFM v0.2 — Runtime Integration Readiness

Status: **implementation branch / runtime routes wired / not activated / not production-ready**

This document records the HFM v0.2 runtime boundary and exact release gates. It does not authorize database migrations, owner or membership provisioning, production environment changes, merge, or Render deployment.

## Implemented in this branch

- Fail-closed unified retrieval facade. It requires trusted host authorization, project-scoped request context, per-record READ decisions, VERIFIED integrity, trusted state, ACTIVE lifecycle, and conflict exclusion. It has no Local JSON or Google Drive fallback.
- Work Learning retrieval bridge. It filters through the facade before relevance ranking and returns non-executable, read-only learning candidates.
- Dedicated project-selection reader and session-bound project-selection route. Actor identity is derived from the authenticated session principal; a project binding is persisted only after active membership is verified.
- Dedicated Memory retrieval reader. It verifies database identity, login role, role isolation, effective privileges, forced RLS, and required policies before returning a pool.
- Authorized Memory reader. It derives actor/project from server-held session state, validates a server-held one-time authority, consumes that authority, appends an audit event, and reads eligible Memory in the same transaction.
- Server-only authority issuer. It can issue only a short-lived, single-use `memory.read` authority after checking active owner/membership and a consumed signed approval.
- HMAC approval-token signer/verifier. It binds project, actor, approver, operation, resource, purpose and expiry; verifies signatures in constant time; and requires atomic nonce redemption.
- Recent-admin approval service. It requires a stable configured admin subject, fresh authenticated admin session, verified project binding, active owner/membership, explicit confirmation, and a purpose.
- Persistent approval nonce ledger. Raw HMAC tokens are not stored. Nonces are hashed, scoped, short-lived, single-use and audited on issuance/consumption.
- Authenticated same-origin HTTP routes:
  - `POST /api/hfm/projects/select`
  - `POST /api/hfm/memory/authorize`
  - `POST /api/hfm/memory/read`
- The authorize route stores the resulting grant in the server-side session and never returns the grant or approval token to the browser. The read route removes the session grant before starting retrieval; database authority consumption is independently atomic.
- Migrations 007, 008 and 009 are source-only drafts for the Memory reader, authority issuer and persistent approval nonce ledger.
- Synthetic tests cover project selection → authorized Memory retrieval, approval signing/replay protection, admin approval issuance, route authentication/origin checks, server-side grant storage, grant removal, and retrieval flow.

## Runtime environment variable names

Values must be supplied only after the target database and role credentials are independently verified. Do not copy a writer credential into a reader variable.

| Purpose | Environment variables |
|---|---|
| Project-selection reader | `MIRA_HFM_PROJECT_READ_ENABLED`, `MIRA_HFM_PROJECT_READ_DATABASE_URL`, `MIRA_HFM_PROJECT_READ_ROLE` |
| Memory retrieval reader | `MIRA_HFM_MEMORY_READ_ENABLED`, `MIRA_HFM_MEMORY_READ_DATABASE_URL`, `MIRA_HFM_MEMORY_READ_ROLE` |
| One-time authority issuer | `MIRA_HFM_AUTHORITY_ISSUER_ENABLED`, `MIRA_HFM_AUTHORITY_ISSUER_DATABASE_URL`, `MIRA_HFM_AUTHORITY_ISSUER_ROLE` |
| Signed approval flow | `MIRA_HFM_APPROVAL_TOKEN_SECRET` (minimum 32 bytes) |
| Memory writer (separate existing path) | `MIRA_HFM_MEMORY_WRITE_ENABLED`, `MIRA_HFM_MEMORY_DATABASE_URL`, `MIRA_HFM_MEMORY_WRITER_ROLE` |
| Stable admin principal | `MIRA_ADMIN_SUBJECT_ID` |

Feature flags must remain disabled until database readiness, target mapping, role provisioning and owner/membership bootstrap are verified. No secret values are recorded in this document.

## Required database roles and migration order

1. Verify the existing HFM schema and forced-RLS tables on the exact approved target database.
2. Migration 006 defines the project-selection NOLOGIN group role and its two read-only RLS policies.
3. Migration 007 defines the separate Memory retrieval NOLOGIN role and its narrowly scoped SELECT / authority-consumption / audit-insert privileges.
4. Migration 008 defines the separate NOLOGIN authority-issuer role, active owner/membership reads, narrowly scoped Memory-read authority insertion, and append-only issuance/approval audit events.
5. Migration 009 defines the forced-RLS hashed nonce registry. The issuer can SELECT/INSERT scoped nonce rows and update only `consumed_at`; it cannot update nonce identity/scope fields, DELETE, or TRUNCATE.
6. Separately provision a dedicated LOGIN role for each runtime group role. Each login must inherit only its matching NOLOGIN group role, must not own database objects, and must have no elevated privileges.
7. Configure the application with the matching dedicated credentials and exact target database. Runtime preflights must verify database identity, role identity, effective privileges, RLS and exact policies before the routes can operate.

Migrations 007, 008 and 009 are source-only drafts. Do not execute them until the target database is unambiguously mapped, a backup/recovery point is confirmed, and explicit staging approval is obtained.

## Outstanding blockers

- The inspected staging database has no project owner, active membership, or Memory records. Project selection and approval issuance therefore correctly fail closed.
- The admin HFM subject must be provisioned and match `MIRA_ADMIN_SUBJECT_ID`.
- Migration 009 is not applied; the persistent nonce table does not yet exist in staging.
- Dedicated LOGIN credentials for the reader and issuer group roles have not been provisioned.
- The new HTTP routes are wired but remain disabled because their runtime feature flags are not enabled.
- The staging-to-Render production Neon target cannot be conclusively mapped while duplicate Neon projects exist. Do not guess which project is production.
- Legacy Memory and Knowledge consumers remain in service. The retrieval callsite inventory reports REVIEW_REQUIRED; they must be migrated in bounded groups with explicit behavior tests before HFM becomes the source of truth.
- A successful synthetic test does not prove a live Neon policy, credential, session-store, or Render environment is correct.

## Staging database read-only inspection

Read-only inspection of Neon staging project `steep-grass-38696226`, branch `br-lingering-dawn-a18x6pxx` (`mira-hfm-test`), database `neondb`:

- The five existing HFM owner, membership, authority, authority-audit and Memory tables have RLS enabled and FORCE RLS enabled.
- Existing project-reader and Memory-writer roles have the expected NOLOGIN / NOINHERIT / no-superuser / no-BYPASSRLS attributes.
- No existing `mira_hfm_memory_reader` or `mira_hfm_authority_issuer` role was present at inspection time.
- No existing issuer policy-name collision was found at inspection time; the authority audit identity sequence resolves to `mira_hfm.authority_audit_events_event_sequence_seq`.
- Current row counts at inspection time: owners 0, memberships 0, authorities 0, Memory records 0, authority audit events 2.
- The nonce registry table does not exist yet because Migration 009 has not been applied.

This is structural preflight evidence only. No migration, role creation, grant, seed, or application-data write was executed. Empty owner and membership tables prevent project selection and authority issuance. Production Neon target mapping remains unresolved.

## Validation evidence

At the last fully completed workflow head before the current route integration, all 8 applicable workflows passed. The new route and server wiring changes are now being validated by a fresh CI run. Do not treat earlier green checks as evidence for later commits.

HFM-specific tests are synthetic/offline. No live HFM database write or migration has been performed.

## Release and deployment gates

- Keep this work on `work/mira-hfm-v02-runtime-integration`.
- Keep PR #79 as a draft while database and legacy-callsite gates remain open.
- Do not merge to `main`: Render Auto Deploy is enabled.
- Do not set HFM feature flags to `true` before dedicated roles, database target mapping, owner/membership bootstrap, and authority issuance are verified.
- Ask for explicit approval before any database migration, bootstrap write, production environment mutation, merge, or Render deployment.
- Stay within HFM v0.2. Do not create v0.3 work.
