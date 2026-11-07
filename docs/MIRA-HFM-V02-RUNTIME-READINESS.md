# Mira HFM v0.2 — Runtime Integration Readiness

Status: **implementation branch / manual social-draft workflow wired / runtime disabled / not production-ready**

This document records the HFM v0.2 runtime boundary and exact release gates. It does not authorize database migrations, owner or membership provisioning, production environment changes, merge, or Render deployment.

## Implemented in this branch

- Fail-closed unified retrieval facade. It requires trusted host authorization, project-scoped request context, per-record READ decisions, VERIFIED integrity, trusted state, ACTIVE lifecycle, and conflict exclusion. It has no Local JSON or Google Drive fallback.
- Work Learning retrieval bridge. It filters through the facade before relevance ranking and returns non-executable, read-only learning candidates.
- Feature-flagged HFM Work Learning runtime. When `MIRA_HFM_WORK_LEARNING_ENABLED=true`, `executeWork` first resolves the dedicated Memory reader and `createTaskPlan` performs an authorized, audited standing `memory.read` transaction **before `understandTask` or task-planning/model work begins**. The resulting verified snapshot is reused for Work Learning relevance ranking after task understanding, avoiding a second database retrieval/audit. Only ACTIVE `learning_note` / `knowledge_item` records are accepted; LIST/READ decisions are bound to the transaction-verified actor/project/authority context and HFM eligibility checks run before ranking. The planner does not consult legacy local cross-task learning or future-strategy stores in this mode. Precomputed plans are rejected while this feature flag is enabled so they cannot bypass HFM preflight. Both Work Learning and standing-read flags must be enabled; missing, paused, expired, revoked, unauthorized, or unavailable HFM authority fails closed before task understanding. When disabled, the legacy planning path remains unchanged.
- Dedicated project-selection reader and session-bound project-selection route. Actor identity is derived from the authenticated session principal; a project binding is persisted only after active membership is verified.
- Dedicated Memory retrieval reader. It verifies database identity, login role, role isolation, effective privileges, forced RLS, and required policies before returning a pool.
- Authorized Memory reader. It derives actor/project from server-held session state, validates a server-held one-time authority, consumes that authority, appends an audit event, and reads eligible Memory in the same transaction.
- Server-only authority issuer. It supports only short-lived, single-use `memory.read`, `memory.write`, `memory.trash`, and `memory.restore` authorities after checking active owner/membership and a consumed signed approval. Permanent purge is not an allowed operation.
- HMAC approval-token signer/verifier. It binds project, actor, approver, operation, resource, purpose and expiry; verifies signatures in constant time; and requires atomic nonce redemption.
- Recent-admin approval service. It requires a stable configured admin subject, fresh authenticated admin session, verified project binding, active owner/membership, explicit confirmation, and a purpose.
- 365-day Standing Read Authority. A single explicit admin approval creates a separate, project-bound `memory.read` grant for `learning_note` and `knowledge_item` records only. It does not reuse or weaken the one-time authority table; every read is rechecked against active owner/membership revisions and appended to the authority audit log. The grant can be paused, resumed, or permanently revoked, and expires after 365 days. No per-read approval is required while it remains active. It grants no Memory write/edit/trash/restore/purge or Facebook publishing capability.
- Standing-authority management routes and Knowledge & Memory UI controls require explicit confirmation for issuance and expose status, pause, resume, and revoke. Standing reads remain disabled unless `MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED=true`; the default remains disabled.
- Persistent approval nonce ledger. Raw HMAC tokens are not stored. Nonces are hashed, scoped, short-lived, single-use and audited on issuance/consumption.
- One-time initial-project bootstrap route and source-only Migration 013. It creates only the initial owner, matching ADMIN membership, one-time bootstrap latch and audit row in one transaction; it imports no legacy Memory.
- Daily social-draft generation route. It reads eligible active daily activity/learning notes using a one-time `memory.read` authority, builds a Bangladesh-time-zone daily post, and writes a private `social_post_draft` through a separate one-time `memory.write` authority and dedicated writer transaction.
- Canonical agent Memory save integration. With `MIRA_HFM_MEMORY_WRITE_ENABLED=true`, the existing `memory_save` tool is routed to a new HFM-only writer runtime; it accepts only explicit user save intent and requires the saved text to appear verbatim in the current user message (paraphrased or inferred content is rejected). It writes a private `knowledge_item` with HUMAN_VERIFIED trust and ACTIVE lifecycle, using a server-held one-time `memory.write` authority plus deterministic task/tool-call idempotency. It does not call legacy JSON or Google Drive stores.
- Canonical agent Knowledge save integration. With the same write flag, `knowledge_save` stores a private `knowledge_item` as SOURCE_RECORDED/PENDING_REVIEW after validating and sanitizing an HTTPS source URL. It is deliberately excluded from trusted search until a separate verification/update workflow exists; it does not elevate external source content to trusted knowledge.
- Canonical agent Learning save integration. With the same independent writer flag, `learning_save` stores a user-requested learning source as a private `learning_note` in SOURCE_RECORDED/PENDING_REVIEW. It requires explicit save intent and a separate single-use `memory.write` authority; it does not run legacy automatic learning, mark the note trusted, or make it eligible for Work Learning until human review and a future authorized verification/update workflow.
- Pending Knowledge/Learning review queue. The `knowledge_review_queue` tool lists only PROJECT_PRIVATE `knowledge_item` and `learning_note` records in PENDING_REVIEW/SOURCE_RECORDED state after an explicit review request. Because these records are unverified and outside the ACTIVE-record Standing Read scope, this queue uses a separate short-lived, single-use `memory.read` grant and a verified project-admin context; it does not silently consume or broaden the 365-day standing grant. Source URL query/fragment data is redacted. Results are a manual review surface, not trusted task context. Promotion/verification is not implemented because the current runtime authority contract does not include `memory.update`.
- HFM write context is server-held: the execution engine resolves the dedicated writer and authority-issuer pools and passes the authenticated request, original user intent, task ID, and tool-call ID. Missing runtime, disabled flags, absent membership permission, invalid user intent, or failed authority checks fail closed. Direct legacy tool execution also refuses HFM mode; no local or Drive fallback is used.

