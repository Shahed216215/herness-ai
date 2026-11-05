# Mira HFM v0.2 — Phase 7 Encrypted Emergency Backup

Status: ENCRYPTED BACKUP, IMMUTABLE LOCAL ARTIFACT, INTEGRITY VERIFICATION, RESTORE PREVIEW/STAGING, CAPACITY/RETENTION CONTRACTS, VERSIONED KEY-PROVIDER WRAPPER, AND OFFLINE INJECTED TRANSPORT ADAPTER PROTOTYPE IMPLEMENTED. GOOGLE DRIVE OAUTH AND PRODUCTION RESTORE NOT CERTIFIED.

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

- Local emergency artifacts authenticate/decrypt before file creation; owner-only permissions, symlink rejection, atomic create-only publication, fsync, and read-after-write verification are enforced.
- Existing backup IDs cannot be overwritten.
- Restore preview authenticates/decrypts without writing a stage file.
- Cloud restore preview verifies project/object identity and encryption before staging.
- Actual restore decrypts and verifies into a separate owner-only staging directory only.
- No canonical Memory writes, live provider calls, production restore, or automatic trust promotion occur.
- Capacity monitoring uses explicit project-scoped pagination and a configured 5,000,000,000-byte emergency-backup budget; it is not a live Google Drive quota integration.
- Retention planning is non-destructive and never deletes artifacts.

## Offline key-provider contract

- `services/mira-hfm-backup-key-provider.js` provides an injected `getKey({ keyId })` wrapper, exact 32-byte validation, authenticated key-version metadata, historical version lookup, normalized failure codes, ephemeral key-copy zeroization, and a retirement evidence gate.
- This is not a production key vault/KMS. JavaScript zeroization is best-effort memory hygiene only; production custody, rotation operations, escrow, and recovery remain NOT_CERTIFIED.

## Offline injected transport adapter

- `services/mira-hfm-drive-emergency-backup-adapter.js` provides a provider-neutral adapter around an injected `atomicCreate`, `readObject`, and `listPage` transport.
- It fixes a project-scoped namespace, validates encrypted-envelope content metadata and SHA-256 format, rejects cross-project/path traversal access, enforces explicit bounded pagination, and rejects ambiguous create results.
- The transport's `atomicCreate` must be a true provider-side atomic create-if-absent operation. The adapter cannot prove that a future real provider implements this correctly.
- Synthetic fake-transport tests cover concurrent create-only behavior, namespace isolation, metadata binding, readback, multi-page listing, uncertain create rejection, and no OAuth/network use.
- No Google Drive SDK, OAuth, token handling, real Drive calls, delete/overwrite, permission grants, or routine-sync mutation is implemented.

## Verification

- Latest branch-head CI: run **41981522602 — SUCCESS**, job **127092457448**, commit **a5c092056800734bc3b1bec1989fed6f9c311a05**.
- Existing encrypted-backup/key-provider suite: **20 PASS markers**, `TESTS_FAILED=0`.
- New injected-transport adapter suite: **6 PASS markers**, `TESTS_FAILED=0`.
- Log confirms `CANONICAL_WRITES=0` and `PRODUCTION_RESTORE=0`.
- This is synthetic offline CI evidence, not a live-provider or production recovery certification.

## Explicit exclusions and blockers

- Actual Google Drive adapter/OAuth/live upload/download/Drive quota API: NOT_IMPLEMENTED / NOT_TESTED.
- Production key provider/KMS/OS keystore, key custody, rotation execution, escrow/recovery: NOT_IMPLEMENTED / NOT_CERTIFIED.
- Canonical HFM snapshot exporter: BLOCKED pending authoritative store/schema reconciliation in Phases 1–3.
- Production restore drill and independent production recovery certification: NOT_TESTED.
- Existing routine Google Drive synchronization: UNCHANGED.

VERSION=v0.2
PHASE7=OFFLINE_ENCRYPTED_EMERGENCY_BACKUP_AND_INJECTED_TRANSPORT_CONTRACT
LATEST_CI=41981522602_SUCCESS
LIVE_NETWORK=NOT_AUTHORIZED
ROUTINE_DRIVE_SYNC=UNCHANGED
PRODUCTION_RESTORE=NOT_CERTIFIED
