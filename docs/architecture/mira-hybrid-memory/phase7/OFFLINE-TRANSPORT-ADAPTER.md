# Mira HFM v0.2 — Offline Emergency Backup Transport Adapter

Status: INJECTED TRANSPORT CONTRACT PROTOTYPE — NO GOOGLE DRIVE SDK, OAUTH, NETWORK REQUEST, OR PROVIDER IMPLEMENTATION.

## Purpose

`services/mira-hfm-drive-emergency-backup-adapter.js` adds a provider-neutral adapter boundary for a future dedicated emergency-backup destination. It is deliberately separate from routine Google Drive synchronization and does not contact Google Drive.

## Contract

- Construct with an injected transport, a fixed project ID, and the dedicated namespace `mira-hfm-emergency/v1`.
- The transport must implement `getCapabilities`, `atomicCreate`, `readObject`, and `listPage`; `getQuota` is optional.
- Before every operation, the adapter performs a cached provider capability negotiation. The provider must explicitly declare `atomicCreateIfAbsent`, `readAfterWrite`, `projectIsolation`, `encryptedObjectStorage`, and `paginatedList` as true, plus `consistency: "read-after-write"`, a bounded `maxObjectBytes` (1 byte–64 MiB), and `maxPageSize` (1–500). Missing, malformed, or unsupported capability declarations fail closed. Negotiated limits are enforced on uploads and listing.
- Negotiation is a contract declaration, not proof of provider behavior; a real provider still requires independent verification.
- `atomicCreate` must be a provider-side atomic create-if-absent primitive. Search-then-upload is not compliant.
- Every non-error create response is followed by exact-byte readback; a positive create result is not accepted without matching project, backup ID, object key, encryption metadata, byte length, SHA-256 digest, and exact ciphertext bytes.
- If create throws or returns an ambiguous result, the adapter performs one read-only reconciliation of the immutable object key. A matching object returns `{ created: false, reconciled: true }`; absent/unreadable state fails closed as `HFM_DRIVE_CREATE_UNCERTAIN`. It never blindly retries create.
- A pre-existing object with the same backup ID but different ciphertext/metadata is rejected as `HFM_DRIVE_OBJECT_CONFLICT`; missing readback after an explicit create result is `HFM_DRIVE_READBACK_FAILED`.
- The caller must treat reconciled/already-present as verified presence, not proof that this invocation created the object.
- Uploads require the exact project namespace, AES-256-GCM content type, and a SHA-256 digest field. Root keys and plaintext are not accepted by this interface.
- Reads and listings validate project/object metadata and bounded explicit pagination.
- Optional `getQuota` responses are validated for provider ID, account/project scope, project binding, canonical measurement timestamp, and safe integer byte counts. Missing provider quota is reported as `NOT_REPORTED`, never inferred.
- Capacity reporting keeps the configured 5,000,000,000-byte HFM project budget separate from provider-reported quota. Account-level provider quota is explicitly labeled account scope; it is not presented as the HFM project budget.
- The adapter exposes no delete, overwrite, move, permission-grant, OAuth, or routine-sync methods.
- The adapter cannot prove a real transport's atomicity, durability, quota semantics, OAuth scope, or remote consistency. Those require provider-specific review and live integration tests after separate authorization.

## Offline evidence

The synthetic test uses an in-memory fake transport only. It checks capability negotiation and fail-closed unsupported providers, negotiated object/page bounds, scoped quota validation and unavailable-quota reporting, concurrent create-only behavior, project isolation, namespace traversal rejection, encrypted metadata requirements, exact-byte readback, multi-page listing, timeout-after-commit reconciliation, timeout-before-commit uncertainty, immutable-ID collision rejection, missing/unreadable readback, and absence of OAuth/network use. No credentials, network calls, real backups, or production stores are used.

VERSION=v0.2
TRANSPORT_ADAPTER=INJECTED_CONTRACT_PROTOTYPE
GOOGLE_DRIVE_OAUTH=NOT_IMPLEMENTED
LIVE_NETWORK=NOT_AUTHORIZED
ROUTINE_DRIVE_SYNC=UNCHANGED
PRODUCTION_CERTIFICATION=NOT_CERTIFIED

## Timeout and retry safety semantics

The adapter intentionally does not implement automatic upload retries. When an atomic create call throws (including a synthetic timeout), its outcome is ambiguous. The adapter performs one read-only lookup and accepts only a byte-for-byte and digest-verified match. If the object is absent or cannot be read, it returns an uncertainty error for caller/operator reconciliation. It does not issue a second create request.

This avoids accidental duplicate writes and avoids overwriting an immutable backup ID. A real provider must still demonstrate that its create-if-absent primitive is atomic and that read-after-write visibility meets the required consistency model.


## Provider capability and quota reporting contract

Capability negotiation is mandatory before upload, read, or listing. The injected provider must declare the exact consistency and feature contract; no feature is inferred from method presence. A declaration is only an assertion from the provider implementation and is not a substitute for provider-specific atomicity, consistency, or durability testing.

Quota is optional because providers expose different quota scopes and some transports may not expose quota at all. If present, quota is a measured provider response and must identify the provider, scope (`account` or `project`), canonical UTC measurement time, quota bytes, and used bytes. Project-scoped quota must match the configured project. Account quota is labeled as account-wide and must not be confused with the HFM 5 GB configured emergency-backup budget. Missing quota returns `NOT_REPORTED`; malformed quota fails closed. The capacity report separately reports estimated HFM namespace usage from a complete bounded listing.