- Manual Facebook workflow in the existing Knowledge & Memory section: generate a private draft, copy it with the browser clipboard, manually publish it in Facebook, explicitly confirm publication, and move only that `social_post_draft` to recoverable Neon Trash. No Facebook API publishing or auto-publish path exists. Trash can be listed and restored; it is not a hard delete.
- Authenticated same-origin HTTP routes:
  - `POST /api/hfm/projects/select`
  - `POST /api/hfm/memory/authorize`
  - `POST /api/hfm/memory/read`
  - `POST /api/hfm/memory/standing-authority/status`
  - `POST /api/hfm/memory/standing-authority/issue`
  - `POST /api/hfm/memory/standing-authority/pause`
  - `POST /api/hfm/memory/standing-authority/resume`
  - `POST /api/hfm/memory/standing-authority/revoke`
  - `POST /api/hfm/bootstrap/initial-project`
  - `POST /api/hfm/social-drafts/generate-daily`
  - `POST /api/hfm/social-drafts/trash`
  - `POST /api/hfm/social-drafts/restore`
- The one-time authorize route stores its grant in the server-side session and never returns the grant or approval token to the browser. The read route removes that session grant before one-time retrieval; database authority consumption is independently atomic. In standing mode, the read route accepts no client-supplied grant: it discovers the active database grant using the verified actor/project session and performs the read plus audit in one serializable transaction.
- Migrations 007–009 preserve the previously applied issuer/bootstrap/login baseline. Runtime additions 010–014 are source-only: Memory reader role, issuer hardening, approval nonce registry, one-time bootstrap role, and 365-day standing read authority.
- Synthetic tests cover project selection → authorized Memory retrieval, approval signing/replay protection, 365-day standing authority issue/status/pause/resume/revoke, route consent and same-origin guards, UI scope/consent controls, per-read audit and revoked-grant denial, audit-insert failure rollback, non-admin route denial, Work Learning runtime authorization-context binding, feature-flag fail-closed behavior, HFM preflight before `understandTask`, functional propagation of retrieved lessons into task verification planning, and the no-legacy-local-fallback task-planning path. Disposable PostgreSQL 16 CI additionally overlaps two SERIALIZABLE standing-read transactions under the least-privilege reader role and verifies that both independently committed retrievals have distinct audit rows.

