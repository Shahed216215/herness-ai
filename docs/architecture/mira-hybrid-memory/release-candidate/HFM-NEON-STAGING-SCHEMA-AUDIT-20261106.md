# HFM Neon Staging Schema Audit — 2026-11-06

Date: 2026-11-06
Repository branch: `work/hfm-release-candidate-reconciliation-20261106`
Status: `READ_ONLY_AUDIT_COMPLETE / APPLICATION_IMPLEMENTATION_BLOCKED`
Scope: Neon metadata, table schemas, row counts, RLS state, and role grants. No SQL writes or schema changes were performed.

## 1. Neon project identification

Two Neon projects with the same display name `mira-ai-agent-db` were returned:

| Project ID | Default branch | Observed state |
|---|---|---|
| `steep-grass-38696226` | `production` (`br-crimson-sun-a13xzreh`) | Contains `mira-hfm-test` and two backup/test branches |
| `fancy-wave-81945737` | `production` (`br-fragrant-unit-ao83lidm`) | Only the default branch was listed |

The HFM schema was found on `steep-grass-38696226 / mira-hfm-test` (`br-lingering-dawn-a18x6pxx`). These project IDs are not interchangeable. No project or branch was changed.

## 2. Staging schema inventory

The `mira-hfm-test` branch contains eight tables in `mira_hfm`:

- `authority_audit_events`
- `memory_audit_events`
- `memory_operation_registry`
- `memory_record_versions`
- `memory_records`
- `operation_authorities`
- `project_memberships`
- `project_owners`

All eight tables reported RLS and FORCE RLS enabled, with one project-scope policy per table.

## 3. Record-family compatibility

The `memory_records` and `memory_record_versions` constraints recognize `daily_activity`, `learning_note`, `knowledge_item`, `social_post_draft`, `client_vault_record`, and `financial_vault_record`.

For `daily_activity`, `learning_note`, and `social_post_draft`, the database requires schema version `1.1.0` and classification `PROJECT_PRIVATE`.

The record constraint enforces:
- `PUBLIC`: JSONB public payload with string `content`, and no encrypted envelope.
- `PROJECT_PRIVATE` / `RESTRICTED`: no public payload and a non-null JSONB encrypted envelope.

A social draft must not be written as plaintext into the public payload. Application-level encryption and a valid envelope/key lifecycle are prerequisites.

## 4. Observed row counts on the test branch

| Table | Rows |
|---|---:|
| `memory_records` | 0 |
| `memory_record_versions` | 0 |
| `memory_audit_events` | 0 |
| `memory_operation_registry` | 0 |
| `project_owners` | 0 |
| `project_memberships` | 0 |
| `operation_authorities` | 0 |
| `authority_audit_events` | 2 |

No user Memory or social-post draft records were present. The two authority audit rows were counted only; their payloads were not read.

## 5. Database role findings

- `mira_hfm_runtime`: SELECT only on the four primary Memory tables.
- `mira_hfm_memory_writer`: INSERT/SELECT/UPDATE on `memory_records`; INSERT on `memory_record_versions`; INSERT/SELECT on `memory_audit_events`; INSERT/SELECT/UPDATE on `memory_operation_registry`. No DELETE grant was listed for this role.
- `mira_hfm_it_runner`: SELECT/INSERT/UPDATE/DELETE on the four primary Memory tables. This is a test role and must not be reused as the production application role.
- `neondb_owner`: owner-level privileges.

A grant listing alone does not prove that transaction order, RLS context, operation authority, or audit semantics are correct.

## 6. Implementation blockers

1. The inspected release-candidate source branch does not contain the HFM unified facade/provider modules referenced by the work-learning retrieval bridge/tests.
2. The inspected test branch has zero `project_owners`, `project_memberships`, `operation_authorities`, and Memory records. No seeded project/actor authority context exists to exercise an authorized write.
3. The app branch's `package.json` does not declare the PostgreSQL driver required by the runtime-foundation source branch. The existing reconciliation report records package/lockfile conflicts; selecting a dependency manifest without reconciling those branches is unsafe.
4. Application-level encryption and external key lifecycle have not been verified. Private social drafts must fail closed without them.
5. No end-to-end evidence proves the full workflow: create draft -> read draft -> explicit Copy click -> manually publish outside Mira -> user-confirmed archive/trash action. Copy must never imply publication.

## 7. Next safe implementation sequence

1. Reconcile runtime-foundation and authority-integrity branches onto this release-candidate branch, preserving package scripts, dependencies, lockfile integrity, and migration lineage.
2. Restore/implement the missing unified HFM facade and repository boundary with trusted actor/project context.
3. Add an application-encryption/key-management boundary and tests; do not create production keys here.
4. Add social-draft operations using `social_post_draft` records, project-scoped authorization, stable operation/idempotency IDs, audit-intent-before-write, read-back verification, and fail-closed uncertain-outcome handling.
5. Add UI Copy-only interaction. Copy never marks the post published.
6. Treat deletion as an explicit user-requested lifecycle transition (trash/archive) with audit and recovery, not silent hard deletion.
7. Run exact-head offline tests and isolated Neon tests. Live Facebook access, production migration, and deployment remain separate approval gates.

## 8. Evidence and disposition

`NEON_PROJECTS_WITH_DUPLICATE_DISPLAY_NAME=2`
`HFM_SCHEMA_FOUND_ON=steep-grass-38696226/mira-hfm-test`
`HFM_STAGING_TABLE_COUNT=8`
`HFM_STAGING_RLS_FORCE_RLS=ENABLED_ON_ALL_8_TABLES`
`HFM_STAGING_MEMORY_RECORDS=0`
`HFM_STAGING_PROJECT_OWNERS=0`
`HFM_STAGING_PROJECT_MEMBERSHIPS=0`
`HFM_STAGING_OPERATION_AUTHORITIES=0`
`PRIVATE_SOCIAL_DRAFT_ENCRYPTION=REQUIRED_NOT_VERIFIED`
`APPLICATION_HFM_WRITE_PATH=BLOCKED`
`PRODUCTION_SCHEMA_OR_DATA_CHANGED=NO`
`LIVE_FACEBOOK_ACTIONS=NONE`
`DEPLOYMENT=NOT_PERFORMED`
`PRODUCTION_READINESS=NOT_CERTIFIED`
