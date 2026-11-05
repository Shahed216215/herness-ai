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
- `services/mira-hfm-local-staging-snapshot-source.js`: staging-only local JSON source adapter with explicit file paths, staging-root containment, non-symlink file checks, authorization callback, bounded read-only file descriptors, and Ed25519 request-bound attestation.
- Tests: emergency-backup, mocked Drive adapter, key-provider contract, authoritative snapshot, recovery verification, and local staging snapshot source.
- `.github/workflows/mira-hfm-phase7-emergency-backup.yml`: isolated Node 24 offline contract workflow; updated to include the staging-source suite.

## Local staging source design boundary
- The adapter accepts only `environment: staging`; production environment is rejected.
- No repository default storage path is resolved. Both JSON file paths must be explicitly supplied and remain inside a real, non-symlink staging root.
- Authorization is delegated to an explicitly injected callback and must return literal `true` before either source file is read.
- The adapter does not call `readMemory()`, because that function may create an initialization marker; it does not call Knowledge backup creation, which writes backup/audit state.
- The adapter signs the source revision, record count, payload digest, actor/project/scope, request ID and nonce using an injected Ed25519 key.
- Synthetic tests only; no staging or production project files were read by this implementation session. No live source, KMS, Drive, or canonical Memory was touched.
- The injected authorization callback and private-key custody are not independently certified. Production integration remains blocked.

## CI evidence before local staging adapter
- Latest previously observed five-suite workflow run `42028413165` completed SUCCESS on commit `8b8d7127a3c986d906f74edffcfefd1f924929d5`.
- This run covered encrypted backup, mocked Drive, key-provider contract, signed snapshot source and recovery verification. It did not cover the subsequently added local staging adapter.
- A later documentation-only ledger commit was recorded after that CI run; no claim is made that the documentation-only commit was tested by that run.
- Earlier failed run `42026705689` is retained as FAIL evidence (async assertion mismatch); a corrected later run succeeded.

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
- Staging authorization callback and signing-key custody need independent implementation review.
- Live Google Drive permission/quota/upload/download verification: NOT_RUN.
- Retention deletion approval and policy: NOT_APPROVED; plan-only behavior remains.
- Restore preview is implemented through authenticated decrypt and validation; production restore/atomic canonical replacement remains NOT_IMPLEMENTED.
- Full independent security review and deployment certification: NOT_STARTED.

## Current Phase 7 state
- Offline encryption and local immutable backup contract: PASS_CI (previous workflow evidence).
- Mocked Drive adapter contract: PASS_CI (previous workflow evidence).
- Signed snapshot-source and recovery-verification contracts: PASS_CI (previous workflow evidence).
- Local staging snapshot source: IMPLEMENTED; CI_PENDING.
- Live provider verification: INCONCLUSIVE / NOT_RUN.
- Production restore: NOT_APPROVED.
- Production readiness: NOT_CERTIFIED.
- Phase 7: PARTIAL_IMPLEMENTATION — CONTINUE REQUIRED.
