# Mira HFM v0.2 — Offline Emergency Backup Transport Adapter

Status: INJECTED TRANSPORT CONTRACT PROTOTYPE — NO GOOGLE DRIVE SDK, OAUTH, NETWORK REQUEST, OR PROVIDER IMPLEMENTATION.

## Purpose

`services/mira-hfm-drive-emergency-backup-adapter.js` adds a provider-neutral adapter boundary for a future dedicated emergency-backup destination. It is deliberately separate from routine Google Drive synchronization and does not contact Google Drive.

## Contract

- Construct with an injected transport, a fixed project ID, and the dedicated namespace `mira-hfm-emergency/v1`.
- The transport must implement `atomicCreate`, `readObject`, and `listPage`.
- `atomicCreate` must be a provider-side atomic create-if-absent primitive. Search-then-upload is not compliant.
- Every non-error create response is followed by exact-byte readback; a positive create result is not accepted without matching project, backup ID, object key, encryption metadata, byte length, SHA-256 digest, and exact ciphertext bytes.
- If create throws or returns an ambiguous result, the adapter performs one read-only reconciliation of the immutable object key. A matching object returns `{ created: false, reconciled: true }`; absent/unreadable state fails closed as `HFM_DRIVE_CREATE_UNCERTAIN`. It never blindly retries create.
- A pre-existing object with the same backup ID but different ciphertext/metadata is rejected as `HFM_DRIVE_OBJECT_CONFLICT`; missing readback after an explicit create result is `HFM_DRIVE_READBACK_FAILED`.
- The caller must treat reconciled/already-present as verified presence, not proof that this invocation created the object.
- Uploads require the exact project namespace, AES-256-GCM content type, and a SHA-256 digest field. Root keys and plaintext are not accepted by this interface.
- Reads and listings validate project/object metadata and bounded explicit pagination.
- The adapter exposes no delete, overwrite, move, permission-grant, OAuth, or routine-sync methods.
- The adapter cannot prove a real transport's atomicity, durability, quota semantics, OAuth scope, or remote consistency. Those require provider-specific review and live integration tests after separate authorization.

## Offline evidence

The synthetic test uses an in-memory fake transport only. It checks concurrent create-only behavior, project isolation, namespace traversal rejection, encrypted metadata requirements, exact-byte readback, multi-page listing, timeout-after-commit reconciliation, timeout-before-commit uncertainty, immutable-ID collision rejection, missing/unreadable readback, and absence of OAuth/network use. No credentials, network calls, real backups, or production stores are used.

VERSION=v0.2
TRANSPORT_ADAPTER=INJECTED_CONTRACT_PROTOTYPE
GOOGLE_DRIVE_OAUTH=NOT_IMPLEMENTED
LIVE_NETWORK=NOT_AUTHORIZED
ROUTINE_DRIVE_SYNC=UNCHANGED
PRODUCTION_CERTIFICATION=NOT_CERTIFIED

## Timeout and retry safety semantics

The adapter intentionally does not implement automatic upload retries. When an atomic create call throws (including a synthetic timeout), its outcome is ambiguous. The adapter performs one read-only lookup and accepts only a byte-for-byte and digest-verified match. If the object is absent or cannot be read, it returns an uncertainty error for caller/operator reconciliation. It does not issue a second create request.

This avoids accidental duplicate writes and avoids overwriting an immutable backup ID. A real provider must still demonstrate that its create-if-absent primitive is atomic and that read-after-write visibility meets the required consistency model.
