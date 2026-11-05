# Mira HFM v0.2 — Phase 7 Emergency Backup

Status: SIGNED STAGING AUTHORIZATION, SIGN-ONLY SNAPSHOT PROVIDER, AND PINNED BACKUP PUBLICATION CONTRACTS IMPLEMENTED; COMMIT-MATCHED OFFLINE CI PASS; REAL KEY CUSTODY, DIRECTORY GOVERNANCE, SOURCE PROVENANCE AND LIVE PROVIDER VERIFICATION REMAIN OPEN.

## Implemented
- Per-backup random 256-bit data-encryption key (DEK), AES-256-GCM payload encryption, and external key-provider wrapping/unwrapping of the DEK (KEK boundary).
- Authenticated manifest includes backup format/schema versions, project scope, record count, source revision, payload digest, key reference/version, wrapped DEK, nonce, algorithm and manifest digest.
- Key material is injected through wrapDataKey/unwrapDataKey callbacks. This module does not generate, persist, rotate or escrow KEKs.
- Immutable local file creation uses a retained Linux pinned-directory descriptor, descriptor-relative exclusive temporary files, fsync, atomic hard-link publication, owner-only file permissions and no-follow byte-for-byte readback. Backup directories must be owned by the effective workload UID/GID and have exact POSIX mode `0700`; identity/mode are rechecked before create, publish and readback. Unsupported platforms fail closed.
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
- It requires explicit absolute file paths, a non-symlink staging root, `environment: staging`, an injected Ed25519 private signing key, a separately pinned authorization-issuer trust store, a signed short-lived request-bound ALLOW decision, and a mandatory one-time replay-guard interface. It has no default production path and rejects `environment: production`.
- It reads the two files through bounded regular-file descriptors, checks file identity/size/mtime across the read, parses JSON arrays, flattens records with store identifiers, and signs a request-bound attestation.
- The adapter does not call `readMemory()` or `createKnowledgeBackup()`. This is intentional: inspection found that the former may create an initialization marker, while the latter writes backup/audit state.
- The adapter does not write, migrate, restore, publish, upload, or delete anything. Its source signing provider, authorization issuer trust store, decision provider and replay guard are injected. The adapter receives only a sign operation; private-key PEM/bytes are not part of its configuration contract. Real issuer policy governance, durable distributed replay protection and source signing-key custody remain deployment responsibilities.
- Synthetic tests cover successful signed staging capture, denial, expired decisions, actor mismatch, replay rejection, production-environment rejection, path pinning, and source-file immutability. Commit-matched CI run #42039641130 passed all eight offline suites.
- This adapter is not a production integration and must not be pointed at production data.

