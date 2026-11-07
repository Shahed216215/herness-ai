# Mira HFM v0.2 — Runtime Integration Readiness

Status: **implementation branch / not production-ready / not activated**

This document records the HFM v0.2 runtime boundary and the exact remaining gates. It does not authorize a database migration, owner or membership provisioning, production environment changes, merge, or Render deployment.

## Implemented in this branch

- Pure unified retrieval facade. It requires trusted host authorization, project-scoped request context, per-record READ decisions, VERIFIED integrity, trusted state, ACTIVE lifecycle, and conflict exclusion. It has no local JSON or Google Drive fallback.
- Work Learning retrieval bridge. It filters through the facade before relevance ranking and returns non-executable, read-only learning candidates.
- Dedicated project-selection reader. It is disabled unless configured and verifies the database identity, login role, least privilege, forced RLS, and the exact owner/membership SELECT policies.
- Session-bound project selection route. The actor is derived from the authenticated session principal; project selection is persisted only after active membership is verified.
- Dedicated Memory retrieval reader. It is disabled unless configured and checks exact database identity, effective privileges, role isolation, forced RLS, and required policies.
- Authorized Memory reader. It derives project and actor from server-held session state, validates a server-held one-time authority grant, consumes that grant, appends an audit event, and reads active eligible Memory in the same transaction.
- Migration 007 source draft for the constrained Memory retrieval role. It has not been applied to any database.
- Offline contract tests, including a project-selection-to-authorized-Memory-read integration fixture.

## Runtime environment variable names

Values must be supplied only after the target database and role credentials are independently verified. Do not copy a writer credential into a reader variable.

| Purpose | Environment variables |
|---|---|
| Project-selection reader | `MIRA_HFM_PROJECT_READ_ENABLED`, `MIRA_HFM_PROJECT_READ_DATABASE_URL`, `MIRA_HFM_PROJECT_READ_ROLE` |
| Memory retrieval reader | `MIRA_HFM_MEMORY_READ_ENABLED`, `MIRA_HFM_MEMORY_READ_DATABASE_URL`, `MIRA_HFM_MEMORY_READ_ROLE` |\n| One-time authority issuer | `MIRA_HFM_AUTHORITY_ISSUER_ENABLED`, `MIRA_HFM_AUTHORITY_ISSUER_DATABASE_URL`, `MIRA_HFM_AUTHORITY_ISSUER_ROLE` |
| Memory writer (separate existing path) | `MIRA_HFM_MEMORY_WRITE_ENABLED`, `MIRA_HFM_MEMORY_DATABASE_URL`, `MIRA_HFM_MEMORY_WRITER_ROLE` |
| Stable admin principal | `MIRA_ADMIN_SUBJECT_ID` |

No values are recorded here. Feature flags must remain disabled until database readiness and authorization provisioning are verified.

## Required database roles and migration order

1. Existing HFM schema and forced RLS tables must be verified on the exact target database.
2. Migration 006 defines the project-selection NOLOGIN group role and its two read-only RLS policies.
3. Migration 007 defines the separate Memory retrieval NOLOGIN role and its narrowly scoped SELECT / authority-consumption / audit-insert privileges.
4. A dedicated LOGIN role must be separately provisioned for each runtime role. It must not inherit unrelated roles, own database objects, or have elevated privileges.
5. The application must connect using the corresponding dedicated credential. The runtime preflight must verify the exact database and role before enabling a feature flag.

Migrations 007 and 008 are source-only drafts. Do not execute it until the database target is unambiguously mapped, a backup/recovery point is confirmed, and explicit approval is obtained.

## Outstanding blockers

- The inspected staging database has no project owner, active membership, or Memory records. Project selection therefore correctly fails closed.
- The admin HFM subject depends on `MIRA_ADMIN_SUBJECT_ID`; it must match the stable subject derived from successful admin authentication. The authority issuer also requires a separate login credential inheriting only the issuer group role and a trusted one-time approval-token verifier.
- No approved owner/membership bootstrap workflow or production approval-token verifier is provisioned. The code-only authority issuer and disabled-by-default issuer runtime are now implemented; it requires a trusted verifier that atomically consumes a signed single-use human approval token and returns a receipt bound to the current admin, project, operation, resource, purpose, and expiry.
- The Render service's Neon target cannot be conclusively mapped while duplicate Neon projects exist. Do not guess which project is production.
- The legacy Memory and Knowledge callsites remain in service. The inventory reports them as REVIEW_REQUIRED; they must be migrated in bounded groups with explicit behavior tests before HFM becomes the source of truth.
- A successful synthetic test does not prove a live Neon policy, credential, or Render environment is correct.

## Staging database read-only inspection

Read-only inspection of Neon staging project `steep-grass-38696226`, branch `br-lingering-dawn-a18x6pxx` (`mira-hfm-test`), database `neondb`:
- The five HFM owner, membership, authority, authority-audit, and Memory tables all have RLS enabled and FORCE RLS enabled.
- Existing project-reader and Memory-writer roles have the expected NOLOGIN / NOINHERIT / no-superuser / no-BYPASSRLS attributes.
- No existing `mira_hfm_memory_reader` or `mira_hfm_authority_issuer` role was present at inspection time.
- No existing policy-name collision was found for the new issuer policy set; the authority audit identity sequence resolves to `mira_hfm.authority_audit_events_event_sequence_seq`.
- Current row counts: owners 0, memberships 0, authorities 0, Memory records 0, authority audit events 2.

This is structural preflight evidence only. No migration, role creation, grant, seed, or application-data write was executed. The empty owner and membership tables still prevent project selection and authority issuance from succeeding. Production Neon target mapping remains unresolved.

## Validation evidence

The GitHub Actions run for the branch head that includes the project-selection-to-memory integration fixture completed:
- HFM foundation contract: PASS
- HFM Memory repository contract and full `npm test` regression: PASS
- Offline and regression workflow: PASS
- Render host-binding contract: PASS
- Render HTTP smoke workflow: PASS (this is not proof of HFM database readiness)
- Dependency remediation validation: PASS
- Remaining repository workflows on that head: PASS

The integration fixture verifies session-derived actor/project scope, membership validation, one-time authority consumption, audit insertion, and no legacy fallback. All HFM integration tests are synthetic/offline. No live HFM database write or migration was performed.

## Release and deployment gates

- Keep this work on `work/mira-hfm-v02-runtime-integration`.
- Keep PR #79 as a draft while runtime, database, and legacy-callsite gates remain open.
- Do not merge to `main`: Render Auto Deploy is enabled.
- Do not set HFM feature flags to `true` before dedicated roles, database target mapping, owner/membership bootstrap, and authority issuance are verified.
- Ask for explicit approval before any database migration, bootstrap write, production environment mutation, merge, or Render deployment.
- Stay within HFM v0.2. Do not create v0.3 work.