## Runtime environment variable names

Values must be supplied only after the target database and role credentials are independently verified. Do not copy a writer credential into a reader variable.

| Purpose | Environment variables |
|---|---|
| Project-selection reader | `MIRA_HFM_PROJECT_READ_ENABLED`, `MIRA_HFM_PROJECT_READ_DATABASE_URL`, `MIRA_HFM_PROJECT_READ_ROLE` |
| Memory retrieval reader | `MIRA_HFM_MEMORY_READ_ENABLED`, `MIRA_HFM_MEMORY_READ_DATABASE_URL`, `MIRA_HFM_MEMORY_READ_ROLE` |
| One-time authority issuer | `MIRA_HFM_AUTHORITY_ISSUER_ENABLED`, `MIRA_HFM_AUTHORITY_ISSUER_DATABASE_URL`, `MIRA_HFM_AUTHORITY_ISSUER_ROLE` |
| One-time bootstrap | `MIRA_HFM_BOOTSTRAP_ENABLED`, `MIRA_HFM_BOOTSTRAP_DATABASE_URL`, `MIRA_HFM_BOOTSTRAP_ROLE` |
| Signed approval flow | `MIRA_HFM_APPROVAL_TOKEN_SECRET` (minimum 32 bytes) |
| Standing read authority | `MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED` (must remain `false` until Migration 014 and reader/issuer preflights are verified) |
| HFM Work Learning integration | `MIRA_HFM_WORK_LEARNING_ENABLED` (must remain `false` until standing-read authority and HFM Work Learning record availability are verified) |
| Memory writer (separate existing path) | `MIRA_HFM_MEMORY_WRITE_ENABLED`, `MIRA_HFM_MEMORY_DATABASE_URL`, `MIRA_HFM_MEMORY_WRITER_ROLE` |
| Stable admin principal | `MIRA_ADMIN_SUBJECT_ID` |

Feature flags must remain disabled until database readiness, target mapping, role provisioning and owner/membership bootstrap are verified. No secret values are recorded in this document.

## Canonical agent Memory write mode

The writer remains disabled by default. The following must all be independently ready before enabling it:

- `MIRA_HFM_MEMORY_WRITE_ENABLED=true` and `MIRA_HFM_AUTHORITY_ISSUER_ENABLED=true`.
- Dedicated `MIRA_HFM_MEMORY_DATABASE_URL` and `MIRA_HFM_MEMORY_WRITER_ROLE` for the Memory writer.
- Dedicated `MIRA_HFM_AUTHORITY_ISSUER_DATABASE_URL` and `MIRA_HFM_AUTHORITY_ISSUER_ROLE` for the issuer.
- `MIRA_HFM_APPROVAL_TOKEN_SECRET` and stable `MIRA_ADMIN_SUBJECT_ID` for signed, single-use approval.
- `MIRA_VAULT_ACTIVE_KEK_VERSION` and the matching versioned `MIRA_VAULT_KEK_Vn` key for encrypted PROJECT_PRIVATE payloads.
- The selected project membership must explicitly include `memory.write`. The last inspected staging membership contained `memory.read` only; it does not currently authorize writes. No membership or credential was changed.

This mode supports record creation only. It does not add `memory.update`, trust promotion, permanent deletion, or restricted client/financial vault writes. Knowledge sources saved by `knowledge_save` remain PENDING_REVIEW until a separately approved update/verification contract and workflow exist. Do not enable the writer flag based solely on the presence of the code.

