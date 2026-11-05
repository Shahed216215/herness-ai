# Mira HFM v0.2 — Offline Emergency Backup Transport Adapter

Status: INJECTED TRANSPORT CONTRACT PROTOTYPE — NO GOOGLE DRIVE SDK, OAUTH, NETWORK REQUEST, OR PROVIDER IMPLEMENTATION.

## Purpose

`services/mira-hfm-drive-emergency-backup-adapter.js` adds a provider-neutral adapter boundary for a future dedicated emergency-backup destination. It is deliberately separate from routine Google Drive synchronization and does not contact Google Drive.

## Contract

- Construct with an injected transport, a fixed project ID, and the dedicated namespace `mira-hfm-emergency/v1`.
- The transport must implement `atomicCreate`, `readObject`, and `listPage`.
- `atomicCreate` must be a provider-side atomic create-if-absent primitive. Search-then-upload is not compliant. The adapter rejects an ambiguous result rather than treating it as success.
- Uploads require the exact project namespace, AES-256-GCM content type, and a SHA-256 digest field. Root keys and plaintext are not accepted by this interface.
- Reads and listings validate project/object metadata and bounded explicit pagination.
- The adapter exposes no delete, overwrite, move, permission-grant, OAuth, or routine-sync methods.
- The adapter cannot prove a real transport's atomicity, durability, quota semantics, OAuth scope, or remote consistency. Those require provider-specific review and live integration tests after separate authorization.

## Offline evidence

The synthetic test uses an in-memory fake transport only. It checks create-only response handling, project isolation, namespace traversal rejection, encrypted metadata requirements, readback bytes, pagination envelope, and uncertain-create rejection. No credentials, network calls, real backups, or production stores are used.

VERSION=v0.2
TRANSPORT_ADAPTER=INJECTED_CONTRACT_PROTOTYPE
GOOGLE_DRIVE_OAUTH=NOT_IMPLEMENTED
LIVE_NETWORK=NOT_AUTHORIZED
ROUTINE_DRIVE_SYNC=UNCHANGED
PRODUCTION_CERTIFICATION=NOT_CERTIFIED
