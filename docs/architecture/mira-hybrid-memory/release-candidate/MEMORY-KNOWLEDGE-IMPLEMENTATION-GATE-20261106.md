# HFM Memory / Knowledge Integration — Implementation Gate

Date: 2026-11-06
Release-candidate branch: `work/hfm-release-candidate-reconciliation-20261106`
Status: `PARTIAL_FOUNDATION_IMPLEMENTED_INTEGRATION_NOT_STARTED`

## Work performed

Read-only source inspection confirmed the existing Memory/Knowledge tool and storage gaps. The user then explicitly approved topology B, recorded in:
`HFM-MEMORY-TOPOLOGY-AND-DAILY-KNOWLEDGE-AMENDMENT-20261106.md`.

The approved decision is:
- Provider-neutral Mira Memory Core is the canonical service boundary.
- Neon/PostgreSQL is the durable repository backend behind that boundary.
- Facebook is an optional read-only public source; no Facebook API token is required for Mira Core Memory.
- Daily activity and learning are retained with provenance and verification state.
- Facebook-ready post drafts have a post-style preview and user-click Copy action; user manually publishes them.
- Client identity, private work details, contracts, and financial/transaction payloads are isolated in an application-encrypted vault.
- Google Drive is not an implicit fallback.

## Confirmed existing code-level gaps (still open)

1. `memory_save` ignores trusted-context arguments and writes to the global legacy local Memory store through `addMemory`.
2. `knowledge_save` writes to the global legacy Knowledge store and also performs Google Drive sync.
3. `knowledge_search` reads the global local Knowledge store and may replace the result set with Google Drive content. It has no project authorization or classification filter.
4. Legacy `memory.js` and `knowledge.js` are global file-backed services; no project isolation exists at those storage boundaries.
5. Runtime identity context can resolve a server-issued actor, but identity transport is not project authorization.
6. The authority transaction primitive is not wired to these tools. Its database transaction requires UPDATE/INSERT, while the current HFM runtime role is explicitly SELECT-only.
7. The retrieval bridge imports `mira-memory-unified-facade`, absent at the inspected runtime-foundation commit. It remains NOT_VERIFIED and must not be enabled.
8. Current Google Drive and local fallback paths must not be used as implicit canonical Memory providers.

## Implementation remains blocked on technical prerequisites

The normative topology decision is no longer unresolved. Implementation must still wait until the following are completed on the isolated release-candidate branch:

1. Reconcile the amendment with HFM v0.2.4 canonical record, trust, integrity, lifecycle, conflict, and authority contracts.
2. Inspect full runtime identity, project membership/delegation, transaction, migration, storage, and UI paths.
3. Define the durable schema, narrow repository API, database roles, idempotency, and uncertain-outcome handling.
4. Implement application-level authenticated encryption with envelope key management outside Neon; missing keys must fail closed. Do not persist client/financial plaintext or keys in database, repository, search index, social drafts, or logs.
5. Implement daily activity/learning capture with evidence provenance and no fabricated completion/test claims.
6. Implement social post drafts and explicit user-click Copy only; no auto-publishing.
7. Implement read-only public Facebook/web retrieval only for accessible permitted content, with SSRF/redirect protections and no login/access-control bypass.
8. Implement owner/project scope and record-level authorization for every read/write/search/list/count/export/backup/restore path.
9. Add independent tests for cross-project denial, vault ciphertext-only persistence, key absence/rotation, log redaction, prompt injection, URL/redirect SSRF, copy behavior, idempotency, restart/recovery, and audit integrity.
10. Exact-head CI, independent security review, disposable database verification, and evidence-backed readiness report.

## Current execution boundary

`ARCHITECTURE_DECISION=APPROVED_B`
`IMPLEMENTATION=FOUNDATION_PARTIAL`
`LEGACY_DATA=READ_ONLY_PRESERVE`
`FACEBOOK_TOKEN_REQUIRED_FOR_CORE_MEMORY=NO`
`FACEBOOK_ACCESS=PUBLIC_READ_ONLY_WHEN_PERMITTED`
`FACEBOOK_AUTO_PUBLISH=PROHIBITED`
`CLIENT_AND_FINANCIAL_DATA=APPLICATION_ENCRYPTED_VAULT_REQUIRED`
`PRODUCTION_MIGRATION=NOT_APPROVED`
`PRODUCTION_WRITE=NOT_APPROVED`
`DEPLOYMENT=NOT_APPROVED`

