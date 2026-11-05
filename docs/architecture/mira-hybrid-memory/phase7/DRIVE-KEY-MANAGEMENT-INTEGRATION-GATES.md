# Mira HFM v0.2 — Phase 7 Drive and Key-Management Integration Gates

Status: OFFLINE KEY-PROVIDER CONTRACT PROTOTYPE IMPLEMENTED — NO PRODUCTION KEY PROVIDER, OAUTH, NETWORK CALL, OR SECRET ACCESS.

## 1. Purpose

This document defines the next safe integration boundary after the provider-neutral encrypted emergency-backup primitive. It does not certify Google Drive, production key management, canonical snapshot export, or production recovery.

## 2. Non-negotiable separation

- Emergency backup is a separate storage purpose. Existing routine Google Drive synchronization must remain unchanged until every dependent workflow is inventoried, migrated, and independently verified.
- Only the encrypted HFM envelope may cross the cloud-adapter boundary. Plaintext snapshots and root keys must never be passed to a cloud adapter.
- Google Drive is an emergency-backup destination, not the canonical Memory database and not a live replication node.
- Drive object existence or successful upload alone is not VERIFIED. Exact-byte readback, ciphertext digest verification, authenticated decryption, project/backup identity checks, and durable metadata validation are required.
- Provider errors, permission denial, quota exhaustion, timeouts, and search/list omissions must not be interpreted as proof of data loss.

## 3. Required Google Drive adapter contract

A future adapter may be considered only when it exposes the provider-neutral operations already consumed by `mira-hfm-encrypted-emergency-backup-cloud.js`:

- `putIfAbsent({ objectKey, projectId, backupId, bytes, contentType, ciphertextSha256, encryption })`; the injected provider's `atomicCreate` operation must also receive the configured `projectId` explicitly, not rely only on metadata.
- `get({ objectKey, projectId })`
- `list({ projectId, prefix, cursor, limit })` returning `{ items, complete, nextCursor }`; every page must explicitly state whether pagination is complete.

The adapter must additionally demonstrate:

1. OAuth scopes limited to the dedicated backup folder/object operations actually required; no broad Drive access by default.
2. Dedicated app-created folder or equivalent namespace, with project isolation enforced by both adapter and stored metadata.
3. Create-only semantics implemented without a check-then-create race. A preflight search followed by an ordinary upload is not create-only.
4. Upload metadata binds project ID, backup ID, schema/version, ciphertext SHA-256, byte length, and creation timestamp.
5. Readback downloads the exact object bytes and compares byte-for-byte with the submitted envelope.
6. Listing uses opaque cursors and a bounded page size; every page explicitly declares `complete`. The consumer follows cursors to completion, rejects repeated/malformed cursors, malformed/cross-project objects and duplicate IDs, and reports truncation or page-limit exhaustion as INCONCLUSIVE. A legacy one-shot array response is not accepted as proof of complete listing.
7. Quota reporting distinguishes provider quota from the configured 5,000,000,000-byte HFM allocation. The configured budget is not evidence of actual Drive quota.
8. Retry behavior is bounded and idempotent; uncertain upload outcomes are reconciled by object identity and digest before retry.
9. No delete, overwrite, move, permission grant, or routine-sync mutation is exposed through the Phase 7 adapter.
10. Network requests are disabled in offline tests and require explicit authorization in a separate live integration test.

## 4. Key-provider contract

The backup cryptography module accepts a caller-supplied 32-byte root key. A production key provider is a separate dependency and must not be implemented by storing the key beside the backup.

A future provider must:

- Return exactly 32 bytes for a requested opaque key ID.
- Keep key material out of logs, exceptions, telemetry, backup metadata, Git, and Drive.
- Distinguish KEY_NOT_FOUND, KEY_ACCESS_DENIED, KEY_VERSION_RETIRED, PROVIDER_UNAVAILABLE, and INVALID_KEY_MATERIAL.
- Support explicit key version identifiers so old backups remain decryptable after rotation.
- Require a tested recovery path before retiring any key version.
- Never silently generate a replacement key when a requested key is unavailable.
- Document who can authorize key creation, rotation, recovery, and retirement.
- Avoid automatic export of raw keys to application files or environment dumps.

Key rotation acceptance requires: create backup with key version A; verify restore with A; create version B; verify new backup with B; verify old backup still restores with A; prove retirement of A is blocked until a separately approved migration/re-encryption and recovery test is complete.

