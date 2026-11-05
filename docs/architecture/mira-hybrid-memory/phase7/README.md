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


## Fake provider fault-injection extension — 2026-11-05

- Extended the isolated local fake provider with a deterministic request-loss-before-commit fault. The injected failure leaves state and idempotency records unchanged; retrying the same request/key then commits once.
- Added tests for pre-commit request loss/retry and defensive-copy isolation of state/snapshot exports. The fake provider's returned read-state object is frozen; exported snapshots are detached copies.
- Corrected the Phase 7 pull-request workflow path filters so changes to both fake-provider service and test trigger the offline contract workflow on pull requests as well as pushes.
- An intermediate CI attempt (#177, ID `42066854634`) failed because the new test attempted to mutate a frozen read-state object in strict mode. The assertion was corrected to explicitly expect `TypeError`; this was a test assertion issue. An intermediate workflow-only run (#178, ID `42066861818`) also failed because it included the same test before the correction.
- Final Phase 7 run #179 (ID `42066941166`) completed SUCCESS on exact commit `9bc3c549342a25273471112eed4e74e52b4a44df`; job `phase7-offline-contract` SUCCESS and marker `LOCAL_FAKE_PROVIDER_TESTS=PASS` confirmed.
- Phase 10 independent verification run #53 (ID `42066940999`) completed SUCCESS on the same exact commit.
- Retrieved logs confirm `NETWORK_REQUESTS=0`, `PRODUCTION_MEMORY_TOUCHED=NO`, `LIVE_DRIVE_API_CALLS=0`, and `BACKUP_DELETION=0`.
- Expanded synthetic cases now include: read state, stale CAS, concurrent writers, idempotent retry, idempotency-key reuse rejection, snapshot restart simulation, outage fail-closed, request loss before commit, response loss after commit with reconciliation, and defensive-copy isolation.
- Disposition remains LOCAL_FAKE_PROVIDER_CONFORMANCE=PASS_CI (test double only). F7-SR-01 through F7-SR-05 remain PARTIALLY_REMEDIATED / OPEN pending independent review and real operational evidence; staging remains NOT_APPROVED; production readiness remains NOT_CERTIFIED.


## Authorization decision verifier negative-case hardening — 2026-11-05

- Added isolated `tests/mira-hfm-authorization-decision.test.js` with synthetic Ed25519 fixtures. It exercises valid authentication, signature tampering, project/actor/scope/request/nonce binding, trust-anchor fingerprint mismatch, key-ID mismatch, DENY, expiry, excessive validity, future dating, replay duplicate, replay-store outage, and non-Ed25519 trust anchors.
- The new test exposed a real fail-closed gap: `verifyAuthorizationDecision()` allowed a replay-guard exception to escape as an arbitrary error rather than returning the stable authorization rejection code. Updated `services/mira-hfm-authorization-decision.js` to catch replay-guard failures and reject with `HFM_AUTHZ_REPLAY_REJECTED`.
- An earlier test attempt failed because the signature-tamper fixture re-signed the modified signature field, making the test data valid. The fixture was corrected to sign first and then tamper with the signature bytes. The next run exposed the replay-guard error-normalization gap; the service was fixed and the same negative test then passed.
- Phase 7 run #185 (ID `42067455795`) completed SUCCESS on exact commit `b5dc8eb5b16cc1c85c4e0d1435b6ced459523a1c`; job `phase7-offline-contract` SUCCESS. Marker: `MIRA_HFM_AUTHORIZATION_DECISION_NEGATIVE_TESTS=PASS`.
- Phase 10 independent verification run #59 (ID `42067455619`) completed SUCCESS on the same exact commit.
- Retrieved logs confirm `NETWORK_REQUESTS=0`, `PRODUCTION_MEMORY_TOUCHED=NO`, `LIVE_DRIVE_API_CALLS=0`, and `BACKUP_DELETION=0`.
- This improves error handling and negative-case coverage only. It does not prove the authorization issuer's policy correctness or a durable/atomic replay guard. F7-SR-01 remains PARTIALLY_REMEDIATED / OPEN pending independent policy governance and real replay-store evidence; staging remains NOT_APPROVED; production readiness remains NOT_CERTIFIED.


## Authorization and signing-provider negative-test expansion — 2026-11-05

- Added dedicated authorization decision negative tests for Ed25519 signature tampering, exact project/actor/scope/request/nonce binding, trust-anchor fingerprint and key-ID mismatch, DENY, expiry, maximum validity, future dating, duplicate replay, replay-store outage, and non-Ed25519 trust anchors.
- The negative tests exposed and drove remediation of a real F7-SR-01 fail-closed gap: replay-guard exceptions previously escaped as arbitrary errors. The verifier now normalizes replay-guard outages to `HFM_AUTHZ_REPLAY_REJECTED`. The verifier still does not certify policy correctness or real replay-store durability/atomicity.
- Expanded F7-SR-02 signing-provider tests to reject production environment, wrong algorithm, wrong key purpose, mismatched expected key ID, and private-key bytes in the sign-only provider interface.
- Phase 7 run #188 (ID `42067671922`) completed SUCCESS on exact commit `bb47439cb5e590e13c0dddeb29cb58bf800fa2c6`; job `phase7-offline-contract` SUCCESS.
- Phase 10 independent verification run #62 (ID `42067672031`) completed SUCCESS on the same exact commit.
- The preceding authorization verifier patch was independently verified by Phase 7 run #185 / Phase 10 run #59 on commit `b5dc8eb5b16cc1c85c4e0d1435b6ced459523a1c`; the dedicated marker `MIRA_HFM_AUTHORIZATION_DECISION_NEGATIVE_TESTS=PASS` was present in retrieved logs.
- All tests use synthetic keys and fixtures. No live key custody, KMS/HSM, independent policy authority, or durable replay-store behavior is certified. F7-SR-01 and F7-SR-02 remain PARTIALLY_REMEDIATED / OPEN pending independent governance and real provider evidence; staging remains NOT_APPROVED; production readiness remains NOT_CERTIFIED.


## Independent provenance evidence verifier failure-path expansion — 2026-11-05

- Expanded `tests/mira-hfm-provenance-evidence-verifier.test.js` with malformed base64 signature rejection, pinned evidence-key fingerprint mismatch rejection, and evidence-resolver outage fail-closed behavior.
- Phase 7 run #192 (ID `42067928386`) completed SUCCESS on exact commit `685ef65c1ed3279ff5a80a169078b1207d98fab2`; job `phase7-offline-contract` SUCCESS. Retrieved logs include `MIRA_HFM_PROVENANCE_EVIDENCE_FAIL_CLOSED_PASS` and `MIRA_HFM_PROVENANCE_EVIDENCE_CONTRACT_COMPLETE`.
- Phase 10 independent verification run #65 (ID `42067928501`) completed SUCCESS on the same exact commit.
- The same run confirms authorization decision negative tests and local fake provider tests passed. Safety markers confirm `NETWORK_REQUESTS=0`, `PRODUCTION_MEMORY_TOUCHED=NO`, `LIVE_DRIVE_API_CALLS=0`, and `BACKUP_DELETION=0`.
- These tests verify synthetic signature, digest, scope, issuer, freshness and resolver-failure handling only. They do not establish that evidence records originate from truthful provider control planes or that trust roles are independent in real infrastructure. F7-SR-05 remains PARTIALLY_REMEDIATED / OPEN; staging remains NOT_APPROVED; production readiness remains NOT_CERTIFIED.


## Snapshot signing provider secret-boundary hardening — 2026-11-05

- Hardened `validateSnapshotSigningProvider()` so `privateKeyPem`, `privateKey`, and `privateKeyBytes` are rejected both on the provider object and inside its descriptor. This prevents the metadata descriptor from becoming an accidental private-key transport channel.
- Expanded negative tests for production environment, wrong algorithm, wrong key purpose, expected key-ID mismatch, and private-key material on both provider and descriptor surfaces.
- Phase 7 run #196 (ID `42068235723`) completed SUCCESS on exact commit `d9205897148f954aff6dffac0dbc91fbe60e676e`; Phase 10 independent verification run #70 (ID `42068229797`) also completed SUCCESS on the same commit.
- Added the snapshot signing provider service to both Phase 7 push and pull-request path filters so future edits to the contract itself trigger the dedicated Phase 7 workflow.
- These checks validate the adapter's declared interface only. They do not prove provider identity, non-exportable custody, KMS/HSM controls, key rotation/revocation, workload identity, or provider audit evidence. F7-SR-02 remains PARTIALLY_REMEDIATED / OPEN; staging remains NOT_APPROVED; production readiness remains NOT_CERTIFIED.


## Additional offline hardening checkpoint — 2026-11-05

- Latest code/test commit at this checkpoint: `ec92874181b7e36c831a5dff32dfe8536bf3364c`.
- F7-SR-01: authorization verifier now rejects non-safe-integer, non-positive, non-finite, or over-limit validity/skew/clock configuration; malformed Ed25519 trust-anchor parsing is normalized to a stable fail-closed error; signatures must use canonical base64 encoding. Dedicated negative tests cover these inputs.
- F7-SR-05: staging source provenance is cloned from canonical JSON and recursively frozen before being exposed or signed. Non-object/non-canonical provenance is rejected. Same-file Memory/Knowledge source collisions close the pinned directory descriptor before rejection. Tests cover nested mutation, invalid provenance shape, and same-file rejection.
- F7-SR-03: pinned child reads now use a no-follow file descriptor and reject non-regular files, hard links, oversized files, and inode/size/timestamp/link-count changes during read. Tests cover a valid single-link file, hard-link rejection, and symlink rejection.
- The changed services and tests are already covered by the Phase 7 workflow path filters.
- Verification disposition for this checkpoint: `CI_STATUS=INCONCLUSIVE_PENDING_PUSH_RUN_RETRIEVAL`. The available linked GitHub workflow-run lookup returns pull-request-triggered runs only and returned no PR runs for this branch commit. No local execution evidence is claimed; do not mark these new tests PASS until the matching push workflow logs are inspected.
- These changes are offline contract hardening only. No live KMS/HSM, live Drive, staging deployment, production Memory/Knowledge, or production infrastructure was accessed.


## Signed provenance policy integration hardening — 2026-11-05

- Latest implementation/test commit before this documentation checkpoint: `967f21bae97ced892a1f7dad33c805982a953eed`.
- Closed an offline end-to-end integration gap in F7-SR-05: the staging backup drill no longer accepts a caller-supplied unsigned `provenancePolicy` object as its authority. It now requires a signed policy envelope, separately pinned policy issuer/reviewer/state-authority trust, an evidence resolver and trusted evidence issuers.
- Before either baseline or backup source is read, the drill now verifies the signed policy, verifies the accepted signed policy-state envelope, validates all evidence references/signatures/digests, and verifies the signed compare-and-swap commit receipt. The drill then uses only the provenance profiles returned by that verified policy.
- Operational issuer exclusions now include source IDs, snapshot issuer IDs, authorization issuer IDs, snapshot signing-provider IDs and backup key-provider identity. The signed policy verifier returns the verified provenance profiles as immutable source objects.
- Added synthetic end-to-end tests for unsigned-policy rejection before source reads, 12 evidence records, signed policy-state commit receipt, correct verification-before-source-read ordering, and policy-state read outage blocking all source reads.
- Hardened policy-state provider read failure handling: unexpected read outages now fail closed with `HFM_POLICY_STATE_UNAVAILABLE`; a regression test verifies no compare-and-swap occurs after a failed read.
- These changes use synthetic Ed25519 keys and an in-memory fake policy-state provider only. The provider's `durable`/`atomic` claims are not proof of real durability or atomicity; real policy governance, out-of-band trust provisioning, evidence collection, and infrastructure independence remain unverified.
- Verification disposition: `CI_STATUS=INCONCLUSIVE_PENDING_PUSH_RUN_RETRIEVAL`. No new CI PASS is claimed until the exact push workflow logs for the implementation commit are inspected.
- Staging remains NOT_APPROVED; production readiness remains NOT_CERTIFIED; all work remains within v0.2.


## Time-configuration and key-provider failure hardening — 2026-11-05

- Latest code/test commit before this documentation checkpoint: `2a1872ab2b5ba30832c6649952caca5cd6221a27`.
- Bounded time configuration across signed provenance policy, policy-state records/acceptance, provenance evidence verification, and authoritative snapshot capture. Non-safe-integer clocks, invalid skew values, and excessive snapshot freshness windows now fail closed before provider/resolver/source access.
- Added regression tests for NaN/infinite/over-limit time configuration and for rejecting invalid clocks before policy-state reads and evidence resolver calls.
- Hardened backup key wrapping: unexpected external key-provider errors are normalized to `BACKUP_KEY_WRAP_FAILED` without propagating provider error text. The temporary DEK copy passed to the provider is zeroed even when wrapping throws; a regression test verifies both properties.
- The Phase 7 workflow already includes the modified service/test paths. Matching push-run logs have not yet been retrievable through the currently available workflow-run lookup, which only returns pull-request-triggered runs. `CI_STATUS=INCONCLUSIVE_PENDING_PUSH_RUN_RETRIEVAL`; no PASS claim is made for these new tests.
- All changes remain synthetic/offline contract work. Real provider custody, durable/atomic replay and policy state, host ACL/mount review, six-dimension infrastructure evidence, staging approval, and production certification remain outstanding.


## Policy-state idempotency and ambiguous-commit reconciliation — 2026-11-05

- Latest implementation/test commit for this checkpoint: `5ae3ba796a87ed935853288caf9780c1105b2f41`.
- The signed policy-state provider contract now requires `readState`, `compareAndSwap`, and authoritative `getCommitReceipt`.
- The orchestrator derives a deterministic policy/digest idempotency key and a SHA-256 digest over canonical JSON `{authorityId, expectedSequence, expectedDigest, nextState}`. The signed commit receipt must bind both values.
- A provider-confirmed pre-commit request loss is retried once with the exact same idempotency key and request. A post-commit response-loss signal triggers exact receipt lookup and signature/binding verification. Missing or unavailable receipt lookup fails closed as `HFM_POLICY_STATE_COMMIT_UNRESOLVED`; the orchestrator does not invent a new key or sequence.
- The local fake provider now exposes exact receipt lookup and rejects digest mismatch. Synthetic tests cover receipt lookup, wrong digest, pre-commit retry, post-commit response-loss reconciliation, and unresolved ambiguous outcomes. The staging drill fixture also exercises the signed receipt fields.
- The provider adapter specification and F7-SR-05 acceptance specification now describe this contract. Real provider atomicity/durability across state and receipt persistence, restart-safe receipt lookup, and independent operational evidence remain unverified.
- Verification disposition: `CI_STATUS=INCONCLUSIVE_PENDING_PUSH_RUN_RETRIEVAL`. No PASS claim is made until matching Phase 7 push workflow logs are inspected.
- F7-SR-01 through F7-SR-05 remain partially remediated/open where real governance, provider custody, host controls, or independent infrastructure evidence is required. Staging remains NOT_APPROVED; production readiness remains NOT_CERTIFIED; version remains v0.2.


## Authoritative policy-state receipt reconciliation — 2026-11-05

- Latest implementation/test commit before this documentation checkpoint: `df1cff5db174600178f3916361cee546ef90c2a0`.
- Extended the policy-state adapter contract to require `getCommitReceipt({authorityId, idempotencyKey, requestDigest})` in addition to `readState` and `compareAndSwap`.
- CAS idempotency keys are deterministic from policy ID and verified policy digest. The request digest uses SHA-256 over the shared canonical-JSON representation of `{authorityId, expectedSequence, expectedDigest, nextState}`. The signed receipt must bind both values.
- A confirmed pre-commit request-loss error is retried once with the identical request/key. An ambiguous post-commit response is reconciled through authoritative receipt lookup; receipt absence, lookup failure, or digest mismatch fails closed. No new policy sequence/key is invented during reconciliation.
- The local fake provider and its tests now support exact receipt lookup and digest binding. The policy-state contract tests cover successful ambiguous-response reconciliation, safe pre-commit retry, wrong receipt digest, and unresolved ambiguous commit. The staging drill fixture also implements the signed receipt lookup contract.
- Provider-adapter and acceptance specifications now describe the exact interface and evidence required. Synthetic tests still do not prove real provider atomicity/durability, receipt retention, restart behavior, or cross-replica consistency.
- Verification disposition: `CI_STATUS=INCONCLUSIVE_PENDING_PUSH_RUN_RETRIEVAL`. No PASS claim is made until matching Phase 7 push workflow logs are inspected.
- Staging remains NOT_APPROVED; production readiness remains NOT_CERTIFIED; work remains within v0.2.


## Pinned backup inventory, provider failure boundaries, and Drive reconciliation — 2026-11-05

- Latest implementation/test commit covered by this checkpoint: `361a2c94c8e70a65a985862a946c868c13706fe4`.
- Policy-state provider read/CAS failures are normalized to generic fail-closed errors so upstream provider exception text is not returned to callers. Regression tests cover read and CAS error-detail suppression; receipt-store lookup outage after an ambiguous commit remains `HFM_POLICY_STATE_COMMIT_UNRESOLVED`.
- Pinned backup inventory now reads through an opened directory descriptor and the no-follow pinned-child reader. Symlinks, hard links, non-regular files/directories, over-limit files, and file mutation during read are rejected as `REVIEW_REQUIRED`; pinned child reads require non-blocking open support and a bounded read limit.
- Google Drive adapter now fails closed when duplicate-check results are missing or malformed. It binds a deterministic `miraHfmUploadKey` to folder/name/project/ciphertext digest, recognizes an exact pre-existing object only after metadata and byte-for-byte readback verification, and performs one exact metadata reconciliation after an ambiguous create response. It never issues a blind second create. Unresolved or conflicting remote outcomes remain `REVIEW_REQUIRED`.
- Direct Buffer, Uint8Array, ArrayBuffer, and streamed Drive response bodies are bounded by `MAX_BACKUP_BYTES`. Download remains `DOWNLOADED_UNVERIFIED` until authenticated decryption and independent-baseline recovery verification.
- Added regression coverage for provider error-detail suppression, receipt lookup outage, pinned inventory symlink/hard-link/directory rejection, bounded pinned-read configuration, incomplete Drive duplicate checks, idempotent existing-object reuse, ambiguous-create reconciliation, and unresolved remote create outcomes.
- Added `DRIVE-BACKUP-ADAPTER-FAILURE-AND-RECONCILIATION-ADDENDUM.md`. It explicitly records that list-before-create is not an atomic uniqueness guarantee and that concurrent real Drive writers, live identity/ACL, provider consistency, and operational recovery remain unverified.
- F7-SR-05 acceptance specification corrected: signed policy/state/evidence orchestration is now wired into the staging drill offline; real provider certification and current CI verification remain open.
- CI disposition: `CI_STATUS=INCONCLUSIVE`. The Phase 7 workflow path filters include all changed services/tests, but the available GitHub connector returned no combined status checks or PR-triggered workflow runs for the latest commit. No test PASS is claimed for this checkpoint.
- No live Drive API, upload, delete, restore, deployment, production Memory/Knowledge write, or real credential use occurred.
- F7-SR-01 through F7-SR-05 remain PARTIALLY_REMEDIATED / OPEN pending their independent governance, KMS/HSM, host ACL/mount, real provider, and provenance evidence. Staging remains NOT_APPROVED; production readiness remains NOT_CERTIFIED; work remains in v0.2.


## Semantic provenance evidence, trust-role separation, and staging TOCTOU hardening — 2026-11-05

- Latest implementation/test commit covered by this checkpoint: `1534fb80dfffee7ac9c40fc1d46a81ef41fa397f`.
- Provenance evidence records must now bind the exact `sourceId`, `dimension`, policy-declared `observedValue`, `environment`, and `projectId`. Evidence digest/signature validity without this semantic binding is rejected.
- Signed policies must contain exactly two source profiles and an exact six-dimension evidence register for each source. Extra source registers or unknown provenance dimensions are rejected by both the policy verifier and standalone evidence verifier.
- Reviewer roles are independently pinned in reviewer trust records; approval roles must match those records and be distinct. Reviewer key fingerprints cannot alias policy signer, policy-state authority, or another reviewer.
- Evidence reviewer identities are disjoint from policy reviewers and operational issuers. Evidence issuer keys must be cryptographically distinct from policy/state/reviewer keys; different evidence issuer IDs cannot alias one signing key.
- The policy-state orchestrator snapshots the signed envelope and state/policy/reviewer/evidence trust maps before awaiting any provider. The evidence verifier snapshots policy source profiles, evidence references, and evidence trust before awaiting the resolver. Regression tests mutate caller-owned envelopes/trust maps from provider callbacks and verify that the authenticated snapshot remains stable.
- Before policy-state CAS, the staging drill now requires exact backup/baseline source IDs and exact match between each policy provenance profile and the independently pinned source trust profile. Mismatch fails before state-provider read and before source reads.
- The staging drill snapshots source descriptors, source trust, request objects, key-provider descriptor and method references, and schema allowlists before asynchronous provider calls. A regression test mutates the original source trust and key-provider object from the policy-state callback; the stable snapshot must still complete the synthetic drill.
- Google Drive exact idempotent reuse now remains available when current quota is exhausted because it creates no new object. Quota verification remains mandatory before a new upload. Regression coverage includes this retry case.
- Updated F7-SR-05 acceptance and provider-adapter specifications and the Drive adapter addendum with these exact requirements and limitations.
- CI disposition: `CI_STATUS=INCONCLUSIVE`. The Phase 7 workflow path filters include the changed services/tests, but the available GitHub connector reports no combined status checks or PR-triggered workflow runs for the latest branch commit. No PASS claim is made for this checkpoint.
- No live Drive API, KMS/HSM, staging/production integration, upload, deletion, restore, deployment, production Memory/Knowledge write, or real credential use occurred.
- F7-SR-01 through F7-SR-05 remain PARTIALLY_REMEDIATED / OPEN pending independent governance, real key custody, host ACL/mount review, durable provider behavior, and independently sourced infrastructure provenance. Staging remains NOT_APPROVED; production readiness remains NOT_CERTIFIED; work remains within v0.2.


## Backup key-provider secret boundary and unwrap failure handling — 2026-11-05

- Latest implementation/test commit covered by this checkpoint: `2478f86d3214828b5bdd64bef301d9796654feb6`.
- Backup key-provider contract rejects raw private/master keys, KEKs, encryption-key bytes, generic key material, credential objects, access/refresh tokens, and client secrets on both the provider object and descriptor.
- Snapshot signing provider applies a corresponding sign-only secret/credential boundary.
- External backup `wrapDataKey` and `unwrapDataKey` exceptions are normalized to generic `BACKUP_KEY_WRAP_FAILED` / `BACKUP_KEY_UNWRAP_FAILED` errors; provider-specific exception text and codes are not returned to callers. Existing DEK-copy zeroization on wrap failure remains covered.
- Added negative tests for all listed secret/credential fields on provider and descriptor, plus unwrap-provider exception-detail suppression.
- Updated the provider adapter specification with the exact boundary and explicit limitation: this does not prove non-exportable KMS/HSM custody, workload identity, IAM separation, rotation/revocation, or provider auditability.
- CI remains `INCONCLUSIVE`: matching Phase 7 workflow check/run logs are not exposed by the available GitHub connector for the current branch commits. No PASS claim is made for newly added tests.
- No live key service, real credential, KMS/HSM, Drive API, staging, or production operation was used. F7-SR-02 remains PARTIALLY_REMEDIATED / OPEN pending independent custody evidence; staging remains NOT_APPROVED; production readiness remains NOT_CERTIFIED; work remains v0.2.
