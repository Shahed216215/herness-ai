# Mira HFM v0.2 — Phase 7 Emergency Backup

Status: STAGING BACKUP/RECOVERY DRILL IMPLEMENTED; NEW CI RUN PENDING; PRODUCTION KEY CUSTODY AND LIVE PROVIDER VERIFICATION REMAIN OPEN.

## Implemented
- Per-backup random 256-bit data-encryption key (DEK), AES-256-GCM payload encryption, and external key-provider wrapping/unwrapping of the DEK (KEK boundary).
- Authenticated manifest includes backup format/schema versions, project scope, record count, source revision, payload digest, key reference/version, wrapped DEK, nonce, algorithm and manifest digest.
- Key material is injected through wrapDataKey/unwrapDataKey callbacks. This module does not generate, persist, rotate or escrow KEKs.
- Immutable local file creation uses exclusive temporary files, fsync, atomic link publication, owner-only file permissions and byte-for-byte readback.
- Google Drive adapter accepts an already-authorized Drive client, reads quota, enforces the configured 5 GiB allocation ceiling, refuses filename overwrite, uploads encrypted bytes and performs byte-for-byte remote readback verification.
- Drive download returns encrypted bytes after envelope and optional digest checks. It does not decrypt or restore canonical Memory.
- Retention produces a deletion proposal only. It never deletes backup files.

## CI evidence
- Latest previously observed five-suite workflow run `42028413165` completed SUCCESS on commit `8b8d7127a3c986d906f74edffcfefd1f924929d5`. A later ledger-only documentation commit was not included in that run.
- Five offline suites passed: encrypted backup contract, mocked Drive adapter, key-provider contract, signed snapshot-source contract, and recovery verification.
- Logs confirmed `PRODUCTION_SOURCE_AUTHENTICATED=NO`, `CANONICAL_MEMORY_WRITTEN=NO`, `CANONICAL_KNOWLEDGE_WRITTEN=NO`, `NETWORK_REQUESTS=0`, `LIVE_DRIVE_API_CALLS=0`, and `BACKUP_DELETION=0`.
- Earlier failed attempts are retained as evidence; run `42026705689` failed on an async assertion mismatch and was corrected in a later run.

## Key-provider contract update
- `services/mira-hfm-key-provider-contract.js` validates the declared external-provider interface, backup key purpose, and key ID/version consistency.
- The validator result is `CONTRACT_SHAPE_VALID_NOT_APPROVAL`; descriptor fields are caller-supplied and do not prove provider identity, key custody, authorization, or production approval.
- Production KMS/HSM selection, workload identity, least privilege, rotation, escrow/recovery, audit policy, and security approval remain open. See `KEY-PROVIDER-GOVERNANCE.md`.

## Authoritative snapshot and recovery verification
- `services/mira-hfm-authoritative-snapshot.js` defines an injected read-only source contract with independent pinned Ed25519 trust anchors, public-key fingerprint checks, signed attestation verification, request nonce/request-ID binding, freshness limits, project/actor/scope checks, source revision, schema, count and payload digest checks.
- Signature verification authenticates the attestation signer against the configured trust anchor. It does not independently enforce the source's authorization policy or certify that a production Memory/Knowledge store is authoritative.
- `createEncryptedBackupFromSource` connects the verified snapshot result to envelope encryption and returns prepared bytes only; it does not publish a local file, upload to Drive, or write canonical Memory.
- `services/mira-hfm-recovery-verification.js` performs a non-mutating recovery drill: decrypt/authenticate, validate project/schema/count, and compare source revision, record count, and payload SHA-256 against an independently supplied baseline.
- Synthetic tests cover signed snapshot validation, trust-anchor mismatch, denied claims, stale attestation, nonce replay mismatch, successful recovery preview, baseline mismatch, and no-canonical-write behavior.

## Local staging snapshot source (new)
- `services/mira-hfm-local-staging-snapshot-source.js` is a separate staging-only adapter for the existing `memory.json` and `knowledge.json` JSON-array stores.
- It requires explicit absolute file paths, a non-symlink staging root, `environment: staging`, an injected Ed25519 private signing key, and an explicit authorization callback. It has no default production path and rejects `environment: production`.
- It reads the two files through bounded regular-file descriptors, checks file identity/size/mtime across the read, parses JSON arrays, flattens records with store identifiers, and signs a request-bound attestation.
- The adapter does not call `readMemory()` or `createKnowledgeBackup()`. This is intentional: inspection found that the former may create an initialization marker, while the latter writes backup/audit state.
- The adapter does not write, migrate, restore, publish, upload, or delete anything. Its signing key and authorization callback are injected; their real identity, custody, and policy remain deployment responsibilities.
- New synthetic tests cover successful signed staging capture, denied authorization, production-environment rejection, path pinning, and source-file immutability. CI execution for this addition is pending until the new workflow run completes.
- This adapter is not a production integration and must not be pointed at production data.

## Staging backup and recovery drill (new)
- `services/mira-hfm-staging-backup-drill.js` composes two separately pinned staging snapshot sources, encrypted envelope creation, immutable local publication, byte-for-byte file readback, and the existing non-mutating recovery verifier.
- The baseline source is captured independently before the backup source. Source revision, record count, and canonical payload digest must match before any backup file is published; a mismatch blocks publication.
- The published encrypted file is read back from disk and recovery-verified against the independent baseline. Existing backup names are never overwritten.
- The drill requires an existing explicit non-symlink staging backup directory and a restricted filename. It does not call Drive, write canonical Memory/Knowledge, restore data, or delete files.
- Synthetic tests cover successful publication and recovery preview, unchanged source files, overwrite refusal, and mismatch blocking. The new CI suite is pending; no PASS is claimed until its workflow logs confirm execution.
- Both source adapters are synthetic test identities. This demonstrates the staging workflow contract, not independent production authority, real key custody, or production store correctness.

## Explicit limitations
- No production Memory source is read. No production store is wired into the source contract.
- No Drive folder is created or credentials loaded by the adapter; caller must supply a verified folder ID and authorized client.
- No production KMS/KEK, key rotation, escrow or recovery-key workflow is implemented. Production use is blocked until key custody is reviewed and approved.
- No routine Google Drive synchronization is removed or changed.
- No restore-to-production, migration, deployment or provider cutover is implemented.
- Existing local backup/restore tools remain unchanged.
- Live Drive quota, upload, download and provider permission behavior remain unverified.

## Acceptance status
- Envelope encryption and authentication: PASS_CI (test KEK fixture only).
- Manifest and payload integrity: PASS_CI.
- Project/schema/count validation: PASS_CI.
- Immutable local write/readback: PASS_CI.
- Mocked Drive quota/upload/no-overwrite/remote-readback contract: PASS_CI.
- Local staging snapshot adapter: PASS_CI (six-suite workflow evidence).
- Staging backup publication and recovery drill: IMPLEMENTED; CI_PENDING.
- Retention: plan-only; deletion not authorized.
- Restore: decrypt-and-validate preview only; production restore not authorized.
- Production readiness: NOT_CERTIFIED.


## Staging security review (2026-11-05)
- Static review recorded in `STAGING-SECURITY-REVIEW.md`.
- Five HIGH findings remain open: independently enforced authorization, signing-key custody, parent-directory TOCTOU resistance, existing backup-directory ownership/permissions, and independently governed baseline provenance.
- Real staging integration is NOT_APPROVED until remediation and adversarial offline tests are complete. Production readiness remains NOT_CERTIFIED.
- Review was read-only; no staging/production data, secrets, live providers, or deployment were accessed.
