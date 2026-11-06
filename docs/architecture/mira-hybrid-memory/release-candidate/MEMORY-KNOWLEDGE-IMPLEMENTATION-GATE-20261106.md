# HFM Memory / Knowledge Integration — Implementation Gate

Date: 2026-11-06
Release-candidate branch: `work/hfm-release-candidate-reconciliation-20261106`
Status: `ARCHITECTURE_DECISION_APPROVED_IMPLEMENTATION_NOT_STARTED`

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
`IMPLEMENTATION=NOT_STARTED`
`LEGACY_DATA=READ_ONLY_PRESERVE`
`FACEBOOK_TOKEN_REQUIRED_FOR_CORE_MEMORY=NO`
`FACEBOOK_ACCESS=PUBLIC_READ_ONLY_WHEN_PERMITTED`
`FACEBOOK_AUTO_PUBLISH=PROHIBITED`
`CLIENT_AND_FINANCIAL_DATA=APPLICATION_ENCRYPTED_VAULT_REQUIRED`
`PRODUCTION_MIGRATION=NOT_APPROVED`
`PRODUCTION_WRITE=NOT_APPROVED`
`DEPLOYMENT=NOT_APPROVED`

No source code, runtime configuration, production database schema/data, secrets, or deployment were changed in this documentation step. No scheduled task, reminder, or automation was created.
