# Google Drive Backup Adapter — Failure and Reconciliation Addendum

**Version scope:** Mira Hybrid Memory v0.2 / Phase 7 only  
**Implementation boundary:** synthetic/offline contract and adapter behavior; no live Drive API was called by these changes.  
**Operational disposition:** NOT_CERTIFIED until independent provider and live staging evidence are reviewed.

## 1. Fail-closed duplicate detection

Before creating an immutable backup, the adapter lists the exact filename within the selected Drive folder. It requires a structurally complete `data.files` array. A list exception or malformed response stops the upload; the adapter must not interpret missing data as proof that the destination is absent.

More than one candidate is a duplicate conflict requiring review. One candidate is reusable only when its ID, exact name, parent folder, backup format, project ID, ciphertext SHA-256, and deterministic upload key all match the current request. The adapter then downloads and byte-verifies the object before returning `VERIFIED_EXISTING_IDEMPOTENT`. A same-name object with different metadata is never overwritten.

## 2. Deterministic request identity

The adapter derives `miraHfmUploadKey` as SHA-256 over the UTF-8 JSON representation of `{ folderId, fileName, projectId, expectedHash }`. It stores the key with the backup format, project ID, and exact encrypted-byte digest in Drive `appProperties`.

This metadata enables safe recognition of an already committed copy. It is not a Drive-side uniqueness constraint and does not provide an atomic compare-and-swap guarantee.

## 3. Ambiguous create response

If `files.create` throws or returns metadata that cannot prove the exact object, the adapter does not issue another create. It performs one exact-name/folder listing and accepts reconciliation only when exactly one object matches all deterministic metadata and a subsequent media readback matches the exact encrypted bytes.

- Exact object found and readback verified: `VERIFIED_RECONCILED_AFTER_AMBIGUOUS_CREATE` (or the corresponding unverified-response reconciliation status).
- No exact object, multiple candidates, list failure, metadata mismatch, or readback failure: `REVIEW_REQUIRED`; the operation must not be retried blindly.
- A remote object that may have committed is retained. This adapter does not delete it during reconciliation.

## 4. Bounded response handling

Buffer, Uint8Array, ArrayBuffer, and streamed response bodies are bounded by `MAX_BACKUP_BYTES`. Stream accumulation stops once the limit is exceeded. A downloaded envelope is structurally parsed and its optional externally expected SHA-256 is checked, but the download result remains `DOWNLOADED_UNVERIFIED` until decryption/authentication and an independent recovery baseline are verified by the recovery workflow.

## 5. Remaining acceptance gaps

The synthetic adapter tests cover incomplete duplicate-list responses, immutable same-name conflicts, exact idempotent reuse, ambiguous create response reconciliation, unresolved create outcomes, and exact byte readback. They do not prove:

- Google Drive's real consistency/visibility timing for `appProperties` and list queries;
- uniqueness under concurrent writers or cross-client races;
- live OAuth/workload identity, folder ACLs, ownership, retention, or administrative independence;
- provider behavior after real network timeouts, throttling, replica lag, or service outage;
- durable operational audit evidence and a reviewed restore/recovery exercise.

A production-grade adapter must either obtain a provider-enforced atomic uniqueness/idempotency primitive or demonstrate an independently reviewed serialization/lease protocol. A list-before-create check alone is not atomic. Until these requirements are evidenced, this adapter remains a contract implementation, not production certification.

## 6. Safety boundary

These changes do not perform a live Drive call, upload, delete, restore, or production Memory/Knowledge write. No real credentials or tokens are stored in the repository. Staging remains NOT_APPROVED and production readiness remains NOT_CERTIFIED.


## 7. Exact existing-object reuse and quota boundary

An exact existing object with matching deterministic upload metadata is verified by byte-for-byte readback and returned as `VERIFIED_EXISTING_IDEMPOTENT`. This is a no-new-upload path; a current quota snapshot is not required to reuse the already stored exact object. Quota verification remains mandatory before a new `files.create` operation. A same-name object with different metadata remains a hard conflict.
