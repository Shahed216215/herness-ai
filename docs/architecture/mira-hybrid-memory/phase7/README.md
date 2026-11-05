# Mira HFM v0.2 — Phase 7 Emergency Backup

Status: OFFLINE CONTRACT CI VERIFIED; PRODUCTION KEY CUSTODY AND LIVE PROVIDER VERIFICATION REMAIN OPEN.

## Implemented
- Per-backup random 256-bit data-encryption key (DEK), AES-256-GCM payload encryption, and external key-provider wrapping/unwrapping of the DEK (KEK boundary).
- Authenticated manifest includes backup format/schema versions, project scope, record count, source revision, payload digest, key reference/version, wrapped DEK, nonce, algorithm and manifest digest.
- Key material is injected through wrapDataKey/unwrapDataKey callbacks. This module does not generate, persist, rotate or escrow KEKs.
- Immutable local file creation uses exclusive temporary files, fsync, atomic link publication, owner-only file permissions and byte-for-byte readback.
- Google Drive adapter accepts an already-authorized Drive client, reads quota, enforces the configured 5 GiB allocation ceiling, refuses filename overwrite, uploads encrypted bytes and performs byte-for-byte remote readback verification.
- Drive download returns encrypted bytes after envelope and optional digest checks. It does not decrypt or restore canonical Memory.
- Retention produces a deletion proposal only. It never deletes backup files.

## CI evidence
- GitHub Actions run 42026737289 completed SUCCESS on commit a58537677d88b137f9af4d296a10f100ae743f62.
- Both isolated suites report PASS: MIRA_HFM_PHASE7_EMERGENCY_BACKUP_CONTRACT_PASS and MIRA_HFM_PHASE7_GOOGLE_DRIVE_ADAPTER_PASS.
- Logs confirm NETWORK_REQUESTS=0, PRODUCTION_MEMORY_TOUCHED=NO, LIVE_DRIVE_API_CALLS=0 and BACKUP_DELETION=0.
- Earlier failed attempts are preserved; run 42026705689 failed on an async assertion mismatch. The assertion was corrected and the later branch-head run above passed.

## Explicit limitations
- No production Memory source is read. Caller must provide a snapshot and its independently established project scope/source revision.
- No Drive folder is created or credentials loaded by the adapter; caller must supply a verified folder ID and authorized client.
- No production KMS/KEK, key rotation, escrow or recovery-key workflow is implemented. Production use is blocked until key custody is reviewed and approved.
- No routine Google Drive synchronization is removed or changed.
- No restore-to-production, migration, deployment or provider cutover is implemented.
- The current local backup/restore tools remain unchanged.
- Live Drive quota, upload, download and provider permission behavior remain unverified.

## Acceptance status
- Envelope encryption and authentication: PASS_CI (test KEK fixture only).
- Manifest and payload integrity: PASS_CI.
- Project/schema/count validation: PASS_CI.
- Immutable local write/readback: PASS_CI.
- Mocked Drive quota/upload/no-overwrite/remote-readback contract: PASS_CI.
- Retention: plan-only; deletion not authorized.
- Restore: decrypt-and-validate preview only; production restore not authorized.
- Production readiness: NOT_CERTIFIED.
