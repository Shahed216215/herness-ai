# MIRA HFM v0.2 — Phase 7 Execution Ledger

- Repository: Shahed216215/herness-ai
- Base branch: work/mira-hfm-v02-phase4-public-web-research
- Phase 7 branch: work/mira-hfm-v02-phase7-emergency-backup
- Version boundary: v0.2 (no v0.3 transition)
- Scope: Emergency Backup; isolated and non-destructive.

## Source reconciliation
- Existing `google-drive.js` contains legacy JSON upload/update and download functions for Memory and Knowledge. It is unchanged.
- Existing `tools/knowledge-backup.js` and `tools/knowledge-restore.js` use local Knowledge recovery service.
- Existing `scripts/mira-memory-backup.js` delegates to the local Memory store.
- Existing `tools/memory-restore.js` is blocked by the action-scoped tool safety boundary.
- Existing local Memory and Knowledge backup formats are checksummed JSON, not encrypted emergency-backup envelopes.
- The local Memory store's `readMemory()` may create an initialization marker when it reads a valid legacy store; it is therefore not a strictly side-effect-free snapshot reader.
- Knowledge backup creation writes backup and audit state; it is not a read-only snapshot operation.
- Phase 4 SQL archive is an isolated untrusted Facebook research archive and is not an emergency-backup store.

## Added in this Phase 7 branch
- `services/mira-hfm-emergency-backup.js`: per-backup random DEK, AES-256-GCM, externally wrapped DEK, authenticated manifest, SHA-256 payload/manifest integrity, project/schema/record-count validation, immutable atomic local publication, backup inventory, plan-only retention and quota snapshot assessment.
- `services/mira-hfm-google-drive-backup-adapter.js`: injected-client Drive adapter; quota read, configured 5 GiB allocation cap, immutable create-only upload, encrypted-byte readback verification and download digest checks. It does not load credentials or make calls until invoked.
- `services/mira-hfm-key-provider-contract.js`: validates the declared provider interface, key purpose and key reference/version consistency. Contract shape is not provider identity or approval.
- `services/mira-hfm-authoritative-snapshot.js`: injected signed snapshot contract with independent Ed25519 trust anchor, request binding, freshness and payload/revision checks; produces encrypted bytes only.
- `services/mira-hfm-recovery-verification.js`: non-mutating decrypt/authenticate and independent baseline comparison.
- `services/mira-hfm-authorization-decision.js`: verifies short-lived signed Ed25519 authorization decisions against a separate pinned issuer trust store and requires an atomic one-time replay-guard interface.
- `services/mira-hfm-local-staging-snapshot-source.js`: staging-only local JSON source adapter with explicit file paths, staging-root containment, non-symlink file checks, signed authorization decision verification before reads, bounded read-only file descriptors, and Ed25519 request-bound attestation.
- `services/mira-hfm-staging-backup-drill.js`: staging-only orchestrator that compares two separately pinned staging source captures, encrypts and immutably publishes a backup, reads it back from disk, and verifies recovery preview against the baseline.
- Tests: emergency-backup, mocked Drive adapter, key-provider contract, authoritative snapshot, recovery verification, local staging snapshot source, and staging backup/recovery drill.
- `.github/workflows/mira-hfm-phase7-emergency-backup.yml`: isolated Node 24 offline contract workflow; updated to include the staging-source and end-to-end staging backup/recovery drill suites.

## Local staging source design boundary
- The adapter accepts only `environment: staging`; production environment is rejected.
- No repository default storage path is resolved. Both JSON file paths must be explicitly supplied and remain inside a real, non-symlink staging root.
- Authorization callback returns a signed, short-lived ALLOW decision; a separately pinned issuer key authenticates it and an injected one-time replay guard must atomically consume it before either source file is read.
- The adapter does not call `readMemory()`, because that function may create an initialization marker; it does not call Knowledge backup creation, which writes backup/audit state.
- The adapter signs the source revision, record count, payload digest, actor/project/scope, request ID and nonce using an injected Ed25519 key.
- Synthetic tests only; no staging or production project files were read by this implementation session. No live source, KMS, Drive, or canonical Memory was touched.
- The authorization issuer's policy governance, durable cross-instance replay guard, source signing-key custody and private-key lifecycle are not independently certified. Production integration remains blocked.

## CI evidence before local staging adapter
- Latest previously observed five-suite workflow run `42028413165` completed SUCCESS on commit `8b8d7127a3c986d906f74edffcfefd1f924929d5`.
- This run covered encrypted backup, mocked Drive, key-provider contract, signed snapshot source and recovery verification. It did not cover the subsequently added local staging adapter.
- A later documentation-only ledger commit was recorded after that CI run; no claim is made that the documentation-only commit was tested by that run.
- Earlier failed run `42026705689` is retained as FAIL evidence (async assertion mismatch); a corrected later run succeeded.

