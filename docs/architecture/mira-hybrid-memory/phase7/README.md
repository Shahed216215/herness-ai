# Mira HFM v0.2 — Phase 7 Encrypted Emergency Backup

Status: ENCRYPTED BACKUP, IMMUTABLE LOCAL ARTIFACT, RESTORE PREVIEW/STAGING, CAPACITY/RETENTION, KEY-PROVIDER CONTRACT, DURABLE ID JOURNAL, JOURNALED UPLOAD/CLOUD ADAPTER, AND INJECTED GOOGLE DRIVE V3 MAPPER IMPLEMENTED. LATEST INTEGRATION CI PENDING; GOOGLE OAUTH AND PRODUCTION RESTORE NOT CERTIFIED.

## Scope

Phase 7 adds an encrypted emergency-backup primitive for a bounded Memory snapshot payload. It is deliberately separate from routine Google Drive synchronization. It does not replace, disable, rename, or modify any existing routine sync.

## Cryptographic design

- AES-256-GCM authenticated encryption with a fresh 96-bit nonce per backup.
- HKDF-SHA256 derives a per-backup encryption key from a caller-supplied 32-byte root key and random 128-bit salt.
- Root key is injected by an external key provider. This module never generates, stores, logs, exports, or transmits the root key.
- The authenticated header binds schema/version, algorithm, backup ID, timestamp, payload length, plaintext digest, and allowlisted metadata, including optional key version ID.
- Ciphertext and plaintext SHA-256 digests are checked; GCM authentication is mandatory before plaintext is returned.
- Payload and envelope sizes are bounded.

## Storage and restore safety

- Local emergency artifacts authenticate/decrypt before file creation; owner-only permissions, symlink rejection, atomic create-only publication, fsync, and read-after-write verification are enforced. Restore staging fsyncs the staging directory after create-only publication and verifies exact plaintext bytes; failed authentication leaves no staging artifact.
- Existing backup IDs cannot be overwritten.
- Restore preview authenticates/decrypts without writing a stage file.
- Cloud restore preview verifies project/object identity and encryption before staging.
- Actual restore decrypts and verifies into a separate owner-only staging directory only.
- No canonical Memory writes, live provider calls, production restore, or automatic trust promotion occur.
- Capacity monitoring uses explicit project-scoped pagination and a configured 5,000,000,000-byte emergency-backup budget. It validates provider quota schema, scope, arithmetic, and non-future measurement time; it validates canonical non-future backup timestamps. It reports the HFM budget separately from optional provider-reported account/project quota; unavailable provider quota is explicitly NOT_REPORTED. This is still not a live Google Drive quota integration.
- Retention planning is non-destructive and never deletes artifacts.

## Offline key-provider contract

- `services/mira-hfm-backup-key-provider.js` provides an injected `getKey({ keyId })` wrapper, exact 32-byte validation, authenticated key-version metadata, historical version lookup, normalized failure codes, ephemeral key-copy zeroization, and a retirement evidence gate.
- This is not a production key vault/KMS. JavaScript zeroization is best-effort memory hygiene only; production custody, rotation operations, escrow, and recovery remain NOT_CERTIFIED.

## Durable Google Drive generated-ID journal prototype

- `services/mira-hfm-drive-backup-id-journal.js` provides a local-only immutable operation journal for a future pre-generated Drive file ID.
- It persists SHA-256 account fingerprint, Drive space, project/backup identity, authenticated backup schema/version/createdAt, generated file ID, ciphertext digest and byte length before a future provider upload can begin.
- Publication uses a same-directory temporary file, owner-only permissions, fsync, create-only hard-link publication, directory fsync and exact-byte readback. Existing operation IDs cannot be overwritten.
- Restart reconciliation returns the persisted ID but explicitly does not assert remote upload success; provider exact-ID retrieval and exact-byte verification remain mandatory.
- Synthetic offline tests are run in the Phase 7 GitHub Actions workflow. No Google OAuth/API or network calls are performed.

## Journaled generated-ID upload orchestration prototype

