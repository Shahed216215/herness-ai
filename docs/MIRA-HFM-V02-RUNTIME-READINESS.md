# Mira HFM v0.2 — Runtime Integration Readiness

Status: **implementation branch / manual social-draft workflow wired / runtime disabled / not production-ready**

This document records the HFM v0.2 runtime boundary and exact release gates. It does not authorize database migrations, owner or membership provisioning, production environment changes, merge, or Render deployment.

## Implemented in this branch

- Fail-closed unified retrieval facade. It requires trusted host authorization, project-scoped request context, per-record READ decisions, VERIFIED integrity, trusted state, ACTIVE lifecycle, and conflict exclusion. It has no Local JSON or Google Drive fallback.
- Work Learning retrieval bridge. It filters through the facade before relevance ranking and returns non-executable, read-only learning candidates.
- Dedicated project-selection reader and session-bound project-selection route. Actor identity is derived from the authenticated session principal; a project binding is persisted only after active membership is verified.
- Dedicated Memory retrieval reader. It verifies database identity, login role, role isolation, effective privileges, forced RLS, and required policies before returning a pool.
- Authorized Memory reader. It derives actor/project from server-held session state, validates a server-held one-time authority, consumes that authority, appends an audit event, and reads eligible Memory in the same transaction.
- Server-only authority issuer. It supports only short-lived, single-use `memory.read`, `memory.write`, `memory.trash`, and `memory.restore` authorities after checking active owner/membership and a consumed signed approval. Permanent purge is not an allowed operation.
- HMAC approval-token signer/verifier. It binds project, actor, approver, operation, resource, purpose and expiry; verifies signatures in constant time; and requires atomic nonce redemption.
- Recent-admin approval service. It requires a stable configured admin subject, fresh authenticated admin session, verified project binding, active owner/membership, explicit confirmation, and a purpose.
- Persistent approval nonce ledger. Raw HMAC tokens are not stored. Nonces are hashed, scoped, short-lived, single-use and audited on issuance/consumption.
- One-time initial-project bootstrap route and source-only Migration 010. It creates only the initial owner, matching ADMIN membership, one-time bootstrap latch and audit row in one transaction; it imports no legacy Memory.
- Daily social-draft generation route. It reads eligible active daily activity/learning notes using a one-time `memory.read` authority, builds a Bangladesh-time-zone daily post, and writes a private `social_post_draft` through a separate one-time `memory.write` authority and dedicated writer transaction.
- Manual Facebook workflow in the existing Knowledge & Memory section: generate a private draft, copy it with the browser clipboard, manually publish it in Facebook, explicitly confirm publication, and move only that `social_post_draft` to recoverable Neon Trash. No Facebook API publishing or auto-publish path exists. Trash can be listed and restored; it is not a hard delete.
- Authenticated same-origin HTTP routes:
  - `POST /api/hfm/projects/select`
  - `POST /api/hfm/memory/authorize`
  - `POST /api/hfm/memory/read`
  - `POST /api/hfm/bootstrap/initial-project`
  - `POST /api/hfm/social-drafts/generate-daily`
  - `POST /api/hfm/social-drafts/trash`
  - `POST /api/hfm/social-drafts/restore`
- The authorize route stores the resulting grant in the server-side session and never returns the grant or approval token to the browser. The read route removes the session grant before starting retrieval; database authority consumption is independently atomic.
- Migrations 007–010 are source-only drafts for the Memory reader, allowlisted authority issuer, persistent approval nonce ledger and one-time bootstrap role.
- Synthetic tests cover project selection → authorized Memory retrieval, approval signing/replay protection, admin approval issuance, route authentication/origin checks, server-side grant storage, grant removal, and retrieval flow.

## Runtime environment variable names

Values must be supplied only after the target database and role credentials are independently verified. Do not copy a writer credential into a reader variable.

| Purpose | Environment variables |
|---|---|
| Project-selection reader | `MIRA_HFM_PROJECT_READ_ENABLED`, `MIRA_HFM_PROJECT_READ_DATABASE_URL`, `MIRA_HFM_PROJECT_READ_ROLE` |
| Memory retrieval reader | `MIRA_HFM_MEMORY_READ_ENABLED`, `MIRA_HFM_MEMORY_READ_DATABASE_URL`, `MIRA_HFM_MEMORY_READ_ROLE` |
| One-time authority issuer | `MIRA_HFM_AUTHORITY_ISSUER_ENABLED`, `MIRA_HFM_AUTHORITY_ISSUER_DATABASE_URL`, `MIRA_HFM_AUTHORITY_ISSUER_ROLE` |
| One-time bootstrap | `MIRA_HFM_BOOTSTRAP_ENABLED`, `MIRA_HFM_BOOTSTRAP_DATABASE_URL`, `MIRA_HFM_BOOTSTRAP_ROLE` |
| Signed approval flow | `MIRA_HFM_APPROVAL_TOKEN_SECRET` (minimum 32 bytes) |
| Memory writer (separate existing path) | `MIRA_HFM_MEMORY_WRITE_ENABLED`, `MIRA_HFM_MEMORY_DATABASE_URL`, `MIRA_HFM_MEMORY_WRITER_ROLE` |
| Stable admin principal | `MIRA_ADMIN_SUBJECT_ID` |

Feature flags must remain disabled until database readiness, target mapping, role provisioning and owner/membership bootstrap are verified. No secret values are recorded in this document.

## Required database roles and migration order

