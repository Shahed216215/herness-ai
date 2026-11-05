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
- Required remediation: Use directory-handle-relative operations where supported (open and retain a trusted directory descriptor; operate via `openat`-style APIs or a native helper with no-follow semantics), verify directory identity immediately before and after operations, and fail closed where the platform cannot provide the required guarantees. Add race-oriented tests in an isolated temporary filesystem. Do not claim race-free confinement from the current checks.
- Gate: BLOCKS REAL STAGING BACKUP DIRECTORY USE UNTIL REVIEWED.

### F7-SR-04 — Existing backup directory permissions and ownership are not enforced
- Severity: HIGH
- Evidence: `services/mira-hfm-staging-backup-drill.js`, `validateStagingDirectory()` checks absolute path, directory type and symlink status but not owner, group, or mode. `writeBackupAtomic()` creates a missing directory with mode 0700, but the staging drill requires an existing directory and does not validate its effective permissions.
- Impact: A pre-existing directory may be readable, writable or traversable by unintended local principals. File mode 0600 does not protect filenames, deletion/replacement attempts, or directory metadata.
- Required remediation: Require an explicitly provisioned directory with expected owner/workload identity and restrictive mode (normally 0700 on POSIX), reject group/other access and unexpected ownership, and document platform-specific ACL handling. Verify the directory identity/mode at use time. Add tests for permissive mode, wrong owner where testable, symlink, and directory replacement.
- Gate: BLOCKS REAL STAGING BACKUP DIRECTORY USE.

### F7-SR-05 — Distinct source IDs do not establish independent baseline authority
- Severity: HIGH
- Evidence: `services/mira-hfm-staging-backup-drill.js`; independence currently means the two descriptor `sourceId` strings differ. The orchestrator does not verify distinct storage roots, administrative principals, infrastructure, or acquisition paths.
- Impact: Two separately named adapters may read the same underlying files or be controlled by the same principal. Matching snapshots then provide consistency evidence, not independent baseline assurance.
- Required remediation: Add an explicit, independently governed source-provenance contract covering storage identity, administrative/security principal, acquisition path and trust domain. Reject duplicate provenance identities. For high-assurance baseline, obtain the baseline from a separately controlled source or signed immutable checkpoint. Tests must prove same-root/same-principal provenance is rejected.
- Gate: BLOCKS CLAIMS OF INDEPENDENT BASELINE VERIFICATION.

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
3. Harden directory-relative filesystem operations and permissions.
4. Add source-provenance independence contract.
5. Add adversarial offline tests for all four controls.
6. Run isolated CI and inspect actual logs; only then reassess staging approval.

## Final disposition

- Static review: COMPLETE.
- Findings: 5 HIGH, all open.
- Runtime adversarial testing: NOT_RUN.
- Real staging integration: NOT_APPROVED.
- Production integration/deployment: NOT_APPROVED.
- No code behavior was changed by this review.