## Private payload digest and audit-chain hardening

- PUBLIC records retain canonical SHA-256 idempotency digests because their payloads are intentionally public.
- PROJECT_PRIVATE and RESTRICTED records use a domain-separated HMAC-SHA-256 digest key derived from the configured versioned KEK. Plaintext canonical hashes are not stored in the operation registry.
- During KEK rotation, idempotency reconciliation checks digests derived from every configured KEK version, with the active version used for new writes. Keep prior KEK versions configured while operations created under those keys may still be retried. The operation registry currently has no automatic expiry; removing an old KEK before controlled reconciliation can make an old idempotency key return a conflict rather than a replay result.
- Private content hashes are not copied into audit event metadata or retrieval provenance. They remain inside the encrypted canonical record.
- Project audit hash-chain appends acquire a transaction-scoped advisory lock before reading the previous event hash, serializing concurrent appends within a project.

These controls passed focused regression tests in the HFM Memory repository contract workflow on code commit `645af36db7a3150d2f53f8570228b93cebab7ba6`: keyed digest determinism/KEK-rotation reconciliation, private digest opacity, audit metadata redaction, and serialized project audit appends. Later branch commits changed documentation only.

## Required database roles and migration order

1. Verify the existing HFM schema and forced-RLS tables on the exact approved target database.
2. Migration 006 defines the project-selection NOLOGIN group role and its two read-only RLS policies.
3. Migration 007 preserves the previously applied authority-issuer capability role and its baseline project-scoped policies.
4. Migration 008 preserves the previously applied owner/membership bootstrap capability extension for the issuer role.
5. Migration 009 preserves the previously applied dedicated Memory-writer and authority-issuer LOGIN principals.
6. Migration 010 defines the constrained Memory reader role and its project-scoped SELECT / authority-consumption / audit-insert privileges.
7. Migration 011 hardens the existing authority issuer role, removes the old broad policies, and installs actor-bound issuer policies.
8. Separately provision a dedicated LOGIN role for each runtime group role. Each login must inherit only its matching NOLOGIN group role, must not own database objects, and must have no elevated privileges.
9. Configure the application with the matching dedicated credentials and exact target database. Runtime preflights must verify database identity, role identity, effective privileges, RLS and exact policies before the routes can operate.

Migrations 010–014 are source-only additions and have not been applied to the inspected staging target. Migrations 007–009 preserve the previously applied production baseline. Do not execute any new migration until the target database is unambiguously mapped, a backup/recovery point is confirmed, and explicit staging approval is obtained.

## Outstanding blockers

- **Migration source lineage:** the branch preserves the previously applied 007–009 SQL and places runtime additions at 010–014. Migration 011 hardens the existing issuer role and removes the prior broad issuer policies. Migration 006 remains a source-level conflict with the deferred social-post payload-erasure migration from the separate Memory Core branch; keep only the project-selection policy at 006 here. The full 001–014 chain and the revised migration workflow are verified on disposable PostgreSQL 16 by CI for functional-code commit `b7656ac766e1a42a9e7b4eabd67b005dd01fffaa`; exact-target Neon role/policy compatibility remains unverified. Migration 013 bootstrap is not applicable to the inspected non-empty staging registry. See [Migration Lineage Reconciliation](MIRA-HFM-V02-MIGRATION-LINEAGE-RECONCILIATION-20261107.md).


