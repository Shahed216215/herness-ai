# MIRA HFM v0.2 — Phase 7 Staging Security Review

Review type: Static source review of the staging snapshot, backup drill, key-provider contract, and local immutable publication code.
Reviewed branch: `work/mira-hfm-v02-phase7-emergency-backup`
Reviewed baseline commit: `78de65d0afb04d893b0ab78abbb0506a34026b25`
Execution boundary: Read-only repository review. No staging/production data, credentials, KMS, Drive API, or deployment was accessed. No runtime exploit test was performed.

## Executive result

**STAGING SECURITY GATE: NOT APPROVED — REMEDIATION REQUIRED.**
**PRODUCTION READINESS: NOT_CERTIFIED.**

The seven-suite CI success demonstrates the tested synthetic contracts. It does not prove real authorization enforcement, independent source infrastructure, private-key custody, or race-free filesystem confinement.

## Findings

### F7-SR-01 — Authorization callback is an assertion boundary, not independently enforced authorization
- Severity: HIGH
- Evidence: `services/mira-hfm-local-staging-snapshot-source.js`, `createLocalStagingSnapshotSource()` and `readSnapshot()`; callback result is accepted when it is literal `true`.
- Evidence: `services/mira-hfm-authoritative-snapshot.js`; the signed attestation is verified, but returned evidence explicitly sets `authorizationIndependentlyEnforced: false`.
- Impact: A caller can supply an always-allow callback or a misconfigured policy adapter. A valid signature proves which configured key signed the claim; it does not prove the actor was authorized by an independently trusted policy authority.
- Remediation progress (2026-11-05): Added `services/mira-hfm-authorization-decision.js`. The staging source now requires a signed, short-lived Ed25519 ALLOW decision from a separate pinned issuer, bound to project/actor/scope/request ID/nonce, plus a one-time replay-guard interface before file reads. Offline tests cover denial, expiry, actor mismatch and replay. This authenticates the decision claim; it does NOT prove the issuer's policy is correctly governed, and the production replay guard must be durable/atomic across instances. Finding remains PARTIALLY_REMEDIATED / OPEN pending provider governance, policy tests, outage tests and durable replay-store review.
- Gate: BLOCKS REAL STAGING INTEGRATION.

### F7-SR-02 — Snapshot signing private-key custody is caller-managed and unverified
- Severity: HIGH
- Evidence at original review: `services/mira-hfm-local-staging-snapshot-source.js` accepted `privateKeyPem` and converted it to a Node private KeyObject in-process.
- Impact: The adapter does not establish where the private key originated, whether it is exportable, how it is protected at rest/in memory, which workload may use it, how it is rotated/revoked, or how compromise is audited. The synthetic tests generate ephemeral keys and do not test custody.
- Remediation progress (2026-11-05): Added `services/mira-hfm-snapshot-signing-provider-contract.js`. The staging adapter now accepts a sign-only provider interface, never a PEM/private-key value; the provider descriptor pins key ID/version, purpose, algorithm and staging environment. The signed attestation carries the key version, and the independent snapshot trust record must pin the same key version and public-key fingerprint. Synthetic tests exercise the contract shape and adapter-side signing boundary. This is interface separation only: a caller-supplied provider can still be a software key wrapper, and no real KMS/HSM, workload identity, non-exportability, rotation/revocation, or provider audit has been verified. Finding remains PARTIALLY_REMEDIATED / OPEN.
- Gate: BLOCKS REAL STAGING INTEGRATION AND PRODUCTION.

### F7-SR-03 — Filesystem path checks do not fully close parent-directory TOCTOU races
- Severity: HIGH
- Evidence: `services/mira-hfm-local-staging-snapshot-source.js`; root and file paths are resolved/checked at construction, while later reads reopen the absolute file path. `O_NOFOLLOW` protects the final path component where supported, but does not pin every parent directory component against replacement.
- Evidence: `services/mira-hfm-emergency-backup.js`; `writeBackupAtomic()` checks the directory and later performs path-based temporary-file creation, link, unlink and readback.
- Impact: In a hostile or concurrently mutable filesystem, a checked parent directory can potentially be replaced between validation and later path operations. Current tests cover static symlink/path escapes, not adversarial directory replacement races.
- Remediation progress (2026-11-05): Added `services/mira-hfm-pinned-directory.js`. The local staging source now opens and retains a no-follow Linux directory descriptor, restricts source files to direct children, and opens/reads them through `/proc/self/fd/<dirfd>/...`; it fails closed when Linux procfs and required directory flags are unavailable. The descriptor identity is checked across open. This protects source reads against replacement of the configured root pathname after descriptor acquisition. Remediation update (2026-11-05): immutable backup publication now uses a retained pinned directory descriptor, descriptor-relative temporary creation/hard-link/unlink, descriptor fsync, and no-follow descriptor-based readback. The staging drill pins its destination directory before asynchronous snapshot capture and consumes the writer's descriptor-based byte-for-byte readback for recovery preview. A dedicated adversarial test covers rename/replacement and symlink substitution of the original directory pathname. Commit-matched GitHub Actions run #42038520652 completed SUCCESS on 2026-11-05 (commit `f4f28b7f94bdf1213bc9e79c24b0e696850f65a7`); both adversarial race markers and all seven Phase 7 offline contract suites passed. This is CI evidence only, not production filesystem approval. Finding remains PARTIALLY_REMEDIATED / OPEN.
- Gate: BLOCKS REAL STAGING BACKUP DIRECTORY USE UNTIL REVIEWED.

