# Mira HFM v0.2 — Phase 7 Encrypted Emergency Backup

Status: ENCRYPTION, IMMUTABLE LOCAL ARTIFACT, INTEGRITY VERIFICATION, RESTORE PREVIEW/STAGING, PROVIDER-NEUTRAL CAPACITY MONITOR AND NON-DESTRUCTIVE RETENTION PREVIEW IMPLEMENTED; GOOGLE DRIVE ADAPTER AND LIVE RESTORE NOT CERTIFIED.

## Scope

Phase 7 adds an encrypted emergency-backup primitive for a bounded Memory snapshot payload. It is deliberately separate from routine Google Drive synchronization. It does not replace, disable, rename, or modify any existing routine sync.

## Cryptographic design

- AES-256-GCM authenticated encryption with a fresh 96-bit nonce per backup.
- HKDF-SHA256 derives a per-backup encryption key from a caller-supplied 32-byte root key and random 128-bit salt.
- Root key is injected by an external key provider. This module never generates, stores, logs, exports, or transmits the root key.
- The authenticated header binds schema/version, algorithm, backup ID, timestamp, payload length, plaintext digest, and allowlisted metadata.
- Ciphertext and plaintext SHA-256 digests are checked; GCM authentication is mandatory before plaintext is returned.
- Payload and envelope sizes are bounded.

## Storage and restore safety

- Local emergency artifacts must authenticate/decrypt successfully with the supplied external key before any file is created; they then use owner-only directory/file permissions, symlink rejection, atomic create-only hard-link publication, fsync, and read-after-write verification.
- Existing backup IDs cannot be overwritten.
- Restore preview authenticates/decrypts the exact envelope and reports metadata, byte count, and digest without writing a stage file.
- Cloud restore preview verifies project/object identity and encryption before any restore staging.
- Actual restore decrypts and verifies into a separate owner-only staging directory only.
- No canonical Memory writes, live provider calls, production restore, or automatic trust promotion occur.
- A provider-neutral capacity monitor totals project-scoped backup object bytes against a 5,000,000,000-byte emergency-backup budget. It requires a future adapter with explicit project-scoped list capability; it is not a live Google Drive quota/API integration.
- Retention planning accepts explicit `keepLast` and `maxAgeDays` policy, produces a non-destructive candidate list, and never deletes artifacts. Any future deletion requires a separately approved workflow.
- A successful cryptographic verification proves integrity under the supplied key; it does not prove that the source snapshot was complete, correct, or authorized.

## Explicit exclusions / next integration

- No Google Drive OAuth, token access, concrete Drive adapter, live upload, download, or API request is implemented in this phase slice. The 5 GB monitor is a tested provider-neutral inventory contract only.
- A future emergency cloud transport must be a separately authorized adapter using encrypted envelope bytes only; it must not alter routine sync behavior.
- Production key management, key rotation/recovery, real provider adapter/authentication, durable cloud retention, snapshot export from the canonical HFM store, crash-recovery drills, and independent production restore verification remain NOT_CERTIFIED. The offline cross-process synthetic recovery check is not a production recovery drill.
- Do not store the root key beside the backup. Losing the key means the backup cannot be decrypted; losing the backup does not justify weakening key protection.

## Offline verification

Run: `node tests/mira-hfm-encrypted-emergency-backup.test.js`

Latest GitHub Actions run **41966608276: SUCCESS**; TESTS_FAILED=0. Verified log groups include authenticated local/cloud restore preview without writes, project-scoped 5 GB capacity monitoring, non-destructive retention planning, independent-process recovery, and failed-authentication/no-stage-artifact checks. Synthetic offline tests cover authenticated encrypt/decrypt, wrong-key rejection, metadata/ciphertext tamper rejection, input/key gates, authenticated local/cloud restore previews without writes, authenticated-before-write local storage, immutable write/readback, encrypted-only cloud adapter capability gates, create-only cloud upload/readback, project isolation, project-scoped 5 GB capacity accounting, non-destructive retention planning, cloud-download restore-to-staging, independent-process recovery from the exact encrypted artifact, and proof that failed authentication creates no restore-stage file. No live network or cloud calls occur.

VERSION=v0.2
PHASE7=ENCRYPTED_EMERGENCY_BACKUP_PRIMITIVE_IMPLEMENTED
ROUTINE_DRIVE_SYNC=UNCHANGED
CLOUD_TRANSPORT=PROVIDER_NEUTRAL_CONTRACT_ONLY
PRODUCTION_RESTORE=NOT_CERTIFIED


## Capacity and retention contracts

- Default emergency-backup allocation: `5,000,000,000` bytes (decimal 5 GB), scoped to one project.
- Capacity states: `WITHIN_BUDGET`, `NEAR_BUDGET_LIMIT` (90% or more), and `OVER_BUDGET`.
- Capacity inspection requires `capabilities.list === true` and an adapter `list({ projectId, prefix })` implementation. Each listed object must bind to the exact project/object key and provide a positive byte count and canonical creation timestamp.
- Retention preview requires an explicit `keepLast` and `maxAgeDays`; it labels old snapshots as candidates but never removes them. No automatic pruning or deletion is implemented.