- Latest read-only staging inspection shows `project_owners=1`, `project_memberships=1`, `memory_records=1`, `operation_authorities=0`, and `authority_audit_events=2`; one active owner row matches one active ADMIN membership. The membership currently grants `memory.read` but not `memory.write`, `memory.trash`, or `memory.restore`. Row provenance has not been independently certified. Preserve all existing rows; do not treat staging as empty or run the one-time bootstrap migration against it.
- The admin HFM subject must be provisioned and match `MIRA_ADMIN_SUBJECT_ID`.
- Migrations 010–014 are not applied in the inspected staging database; the Memory reader role, issuer hardening, nonce registry, bootstrap latch and standing-authority registry are not present there.
- Dedicated LOGIN credentials for the project reader, Memory reader, authority issuer, bootstrap operator and Memory writer have not been provisioned or verified.
- HFM runtime feature flags and database credentials remain disabled/unconfigured in Render; no live HFM read/write/trash/restore has been verified.
- The manual social-draft UI and standing-authority controls are implemented but cannot function against the live service until the database and runtime gates above are completed. Keep the standing-read feature flag disabled until Migration 014 is applied to the verified target and both reader/issuer preflights pass.
- The staging-to-Render production Neon target cannot be conclusively mapped while duplicate Neon projects exist. Do not guess which project is production.
- Legacy Memory and Knowledge consumers remain available only when both HFM flags are disabled. The retrieval callsite inventory reports 36 calls across 15 files. The bounded HFM Work Learning bridge is wired into `executeWork` behind two disabled-by-default flags, with HFM reader context passed to governed tools. A central guard blocks legacy Knowledge JSON load/save, local Memory read/write, and legacy Google Drive Knowledge/Memory read/write whenever either HFM standing-read or Work Learning mode is enabled; `services/learning.js` also rejects legacy Learning workflows before model calls. The admin Knowledge search endpoint, exact Knowledge detail endpoint, chat Knowledge recall, and Work `knowledge_search` tool use the dedicated HFM `knowledge_item` and `learning_note` search runtime under the 365-day standing `memory.read` authority, with canonical trust/integrity/project filtering before ranking and no local/Drive fallback. Other legacy Memory/Knowledge/Learning tools (count, restore, backup, cleanup, improvement, and unsupported Learning operations) fail closed. `memory_save`, `knowledge_save`, and `learning_save` do not use standing authority: they are routed only when the separate HFM writer flag is enabled, and each save requires explicit current-message intent plus a separate single-use `memory.write` grant. User-supplied learning notes are stored as `learning_note` / `SOURCE_RECORDED` / `PENDING_REVIEW`, not as trusted active Learning; legacy local/Drive save paths remain blocked. Knowledge edit and delete are explicitly blocked; the standing grant itself has no write/edit/delete/restore permission. The admin status dashboard reports legacy Memory/Knowledge metrics as unavailable rather than reading local stores, and chat conversation recall is disabled in HFM mode rather than consulting local Memory. Legacy Knowledge-improvement and autonomous-learning routes, Mira Evolution routes, local experience-lesson reads, and low-level legacy evolution JSON/snapshot reads/writes are blocked while HFM read-only mode is active. Do not enable the HFM flags for broader Learning/Knowledge workflows until the remaining consumers are migrated and tested.
- A successful synthetic test does not prove a live Neon policy, credential, session-store, or Render environment is correct.

## Staging database read-only inspection

Read-only inspection of Neon staging project `steep-grass-38696226`, branch `br-lingering-dawn-a18x6pxx` (`mira-hfm-test`), database `neondb`:

- The five existing HFM owner, membership, authority, authority-audit and Memory tables have RLS enabled and FORCE RLS enabled.
- Existing project-reader and Memory-writer roles have the expected NOLOGIN / NOINHERIT / no-superuser / no-BYPASSRLS attributes.
- No existing `mira_hfm_memory_reader` or `mira_hfm_authority_issuer` role was present at inspection time.
- No existing issuer policy-name collision was found at inspection time; the authority audit identity sequence resolves to `mira_hfm.authority_audit_events_event_sequence_seq`.
- Latest read-only row counts (2026-11-07): owners 1, memberships 1, authorities 0, Memory records 1, authority audit events 2. A read-only join found one active owner-to-ADMIN-membership pair. Its membership permissions include `memory.read` only among the four HFM Memory operations; `memory.write`, `memory.trash`, and `memory.restore` are absent. The previously recorded zero-count snapshot is stale and must not be used for migration planning. Existing rows were not modified. The single Memory row is `social_post_draft` / schema `1.1.0`, `PROJECT_PRIVATE`, `ACTIVE`, integrity `VERIFIED`, trust `SOURCE_RECORDED`; its payload-erasure markers are set and both payload columns are NULL. It is not eligible for unified retrieval (trust is below `CONTENT_VERIFIED` / `HUMAN_VERIFIED`), and no content was read. Do not restore or rewrite it without provenance and explicit approval.
- The nonce registry table does not exist yet because Migration 012 has not been applied.

