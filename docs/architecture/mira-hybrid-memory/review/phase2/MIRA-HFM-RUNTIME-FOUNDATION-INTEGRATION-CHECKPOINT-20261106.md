# Mira HFM Runtime Foundation — Integration Checkpoint

Date: 2026-11-06
Branch: `work/hfm-runtime-integration-from-render-main-20261106`
Base: `work/render-main-host-binding-compat-20261106`

## Scope ported

- Canonical host identity normalizer for trusted, server-issued principals.
- Session identity context resolver with fail-closed behavior.
- Login boundary issues a principal only for a stable registered-user UUID or separately provisioned `MIRA_ADMIN_SUBJECT_ID`.
- Trusted context is passed through the work execution engine, tool runner, and tool executor.
- Read-only Neon/PostgreSQL metadata adapter and admin-only database status tool.
- Transactional owner → membership → operation-authority locking/consumption primitive.
- Empty HFM owner, membership, operation-authority, and append-only audit schema migrations.
- Offline contract tests for identity, adapter, tool gating, schema source, and authority transaction.

## Explicitly not implemented

- No Memory or Knowledge payload read/write is routed through HFM.
- No Project or Conversation storage is migrated to PostgreSQL.
- No owner/membership/authority provisioning workflow or existing-project ownership assignment exists.
- No shared bearer token-to-subject mapping exists; shared bearer remains fail-closed for HFM identity.
- No real Render admin subject has been configured.
- No runtime writable PostgreSQL pool is exposed to application routes or tools.
- No SQL migration is executed by this branch or workflow.
- No production DB connection, data read, write, migration, secret change, Render change, merge, or deployment is authorized by this checkpoint.

## Safety constraints

- `MIRA_HFM_DATABASE_URL` is a dedicated HFM connection setting; the adapter does not fall back to generic `DATABASE_URL`.
- The default runtime pool is TLS-verified and read-only.
- The transactional primitive accepts a server-verified principal and a database callback using the same transaction client. It is not yet called by application routes.
- The admin database status tool returns metadata only and requires a canonical admin principal.
- Existing legacy global Memory/Knowledge/Project stores remain unchanged. They must not be silently treated as project-scoped.

## Required next gates

1. Review identity creation, session expiry/revocation, admin provisioning, and bearer identity separately.
2. Implement an approved owner/membership/authority provisioning lifecycle with audit and revision semantics.
3. Design a separate payload storage model and per-project retrieval enforcement for Memory/Knowledge.
4. Integrate every relevant route/tool with transaction-scoped authority checks; fail closed if DB is unavailable.
5. Add isolation, cross-project denial, revocation, replay, concurrency, restore, and restart-recovery tests.
6. Run CI and disposable Neon integration only with explicitly approved test credentials.
7. Review backup/restore and Render Free durability constraints before any production rollout.

## Current release decision

`HFM_RUNTIME_FOUNDATION=PARTIAL`
`PROJECT_SCOPED_MEMORY_KNOWLEDGE=NOT_IMPLEMENTED`
`PRODUCTION_DEPLOYMENT=BLOCKED`