### 4.1 Offline key-provider contract prototype (v0.2)

The Phase 7 branch now includes `services/mira-hfm-backup-key-provider.js`. This is a provider-injected contract wrapper, not a production key store or KMS integration.

- Provider interface: `getKey({ keyId })` returns `{ keyId, key }`; the returned key must be a Buffer of exactly 32 bytes and the ID must match the requested opaque version ID.
- `withBackupKey` passes a short-lived copy to a callback and zeroes that copy in a `finally` block. Provider-owned Buffer memory is not mutated. JavaScript zeroization is best-effort memory hygiene, not a guarantee that all runtime/GC copies are erased.
- `createEncryptedBackupWithKeyProvider` writes `metadata.keyVersionId` into the authenticated envelope metadata. The core envelope metadata allowlist now accepts this field, so changing the key-version label invalidates authentication.
- `decryptBackupWithKeyProvider` reads the authenticated envelope's key version and requests that exact historical version; it does not fall back to a different key or generate a replacement.
- Provider failures are normalized to distinct non-secret-bearing codes: `HFM_KEY_NOT_FOUND`, `HFM_KEY_ACCESS_DENIED`, `HFM_KEY_VERSION_RETIRED`, `HFM_PROVIDER_UNAVAILABLE`, and `HFM_INVALID_KEY_MATERIAL`.
- `assertKeyVersionRetirementAllowed` blocks retirement while backups still reference a version unless migration and recovery evidence are both true. This is a policy guard only; it does not retire keys or prove those external evidence claims.
- Synthetic offline tests cover key versions A/B, historical A decryption after B exists, ephemeral-copy zeroization, provider failure taxonomy, and the retirement evidence gate.

The fake provider and random test keys are test-only. No real key vault, OS keystore, KMS, escrow, key rotation operation, or production key custody is implemented or certified.

## 5. Canonical snapshot-exporter dependency

A canonical HFM snapshot exporter is intentionally not implemented in this Phase 7 slice. Before implementation, Phases 1–3 must identify and freeze:

- authoritative canonical store(s) and their schema/version;
- transaction or consistent-read boundary;
- all included record families and excluded transient/cache data;
- record count, byte count, and deterministic manifest rules;
- tombstone/deletion representation and conflict handling;
- source provenance and integrity metadata;
- read-failure behavior (never convert failure to an empty snapshot);
- snapshot completeness and authorization evidence.

The exporter must produce a bounded, schema-validated snapshot payload and manifest. It must not mutate canonical data. A successful encryption test cannot certify snapshot completeness.

## 6. Required offline test matrix before any live provider test

- Adapter rejects plaintext, malformed envelope, wrong project, wrong backup ID, and invalid digest.
- Create-only race: concurrent duplicate uploads result in exactly one object creation.
- Upload timeout after remote commit is reconciled without overwriting or duplicating.
- Readback byte mismatch and authenticated-envelope mismatch are rejected.
- Multi-page listing is aggregated to completion; pagination truncation, repeated cursors, malformed page envelopes, duplicate IDs, invalid timestamps, and cross-project records are rejected.
- Quota unknown/permission denied is reported as INCONCLUSIVE, not zero usage.
- Key provider unavailable, denied, missing key, retired version, and malformed key are distinct failures (offline wrapper contract tests cover the taxonomy).
- Rotation preserves decryptability of historical backups.
- Failed authentication creates no restore-stage artifact.
- Every test uses synthetic data and a fake adapter; no OAuth, network, real user data, or secrets.

## 7. Live integration authorization gate

A live Google Drive test is NOT AUTHORIZED by this document. Before any live test, provide a separate preview stating the exact OAuth scopes, account/folder access, data transmitted (encrypted envelope only), expected API operations, quota impact, costs if any, and rollback/revocation procedure. Proceed only after explicit approval.

## 8. Current evidence and status

- Provider-neutral encrypted backup and fake-adapter offline tests: implemented and CI-verified in the Phase 7 PR.
- Actual Google Drive adapter/OAuth/live upload/download: NOT_IMPLEMENTED / NOT_TESTED.
- Offline provider-injected wrapper and key-version metadata binding: IMPLEMENTED; production key provider, rotation execution, escrow/recovery: NOT_IMPLEMENTED / NOT_CERTIFIED.
- Canonical HFM snapshot exporter: BLOCKED pending authoritative schema/store reconciliation in Phases 1–3.
- Production restore drill: NOT_TESTED.
- Routine Google Drive synchronization: UNCHANGED.

