# MIRA HFM v0.2 — Phase 7 Execution Ledger

- Repository: Shahed216215/herness-ai
- Base branch: work/mira-hfm-v02-phase4-public-web-research
- Phase 7 branch: work/mira-hfm-v02-phase7-emergency-backup
- Version boundary: v0.2 (no v0.3 transition)
- Scope: Emergency Backup; isolated and non-destructive.

## Source reconciliation
- Existing google-drive.js contains legacy JSON upload/update and download functions for Memory and Knowledge. It is unchanged.
- Existing tools/knowledge-backup.js and tools/knowledge-restore.js use local Knowledge recovery service.
- Existing scripts/mira-memory-backup.js delegates to the local Memory store.
- Existing tools/memory-restore.js is blocked by the action-scoped tool safety boundary.
- Existing local Memory and Knowledge backup formats are checksummed JSON, not encrypted emergency-backup envelopes.
- Phase 3 execution ledger states that provider integration, encryption and backup remain open; Phase 3 is not production-integrated/certified.
- Phase 4 SQL archive is an isolated untrusted Facebook research archive and is not an emergency-backup store.

## Added in this Phase 7 branch
- services/mira-hfm-emergency-backup.js: per-backup random DEK, AES-256-GCM, externally wrapped DEK, authenticated manifest, SHA-256 payload/manifest integrity, project/schema/record-count validation, immutable atomic local publication, backup inventory, plan-only retention and quota snapshot assessment.
- services/mira-hfm-google-drive-backup-adapter.js: injected-client Drive adapter; quota read, configured 5 GiB allocation cap, immutable create-only upload, encrypted-byte readback verification and download digest checks. It does not load credentials or make calls until invoked.
- tests/mira-hfm-emergency-backup.test.js: synthetic positive/negative tests; test-only KEK wrapper; no production store, external service or network.
- tests/mira-hfm-google-drive-backup-adapter.test.js: mock-only quota/upload/no-overwrite/readback tests.
- docs/architecture/mira-hybrid-memory/phase7/: scope and execution ledger.
- .github/workflows/mira-hfm-phase7-emergency-backup.yml: isolated Node 24 contract workflow.

## CI evidence
- Latest five-suite run `42028283552` completed SUCCESS on commit `5994c8eb372edcbd46ee1021dd45f3af19afba10`; signed snapshot-source, source-to-encrypted-backup, and recovery verification test markers all passed.
- Snapshot source now requires an independently pinned Ed25519 public-key trust anchor and fingerprint, verifies signed attestation, binds project/actor/scope/request ID/nonce, enforces an attestation freshness window, and checks source revision/count/payload digest. This authenticates the attestation signer against the configured trust anchor; it does not independently enforce the source's authorization policy or certify the production store.
- `createEncryptedBackupFromSource` connects the verified snapshot contract to envelope encryption, but returns prepared encrypted bytes only; no local publication, Drive upload, or canonical Memory write occurs.
- Latest five-suite workflow run `42027867376` completed SUCCESS on commit `1a630e76591acba674073d174fef241a1f39bc73`.
- All five offline suites passed: encrypted backup contract, mocked Drive adapter, key-provider contract, authoritative snapshot-source contract, and recovery verification.
- Logs confirm `PRODUCTION_SOURCE_AUTHENTICATED=NO`, `CANONICAL_MEMORY_WRITTEN=NO`, `CANONICAL_KNOWLEDGE_WRITTEN=NO`, `NETWORK_REQUESTS=0`, `LIVE_DRIVE_API_CALLS=0`, and `BACKUP_DELETION=0`.
- Latest Phase 7 workflow run `42027268319` completed SUCCESS on commit `b0ccad200e807876993531f87a6fa23a12455925`.
- Three isolated suites passed: emergency-backup contract, mocked Google Drive adapter, and key-provider contract conformance.
- Logs explicitly confirm `PRODUCTION_KEY_CUSTODY=NOT_APPROVED`, `NETWORK_REQUESTS=0`, `PRODUCTION_MEMORY_TOUCHED=NO`, `LIVE_DRIVE_API_CALLS=0`, and `BACKUP_DELETION=0`.
- GitHub Actions run 42026737289 completed SUCCESS on commit a58537677d88b137f9af4d296a10f100ae743f62.
- Both test suites passed: MIRA_HFM_PHASE7_EMERGENCY_BACKUP_CONTRACT_PASS and MIRA_HFM_PHASE7_GOOGLE_DRIVE_ADAPTER_PASS.
- CI logs: NETWORK_REQUESTS=0; PRODUCTION_MEMORY_TOUCHED=NO; LIVE_DRIVE_API_CALLS=0; BACKUP_DELETION=0.
- Failed run 42026705689 was retained as FAIL evidence (async test assertion mismatch); the correction and subsequent successful run are recorded separately.

## Key-provider contract continuation
- Added `services/mira-hfm-key-provider-contract.js` and offline conformance tests; workflow now includes this suite.
- Backup encryption/decryption now require a declared provider descriptor with matching key ID/version and `MIRA_HFM_BACKUP` purpose.
- Contract result is explicitly `CONTRACT_SHAPE_VALID_NOT_APPROVAL`; it is not proof of KMS identity, custody, authorization, or approval.
- Temporary DEK copy passed to the wrap callback is zeroized after the callback. Node.js runtime copies cannot be guaranteed erased.
- Governance requirements and production acceptance gates are in `KEY-PROVIDER-GOVERNANCE.md`.

## Authoritative snapshot source and recovery verification continuation
- Added `services/mira-hfm-authoritative-snapshot.js`: injected read-only source contract with project/actor/scope request, source revision, schema, record count, capture time and SHA-256 payload attestation checks.
- Added `tests/mira-hfm-authoritative-snapshot.test.js`: synthetic-only positive and negative tests. Status semantics explicitly state `SNAPSHOT_CONTRACT_VERIFIED_NOT_SOURCE_AUTHENTICATED`; caller-supplied descriptor/attestation is not cryptographic proof of source identity or real authorization.
- Added `services/mira-hfm-recovery-verification.js`: non-mutating decrypt/authenticate and independent baseline comparison for source revision, record count and payload SHA-256.
- Added `tests/mira-hfm-recovery-verification.test.js`: successful recovery preview, baseline mismatch, missing baseline, and no-canonical-write assertions.
- CI workflow now runs five isolated offline suites. No production Memory/Knowledge read, production restore, live Drive/KMS call, or deletion was performed.


## Safety boundary
- Production Memory read/write: NO
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
- Live Google Drive permission/quota/upload/download verification: NOT_RUN.
- Retention deletion approval and policy: NOT_APPROVED; plan-only behavior remains.
- Restore preview is implemented through authenticated decrypt and validation; production restore/atomic canonical replacement remains NOT_IMPLEMENTED.
- Full independent security review and deployment certification: NOT_STARTED.

## Final Phase 7 state
- Offline encryption and local immutable backup contract: PASS_CI
- Mocked Drive adapter contract: PASS_CI
- Live provider verification: INCONCLUSIVE / NOT_RUN
- Production restore: NOT_APPROVED
- Production readiness: NOT_CERTIFIED
- Phase 7: PARTIAL_IMPLEMENTATION — CONTINUE REQUIRED
