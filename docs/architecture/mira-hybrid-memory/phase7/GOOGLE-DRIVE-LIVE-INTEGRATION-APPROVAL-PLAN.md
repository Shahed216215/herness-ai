# Mira HFM v0.2 — Google Drive Live Integration Approval Plan

**Document ID:** MIRA-HFM-P7-GDRIVE-APPROVAL-PLAN-001  
**Status:** DESIGN ONLY — NO AUTHORIZATION OR LIVE TEST  
**Applies to:** Phase 7 encrypted emergency backup  
**Version:** v0.2

## 1. Current implementation boundary

The repository now contains:
- An encrypted envelope and local immutable backup implementation.
- A durable local generated-file-ID journal.
- A journal-first upload orchestrator with same-ID timeout/409 reconciliation.
- A provider-injected Google Drive v3 method mapper for files.generateIds, resumable files.create, exact-ID files.get, alt=media download, project-scoped files.list, and about.get quota/account identity.
- Offline fake-client tests only.

The mapper requires a pre-authorized Drive v3 client and a stable account-fingerprint binding. It does not create OAuth credentials, initiate a consent screen, read environment secrets, or call Google by itself. No live provider operation has been performed.

## 2. OAuth scope decision — choose exactly one storage model

### Option A — appDataFolder (private app data)
- Candidate scope: https://www.googleapis.com/auth/drive.appdata.
- Files live in the application's hidden appDataFolder, not as an ordinary user-visible folder in My Drive.
- The app can list/read its own appDataFolder files; this is the narrowest fit if the backup is intended only for Mira's internal recovery.
- The mapper requires driveSpace=appDataFolder and parentId=appDataFolder.

### Option B — dedicated My Drive folder (user-visible)
- Candidate scope: https://www.googleapis.com/auth/drive.file.
- Create or select a dedicated HFM backup folder through an explicit user-mediated setup step; do not request broad access to all Drive files.
- The mapper requires driveSpace=drive and the exact selected folder ID as parentId.
- A folder-picker/ownership-selection workflow is not implemented in this branch. Do not assume an arbitrary existing folder is accessible under drive.file.

### Avoid
- Do not request https://www.googleapis.com/auth/drive for this workflow; it grants broad access to all Drive files and is a restricted scope.
- Do not request drive.readonly, drive.metadata, or other broad scopes as a workaround.
- about.get supports both drive.appdata and drive.file, so the same selected narrow scope can support permissionId/account binding and storageQuota reporting.

No scope has been selected or approved. OAuth consent must remain blocked until the storage model is chosen and the exact requested scope list is reviewed.

## 3. Account identity and quota

- Obtain user.permissionId through about.get with an explicit fields selector.
- Hash the opaque permission ID with SHA-256; store only the 64-character lowercase fingerprint in the local journal.
- Never persist the raw permission ID, email address, access token, refresh token, or client secret in the journal.
- Read storageQuota.limit and storageQuota.usage; usage is total Google-account storage usage across services. Using it for available capacity is conservative because Gmail/Photos can consume quota too.
- If quota is unlimited, missing, malformed, future-dated, or account identity cannot be verified, report NOT_REPORTED/INCONCLUSIVE or fail closed. Never substitute a guessed quota.
- The HFM 5,000,000,000-byte project budget remains separate from Google account quota.

## 4. Encrypted object contract

Each uploaded item must be:
- An ordinary binary file, never converted to a Google Workspace document.
- MIME type application/vnd.mira.hfm-encrypted-backup.
- AES-256-GCM envelope bytes only; no plaintext snapshot or root key.
- Created with one ID from files.generateIds for the selected Drive space.
- Journaled and fsynced locally before files.create starts.
- Bound through private appProperties to projectId, backupId, envelope schema/version/createdAt, ciphertext SHA-256, byte length and encryption algorithm.
- Uploaded resumably; after success, timeout, or 409, retrieved by the same exact file ID and checked for metadata equality and exact ciphertext byte equality.
- Listed only under the configured parent and project namespace. An incomplete Drive listing must never be treated as a complete inventory.

Private appProperties are accessible only to the same OAuth application. Each key+value property is subject to Google's documented 124-byte UTF-8 limit; the current keys/values are bounded to remain below that limit.

## 5. One-time live synthetic test — requires separate explicit approval

The future live test must use a disposable test project ID and a small synthetic encrypted payload, not personal Memory, client, CRM, Facebook, or production data.

1. Confirm the selected scope, authenticated account fingerprint and configured parent/space.
2. Generate one file ID.
3. Persist and fsync the local operation journal; confirm exact readback.
4. Upload one synthetic encrypted binary file with the pre-generated ID and resumable upload.
5. Retrieve metadata by exact ID and download media by exact ID.
6. Verify project/backup/schema/version/timestamp/parent/size/digest metadata and exact ciphertext bytes.
7. Repeat the same create using the same ID; verify the documented 409 path and exact-object reconciliation without a duplicate.
8. Test timeout-after-commit and timeout-before-commit using an approved fault-injection proxy or synthetic provider, never by destabilizing production data.
9. List all pages under the dedicated parent and verify every listed item is encrypted, correctly scoped, bounded and timestamp-valid.
10. Read quota and verify account fingerprint; keep HFM budget accounting separate.
11. Run authenticated restore preview and restore-to-staging only. Do not write canonical Memory.
12. Save redacted evidence, request IDs/status codes, test artifact ID, exact digests and recovery result. Do not log tokens or secrets.

A failed/ambiguous upload remains UNCERTAIN; preserve the journal and use only the same ID. Do not auto-delete or overwrite any Drive object.

## 6. Cost, data and security notes

- No paid service or billing change is authorized by this plan.
- Google Drive storage usage is charged against the user's available account storage; Drive API rate limits and account policies still apply.
- The journal is currently owner-only but not encrypted or MAC-authenticated. A lost journal can be reconstructed only when the user still has the correct Drive account, backup ID and root key and the remote object remains intact; automatic cross-device journal replication and recovery without those inputs remain unresolved.
- The root encryption key must remain outside Drive and outside the journal. Production key custody/rotation/recovery is a separate unresolved gate.
- OAuth tokens and secrets must be held only in an approved secret store; never commit them, print them, or place them in logs.
- Shared Drives, permission changes, link sharing, folder creation, deletion and retention deletion are outside the current provider mapper.

## 7. Required approval checklist

Before any live API call, the owner must explicitly approve:
- [ ] Storage model: appDataFolder or dedicated My Drive folder.
- [ ] Exact OAuth scope(s), consent-screen identity and token-storage location.
- [ ] Authenticated account and SHA-256 account-fingerprint verification method.
- [ ] Exact parent folder ID (if My Drive).
- [ ] Disposable project ID and synthetic payload.
- [ ] The one-time live test steps and the maximum number/size of test files.
- [ ] Whether the resulting test artifact should remain for manual review.

Until all applicable items are approved, status remains NOT_APPROVED and no OAuth/network operation may run.

## 8. Exit condition

Phase 7 cannot be marked production-complete until:
- Authoritative canonical snapshot source/store/schema and project-owner authority are independently reconciled.
- OAuth scope and account/space/parent selection are approved.
- The actual Google Drive client is wired and live synthetic upload/download/list/quota/409/timeout tests pass.
- Production key custody and recovery/rotation controls are certified.
- An independent restore drill verifies authenticated restore staging and recovery without canonical writes.
- Production restore certification and evidence review are complete.

Current status: **DESIGN READY FOR OWNER REVIEW — LIVE INTEGRATION NOT AUTHORIZED — PHASE 7 NOT COMPLETE**.