VERSION=v0.2
PHASE7_DRIVE_KEY_INTEGRATION=OFFLINE_CONTRACT_PROTOTYPE_ONLY
LIVE_NETWORK=NOT_AUTHORIZED
ROUTINE_DRIVE_SYNC=UNCHANGED
PRODUCTION_RESTORE=NOT_CERTIFIED


## 9. Offline injected transport adapter prototype (v0.2)

The branch adds `services/mira-hfm-drive-emergency-backup-adapter.js` as a provider-neutral boundary around an injected transport. It is not a Google Drive implementation.

- Fixed namespace: `mira-hfm-emergency/v1/{projectId}/{backupId}.mhe`; caller-supplied alternate namespaces are rejected.
- Required transport methods: `atomicCreate({ projectId, objectKey, metadata, bytes })`, `readObject({ projectId, objectKey })`, and `listPage({ projectId, prefix, cursor, limit })`. Every storage operation is explicitly project-scoped.
- The adapter validates project binding, object key, AES-256-GCM content metadata, SHA-256 format, object metadata/byte length, negotiated read-size and page-item limits, canonical listing timestamps, bounded cursors, encrypted-only listing metadata and explicit bounded pagination. The cloud service additionally binds the authenticated envelope metadata projectId to the requested project on upload, preview and restore.
- It rejects ambiguous atomic-create results. A future real transport must implement provider-side atomic create-if-absent; a preflight search plus ordinary upload is not acceptable.
- Fake-transport tests exercise concurrent duplicate create calls (exactly one create result), project/namespace isolation, readback, multi-page listing, malformed create result rejection, and the absence of OAuth/network behavior.
- The adapter has no delete, overwrite, move, permission-grant, OAuth, or routine-sync method.

This prototype cannot establish real provider atomicity, remote durability, quota behavior, OAuth scope, or consistency. Those remain separate provider-specific review and live-test gates.

## 9.1 Google Drive create-only design candidate (documentation review only)

Official Google Drive API documentation describes a viable idempotent-create mechanism for ordinary binary files: call `files.generateIds`, pass one generated ID in the `id` field of the subsequent `files.create` upload, and reuse that same ID for every retry. Google documents that after a successful create, subsequent retries return HTTP `409 Conflict` and do not create duplicate files. This is materially stronger than a name-based search followed by ordinary create.

Relevant official references:
- https://developers.google.com/workspace/drive/api/guides/create-file#generate_ids_to_use_with_your_files
- https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds

Historical provider design candidate; the later sections below document the implemented offline journal/uploader/Drive v3 mapper. Live provider behavior remains untested:

1. Bind the operation to the authenticated Google account and selected Drive space (`drive` or `appDataFolder`). The generated IDs are issued for the requesting user and selected space; never reuse an ID across account/space boundaries.
2. Request one generated file ID with `files.generateIds`.
3. Before starting the upload, persist and fsync a local operation-journal entry binding hashed account fingerprint, space, projectId, backupId, generated file ID, authenticated backup schema/version/createdAt, ciphertext SHA-256, byte length and operation state. The journal must be durable across process restart and protected as sensitive metadata. If this journal is unavailable, do not start an upload.
4. Create an ordinary binary file (never a Google Docs/Sheets/Slides conversion) using the generated ID in the file resource, the dedicated backup parent/folder, encrypted-only MIME type, and project/backup/digest metadata. Use a resumable upload for envelopes above 5 MB or mobile/network-interruption risk.
5. On timeout or HTTP 409, do not generate a replacement ID. Retrieve the exact file by the journaled ID, verify its project/backup binding, parent, byte length and digest, then download and compare the exact ciphertext bytes. Only exact verified readback can reconcile the operation as successful.
6. If the ID cannot be retrieved, metadata conflicts, the journal is missing, or the response remains ambiguous, report INCONCLUSIVE/UNCERTAIN and preserve the journal for recovery. Never fall back to search-by-name plus create.
7. Complete the normal authenticated envelope verification after exact-byte readback. Keep root keys and plaintext outside the Drive transport.

