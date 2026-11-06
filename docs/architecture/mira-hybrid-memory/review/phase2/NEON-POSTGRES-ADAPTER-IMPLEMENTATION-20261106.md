# Mira HFM v0.2 — Neon PostgreSQL Adapter

Status: implementation branch only; not merged or deployed.

## Scope
- Dedicated connection variable: MIRA_HFM_DATABASE_URL. The adapter never falls back to DATABASE_URL.
- Neon PostgreSQL hosts only; TLS is mandatory and certificate verification remains enabled.
- Small connection pool (max 2), bounded connection/query timeouts.
- Read-only inspection runs inside BEGIN READ ONLY and returns database/schema/table metadata only.
- Connection errors are reduced to bounded error codes; connection strings and driver messages are never returned.
- No automatic migration, data import, project-owner assignment, or Memory/Knowledge cutover.

## Database roles
1. Migration owner: used only in Neon Console for reviewed schema migrations on a disposable branch.
2. mira_hfm_runtime: separate login role for the app. It receives CONNECT, schema USAGE and SELECT only.
3. Synthetic integration test: use a disposable Neon branch and a separate owner/test credential. It creates a uniquely named temporary schema, tests INSERT/COMMIT, ROLLBACK and state recovery, then attempts to drop only that exact generated schema.

The runtime role must not receive DDL or write privileges. Do not put the owner credential in Render.

## Required environment
- Render runtime secret: MIRA_HFM_DATABASE_URL = connection string for mira_hfm_runtime, with sslmode=require.
- Optional synthetic test only: MIRA_HFM_TEST_DATABASE_URL = owner/test connection string for a disposable Neon branch.
- Synthetic test write consent: MIRA_HFM_TEST_DATABASE_ALLOW_WRITES=I_CREATED_A_DISPOSABLE_NEON_BRANCH.
- Never reuse the production/runtime URL for the synthetic test.

## Validation gates
1. CI unit tests pass.
2. Apply migration 001 only on a disposable Neon branch and inspect created tables.
3. Create mira_hfm_runtime on that branch; apply migration 002 grants.
4. Confirm runtime role can inspect schema and cannot INSERT/UPDATE/DELETE/CREATE.
5. Run synthetic transaction test using disposable branch owner credentials; confirm commit, rollback and recovery; test schema cleanup.
6. Review Neon backup/restore options and retention before any production data.
7. Only after all gates and separate approval: configure Render secret and run a controlled read-only connection check. No merge/deploy is implied by this document.

## Current limitations
- This adapter does not yet authorize project-level operations or connect Memory/Knowledge reads/writes to HFM.
- Migration SQL is not executed by the application.
- No production database is contacted by unit tests.
- Neon Free usage quotas and restore windows must be checked in the Neon dashboard before relying on it for durable production data.