This is structural preflight evidence only. No migration, role creation, grant, seed, or application-data write was executed. Migration 013 explicitly rejects any existing owner, membership, authority, or Memory rows (`HFM_BOOTSTRAP_REQUIRES_EMPTY_PROJECT_AND_MEMORY_REGISTRIES`); its preflight is therefore expected to fail on the currently inspected staging branch. Do not delete, truncate, rewrite, or import around these rows. Project selection and authority issuance still require separate validation of the existing owner/membership records and the missing runtime roles/policies. Production Neon target mapping remains unresolved.

## Validation evidence

The earlier code commit `92b3042cdfa2d2f3a63783c393cc9d879e932d4b` passed its then-current 001–011 disposable PostgreSQL chain. After the migration lineage restack, code commit `645af36db7a3150d2f53f8570228b93cebab7ba6` passed the revised canonical 001–014 PostgreSQL 16 migration workflow, the HFM Memory repository contract workflow, and the HFM runtime foundation workflow. The PostgreSQL job verified the full migration chain, bootstrap/issuer nonce flow, 365-day standing-read RLS/audit behavior, forced RLS, and exact role boundaries. The later `80aedfabd5c07d2f573c9f222eced0178605aeb8` and `26970a77e19f5b9fb1d83a35f215dd7ce550eb1f` commits changed documentation only. Live Neon compatibility remains NOT_VERIFIED. The embedded social-draft UI script also has parser-level syntax validation.

These are synthetic/offline or disposable-CI results. They are not live Neon or Render evidence. No live HFM database write or migration has been performed. The 365-day standing-authority migration and synthetic route/service/UI contracts passed disposable PostgreSQL CI. This does not validate the live Neon staging database or Render runtime.

## Release and deployment gates

- Keep this work on `work/mira-hfm-v02-runtime-integration`.
- Keep PR #79 as a draft while database and legacy-callsite gates remain open.
- Do not merge to `main`: Render Auto Deploy is enabled.
- Do not set HFM feature flags to `true` before dedicated roles, database target mapping, owner/membership bootstrap, and authority issuance are verified.
- Ask for explicit approval before any database migration, bootstrap write, production environment mutation, merge, or Render deployment.
- Stay within HFM v0.2. Do not create v0.3 work.

## Runtime consumer isolation and lifecycle consistency — 2026-11-07

- HFM-mode Work `knowledge_search` uses the server-held authenticated request and dedicated Memory reader pool passed by `executeWork`; the tool cannot fall back to Local JSON or Google Drive. Legacy `memory_*`, `knowledge_*`, and `learning_*` consumers are denied in HFM mode, except the three explicit save tool names (`memory_save`, `knowledge_save`, `learning_save`) which are routed to the separate, one-time `memory.write` workflow only when its independent writer flag is enabled.
- Standing-read-only Work execution now resolves the authenticated reader context independently of the Work Learning flag. If standing-read is enabled, the server-held request and reader pool are required before task execution; Work `knowledge_search` can use HFM even when Work Learning retrieval itself is disabled. If both flags are disabled, legacy behavior is unchanged.
- Legacy Knowledge-improvement and autonomous-learning routers, Mira Evolution routes, and local experience-lesson reads are blocked while either HFM flag is enabled. `knowledge-memory-evolution.js` enforces the legacy-storage guard at low-level JSON read/write boundaries, so direct callers cannot bypass the route guard.
- Standing-authority issuance, reads, status/expiry processing, pause, resume, and revoke use the same transaction-scoped advisory lock keyed to the verified project and actor. This serializes issuance and reads against lifecycle changes without granting the Memory reader any table UPDATE privilege. Status lookup persists natural expiry as `EXPIRED`, allowing the database lifecycle trigger to append the expiry audit event.
- Focused tests verify unauthorized actors, cross-project reads, write-only membership, read-only tool routing, local/Drive evolution fallback denial, and lifecycle serialization. The HFM vault digest candidate test covers KEK version normalization across rotation.
- Latest functional-code head `35044de5f44322997d7c10d5edb38f7c32c36ed2` has **10/10 GitHub checks PASS**, including dependency remediation, offline regression, HFM repository/foundation contracts, Render contracts, Run Agent regression, and the PostgreSQL 001–014 chain on disposable PostgreSQL 16.
## Latest standing-read boundary hardening and CI evidence — 2026-11-07