Important limitations and gates:
- Google documents pre-generated IDs for create/copy/upload and duplicate prevention on retry, but this documentation review is not a live proof of our exact OAuth account, folder, upload mode, or quota behavior.
- Pre-generated IDs are not supported for Google Workspace file creation/conversion (except documented special MIME types); HFM backup objects must remain ordinary binary files.
- The local durable ID journal is a required recovery dependency. Its atomicity, fsync, permissions, crash recovery and account binding are implemented as an offline prototype; it is not encrypted or MAC-authenticated. Authenticated provider-listing recovery is implemented later in this document, but cross-device journal replication and recovery when the backup ID/root key/account are lost remain unresolved.
- The minimum suitable OAuth scope, dedicated-folder ownership, Shared Drive behavior (if any), and `appDataFolder` versus a visible dedicated folder must be decided before OAuth authorization. No OAuth scope is approved by this document.
- This candidate may satisfy the provider-side create-only requirement only after a dedicated fake-transport regression suite and a separately authorized, narrowly scoped live test verify create, timeout-after-commit, 409 reconciliation, exact download and duplicate prevention.

STATUS=DOCUMENTED_DESIGN_CANDIDATE_ONLY
GOOGLE_DRIVE_V3_MAPPER=IMPLEMENTED_CI_PENDING
LIVE_GOOGLE_DRIVE=NOT_TESTED
LIVE_OAUTH_OR_NETWORK=NOT_AUTHORIZED

## 9.2 Durable generated-ID operation journal (offline prototype)

The branch now includes `services/mira-hfm-drive-backup-id-journal.js`. It is a local-only prerequisite prototype for a future Google Drive provider; it does not call Google APIs or authorize an upload.

- `createBackupIdJournal` writes a canonical, bounded record using a same-directory temporary file, owner-only file permissions, fsync, create-only hard-link publication, directory fsync and exact-byte readback.
- The journal binds one immutable operation ID to a SHA-256 fingerprint of a non-secret provider account subject (never a raw email or account identifier), selected Drive space (`drive` or `appDataFolder`), project ID, backup ID, pre-generated Drive file ID, authenticated backup schema/version/createdAt, ciphertext SHA-256, byte length and canonical journal timestamp.
- Repeating an identical journal creation is idempotent. Reusing an operation ID with different content/file ID is rejected; no journal overwrite or delete operation exists.
- `readBackupIdJournal` validates schema/canonical encoding, owner-only permissions, regular-file/no-symlink constraints, and optional expected account/space/project/backup/schema/version/timestamp/digest/size bindings.
- `reconcileBackupIdJournal` returns only the persisted identity and an explicit `JOURNAL_VERIFIED_PROVIDER_RECONCILIATION_REQUIRED` status. It does NOT claim the remote object exists, that upload succeeded, or that provider bytes were verified. A future provider may retry only with the same persisted file ID, then must retrieve and compare exact ciphertext bytes.
- Missing/corrupt/mismatched journals fail closed. No credential, access token, root key, plaintext, or payload is stored in the journal.
- Offline synthetic tests cover create/readback, owner-only permissions, idempotent recovery, immutable collision, account/space binding, missing/corrupt records, symlink rejection, invalid input and no network/OAuth/canonical writes.

Limitations: the journal is not encrypted or MAC-authenticated; it relies on the owner-only local filesystem boundary and detects malformed/canonical/schema/binding failures, not a malicious same-user rewrite. It does not provide multi-device synchronization or a provider transaction. The journal can be reconstructed from an intact authenticated provider object only when the correct account, backup ID and root key remain available; cross-device journal replication and device-loss procedures remain a separate production gate.

STATUS=OFFLINE_DURABLE_JOURNAL_PROTOTYPE
GOOGLE_DRIVE_UPLOAD_ORCHESTRATION=IMPLEMENTED_OFFLINE
LIVE_OAUTH_OR_NETWORK=NOT_AUTHORIZED

## 9.3 Journaled generated-ID upload orchestration (offline prototype)

The branch now includes `services/mira-hfm-drive-generated-id-upload.js`. This composes the durable journal with an injected provider contract; it is not a Google SDK adapter.