### F7-SR-04 — Existing backup directory permissions and ownership are not enforced
- Severity: HIGH
- Remediation status: PARTIALLY_REMEDIATED / OPEN pending commit-matched CI, independent review and platform ACL verification.
- Implementation (2026-11-05): `services/mira-hfm-pinned-directory.js` now validates the retained directory descriptor's owner UID and group GID against the effective workload UID/GID (or explicit expected values), and requires exact POSIX mode `0700`. It rechecks the pinned descriptor before temporary creation, before immutable link publication, and before readback. Both the staging drill and the generic local backup writer use this fail-closed policy. No automatic chmod/chown is performed.
- Tests added: permissive `0750`, owner access-deficient `0600`, expected UID mismatch, expected GID mismatch, and enforcement by the writer itself. Existing directory replacement race tests remain.
- Commit-matched CI: run #42039641130 SUCCESS on commit `86bea6d16c6cd4ecaf649d08d05137620af1237e`; owner/mode policy marker and both pinned-directory race markers passed, together with all eight Phase 7 offline suites. This is CI evidence, not independent security certification.
- Platform boundary: this is POSIX mode/UID/GID enforcement on the Linux procfs-backed path. It does not independently enumerate or certify every platform-specific ACL mechanism (including Windows DACLs and non-POSIX ACL extensions). Production provisioning must verify ACLs and mount/storage policy separately. The application cannot establish that the host administrator or container runtime is trustworthy.
- Gate: BLOCKS REAL STAGING BACKUP DIRECTORY USE until CI and independent security review pass; ACL/host governance remains an operational requirement.

### F7-SR-05 — Baseline provenance claims do not independently certify infrastructure

- Severity: HIGH
- Evidence: `services/mira-hfm-source-provenance-contract.js`, `services/mira-hfm-authoritative-snapshot.js`, and `services/mira-hfm-staging-backup-drill.js`.
- Impact: Distinct source IDs, signing keys, and caller-supplied provenance labels can still describe the same storage account, workload principal, administrative plane, or trust domain. A signature authenticates the claim, not the truth of the infrastructure inventory.
- Remediation progress (2026-11-05): Added a versioned, pinned two-source provenance policy. The contract requires six distinct dimensions: storage system, storage instance, security principal, trust domain, source system, and snapshot-signing trust issuer. Signed claims are compared with each source's pinned trust record; shared dimensions, duplicate IDs, missing profiles, and pin mismatches fail closed before publication. The authorization-decision issuer is a separate trust purpose and must not be conflated with the snapshot-signing issuer. Synthetic negative tests cover every shared dimension and malformed/unpinned policy cases.
- Additional correction: the dedicated test now uses the contract's exact `snapshotIssuerId` field, and the Phase 7 workflow pull-request path filters include both the provenance service and its test. Production infrastructure inventory, independently governed policy distribution, storage/account separation, workload identity, and signer/issuer governance remain unverified. The production key-provider contract also now rejects `environment: production` until a separate approval design is implemented.
- Gate: BLOCKS REAL STAGING INTEGRATION AND PRODUCTION. F7-SR-05 remains PARTIALLY_REMEDIATED / OPEN; CI for the latest changes is INCONCLUSIVE until commit-matched logs are inspected.

## Positive controls observed

- Production environment is explicitly rejected by the local staging source adapter.
- Source files are bounded, opened read-only, checked as regular files, and compared for identity/size/time/link-count changes during reads.
- Snapshot signatures are checked against a separately supplied Ed25519 trust store with a pinned public-key fingerprint.
- Request/project/actor/scope/nonce/request ID and attestation freshness are checked.
- Backup envelope uses AES-256-GCM with authenticated manifest data and a per-backup DEK; external provider contract is shape-validated.
- Immutable backup publication refuses an existing destination, uses exclusive temporary creation and hard-link publication, and applies owner-only file permissions.
- Recovery verification is preview-only; canonical Memory/Knowledge writes and restore are not part of the drill.
- These controls are useful foundations, not substitutes for the remediation above.

