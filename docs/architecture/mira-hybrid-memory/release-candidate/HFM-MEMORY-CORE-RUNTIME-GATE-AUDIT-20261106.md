# HFM v0.2 — Memory Core Runtime Gate Audit

Date: 2026-11-06
Repository: `Shahed216215/herness-ai`
Audit base: `work/hfm-memory-core-implementation-20261106`
Base commit: `98a3e4b38ba39460b70bc7fcaf807851853c3d73`
Database target: Neon disposable branch `mira-hfm-test`
Project ID: `steep-grass-38696226`
Branch ID: `br-lingering-dawn-a18x6pxx`
Database: `neondb`
Mode: READ-ONLY SQL inspection; no DDL/DML, grants, or credential changes.

## 1. Current application implementation

PR #70 provides the initial HFM Memory Core:
- AES-256-GCM envelope encryption with per-record DEK and versioned KEK wrapping.
- Canonical record validation for daily activity, learning notes, knowledge items, social drafts, client vault and financial vault records.
- Transaction-client-only repository with create/revise/project-scoped get/list/recoverable trash/restore.
- One-time authority context is required for repository writes.
- Deterministic Bengali daily knowledge post builder.
- Writer pool preflight checks a separately configured writer URL, explicit enable flag, expected role, group membership, table grants and forced RLS.
- Source-only Migration 005 defines the NOLOGIN writer group and project RLS; PR #70 documents that it has not been executed by that PR.

Exact-head GitHub Actions run `42248694340` completed with conclusion `success`. This is source/contract and repository regression evidence, not proof of Render live integration.

## 2. Live disposable Neon observations

The disposable branch currently exposes eight tables in `mira_hfm`:
- `project_owners`
- `project_memberships`
- `operation_authorities`
- `authority_audit_events`
- `memory_records`
- `memory_record_versions`
- `memory_operation_registry`
- `memory_audit_events`

All eight tables report both Row-Level Security enabled and FORCE ROW LEVEL SECURITY enabled.

Read-only row counts:
| Table | Rows |
|---|---:|
| project_owners | 0 |
| project_memberships | 0 |
| operation_authorities | 0 |
| authority_audit_events | 2 |
| memory_records | 0 |
| memory_record_versions | 0 |
| memory_operation_registry | 0 |
| memory_audit_events | 0 |

The two authority audit rows were not read or exported.

## 3. Role and grant observations

Roles visible with the `mira_hfm%` prefix:
- `mira_hfm_runtime`: LOGIN, not superuser, does not bypass RLS.
- `mira_hfm_it_runner`: LOGIN, not superuser, does not bypass RLS. It has broad test privileges, including DELETE on project and Memory tables. It is test-only and must never be used by the application.
- `mira_hfm_memory_writer`: NOLOGIN, not superuser, does not bypass RLS. It has the intended narrow writer grants on Memory tables and authority transaction tables.

The observed role-membership direction shows `neondb_owner` is a member of the HFM roles; it does not show a dedicated LOGIN role granted membership in `mira_hfm_memory_writer`. No application writer login was established by this audit.

The runtime role has SELECT-only access to the inspected project/Memory tables. This is appropriate for the metadata/read-only boundary but cannot execute the authority transaction's UPDATE/INSERT operations.

## 4. Runtime gates

| Gate | Result | Evidence / reason |
|---|---|---|
| Memory schema exists on disposable branch | PASS | Four Memory tables are present |
| RLS + FORCE RLS on all eight tables | PASS | Catalog inspection |
| Memory/project fixture state is empty | PASS | All relevant data tables are empty; two existing authority audit rows retained |
| Dedicated application writer LOGIN | NOT_CONFIGURED | Writer group is NOLOGIN; no dedicated writer member was observed |
| Project owner / membership / authority provisioning | BLOCKED | All three registries have zero rows |
| Runtime writer connection | NOT_CONFIGURED | No application writer login/URL was established by this audit |
| KEK custody and Render secret configuration | NOT_VERIFIED | No secret values inspected; configuration is not proven |
| Legacy Memory/Knowledge routes and tools use HFM repository | NOT_IMPLEMENTED | PR #70 explicitly excludes these integrations |
| Daily activity/learning event capture | NOT_IMPLEMENTED | Builder exists; source-event capture is not wired |
| Social draft preview / Copy / Trash UI | NOT_IMPLEMENTED | Repository supports recoverable trash; UI/API flow is absent |
| Public Facebook Page research ingestion | NOT_IMPLEMENTED in PR #70 | No public Page ingestion adapter is included in this PR |
| RLS policy predicate review | REVIEW_REQUIRED | This audit verified enabled/forced flags, not the full policy expressions |
| Render live integration | NOT_RUN | No Render deployment or live request was performed |

## 5. Safety boundary

- Only read-only SQL statements were executed against the disposable `mira-hfm-test` branch.
- No row was inserted, updated, deleted or exported.
- No schema, role, grant, credential, KEK, Render environment variable, production database or deployment was changed.
- No Facebook login, API, publishing, messaging or scraping action was performed.
- The production Neon branch was not queried or modified during this audit.

## 6. Required next sequence

1. Independently review Migration 005 and the complete RLS policy expressions.
2. Define and review the explicit project-owner bootstrap procedure; do not infer the owner from email, display name, request body or shared bearer.
3. Establish a separately reviewed writer LOGIN and grant only the NOLOGIN writer group; do not use `mira_hfm_it_runner`.
4. Establish KEK custody, backup/recovery and Render secret rotation procedures without exposing secrets in logs or chat.
5. Add route/tool integration only after trusted principal, owner, membership, one-time authority and writer-pool preflight can all pass.
6. Wire daily activity/learning capture from verified server events; never invent activity or silently capture sensitive client/financial payloads.
7. Add draft preview and direct-click Copy; Copy is not Published. Add audited recoverable Trash/Restore.
8. Add public-only Facebook/Page retrieval with SSRF, redirect, content-size, timeout and untrusted-content controls.
9. Run disposable Neon integration, full regression, independent security review, and controlled Render live tests.
10. Request separate approval before any production migration, Render configuration change, deployment or merge.

## 7. Release assessment

`HFM_MEMORY_CORE_SOURCE=CI_SUCCESS`
`DISPOSABLE_NEON_MEMORY_SCHEMA=OBSERVED`
`PROJECT_AUTHORITY_PROVISIONING=BLOCKED`
`WRITER_LOGIN=NOT_CONFIGURED`
`KEK_CUSTODY=NOT_VERIFIED`
`LEGACY_RUNTIME_INTEGRATION=NOT_IMPLEMENTED`
`DAILY_ACTIVITY_CAPTURE=NOT_IMPLEMENTED`
`SOCIAL_DRAFT_COPY_UI=NOT_IMPLEMENTED`
`FACEBOOK_PUBLIC_RESEARCH_INGESTION=NOT_IMPLEMENTED`
`RENDER_LIVE_TEST=NOT_RUN`
`PRODUCTION_READINESS=NOT_CERTIFIED`