- Requires an injected provider implementing `generateFileId`, `createFile`, `getFile` and `downloadFile`.
- Validates the encrypted envelope schema/version/createdAt/project/backup identity, encrypted MIME type, AES-256-GCM marker, payload size and SHA-256 before provider interaction.
- On a new operation, obtains one provider-generated ID, durably publishes and reads back the local journal, and only then calls `createFile`.
- On restart, loads the existing journal and never requests a replacement ID. A missing/corrupt/mismatched journal blocks upload.
- The create request binds generated ID, dedicated parent, project/backup identity, authenticated envelope schema/version/createdAt, ciphertext digest, byte length and encryption metadata.
- Regardless of create response or error (including timeout/409), it retrieves the exact ID, validates provider metadata and downloads the complete ciphertext for byte-for-byte and SHA-256 comparison. Missing/unreadable objects remain UNCERTAIN; metadata or byte mismatches are CONFLICT.
- A successful return means exact remote bytes and metadata were verified through the injected provider contract. It does not prove Google API behavior, OAuth correctness, provider durability or real quota.
- Offline synthetic tests cover journal-before-upload ordering, timeout after commit, timeout before commit followed by same-ID retry, metadata conflict, ciphertext mismatch, cross-account journal binding, and no network/OAuth/canonical writes.

This is a provider orchestration prototype only. It has no delete, overwrite, move, permission grant, or routine-sync integration. A real provider mapping must prove that `getFile` binds account/space/parent and maps actual Drive metadata faithfully; only then can a separately approved live test be considered.

STATUS=OFFLINE_JOURNALED_UPLOAD_ORCHESTRATION_PROTOTYPE
GOOGLE_DRIVE_V3_MAPPER=IMPLEMENTED_CI_PENDING
LIVE_OAUTH_OR_NETWORK=NOT_AUTHORIZED

## 9.4 Journaled cloud adapter integration (offline prototype)

The branch now includes `services/mira-hfm-drive-journaled-cloud-adapter.js`, which exposes the existing cloud-backup service contract over the generated-ID journal and injected provider.

- `putIfAbsent` derives a deterministic operation ID from project and backup identity, validates the exact object namespace and encrypted bytes, then delegates to journal-before-upload orchestration.
- It returns a reconciliation result only when the generated-ID uploader has verified remote metadata and exact ciphertext bytes. The cloud service now accepts this narrowly defined `reconciled + verified` result and performs its own readback and authenticated-envelope verification again.
- `get` resolves the exact generated ID from the journal, verifies account/space/project/backup/schema/version/timestamp/digest/size/encryption/parent metadata, downloads exact bytes and rechecks size/SHA-256. It never searches by file name.
- `recoverJournal({backupId,key})` scans only the configured project parent with bounded pagination, requires exactly one matching immutable backup ID, fetches by the listed exact file ID, verifies all metadata and exact ciphertext bytes, validates the 32-byte root key before listing, authenticates/decrypts the envelope in memory, zeroizes the recovered plaintext buffer, then recreates the local journal atomically. Wrong keys, duplicate matches, incomplete listings, metadata mismatch or digest mismatch fail closed without writing a journal or restore artifact. When the injected provider exposes listPage/getQuota, the adapter surfaces project-scoped listing and provider quota for capacity monitoring. It intentionally has no delete/move/permission API; quota-unavailable remains NOT_REPORTED.
- End-to-end synthetic tests exercise encrypted backup upload, repeated upload with HTTP 409 reconciliation, capacity/list/quota reporting, authenticated cloud preview, restore to staging only, local-journal loss recovery from a unique authenticated provider object, wrong-key and duplicate-match rejection, project isolation, and no network/OAuth/canonical writes.

This proves only the injected fake-provider and offline Google Drive v3 method-mapping contracts. It does not establish live Google account identity, remote consistency, OAuth scope approval, production quota behavior or provider durability.

STATUS=OFFLINE_JOURNALED_CLOUD_ADAPTER_AND_AUTHENTICATED_JOURNAL_RECOVERY
GOOGLE_DRIVE_V3_MAPPER=IMPLEMENTED_CI_PENDING
LIVE_OAUTH_OR_NETWORK=NOT_AUTHORIZED

## 9.5 Injected Google Drive v3 provider mapper (fake-client CI pending)

The branch now includes `services/mira-hfm-google-drive-generated-id-provider.js`. It maps the injected Google Drive v3 `drive.files` client to the journaled uploader contract; it does not create an OAuth client, load credentials, or perform any request until one of its methods is explicitly called.

