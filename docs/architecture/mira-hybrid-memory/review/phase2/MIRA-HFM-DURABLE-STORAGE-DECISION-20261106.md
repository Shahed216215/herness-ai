# MIRA HFM — Durable Project Authority Storage Decision

**Date:** 2026-11-06  
**Decision status:** PROPOSED — backend not provisioned  
**Target PR:** #52  
**Budget constraint:** $0/month until explicitly changed

## Decision

Recommend **Neon Free PostgreSQL** as the first durable relational backend candidate for the Project Owner Registry, explicit Membership Registry, operation-scoped authority records, and audit events.

This is a technical recommendation, not proof that a Neon account/project exists. No account, database, credential, connection, migration, or production data has been created or changed.

## Why Neon Free

The currently published Neon Free offer includes 1 GB database storage per project, 100 CU-hours per project per month, and scale-to-zero compute. Neon describes a six-hour instant-restore window on Free. These limits are adequate for a small metadata-only HFM registry during development, subject to usage monitoring.

Sources:
- Neon Free plan update (Oct 2, 2026): https://neon.com/blog/neon-free-plan-1-gb-per-project
- Neon Free plan quota reference: https://neon.com/blog/neon-free-plan-1-gb-per-project
- Neon security and durability overview: https://neon.com/security

## Why not Render Free Postgres or Supabase Free as the first choice

- Render Free web services have ephemeral local filesystems. Render Free Postgres is limited to 1 GB and expires 30 days after creation; Render says Free instances are intended for testing/hobby use, not production. https://render.com/docs/free
- Supabase Free provides 500 MB database storage and may pause a project after seven days of low activity. Free plan does not include automatic daily database backups. https://supabase.com/docs/guides/platform/billing-on-supabase https://supabase.com/docs/guides/platform/free-project-pausing https://supabase.com/docs/guides/platform/free-plan-backups

Neon is preferred here because its compute scales to zero without deleting the database, has more included storage for this metadata workload, and publishes an instant-restore window. This does not remove the need for independent logical backups.

## Operational limitations and safeguards

1. Free quotas and product terms can change. Check the dashboard before provisioning and monitor storage, compute-hours, and egress.
2. Scale-to-zero means cold-start latency on the first query after idle.
3. Treat the six-hour instant-restore window as short recovery history, not a durable backup strategy.
4. Before any production records are written, establish a recurring encrypted logical export (for example, `pg_dump`) to a separately controlled private destination, retention rules, and a tested restore procedure.
5. Keep the database connection string server-side only. Never expose it to browser code, logs, Git, chat, or tool/model arguments.
6. Use a least-privilege runtime database role; the schema owner/migration role must not be used as the application's normal runtime identity.
7. Database unavailability must fail closed for HFM-authorized operations. Do not silently fall back to local JSON for owner or membership decisions.
8. Do not store memory/knowledge payloads in this registry. It is metadata and authority state only.

## Registry schema

Migration: `migrations/hfm/001_project_authority_registry.sql`

It creates four empty tables:
- `mira_hfm.project_owners`: at most one current owner per project; requires a canonical actor ID, evidence reference, approval reference, and positive revision.
- `mira_hfm.project_memberships`: explicit actor membership, bounded role/permissions, revision, expiry and revocation fields; only one ACTIVE membership per actor/project.
- `mira_hfm.operation_authorities`: operation/resource/purpose-bound authority, snapshots owner and membership revisions, and globally unique request ID to prevent request replay.
- `mira_hfm.authority_audit_events`: append-only event ledger; UPDATE, DELETE, and TRUNCATE are blocked by database triggers.

The migration deliberately contains no INSERT, UPDATE, import, seed, or project-owner assignment. Existing projects remain UNASSIGNED_BLOCKED until independently verified evidence and an approved assignment process exist.

## Important integration boundary

The current canonical actor ID is namespaced as `mira:<issuer>:<subject>`. The schema stores this canonical string and does not infer identity from role, username, email, project ID, or model/tool arguments.

The existing `project-store.js` persists project records in local `data/projects.json`. The new registry is separate and must not be wired into project creation or retrieval until:
- the database exists and connection security is reviewed;
- a migration runner and version ledger are implemented;
- owner assignment and membership mutations are transactionally coupled to audit events;
- actor context is consumed at the authorization/storage boundary;
- project reads/writes fail closed on missing or stale authority;
- tests cover login → actor → membership → operation authority → DB transaction → revocation/replay → restart/recovery.

No existing project owner is imported or inferred by this migration.

## Next gated work

1. User provisions a Neon Free project manually after confirming current quotas/terms.
2. Provide only the server-side connection string through the approved Render secret-management UI; never paste it into chat or commit it.
3. Run migration first against a disposable/test database, inspect the empty schema and privilege model, then run a restore test.
4. Implement a server-only PostgreSQL adapter and transaction-safe repository behind explicit HFM feature gates.
5. Validate with synthetic projects and actors before any real project ownership is recorded.
6. Production deployment remains blocked until rollback, backup, authorization, and authenticated live-test gates pass.

## Status

- Backend selected: **Neon Free (recommended; not provisioned)**
- Monthly target: **$0**
- Migration authored: **YES (not executed)**
- Existing project records changed: **NO**
- Owner/membership records created: **NO**
- Production credentials/settings changed: **NO**
- Deployment: **NOT PERFORMED**
- Production HFM readiness: **NOT_CERTIFIED**


## Source-contract CI evidence

Latest candidate commit: `b9931ae74b67bd74b905ba6e612cb532b1f18f96`

GitHub Actions run #62 (`42167098189`):
- `identity-context`: **PASS**, including the project-authority schema source-contract test.
- `repository-regression`: **PASS**, including the new schema source-contract test at the start of `npm test`.

This CI validates source-level invariants only. It does **not** parse or execute the PostgreSQL migration against a live database, prove runtime database privileges, or establish a Neon account/project. SQL execution and integration tests remain **NOT_PERFORMED**.