- `services/mira-hfm-drive-generated-id-upload.js` composes the local durable ID journal with a provider-injected create/get/download contract.
- The journal is persisted before upload; retries use the same pre-generated ID only. Every response, including timeout/409, requires exact-ID metadata retrieval and byte-for-byte ciphertext readback.
- Missing objects remain uncertain; metadata or byte mismatch is a conflict. The implementation makes no OAuth, network, Google SDK or canonical Memory calls.
- Synthetic offline CI covers pre-upload journal ordering, timeout reconciliation, same-ID retry, remote mismatch and account binding.

## Journaled cloud adapter integration prototype

- `services/mira-hfm-drive-journaled-cloud-adapter.js` connects the journaled generated-ID uploader to the encrypted cloud-backup service interface.
- Reconciliation is accepted only after metadata and exact ciphertext verification; the cloud service repeats readback and authenticated-envelope checks.
- Cloud reads resolve by the journaled exact file ID, never by name. If the journal is missing, recoverJournal can rebuild it from a unique project-scoped listing item only after exact-ID metadata, exact ciphertext digest/size, and authenticated envelope verification with the supplied root key. Corrupt journals fail closed. When the provider exposes listPage/getQuota, the adapter surfaces listing and quota; otherwise quota is NOT_REPORTED.
- End-to-end synthetic tests cover encrypted upload, HTTP 409 retry, authenticated preview, restore staging, project isolation and offline-only behavior.

## Injected Google Drive v3 provider mapper

- `services/mira-hfm-google-drive-generated-id-provider.js` maps an injected Drive v3 client to generated-ID upload, exact-ID metadata read, bounded media download, project-scoped pagination and account quota.
- It validates account fingerprint, drive space, parent folder, appProperties, encrypted MIME type, envelope digest/timestamp and download size; it also maps project-scoped pagination and account quota through `files.list` and `about.get`. It does not create OAuth clients or make requests during construction.
- The provider is offline-tested with a fake client only. Real OAuth, live Drive calls, Shared Drives, sharing and destructive methods remain unimplemented or uncertified.
- Official Google Drive API docs support generated IDs for `drive` and `appDataFolder` and document 409 duplicate prevention on retry; see the integration gates document for source links.

## Offline injected transport adapter

- `services/mira-hfm-drive-emergency-backup-adapter.js` provides a provider-neutral adapter around an injected `atomicCreate`, `readObject`, and `listPage` transport.
- It fixes a project-scoped namespace, validates encrypted-envelope content metadata and SHA-256 format, rejects cross-project/path traversal access, enforces negotiated object-size and per-page item limits, validates canonical listing timestamps, bounded cursors, encrypted-only listing metadata and negotiated object sizes, and rejects ambiguous create results.
- Before operations it negotiates provider capabilities and fails closed unless atomic create-if-absent, read-after-write consistency, project isolation, encrypted object storage, paginated listing, and bounded object/page limits are explicitly declared.
- Optional provider quota reports are strictly scope- and timestamp-validated. Capacity output separates provider-reported quota from the configured 5 GB HFM emergency-backup budget; no quota is inferred when the provider does not report it.
- The transport's `atomicCreate` must be a true provider-side atomic create-if-absent operation. The adapter cannot prove that a future real provider implements this correctly.
- Synthetic fake-transport tests cover provider capability negotiation, unsupported-provider fail-closed behavior, scoped quota validation and explicit unavailable-quota status, configured-budget/provider-quota separation, concurrent create-only behavior, namespace isolation, metadata binding, exact-byte readback, negotiated read-size and page-item limits, canonical listing timestamp validation, multi-page listing, timeout-after-commit reconciliation, timeout-before-commit uncertainty, immutable-ID collision rejection, missing/unreadable readback, and no OAuth/network use.
- No Google Drive SDK, OAuth, token handling, real Drive calls, delete/overwrite, permission grants, or routine-sync mutation is implemented.

## Verification