This gate separates the implemented service-layer foundation from runtime/production activation. No production database schema/data, secrets, writer role, or deployment was changed. No scheduled task, reminder, or automation was created.


## New implementation evidence (2026-11-06)

- Added `services/mira-hfm-vault-crypto.js`: standalone AES-256-GCM envelope encryption for PROJECT_PRIVATE and RESTRICTED payloads, per-record random DEK, versioned KEK from server environment, authenticated context binding to record/owner/project/type/classification/schema, and fail-closed key handling.
- Added `tests/mira-hfm-vault-crypto.test.js` with synthetic tests for round-trip encryption, ciphertext opacity, fresh nonces/DEKs, context binding, missing/invalid keys, tampering, and KEK version rotation.
- Added `services/mira-hfm-record-schema.js` with backward-compatible v1.0.0 validation and additive v1.1.0 record families for daily activity, learning, knowledge, social drafts, client vault, and financial vault.
- Implemented RFC 8785 JCS string content hashing, strict calendar timestamp validation, schema-version-specific record-type allowlists, and mandatory RESTRICTED classification for client/financial records.
- Added `tests/mira-hfm-record-schema.test.js` and included both focused test files in the configured `npm test` chain.
- Isolated local Node harness result: combined vault crypto + record schema 21/21. The harness used a local copy of the current branch source; these results are not the full repository regression suite and are not exact-head GitHub CI evidence.
- Draft PR #70: https://github.com/Shahed216215/herness-ai/pull/70
- PR #70 remains Draft/Open. The dedicated `mira-hfm-memory-repository.yml` workflow was added for its base branch and source branch. Repository implementation commit `e70bb4a682eaecd70fb81370c7f28e8df265d98c` passed syntax checks, focused repository tests, and full `npm test` (GitHub Actions run `42238970176`). Later commits in the current PR head only update documentation.

## Still not implemented

- Migration 004 schema has been executed and inspected on the disposable Neon test branch only; production remains unchanged.
- A transaction-client-only project-scoped Memory Repository service now exists on PR #70, with create/revise/read/list/trash/restore operations, encrypted private payloads, idempotency, revision history, and sanitized audit.
- No writer role/login or write connection is provisioned. A source-only Migration 005 and fail-closed writer-pool preflight are drafted; Migration 005 has not been executed. The repository service is not yet wired to runtime tools or routes.
- No integration of `memory_save`, `knowledge_save`, `knowledge_search`, or client-profile routes.
- No daily activity/learning capture pipeline or automatic invocation of the digest builder.
- A deterministic Bengali daily knowledge post builder and authority-scoped save helper now exist; social-post preview/Copy UI is not implemented.
- No public Facebook/Page URL ingestion adapter or safe web-search pipeline.
- No encrypted vault UI, authorization-gated decrypt route, blind-index design, or tested recovery/key-custody workflow.
- No production migration, secret/key configuration, production write, merge, or deployment.


## User-confirmed Copy → Facebook → Delete workflow (2026-11-06)

- User manually copies the selected draft from Mira, manually publishes it in Facebook, then uses Mira's Delete action.
- Copy is a direct user-initiated clipboard operation; copied is not equivalent to published.
- Delete is a recoverable Neon soft-delete (`TRASHED`), with sanitized audit and immutable revision history. Restore is available from Trash.
- No automatic permanent purge is authorized.
- The Copy UI and Trash/Restore UI are NOT_STARTED. The transaction-client-only repository service and lifecycle transaction operations are implemented and CI-tested, but no runtime tool/route is wired to them yet.


## Render Free sleep-safe operating contract (2026-11-06)