- Repository-level defense in depth now enforces Standing Read Authority scope even if an internal caller bypasses the authorized-reader adapter: a standing-read transaction must explicitly filter to `learning_note` and/or `knowledge_item`, must use `ACTIVE` lifecycle, cannot request restricted-read permission, and the SQL query excludes `RESTRICTED`, non-`VERIFIED` integrity, and non-`CONTENT_VERIFIED`/`HUMAN_VERIFIED` trust rows before decoding.
- Focused repository regression tests cover missing record-type scope, disallowed `social_post_draft`, non-ACTIVE lifecycle, restricted-read escalation, and the valid Learning/Knowledge-only query.
- Latest functional-code head: `35044de5f44322997d7c10d5edb38f7c32c36ed2` (10/10 checks PASS).
- Code commit `645af36db7a3150d2f53f8570228b93cebab7ba6` produced eight successful GitHub workflows, including HFM PostgreSQL migrations, HFM repository contracts, HFM runtime foundation, Render host binding, session persistence, tool-health diagnostics, Run Agent regression, and Competitor Intelligence. One unrelated dependency-remediation workflow was cancelled; no HFM workflow failed.
- Canonical PostgreSQL integration job completed successfully for migrations 001–014 on disposable PostgreSQL 16 at code commit `645af36db7a3150d2f53f8570228b93cebab7ba6`. The subsequent commits were documentation-only; the revised migration SQL and workflow were unchanged.
- This is code/CI evidence only. No live Neon migration, staging row mutation, credential provisioning, Render environment change, deployment, or PR merge was performed. PR #79 remains Open/Draft/Unmerged; all live activation flags remain disabled pending the separately approved release gates above.


## Canonical Memory, Knowledge, and Learning save contract — 2026-11-07

- `memory_save` is routed to the encrypted HFM repository only when the Memory writer and authority-issuer runtimes are ready and the write flag is explicitly enabled. It requires an authenticated admin session, a verified selected project, explicit save/remember intent, and saved text present in the user's request. The record is private, HUMAN_VERIFIED, and ACTIVE.
- `knowledge_save` creates an encrypted `knowledge_item`; `learning_save` creates an encrypted `learning_note`. Both require explicit save intent and use SOURCE_RECORDED trust with PENDING_REVIEW lifecycle. Optional source URLs must be HTTPS and are persisted without query strings or fragments.
- The review-queue tool accepts explicit requests for pending knowledge or learning notes. It issues a separate one-time `memory.read` authority for each request and returns only same-project private PENDING_REVIEW records. These records remain excluded from trusted retrieval; automatic trust promotion is not implemented.
- Direct legacy save-tool entry points return a fail-closed router-required response in HFM mode. The central tool router is the only HFM write path; Local JSON and Google Drive are never used as fallback.
- All changes remain branch-only. Feature flags are disabled by default. No live database write, migration application, Render environment change, or deployment is implied.


## Latest read-only live topology snapshot — 2026-11-07