- Latest code/test CI: run **42010270018 — SUCCESS**, job **127187209938**, tested code/test head commit `db3013912fa4f636c539be331d2e45ea70d996c2`.
- Node syntax check and all six offline test suites completed successfully. Logs contain **94 explicit Phase 7 PASS markers**; all six test commands report `TESTS_FAILED=0`.
- Google Drive v3 fake-client regressions include exact appProperties allowlist/124-byte property bounds, future timestamp rejection, exact requested file-ID binding, project-scoped pagination, incomplete-search rejection, account identity/quota validation and exact media readback.
- Logs confirm `HFM_PHASE7_CANONICAL_WRITES=0` and `HFM_PHASE7_PRODUCTION_RESTORE=0`.
- PR #16 is Draft and unmerged; the branch is ahead of Phase 6 with behind=0.
- This is synthetic/offline CI evidence, not live Google Drive or production recovery certification.


### Canonical snapshot source blocker — Phase 1–3 evidence

The exporter is not blocked by encryption code; it is blocked by source authority and completeness. Phase 1 identifies separate General Memory, Knowledge, CRM Conversation, Work Learning, Work Knowledge, Conversation, Audit and Evolution stores with different schemas and writers. Phase 3 says General Memory, Knowledge and CRM Conversation are `BLOCKED_FOR_PRODUCTION`; Work Learning/Experience/Work Knowledge are `BLOCKED`. The project-owner registry, host authentication and durable replay store remain contract-only/not implemented. See the live-integration approval plan's Section 7A for the per-domain evidence and prerequisites. No legacy file may be treated as the canonical snapshot by assumption.

## Explicit exclusions and blockers

- Injected Google Drive v3 method mapper: IMPLEMENTED and offline CI-verified with a fake client; real OAuth client wiring and live upload/download/list/quota API remain NOT_IMPLEMENTED / NOT_TESTED. Actual OAuth client wiring and live upload/download/list/quota API: NOT_IMPLEMENTED / NOT_TESTED. Synthetic provider capability/quota contracts do not certify a real provider.
- Production key provider/KMS/OS keystore, key custody, rotation execution, escrow/recovery: NOT_IMPLEMENTED / NOT_CERTIFIED.
- Canonical HFM snapshot exporter: BLOCKED pending production-grade canonical store integration and approved project-owner mappings. Phase 1 static reconciliation is COMPLETE_WITH_EXPLICIT_RESIDUAL_RISKS; Phase 2 local-core safety acceptance is PASS_SCOPED; Phase 3 is COMPLETE_SYNTHETIC_CONTRACT_ONLY. These scoped completions do not establish production host authentication, a persistent authoritative project-owner registry, durable replay protection, production record mappings, or a single committed canonical store. No legacy store is safe to export as a canonical HFM snapshot yet.
- Production restore drill and independent production recovery certification: NOT_TESTED.
- Existing routine Google Drive synchronization: UNCHANGED.

VERSION=v0.2
PHASE7=OFFLINE_IMPLEMENTATION_AND_VERIFICATION_PASS_PRODUCTION_GATES_BLOCKED
CURRENT_HEAD_CI=PASS_OFFLINE_SYNTHETIC
CURRENT_HEAD_CI_RUN=42010270018
CURRENT_HEAD_CI_JOB=127187209938
CURRENT_HEAD_CODE_TEST_COMMIT=db3013912fa4f636c539be331d2e45ea70d996c2
CURRENT_HEAD_TEST_SUITES=6
OFFLINE_PASS_MARKERS=94
OFFLINE_TESTS_FAILED=0
GOOGLE_DRIVE_V3_MAPPER=IMPLEMENTED_OFFLINE_CI_VERIFIED
JOURNAL_RECOVERY=AUTHENTICATED_PROVIDER_OBJECT_RECONSTRUCTION_IMPLEMENTED_OFFLINE
LIVE_GOOGLE_DRIVE=NOT_TESTED
PROVIDER_CAPABILITY_NEGOTIATION=PASS
PROVIDER_QUOTA_REPORTING_CONTRACT=PASS
NEGOTIATED_LIMIT_ENFORCEMENT=PASS
TRANSPORT_TIMEOUT_RECONCILIATION=PASS
BLIND_RETRY=DISABLED
LIVE_NETWORK=NOT_AUTHORIZED
ROUTINE_DRIVE_SYNC=UNCHANGED
PRODUCTION_RESTORE=NOT_CERTIFIED