1. Verify the existing HFM schema and forced-RLS tables on the exact approved target database.
2. Migration 006 defines the project-selection NOLOGIN group role and its two read-only RLS policies.
3. Migration 007 defines the separate Memory retrieval NOLOGIN role and its narrowly scoped SELECT / authority-consumption / audit-insert privileges.
4. Migration 008 defines the separate NOLOGIN authority-issuer role, active owner/membership reads, and narrowly scoped insertion for the four allowlisted Memory operations.
5. Migration 009 defines the forced-RLS hashed nonce registry. The issuer can SELECT/INSERT scoped nonce rows and update only `consumed_at`; it cannot update nonce identity/scope fields, DELETE, or TRUNCATE.
6. Migration 010 defines the one-time initial-project bootstrap latch and insert-only owner/membership/audit path. It does not seed or import Memory.
7. Separately provision a dedicated LOGIN role for each runtime group role. Each login must inherit only its matching NOLOGIN group role, must not own database objects, and must have no elevated privileges.
8. Configure the application with the matching dedicated credentials and exact target database. Runtime preflights must verify database identity, role identity, effective privileges, RLS and exact policies before the routes can operate.

Migrations 007–010 are source-only drafts. Do not execute them until the target database is unambiguously mapped, a backup/recovery point is confirmed, and explicit staging approval is obtained.

## Outstanding blockers

- Latest read-only staging inspection shows `project_owners=1`, `project_memberships=1`, `memory_records=1`, `operation_authorities=0`, and `authority_audit_events=2`; one active owner row matches one active ADMIN membership. The membership currently grants `memory.read` but not `memory.write`, `memory.trash`, or `memory.restore`. Row provenance has not been independently certified. Preserve all existing rows; do not treat staging as empty or run the one-time bootstrap migration against it.
- The admin HFM subject must be provisioned and match `MIRA_ADMIN_SUBJECT_ID`.
- Migrations 007–010 are not applied in the inspected staging database; the nonce registry, bootstrap latch and new runtime role grants are not present there.
- Dedicated LOGIN credentials for the project reader, Memory reader, authority issuer, bootstrap operator and Memory writer have not been provisioned or verified.
- HFM runtime feature flags and database credentials remain disabled/unconfigured in Render; no live HFM read/write/trash/restore has been verified.
- The manual social-draft UI is implemented but cannot function against the live service until the database and runtime gates above are completed.
- The staging-to-Render production Neon target cannot be conclusively mapped while duplicate Neon projects exist. Do not guess which project is production.
- Legacy Memory and Knowledge consumers remain in service. The retrieval callsite inventory reports 36 calls across 15 files, all requiring review. The Work Learning bridge is currently defined and unit-tested but has no runtime callsite in `server.js` or `services/learning.js`; those paths still call legacy `searchKnowledge`. Do not describe the bridge as integrated into live learning until a caller is wired and behavior tests prove the HFM eligibility/authorization boundary. Migrate consumers in bounded groups with explicit behavior tests before HFM becomes the source of truth.
- A successful synthetic test does not prove a live Neon policy, credential, session-store, or Render environment is correct.

## Staging database read-only inspection

Read-only inspection of Neon staging project `steep-grass-38696226`, branch `br-lingering-dawn-a18x6pxx` (`mira-hfm-test`), database `neondb`:

- The five existing HFM owner, membership, authority, authority-audit and Memory tables have RLS enabled and FORCE RLS enabled.
- Existing project-reader and Memory-writer roles have the expected NOLOGIN / NOINHERIT / no-superuser / no-BYPASSRLS attributes.
- No existing `mira_hfm_memory_reader` or `mira_hfm_authority_issuer` role was present at inspection time.
- No existing issuer policy-name collision was found at inspection time; the authority audit identity sequence resolves to `mira_hfm.authority_audit_events_event_sequence_seq`.
- Latest read-only row counts (2026-11-07): owners 1, memberships 1, authorities 0, Memory records 1, authority audit events 2. A read-only join found one active owner-to-ADMIN-membership pair. Its membership permissions include `memory.read` only among the four HFM Memory operations; `memory.write`, `memory.trash`, and `memory.restore` are absent. The previously recorded zero-count snapshot is stale and must not be used for migration planning. Existing rows were not modified.
- The nonce registry table does not exist yet because Migration 009 has not been applied.

This is structural preflight evidence only. No migration, role creation, grant, seed, or application-data write was executed. Migration 010 explicitly rejects any existing owner, membership, authority, or Memory rows (`HFM_BOOTSTRAP_REQUIRES_EMPTY_PROJECT_AND_MEMORY_REGISTRIES`); its preflight is therefore expected to fail on the currently inspected staging branch. Do not delete, truncate, rewrite, or import around these rows. Project selection and authority issuance still require separate validation of the existing owner/membership records and the missing runtime roles/policies. Production Neon target mapping remains unresolved.

## Validation evidence

The HFM runtime, repository, session, dependency, route, UI, and PostgreSQL migration-chain checks all passed on code commit `8f377e784a2750e1f3cb9b5eee5f800a122fba2c` (10/10 GitHub Actions checks). The PostgreSQL migration workflow applied migrations 001–010 only to its disposable PostgreSQL 16 CI database and exercised bootstrap, issuer nonce, trash-authority RLS, and hard-delete denial. The embedded social-draft UI script also has parser-level syntax validation.

These are synthetic/offline or disposable-CI results. They are not live Neon or Render evidence. No live HFM database write or migration has been performed.

## Release and deployment gates

- Keep this work on `work/mira-hfm-v02-runtime-integration`.
- Keep PR #79 as a draft while database and legacy-callsite gates remain open.
- Do not merge to `main`: Render Auto Deploy is enabled.
- Do not set HFM feature flags to `true` before dedicated roles, database target mapping, owner/membership bootstrap, and authority issuance are verified.
- Ask for explicit approval before any database migration, bootstrap write, production environment mutation, merge, or Render deployment.
- Stay within HFM v0.2. Do not create v0.3 work.
