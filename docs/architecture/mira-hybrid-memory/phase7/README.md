# Mira HFM v0.2 — Phase 7 Encrypted Emergency Backup

Status: ENCRYPTION, IMMUTABLE LOCAL ARTIFACT, INTEGRITY VERIFICATION AND RESTORE-STAGING CONTRACT IMPLEMENTED; CLOUD TRANSPORT AND LIVE RESTORE NOT CERTIFIED.

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

- Local emergency artifacts use owner-only directory/file permissions, symlink rejection, atomic create-only hard-link publication, fsync, and read-after-write verification.
- Existing backup IDs cannot be overwritten.
- Restore decrypts and verifies into a separate owner-only staging directory only.
- No canonical Memory writes, live provider calls, production restore, or automatic trust promotion occur.
- A successful cryptographic verification proves integrity under the supplied key; it does not prove that the source snapshot was complete, correct, or authorized.

## Explicit exclusions / next integration

- No Google Drive OAuth, token access, upload, download, or API request is implemented in this phase slice.
- A future emergency cloud transport must be a separately authorized adapter using encrypted envelope bytes only; it must not alter routine sync behavior.
- Production key management, key rotation/recovery, real provider adapter/authentication, durable cloud retention, snapshot export from the canonical HFM store, crash-recovery drills, and independent production restore verification remains NOT_CERTIFIED. The offline cross-process synthetic recovery check is not a production recovery drill.
- Do not store the root key beside the backup. Losing the key means the backup cannot be decrypted; losing the backup does not justify weakening key protection.

## Offline verification

Run: `node tests/mira-hfm-encrypted-emergency-backup.test.js`

Synthetic offline tests cover authenticated encrypt/decrypt, wrong-key rejection, metadata/ciphertext tamper rejection, input/key gates, immutable write/readback, encrypted-only cloud adapter capability gates, create-only cloud upload/readback, project isolation, cloud-download restore-to-staging, independent-process recovery from the exact encrypted artifact, and proof that failed authentication creates no restore-stage file. No live network or cloud calls occur.

VERSION=v0.2
PHASE7=ENCRYPTED_EMERGENCY_BACKUP_PRIMITIVE_IMPLEMENTED
ROUTINE_DRIVE_SYNC=UNCHANGED
CLOUD_TRANSPORT=PROVIDER_NEUTRAL_CONTRACT_ONLY
PRODUCTION_RESTORE=NOT_CERTIFIED
