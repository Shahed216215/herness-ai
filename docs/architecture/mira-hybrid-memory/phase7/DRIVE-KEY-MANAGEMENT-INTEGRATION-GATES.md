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

- `putIfAbsent({ objectKey, projectId, backupId, bytes, contentType, ciphertextSha256, encryption })`
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
- Required transport methods: `atomicCreate({ objectKey, metadata, bytes })`, `readObject({ objectKey })`, and `listPage({ projectId, prefix, cursor, limit })`.
- The adapter validates project binding, object key, AES-256-GCM content metadata, SHA-256 format, object metadata/byte length, and explicit bounded pagination.
- It rejects ambiguous atomic-create results. A future real transport must implement provider-side atomic create-if-absent; a preflight search plus ordinary upload is not acceptable.
- Fake-transport tests exercise concurrent duplicate create calls (exactly one create result), project/namespace isolation, readback, multi-page listing, malformed create result rejection, and the absence of OAuth/network behavior.
- The adapter has no delete, overwrite, move, permission-grant, OAuth, or routine-sync method.

This prototype cannot establish real provider atomicity, remote durability, quota behavior, OAuth scope, or consistency. Those remain separate provider-specific review and live-test gates.

## 10. Latest CI evidence

Branch-head commit `309fb9f50f5e9dadfb7814b7d367ce35ca373e9e` completed GitHub Actions run **41988338971** (job **127114317919**) successfully. The combined offline job logs contain **37 Phase 7 PASS markers** across the encrypted-backup/key-provider and injected-transport suites; both test commands report `TESTS_FAILED=0`. Logs also confirm `HFM_PHASE7_CANONICAL_WRITES=0` and `HFM_PHASE7_PRODUCTION_RESTORE=0`.

This is synthetic offline CI evidence only. It does not certify a live Google Drive provider, production key custody, canonical snapshot completeness, or production recovery.

VERSION=v0.2
OFFLINE_TRANSPORT_ADAPTER=PASS
OFFLINE_CI_RUN=41988338971_SUCCESS
OFFLINE_CI_HEAD=309fb9f50f5e9dadfb7814b7d367ce35ca373e9e
OFFLINE_PASS_MARKERS=37
LIVE_GOOGLE_DRIVE=NOT_IMPLEMENTED
LIVE_NETWORK=NOT_AUTHORIZED
ROUTINE_DRIVE_SYNC=UNCHANGED
PRODUCTION_RESTORE=NOT_CERTIFIED
