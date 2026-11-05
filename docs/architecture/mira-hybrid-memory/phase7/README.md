# Mira HFM v0.2 — Phase 7 Emergency Backup

Status: ENVELOPE-ENCRYPTION CORE IMPLEMENTED; GOOGLE DRIVE PROVIDER ADAPTER, CI EXECUTION AND PRODUCTION KEY CUSTODY REVIEW REMAIN OPEN.

## Scope
- Per-backup random 256-bit data-encryption key (DEK), AES-256-GCM payload encryption, and external key-provider wrapping/unwrapping of the DEK (KEK boundary).
- Authenticated manifest includes backup format/schema versions, project scope, record count, source revision, payload digest, key reference/version, wrapped DEK, nonce, algorithm and manifest digest.
- Key material is injected through wrapDataKey/unwrapDataKey callbacks. This module does not generate, persist, rotate or escrow KEKs.
- Immutable local file creation uses exclusive temporary files, fsync, atomic link publication, owner-only file permissions and byte-for-byte readback.
- Restore is a decrypt-and-validate preview only. It returns a verified snapshot and does not write to canonical Memory.
- Retention produces a deletion proposal only. It never deletes backup files.
- Drive quota assessment accepts an observed quota snapshot and applies the configured 5 GiB allocation ceiling. It performs no Drive API request.

## Explicit limitations
- No production Memory source is read. Caller must provide a snapshot and its independently established project scope/source revision.
- No Google Drive upload/download adapter is wired yet. The quota helper does not establish a live quota value.
- No production KMS/KEK, key rotation, escrow or recovery-key workflow is implemented. Production use is blocked until key custody is reviewed and approved.
- No routine Google Drive synchronization is removed or changed.
- No restore-to-production, migration, deployment or provider cutover is implemented.
- The current local backup/restore tools remain unchanged.

## Offline verification
Run node tests/mira-hfm-emergency-backup.test.js. Tests use synthetic fixtures and a temporary directory only. No network, Drive, OAuth, production Memory or canonical write is permitted.

## Acceptance status
- Envelope encryption and authentication: contract test implemented; CI pending.
- Manifest and payload integrity: contract test implemented; CI pending.
- Project/schema/count validation: contract test implemented; CI pending.
- Immutable local write/readback: contract test implemented; CI pending.
- Retention: plan-only; deletion not authorized.
- Drive quota: pure calculation only; live snapshot not verified.
- Restore: preview-only; production restore not authorized.