- Canonical daily activity, learning notes, and social drafts are persisted in Neon; Render filesystem and process memory are never authoritative.
- Capture writes happen only while the runtime is executing and must be confirmed by a successful Neon commit/readback before reporting saved.
- If Render is asleep, no background AI digest generation is promised. The next authenticated request after wake may generate the missing date-scoped digest from committed records using idempotency.
- No keepalive ping, Render Cron Job, paid worker, persistent disk, or always-on upgrade is authorized.
- A database outage never triggers local or Google Drive fallback and never produces a false saved-success state.
- Archive/Trash reload after restart is not yet implemented or tested.


## Repository service and CI checkpoint (2026-11-06)

- Added `services/mira-hfm-memory-repository.js`; it accepts only the transaction client/context passed inside the consumed-authority callback and does not open a database connection itself.
- Operations: create, revise, project-scoped get/list, recoverable trash, and restore.
- PUBLIC payloads remain plaintext/searchable. PROJECT_PRIVATE and RESTRICTED payloads are envelope-encrypted before database writes; private/restricted reads and lifecycle operations require explicit grants.
- Project scope is bound to the consumed authority resource; cross-project sharing is rejected.
- Idempotency registry, immutable revision history, and sanitized hash-linked audit events are part of the same caller-owned transaction.
- Latest commit `e70bb4a682eaecd70fb81370c7f28e8df265d98c`: focused repository tests PASS and full `npm test` PASS in the dedicated GitHub Actions workflow.
- This is a service-layer foundation only. Legacy tool integration, activity/learning capture, automatic daily digest invocation, social-post Copy/Trash UI, public Facebook/web ingestion, writer-role provisioning, KEK configuration, and Render runtime integration remain NOT_STARTED.
- No Render env changes, writer role, production writes, merge, or deployment.


## Daily knowledge post builder checkpoint (2026-11-06)

- Added deterministic Bengali post builder for the selected Asia/Dhaka local date.
- It accepts only same-project, ACTIVE, PROJECT_PRIVATE daily_activity and learning_note records; client/financial vault records, restricted records, other projects and other dates are excluded.
- Obvious email, URL, phone/long-number and currency amount patterns are redacted. This is best-effort only; human review remains mandatory because names and other sensitive phrases may remain.
- The draft uses a stable project/date ID and idempotency key, is stored as PROJECT_PRIVATE, and the save helper delegates to the authority-scoped Memory repository with an explicit private-write grant.
- The builder is deterministic/template-based; it does not invoke an LLM, auto-publish, schedule a midnight job, or capture activity itself.
- GitHub Actions run for implementation commit `57b49a6c24eacd6645786c1a31566abce8cac41f`: syntax checks PASS, focused HFM and daily-post tests PASS, full `npm test` PASS.
- Render sleep-safe behavior remains: the next authenticated request after wake may generate a missing daily post from records already committed to Neon.


## Writer runtime and RLS checkpoint (2026-11-06)

- Added a fail-closed writer-pool factory that requires explicit `MIRA_HFM_MEMORY_WRITE_ENABLED=true`, a separate `MIRA_HFM_MEMORY_DATABASE_URL`, and an exact `MIRA_HFM_MEMORY_WRITER_ROLE`. It never falls back to the read-only database URL.
- Preflight requires a dedicated login role with INHERIT membership in `mira_hfm_memory_writer`, no superuser/BYPASSRLS/CREATEDB/CREATEROLE/REPLICATION, no schema CREATE, and only required table/sequence grants.
- Preflight requires forced RLS on eight project/authority/Memory tables and rejects DELETE/TRUNCATE, append-only history mutation, excess project table grants, and excess sequence grants.
- Added source-only Migration 005. It creates only a NOLOGIN group role, grants least-privilege access, and defines project RLS policies based on transaction-local `mira.project_id`. It creates no login/password and has NOT been executed.
- Authority transaction now sets project scope before project-owner/membership/authority queries, then validates and consumes the one-time authority before the protected repository callback.
- GitHub Actions run for code commit `a7e5aed10812af9691fccd857ad7832658ec67c6`: syntax checks PASS, focused tests PASS, full `npm test` PASS.
- No Neon role/grant/RLS changes from Migration 005, no writer URL, no KEK, no Render secrets, and no production writes have occurred.