- `generateFileId` calls `files.generateIds({count: 1, space, type: 'files'})`, validates the returned space and one generated ID.
- `createFile` sends the pre-generated ID in the `File` resource, a single configured parent, private `appProperties`, encrypted MIME type and a resumable media upload. It validates the ciphertext digest and canonical envelope timestamp before calling the client.
- `getFile` retrieves metadata by exact ID and maps Drive `appProperties`, parent, MIME type and size into the journaled provider contract. 404 is returned as absent; other provider failures remain errors.
- `downloadFile` downloads media by exact ID as a stream and enforces the 64 MiB bound before returning bytes.
- `listPage` uses a parent-scoped `files.list` query, bounded page size/cursor, exact project and encrypted appProperties validation; no name-based lookup is used.
- `getQuota` uses `about.get` with explicit `fields` for the authenticated `permissionId` and `storageQuota`. It hashes the opaque permission ID for account binding and reports total Google account usage conservatively (Gmail/Photos usage can reduce remaining Drive capacity).
- Every method verifies the SHA-256 account fingerprint. The caller may inject a trusted fingerprint callback; otherwise the mapper derives it from `about.get` `user.permissionId`. It does not create OAuth credentials.
- The mapper has no delete, update, move, sharing, permission-grant, or folder-creation operation. Shared Drive behavior is not certified; use a dedicated My Drive folder or appDataFolder only in a separately configured integration.
- Offline fake-client tests cover generated ID space binding, resumable create request shape, appProperties mapping, exact media readback, 404 handling, project-scoped pagination, quota mapping, account-scope rejection and digest validation. No real Google API client, OAuth credential or network request is used.

Official API references reviewed:
- `files.generateIds`: https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds
- `files.create`: https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create
- Pre-generated ID retries and 409 behavior: https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files
- App-specific `appProperties`: https://developers.google.com/workspace/drive/api/guides/properties
- `about.get` identity and storage quota: https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get
- `files.list` pagination and `incompleteSearch`: https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
- OAuth scope selection and sensitivity: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Drive file creation and generated-ID examples: https://developers.google.com/workspace/drive/api/guides/create-file

The documentation supports generated IDs for `drive` and `appDataFolder` spaces and describes duplicate-preventing 409 responses on retry after a successful create. Pre-generated IDs are not supported for ordinary Google Workspace document conversion; HFM must remain an ordinary binary file. This research does not authorize OAuth or certify the injected account-fingerprint callback.

STATUS=INJECTED_GOOGLE_DRIVE_V3_MAPPER_IMPLEMENTED_CI_PENDING
OAUTH_CLIENT=NOT_CREATED
LIVE_GOOGLE_DRIVE=NOT_TESTED
SHARED_DRIVE=NOT_CERTIFIED

## 10. Latest code-change CI evidence

The latest current-head Phase 7 workflow completed GitHub Actions run **42007614192 — SUCCESS**, job **127178244541**, against workflow head commit `f71b875d906efd7687c62060a4de9ab3962b26f4`. The tested application/test source commit is `34709f7bc02bfcb04981d56fa1e1ac68436c479a`; the later head commit changes documentation only. The run completed the Node syntax check and all six offline test suites. Logs contain **91 explicit Phase 7 PASS markers**; all six test commands report `TESTS_FAILED=0`. Logs confirm `HFM_PHASE7_CANONICAL_WRITES=0` and `HFM_PHASE7_PRODUCTION_RESTORE=0`.

The Phase 7 branch is restacked on the latest Phase 6 base; PR #16 is mergeable, Draft and unmerged.

This is synthetic offline CI evidence only. It does not certify a live Google Drive provider, production key custody, canonical snapshot completeness, or production recovery.

VERSION=v0.2
OFFLINE_TRANSPORT_ADAPTER=PASS
OFFLINE_CI_RUN=42007614192_SUCCESS
OFFLINE_CI_JOB=127178244541
OFFLINE_CI_HEAD_COMMIT=f71b875d906efd7687c62060a4de9ab3962b26f4
OFFLINE_CI_CODE_TEST_COMMIT=34709f7bc02bfcb04981d56fa1e1ac68436c479a
OFFLINE_PASS_MARKERS=91
OFFLINE_TEST_SUITES=6
CURRENT_HEAD_CI=PASS_OFFLINE_SYNTHETIC
LIVE_GOOGLE_DRIVE=NOT_IMPLEMENTED
LIVE_NETWORK=NOT_AUTHORIZED
ROUTINE_DRIVE_SYNC=UNCHANGED
PRODUCTION_RESTORE=NOT_CERTIFIED
