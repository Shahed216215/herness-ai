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
- Latest Phase 7 workflow run `42027268319` completed SUCCESS on commit `b0ccad200e807876993531f87a6fa23a12455925`.
- Three isolated suites passed: emergency-backup contract, mocked Google Drive adapter, and key-provider contract conformance.
- Logs explicitly confirm `PRODUCTION_KEY_CUSTODY=NOT_APPROVED`, `NETWORK_REQUESTS=0`, `PRODUCTION_MEMORY_TOUCHED=NO`, `LIVE_DRIVE_API_CALLS=0`, and `BACKUP_DELETION=0`.
- GitHub Actions run 42026737289 completed SUCCESS on commit a58537677d88b137f9af4d296a10f100ae743f62.
- Both isolated suites report PASS: MIRA_HFM_PHASE7_EMERGENCY_BACKUP_CONTRACT_PASS and MIRA_HFM_PHASE7_GOOGLE_DRIVE_ADAPTER_PASS.
- Logs confirm NETWORK_REQUESTS=0, PRODUCTION_MEMORY_TOUCHED=NO, LIVE_DRIVE_API_CALLS=0 and BACKUP_DELETION=0.
- Earlier failed attempts are preserved; run 42026705689 failed on an async assertion mismatch. The assertion was corrected and the later branch-head run above passed.

## Key-provider contract update
- `services/mira-hfm-key-provider-contract.js` validates the declared external-provider interface, backup key purpose, and key ID/version consistency.
- The validator result is `CONTRACT_SHAPE_VALID_NOT_APPROVAL`; descriptor fields are caller-supplied and do not prove provider identity, key custody, authorization, or production approval.
- `services/mira-hfm-emergency-backup.js` now enforces this contract before wrapping/unwrapping and zeroizes the temporary DEK copy passed to the wrap callback.
- `tests/mira-hfm-key-provider-contract.test.js` covers descriptor shape, key-reference mismatch, wrong purpose, missing operations, and unsupported operation.
- Production KMS/HSM selection, workload identity, least privilege, rotation, escrow/recovery, audit policy, and security approval remain open. See `KEY-PROVIDER-GOVERNANCE.md`.

## Authoritative snapshot and recovery verification
- `services/mira-hfm-authoritative-snapshot.js` defines an injected read-only source contract. It requires explicit project, actor, and `backup:read` request scope, plus declared source/project/revision/schema/count/digest attestation. It returns source revision-bound backup metadata only after contract checks.
- Source descriptors and attestations are caller-supplied claims. This contract does not authenticate a production source, independently authorize an actor, or prove a production snapshot is authoritative. No production Memory or Knowledge store is wired into it.
- `services/mira-hfm-recovery-verification.js` performs a non-mutating recovery drill: decrypt/authenticate, validate project/schema/count, and compare source revision, record count, and payload SHA-256 against an independently supplied baseline. It explicitly reports no canonical Memory/Knowledge write and no restore execution.
- Synthetic tests cover allow/deny shape, project/scope/revision/digest mismatches, read-only mode, successful recovery preview, and baseline mismatch. They do not establish production source identity or key custody.


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
