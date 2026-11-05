# Mira HFM v0.2 — Phase 7 Emergency Backup

Status: ENVELOPE-ENCRYPTION CORE AND MOCKED GOOGLE DRIVE ADAPTER IMPLEMENTED; CI EXECUTION AND PRODUCTION KEY CUSTODY REVIEW REMAIN OPEN.

## Scope
- Per-backup random 256-bit data-encryption key (DEK), AES-256-GCM payload encryption, and external key-provider wrapping/unwrapping of the DEK (KEK boundary).
- Authenticated manifest includes backup format/schema versions, project scope, record count, source revision, payload digest, key reference/version, wrapped DEK, nonce, algorithm and manifest digest.
- Key material is injected through wrapDataKey/unwrapDataKey callbacks. This module does not generate, persist, rotate or escrow KEKs.
- Immutable local file creation uses exclusive temporary files, fsync, atomic link publication, owner-only file permissions and byte-for-byte readback.
- Google Drive adapter accepts an already-authorized Drive client, reads quota, enforces the 5 GiB allocation ceiling, refuses filename overwrite, uploads encrypted bytes and performs byte-for-byte remote readback verification.
- Drive download returns encrypted bytes after envelope and optional digest checks. It does not decrypt or restore canonical Memory.
- Retention produces a deletion proposal only. It never deletes backup files.
- All provider calls are dormant until an explicit caller invokes the adapter. Tests use mock Drive methods only.

## Explicit limitations
- No production Memory source is read. Caller must provide a snapshot and its independently established project scope/source revision.
- No Drive folder is created or credentials loaded by the adapter; caller must supply a verified folder ID and authorized client.
- No production KMS/KEK, key rotation, escrow or recovery-key workflow is implemented. Production use is blocked until key custody is reviewed and approved.
- No routine Google Drive synchronization is removed or changed.
- No restore-to-production, migration, deployment or provider cutover is implemented.
- The current local backup/restore tools remain unchanged.
- Live Drive quota, upload, download and provider permission behavior remain unverified.

## Offline verification
Run node tests/mira-hfm-emergency-backup.test.js and node tests/mira-hfm-google-drive-backup-adapter.test.js. Tests use synthetic keys, mock Drive methods and temporary local directories. No network, OAuth, production Memory or canonical write is permitted.

## Acceptance status
- Envelope encryption and authentication: test implemented; CI pending.
- Manifest and payload integrity: test implemented; CI pending.
- Project/schema/count validation: test implemented; CI pending.
- Immutable local write/readback: test implemented; CI pending.
- Mocked Drive quota/upload/no-overwrite/remote-readback contract: test implemented; CI pending.
- Retention: plan-only; deletion not authorized.
- Restore: decrypt-and-validate preview only; production restore not authorized.