## Staging backup/recovery drill design boundary
- Requires two distinct, independently pinned source identities; both must explicitly declare staging environment.
- Captures the independent baseline first, then the backup source. Source revision, record count, and canonical payload digest must match before publication.
- Requires an existing explicit non-symlink backup directory and a restricted immutable filename; existing backups are never overwritten.
- Reads the published encrypted file back from disk and verifies decryption, authentication, project/schema/count, source revision, and payload digest against the independent baseline.
- A recovery-verification failure after publication retains the encrypted backup and reports its path; the drill does not delete or overwrite it.
- Synthetic fixtures only. Separate source identities and keys in CI do not establish production authority, actual independent infrastructure, or real key custody.
- New suite has not yet been verified by a completed GitHub Actions run; status remains CI_PENDING until logs are inspected.

## Safety boundary
- Production Memory read/write: NO
- Staging project data read: NO (tests use temporary synthetic fixtures only)
- Google Drive live API/OAuth call: NO
- Existing Drive routine sync changed: NO
- Production key generation/storage/rotation: NO
- Production KMS/KEK provider selected or approved: NO
- Production restore/migration: NO
- Backup deletion: NO
- Deployment/merge: NO

## Remaining blockers
- Production KMS/KEK custody, access policy, rotation, escrow and recovery: REVIEW_REQUIRED.
- Authoritative production snapshot source, actor/project authorization and source revision binding: NOT_INTEGRATED.
- Signed authorization decision contract is implemented; issuer policy governance and durable replay-store review remain open. Source signing-key custody still requires independent review.
- Live Google Drive permission/quota/upload/download verification: NOT_RUN.
- Retention deletion approval and policy: NOT_APPROVED; plan-only behavior remains.
- Restore preview is implemented through authenticated decrypt and validation; production restore/atomic canonical replacement remains NOT_IMPLEMENTED.
- Full independent security review and deployment certification: NOT_STARTED.

## Current Phase 7 state
- Offline encryption and local immutable backup contract: PASS_CI (previous workflow evidence).
- Mocked Drive adapter contract: PASS_CI (previous workflow evidence).
- Signed snapshot-source and recovery-verification contracts: PASS_CI (previous workflow evidence).
- Local staging snapshot source: PASS_CI (verified in six-suite run).
- Staging backup/recovery drill: IMPLEMENTED; CI_PENDING.
- Live provider verification: INCONCLUSIVE / NOT_RUN.
- Production restore: NOT_APPROVED.
- Production readiness: NOT_CERTIFIED.
- Phase 7: PARTIAL_IMPLEMENTATION — CONTINUE REQUIRED.


## Staging security review — 2026-11-05
- Added `docs/architecture/mira-hybrid-memory/phase7/STAGING-SECURITY-REVIEW.md` after static source review of authorization, signing-key custody, filesystem confinement, backup-directory permissions, and baseline provenance.
- Five HIGH findings remain open. Details, evidence paths, impact, and required remediation are recorded in the review document.
- Static review is COMPLETE; runtime adversarial tests are NOT_RUN; real staging integration is NOT_APPROVED; production remains NOT_CERTIFIED.
- No application code or runtime behavior was changed. No staging/production data, credentials, KMS, Drive API, or deployment was accessed.


## Signed authorization decision implementation — 2026-11-05
- Added `services/mira-hfm-authorization-decision.js`: Ed25519 signed ALLOW decision verification using an authorization-issuer trust store separate from snapshot-source trust; binds project, actor, scope, request ID and nonce; enforces issuer key fingerprint, policy version, short expiry and one-time replay-guard consumption.
- Updated the local staging source to require this decision and replay guard before opening either source file. Its signed source attestation carries authorization issuer/decision/policy/expiry provenance; the authoritative snapshot verifier validates and retains these claims.
- Expanded synthetic tests for successful decision verification, DENY, expired decision, actor mismatch, replay, and expired authorization claim. Staging backup drill fixtures now use signed decisions.
- The replay-guard interface is not itself a production implementation. Real deployments must provide a durable, atomic, cross-instance consume operation; test Set-based guard is synthetic only. The authorization issuer's policy correctness and governance are not independently certified.
- CI for this new authorization implementation: PENDING / NOT VERIFIED. Do not claim PASS until actual workflow logs are inspected.
- F7-SR-01: PARTIALLY_REMEDIATED / OPEN. Real staging remains NOT_APPROVED.

- Added `docs/architecture/mira-hybrid-memory/phase7/AUTHORIZATION-PROVIDER-GOVERNANCE.md` specifying separate issuer trust, exact policy-version pinning, decision claims, and durable atomic replay-store requirements. No production issuer or replay-store provider is selected.