## Staging backup and recovery drill (new)
- `services/mira-hfm-staging-backup-drill.js` composes two separately pinned staging snapshot sources, encrypted envelope creation, immutable local publication, byte-for-byte file readback, and the existing non-mutating recovery verifier.
- The baseline source is captured independently before the backup source. Source revision, record count, and canonical payload digest must match before any backup file is published; a mismatch blocks publication.
- The published encrypted file is read back from disk and recovery-verified against the independent baseline. Existing backup names are never overwritten.
- The drill requires an existing explicit non-symlink staging backup directory and a restricted filename. It does not call Drive, write canonical Memory/Knowledge, restore data, or delete files.
- Synthetic tests cover successful publication and recovery preview, unchanged source files, overwrite refusal, and mismatch blocking. Commit-matched CI run #42039641130 passed the staging backup drill suite.
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
- Staging backup publication and recovery drill: PASS_CI (commit 86bea6d; run #42039641130).
- Retention: plan-only; deletion not authorized.
- Restore: decrypt-and-validate preview only; production restore not authorized.
- Production readiness: NOT_CERTIFIED.


## Staging security review (2026-11-05)
- Static review recorded in `STAGING-SECURITY-REVIEW.md`.
- Five HIGH findings remain open: independently enforced authorization, signing-key custody, parent-directory TOCTOU resistance, existing backup-directory ownership/permissions, and independently governed baseline provenance.
- Real staging integration is NOT_APPROVED until remediation and adversarial offline tests are complete. Production readiness remains NOT_CERTIFIED.
- Review was read-only; no staging/production data, secrets, live providers, or deployment were accessed.


## Signed authorization decision update (2026-11-05)
- Added a separate authorization-decision verifier with a pinned Ed25519 issuer trust store, request-bound short-lived ALLOW decisions, key-fingerprint validation, and mandatory one-time replay-guard consumption before staging file reads.
- Snapshot attestation now includes authorization issuer, decision ID, policy version and expiry; the independent snapshot verifier rejects missing or expired authorization claims.
- Synthetic tests were expanded for denial, expiry, actor mismatch and replay. The end-to-end staging drill fixtures now use signed authorization decisions.
- This is a contract implementation, not a production policy service or durable replay store. CI verification is pending; F7-SR-01 remains partially remediated/open until provider governance and durable replay-store review.

- Authorization governance and replay-store requirements: `AUTHORIZATION-PROVIDER-GOVERNANCE.md`. Policy version is pinned to the issuer trust record; production issuer and durable replay store are not selected or approved.


## Snapshot signing-provider boundary update (2026-11-05)
- Added `services/mira-hfm-snapshot-signing-provider-contract.js` with a sign-only Ed25519 interface, explicit key ID/version, purpose, algorithm and staging-environment checks.
- `services/mira-hfm-local-staging-snapshot-source.js` no longer imports or constructs a private KeyObject from PEM. It delegates signing to the injected provider and fails closed on provider errors or malformed signatures.
- Snapshot attestation includes signing-key version; independent source trust must pin the matching key ID, key version and public-key fingerprint.
- Synthetic fixtures keep private key objects inside provider closures and pass only the signing interface to the source adapter.
- This is not proof of non-exportable keys, provider identity, KMS/HSM custody, workload identity, rotation/revocation or production approval. The HIGH finding F7-SR-02 remains partially remediated/open pending real provider integration and independent review.


## Verification checkpoint — snapshot signing provider
- The existing `tests/mira-hfm-key-provider-contract.test.js` suite now includes sign-only snapshot provider contract assertions; the local staging-source and staging-drill fixtures use private keys only inside synthetic provider closures.
- The Phase 7 workflow already runs the modified key-provider test and staging-source/drill tests on branch pushes. The new contract module is exercised through those tests and the staging source imports it.
- Latest implementation/test commit: `c0d4a4b682cf8024537b1874e6e4cbd428c12f58`. A matching completed CI run and job logs have not yet been retrieved; verification remains INCONCLUSIVE until commit-matched workflow evidence is inspected.


## Filesystem directory-handle hardening checkpoint (2026-11-05)
- Added `services/mira-hfm-pinned-directory.js`: Linux-only retained directory descriptors through `/proc/self/fd`, no-follow directory open, and inode identity comparison across open.
- Local staging source now requires Memory and Knowledge files to be direct children of the pinned root and reads them via the retained directory descriptor. Root identity is compared with the initially inspected directory identity. The source exposes `close()` to release the descriptor.
- The workflow path filters include the helper and the dedicated adversarial backup-directory test; the existing local staging source suite remains the source-read integration test path.
- Immutable backup publication now uses descriptor-relative temporary creation, fsync, hard-link publication and no-follow readback through the retained directory descriptor. The staging drill pins its backup directory before asynchronous capture and feeds the writer's verified readback bytes to the recovery preview. Adversarial rename/replacement and symlink-substitution tests passed in commit-matched CI run #42038520652. F7-SR-03 remains PARTIALLY_REMEDIATED / OPEN pending independent security review and directory ownership/permission governance. Platforms without Linux procfs/directory flags fail closed.


## Verification checkpoint — pinned backup directory (2026-11-05)
- Commit: `f4f28b7f94bdf1213bc9e79c24b0e696850f65a7`.
- GitHub Actions run #42038520652: SUCCESS; all seven offline suites completed.
- Adversarial markers: `MIRA_HFM_PINNED_BACKUP_DIRECTORY_RENAME_RACE_BLOCK_PASS` and `MIRA_HFM_PINNED_BACKUP_SYMLINK_REPLACEMENT_BLOCK_PASS`.
- Staging drill markers: publication, recovery preview, source immutability, no-overwrite and baseline-mismatch blocking all passed.
- CI confirmed `NETWORK_REQUESTS=0`, `PRODUCTION_MEMORY_TOUCHED=NO`, `LIVE_DRIVE_API_CALLS=0`, `BACKUP_DELETION=0`, and no canonical Memory/Knowledge writes.
- This does not certify production key custody, backup-directory ownership/permissions, independent source provenance, live Drive integration, staging approval or production readiness.


## Backup directory owner and permission enforcement — F7-SR-04 (2026-11-05)
- Added descriptor-based owner UID/group GID and POSIX mode enforcement to the pinned-directory helper.
- Expected identity defaults to the effective process UID/GID; the staging drill also accepts explicit expected UID/GID policy values. The generic local backup writer uses the effective process identity.
- Backup directory mode must be exactly `0700`; group/other access and missing owner read/write/execute permissions are rejected. Checks are repeated against the retained descriptor at publication boundaries.
- The code never changes ownership or permissions automatically. Existing directories with a different owner/group or mode must be provisioned by an authorized operator before use.
- This does not independently inspect Windows DACLs, non-POSIX ACL extensions, mount policy or host/container administrator trust. Production directory provisioning still requires external ACL and infrastructure review.
- Tests cover permissive mode, insufficient owner mode, expected UID/GID mismatch and fail-closed writer behavior. Commit-matched GitHub Actions run #42039641130 completed SUCCESS on commit `86bea6d16c6cd4ecaf649d08d05137620af1237e`; all eight offline suites and the owner/mode policy marker passed.
- F7-SR-04 remains PARTIALLY_REMEDIATED / OPEN pending independent security review, ACL/mount policy verification and operational directory provisioning.


## F7-SR-04 verification checkpoint — 2026-11-05
- Commit: `86bea6d16c6cd4ecaf649d08d05137620af1237e`.
- GitHub Actions run #42039641130: SUCCESS; all eight offline suites completed.
- Owner/mode marker: `MIRA_HFM_BACKUP_DIRECTORY_OWNER_MODE_POLICY_BLOCK_PASS`.
- Existing race markers: `MIRA_HFM_PINNED_BACKUP_DIRECTORY_RENAME_RACE_BLOCK_PASS`, `MIRA_HFM_PINNED_BACKUP_SYMLINK_REPLACEMENT_BLOCK_PASS`.
- Staging drill markers: path pin, backup publication, recovery preview, source immutability, no-overwrite and baseline-mismatch block all passed.
- Logs confirm `NETWORK_REQUESTS=0`, `PRODUCTION_MEMORY_TOUCHED=NO`, `LIVE_DRIVE_API_CALLS=0`, and `BACKUP_DELETION=0`.
- No production store, live Drive, deployment or canonical Memory/Knowledge writes were exercised.
- POSIX mode/UID/GID checks do not certify host-level ACLs, mount policy, container isolation or privileged administrator trust. F7-SR-04 remains PARTIALLY_REMEDIATED / OPEN.


## F7-SR-05 — Baseline source provenance independence

- The staging drill requires a versioned, pinned provenance profile for each source and rejects any shared storage system, storage instance, security principal, trust domain, source system, or snapshot-signing trust issuer.
- The provenance field `snapshotIssuerId` identifies the source-attestation signing trust issuer. It is distinct from `authorizationIssuerId`, which identifies the separately governed issuer of the signed backup:read authorization decision. These two trust purposes must not be conflated.
- The provenance contract and its negative tests are included in both push and pull-request workflow path filters.
- Synthetic tests establish only contract behavior. Real infrastructure independence, policy distribution, account ownership, workload identity, and signer/issuer governance remain REVIEW_REQUIRED; F7-SR-05 remains PARTIALLY_REMEDIATED / OPEN.


## Current consolidated verification — 2026-11-05 (supersedes earlier five-suite checkpoint)

- Latest verified engineering commit before this documentation update: `0c94bd0b4909946534760c041f966b16fddb8b1c`; push workflow run #127 (`42043450318`) completed SUCCESS. Its `phase7-offline-contract` job and retrieved logs confirm all nine isolated suites completed successfully.
- The nine suites cover pinned backup-directory race/owner/mode enforcement; encrypted backup; mocked Drive adapter; backup and snapshot-signing key-provider contracts; authoritative signed snapshot; local staging source and signed authorization; staging backup/recovery drill; source-provenance independence; and non-mutating recovery verification.
- F7-SR-05 provenance test markers all passed: fully independent synthetic profile, shared-boundary rejection, duplicate ID rejection, forged-claim rejection, unpinned-policy rejection, and contract completion.
- The provenance service and its dedicated test are included in both push and pull-request path filters.
- The backup key-provider contract now rejects `environment: production` until production custody and approval are separately established.
- Safety evidence from the run: `NETWORK_REQUESTS=0`, `PRODUCTION_MEMORY_TOUCHED=NO`, `LIVE_DRIVE_API_CALLS=0`, `BACKUP_DELETION=0`, `CANONICAL_MEMORY_WRITTEN=NO`, `CANONICAL_KNOWLEDGE_WRITTEN=NO`.
- A follow-up documentation-only ledger commit `6398ff934d0152f7d80314bb817430b9d2d86f15` was also tested by push run #128 (`42044256555`), conclusion SUCCESS; its retrieved logs repeat all nine suites and F7-SR-05 markers.
- F7-SR-01 through F7-SR-05 remain PARTIALLY_REMEDIATED / OPEN pending independent issuer/replay governance, real key custody, infrastructure provenance, host/container directory security review, and independent review as applicable. Synthetic CI does not prove production infrastructure truth.
- Real KMS/HSM, production snapshot source, live Drive quota/upload/download, real restore/migration and retention deletion remain NOT_APPROVED / NOT_RUN. Staging integration and production readiness remain NOT_CERTIFIED.
- Phase 7 disposition: OFFLINE_CONTRACT_IMPLEMENTATION_AND_CI=PASS; EXTERNAL_SECURITY_AND_LIVE_PROVIDER_GATES=REVIEW_REQUIRED / NOT_APPROVED; PRODUCTION_READINESS=NOT_CERTIFIED.


## Local fake policy-state provider conformance checkpoint — 2026-11-05

- Added `services/mira-hfm-local-fake-policy-state-provider.js` and `tests/mira-hfm-local-fake-policy-state-provider.test.js` as isolated test-only artifacts; no existing runtime path imports or wires the fake provider.
- Coverage: initial state read, stale CAS conflict, two competing writers (exactly one accepted), same-key/same-request idempotent receipt, same-key/different-request rejection, JSON snapshot export/re-instantiation restart simulation, unavailable/quorum-loss fail-closed behavior, and commit-success/response-loss reconciliation using the same idempotency key.
- The fake provider is process-local and its snapshot export is a test harness simulation. It does NOT prove real durable storage, distributed atomicity, quorum semantics, infrastructure independence, or provider-side cryptographic signing.
- First CI attempt run #170 (`42064973089`) failed because the test incorrectly expected a duplicate same-key retry to conflict; this exposed a test expectation defect, not a provider defect. The test was corrected to use a fresh idempotency key for the stale-CAS assertion.
- Corrected Phase 7 run #171 (`42065054168`) completed SUCCESS on exact commit `b2b52eacbad966798f24792882ef06c0e4ffcf0f`. Phase 10 independent cross-phase verification run #46 (`42065054145`) also completed SUCCESS on the same commit.
- Phase 7 fake-provider marker: `LOCAL_FAKE_PROVIDER_TESTS=PASS`; test case list includes all eight scenarios above.
- Safety boundary: no network request from the fake provider, no production Memory/Knowledge access, no live Drive call, no backup deletion, no staging integration, and no production runtime wiring.
- Disposition: LOCAL_FAKE_PROVIDER_CONFORMANCE=PASS_CI (synthetic test double only). F7-SR-01 through F7-SR-05 remain PARTIALLY_REMEDIATED / OPEN pending independent review and real operational evidence. Staging remains NOT_APPROVED; production readiness remains NOT_CERTIFIED.