## Required next implementation order

1. Define trusted authorization-decision provider and threat model.
2. Define signing-key provider/custody and lifecycle.
3. Complete directory-handle-relative backup publication/readback and adversarial directory replacement tests.
4. Enforce backup directory owner/mode and platform ACL policy.
5. Add source-provenance independence contract.
6. Add adversarial offline tests for all controls.
7. Run isolated CI and inspect actual logs; only then reassess staging approval.

## Final disposition

- Static review: COMPLETE.
- Findings: 5 HIGH, all open.
- Runtime adversarial testing: NOT_RUN.
- Real staging integration: NOT_APPROVED.
- Production integration/deployment: NOT_APPROVED.
- No code behavior was changed by this review.


---

## Remediation addendum — 2026-11-05 (latest offline implementation)

This addendum supplements, and does not erase, the original static-review findings above.

### F7-SR-01 — authorization decision and replay protection
- The verifier now snapshots the signed decision, exact request, and pinned issuer trust before awaiting replay protection; it also captures the replay-guard method reference.
- A local fake replay guard now tests a concurrent single-winner claim across 32 simultaneous attempts, duplicate rejection, expiry handling, and restart simulation from digest-only state.
- The fake is process-local and explicitly NOT_DURABLE. Real atomicity across processes/replicas, restart/failover behavior, independent policy governance, and durable retention remain unverified. F7-SR-01 remains PARTIALLY_REMEDIATED / OPEN.

### F7-SR-02 — signing and wrapping-key interface boundary
- Backup key-provider and snapshot-signing provider contracts now reject raw private/master keys, KEKs, encryption-key bytes, generic key material, credentials, access/refresh tokens, and client secrets on provider objects and descriptors.
- Backup wrap/unwrap provider errors are normalized so provider-specific messages/codes are not exposed; copied DEK buffers are zeroed on wrap success/failure paths.
- No non-exportable KMS/HSM, workload identity, IAM separation, rotation/revocation, escrow/recovery, or provider audit evidence exists. F7-SR-02 remains PARTIALLY_REMEDIATED / OPEN.

### F7-SR-03 — pinned filesystem inventory
- Backup inventory now reads through a retained no-follow directory descriptor and non-blocking no-follow child opens. Symlink, hard-link, non-regular, oversized, and changing files are rejected as REVIEW_REQUIRED.
- This is offline Linux/procfs-backed code and synthetic coverage; no independent host/filesystem security review or production runtime evidence has been supplied. F7-SR-03 remains PARTIALLY_REMEDIATED / OPEN.

### F7-SR-04 — owner/mode and host ACL boundary
- Existing implementation still enforces pinned-directory UID/GID and POSIX 0700 policy at descriptor-relative publication/readback boundaries, without automatic chmod/chown.
- The new changes do not establish host/container administrator trust, mount options, platform-specific ACLs, Windows DACLs, or non-POSIX ACL extensions. Independent host ACL/mount review remains outstanding. F7-SR-04 remains PARTIALLY_REMEDIATED / OPEN.

### F7-SR-05 — provenance semantics and role independence
- Signed evidence records now bind exact source ID, dimension, policy-declared observed value, environment, and project. Exactly two source profiles and six required evidence dimensions are enforced.
- Reviewer roles are pinned to trust records and must be distinct. Policy signer, state authority, reviewer, and evidence issuer key fingerprints must be disjoint; evidence reviewer identities cannot overlap policy/operational roles.
- Policy, trust maps, evidence references, source descriptors, key-provider descriptor/method references, requests, and schema allowlists are snapshotted before asynchronous callbacks. The staging drill rejects policy source/profile mismatches before policy-state read/CAS or source reads.
- These are synthetic software controls only. Real source control-plane evidence, storage/account/security-principal/trust-domain independence, independent evidence collection, durable atomic policy state/receipt store, and real provider operation remain unverified. F7-SR-05 remains PARTIALLY_REMEDIATED / OPEN.

### CI and gate disposition
- The Phase 7 workflow path filters now include the latest changed services/tests, including the local fake authorization replay guard and its concurrency test.
- The available GitHub connector currently returns no combined status checks or PR-triggered workflow runs for the latest branch commit. Latest new-test disposition is INCONCLUSIVE; do not treat historical commit-matched CI passes as proof for these new changes.
- Staging remains NOT_APPROVED. Production readiness remains NOT_CERTIFIED. No live Drive, KMS/HSM, staging/production deployment, real credential use, production Memory/Knowledge write, backup deletion, or restore occurred.
