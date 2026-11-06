# HFM v0.2 — Application Runtime Integration Gap Review

Date: 2026-11-06
Repository: `Shahed216215/herness-ai`
Reviewed source branch: `work/hfm-memory-core-implementation-20261106`
Source commit: `98a3e4b38ba39460b70bc7fcaf807851853c3d73`
Review branch: `work/hfm-v02-memory-runtime-gate-audit-20261106`
Scope: source inspection + read-only Neon disposable-branch checks. No app runtime, SQL write, credential, or deployment change.

## 1. Confirmed existing integration

- `server.js` issues `req.session.hfmPrincipal` after successful browser login when a stable subject exists. Registered users use their authenticated user UUID; admins require a valid `MIRA_ADMIN_SUBJECT_ID`.
- `server.js` passes `buildTrustedActorContext(req)` into the work execution path.
- `mira-work-execution-engine`, `tool-runner`, and `tools/index.js` pass that trusted context through to tool execution.
- `mira-hfm-authority-transaction.js` validates a server-held verified principal, sets transaction-local project scope, locks owner and membership, checks permission, consumes a one-time authority, audits consumption, and invokes the protected callback on the same transaction client.

This proves a trusted-actor transport path exists; it does not prove HFM project authorization or persistence is wired.

## 2. Confirmed runtime integration gaps

| Component | Observed source state | Assessment |
|---|---|---|
| `tools/memory-save.js` | `execute` accepts only `{ content }`; calls legacy `addMemory()`; ignores second `trustedContext` argument | NOT INTEGRATED |
| `tools/knowledge-save.js` | Calls legacy `addKnowledge()`; ignores trusted context; reports local/Drive persistence | NOT INTEGRATED |
| `tools/knowledge-search.js` | Reads legacy local Knowledge and may load from Google Drive; no HFM project scope or classification filtering | NOT INTEGRATED |
| `server.js` | No import/initialization of `mira-hfm-memory-postgres-runtime` or HFM repository runtime composition | NOT WIRED |
| `mira-hfm-memory-postgres-runtime.js` | Writer pool exists as an isolated factory; feature flag, separate URL and expected login role required | NOT INITIALIZED |
| Project scope | Trusted actor is transported, but no trusted selected-project binding is supplied to tools | MISSING |
| Authority issuance | Authority consumption exists; a complete server-side issuance/approval path for Memory operations is not established by this review | REVIEW_REQUIRED |
| Daily capture | Daily post builder consumes a caller-supplied record array; no verified event source or repository retrieval bridge is wired | NOT WIRED |
| Social draft UI | No preview/Copy/Trash route or UI integration is present in the reviewed PR #70 changed-file set | NOT IMPLEMENTED |

Model/tool arguments must never supply `actorId`, `projectId`, `authorityId`, `requestId`, or approval state as authorization facts. Those values must come from authenticated server context and a server-side authority workflow.

## 3. Read-only Neon verification: runtime role has no RLS policy

Target: disposable `mira-hfm-test` branch only.

As role `mira_hfm_runtime`, a single SELECT-only check returned:
- `has_select = true` for `mira_hfm.memory_records`
- `rls_active = true`
- `runtime_policies = 0` for `memory_records`
- `visible_records = 0`

The catalog query on the same disposable branch shows the only policy for `memory_records` is `memory_records_project_scope`, targeted to `mira_hfm_memory_writer`. The runtime role has SELECT grant but no applicable RLS policy. Therefore the current runtime role cannot retrieve Memory rows under the observed policy set, even if records later exist.

This is fail-closed, but it means a separate reviewed read policy/role or a carefully reviewed writer-pool-backed read path is required before Memory Retrieval can work. Do not loosen RLS or add a broad policy as a shortcut.

## 4. Migration 005 policy review

Read-only source review and `pg_policies` catalog inspection confirmed:
- Eight project/authority/Memory tables have ENABLE + FORCE ROW LEVEL SECURITY.
- Each writer policy is PERMISSIVE, FOR ALL, TO `mira_hfm_memory_writer`.
- Both USING and WITH CHECK constrain `project_id` to transaction-local `current_setting('mira.project_id', true)`.
- SQL grants, not policy command scope alone, constrain the writer group: no DELETE/TRUNCATE grants; immutable-history triggers remain present.
- The migration creates a NOLOGIN group and deliberately does not create a login credential or membership grant for an application login.

The policy predicates enforce project scope, not actor authorization by themselves. Actor membership, owner revision, operation permission, one-time authority, and trusted identity must continue to be checked in the application transaction.

## 5. Required implementation sequence

1. Define the canonical HFM project ID and owner actor from a user-confirmed project mapping; do not derive it from local project JSON or model arguments.
2. Specify the owner bootstrap evidence and explicit approval reference. The current owner/membership/authority tables have zero rows; no automatic bootstrap is safe.
3. Review and implement a server-side selected-project context that is bound to the authenticated actor and cannot be overridden by tool arguments.
4. Review an explicit authority issuance flow, operation/resource/purpose allowlist, expiry, and revocation behavior. Keep one-time consumption in the same transaction as Memory writes.
5. Decide and test the retrieval role/policy model. Current runtime SELECT grant without an RLS policy is insufficient.
6. Initialize the writer pool only after a dedicated least-privilege LOGIN role, membership, separate URL, and KEK custody are approved and configured. Never use `mira_hfm_it_runner`.
7. Replace legacy Memory/Knowledge tool paths with HFM repository calls only after the above gates pass; preserve legacy behavior until isolated integration tests prove the new path.
8. Wire daily activity from verified server events and build drafts from same-project authorized records.
9. Add copy-only social draft preview, direct-click clipboard handling, and audited recoverable Trash/Restore. Copy is not Published; no auto-publishing.
10. Run disposable Neon integration, full CI, security review, Render staging/live tests, and obtain separate production approval.

## 6. Safety and release status

- No DDL/DML, inserts, updates, deletes, grants, role changes, or seed data were executed.
- No Render environment, KEK, writer URL, production database, PR merge, or deployment was changed.
- No Facebook login/API/publishing action was performed.

`TRUSTED_ACTOR_TRANSPORT=SOURCE_PRESENT`
`HFM_AUTHORITY_CONSUMPTION=SOURCE_PRESENT_NOT_END_TO_END`
`LEGACY_MEMORY_TOOL_INTEGRATION=NOT_IMPLEMENTED`
`HFM_WRITER_POOL_RUNTIME=NOT_INITIALIZED`
`RUNTIME_READ_RLS_POLICY=MISSING`
`PROJECT_BINDING_AND_BOOTSTRAP=BLOCKED`
`AUTHORITY_ISSUANCE=REVIEW_REQUIRED`
`DAILY_EVENT_CAPTURE=NOT_WIRED`
`SOCIAL_DRAFT_COPY_UI=NOT_IMPLEMENTED`
`PRODUCTION_READINESS=NOT_CERTIFIED`