- Neon project `steep-grass-38696226`, production branch `br-crimson-sun-a13xzreh`: 8 baseline `mira_hfm` tables, 4 baseline issuer/writer roles, and zero owner, membership, authority, or Memory rows. The 010–014 reader/issuer-hardening/nonce/bootstrap/standing-authority migrations are not applied.
- Neon branch `mira-hfm-prod-migration-candidate` (`br-sparkling-dew-a19hib3f`): 8 tables, 4 roles, and empty owner/membership/authority/Memory registries. This is an isolated candidate only; no migration or bootstrap write has been performed.
- Neon branch `mira-hfm-test` (`br-lingering-dawn-a18x6pxx`): 9 tables including `memory_social_post_state`, 7 HFM roles, 3 owner rows, 3 membership rows, 1 authority row, and 1 Memory row. Preserve this branch's data; Migration 013's empty-registry precondition is not met. The Memory payload was not read; provenance remains uncertified.
- A second Neon project with the same project name exists (`fancy-wave-81945737`), so the Render-to-Neon production target must be explicitly resolved before any runtime credential or environment change.
- Render service `mira-ai-agent` remains on `main` with Auto Deploy enabled. Its last observed live deployment is commit `881a1deebf5d97a7590aa2b14242a8f32aadf627`. No HFM environment variables, secrets, feature flags, service settings, or deployments were changed during this work.



## Conversation transcript isolation and migration-fixture precision — 2026-11-07

- All four server chat transcript persistence callsites now use the HFM-aware persistence gate. When any of the standing-read, Work Learning, Memory reader, or Memory writer flags is enabled, transcript persistence does not write to legacy local Memory and reports no Local JSON/Drive fallback; canonical transcript persistence remains unconfigured, so the transcript is not silently redirected elsewhere.
- A focused regression test covers all four flags and verifies legacy transcript behavior is preserved only when HFM mode is inactive. The server is statically checked to contain only the four adapter calls and no direct local `addMemory` writes.
- The disposable PostgreSQL standing-authority fixture now uses `statement_timestamp()` for both `valid_from` and the 365-day expiry calculation. This avoids a microsecond drift between separate `clock_timestamp()` calls causing a valid exactly-365-day fixture to violate the RLS maximum-duration policy. The 366-day negative case remains rejected.
- Exact functional/workflow commit `4f56b9572e8ba7e368acbcd73183e1cfa32e8d53`: **11/11 GitHub checks PASS, 0 failures, 0 pending**, including the PostgreSQL 001–014 chain and HFM transcript isolation tests.

## Latest HFM v0.2 runtime verification — 2026-11-07

- Functional-code head: `b7656ac766e1a42a9e7b4eabd67b005dd01fffaa`.
- GitHub CI on that exact commit: **11/11 checks completed successfully; 0 failures; 0 pending**. This includes HFM repository contracts, HFM runtime foundation, offline/regression, dependency remediation, PostgreSQL migration integration, Render host binding/HTTP smoke, session persistence, tool-health diagnostics, Run Agent regression, and Competitor Intelligence.
- The canonical Knowledge search boundary now independently rechecks `ACTIVE` lifecycle, `VERIFIED` integrity, and `CONTENT_VERIFIED`/`HUMAN_VERIFIED` trust after the unified facade, before returning either Knowledge or Learning results. Pending/unverified Learning notes remain excluded from trusted search.
- Standing-authority issuance now acquires the same project/actor transaction-scoped advisory lock used by reads and lifecycle operations. A focused test asserts the exact shared lock key, preventing issuance from racing pause/resume/revoke or an in-flight read.
- PR #79 remains Open and Draft. No merge, deployment, live Neon migration/write, production configuration change, credential/bootstrap change, or external Facebook API action was performed. HFM feature flags remain disabled by default; live activation remains NOT_APPROVED pending the documented topology/credential/owner-membership gates.

This is read-only topology evidence only. It does not authorize applying migrations, creating owner/membership data, provisioning login credentials, enabling HFM flags, merging PR #79, or deploying.

