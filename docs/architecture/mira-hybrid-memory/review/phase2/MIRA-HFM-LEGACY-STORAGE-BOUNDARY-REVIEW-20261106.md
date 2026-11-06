# Mira HFM v0.2 — Legacy Storage and Project-Authority Boundary Review

**Review date:** 2026-11-06  
**Branch:** `work/hfm-phase2-identity-guard-render-base-20261106`  
**PR:** #52 (Draft; not merged)  
**Review type:** Read-only source inspection. No local or production data was read or changed.

## Executive result

Project-scoped memory/knowledge authorization is **NOT_IMPLEMENTED**. The current legacy persistence APIs are global/local-file based and do not consume the canonical HFM trusted actor context. The PostgreSQL adapter is metadata-only and read-only. No project-level allow decision may be inferred from the presence of an authenticated actor or a database connection.

## Source evidence

| Surface | Observed behavior | HFM disposition |
|---|---|---|
| `tools/memory-save.js` | Calls `addMemory("user", content)`; callback does not accept or validate `trustedContext`. | **NOT_ACTOR_SCOPED** |
| `memory.js` | Loads and writes one local memory store; entries contain role/content/time, not canonical actor/project authority. | **LEGACY_GLOBAL_STORE** |
| `tools/knowledge-save.js` | Calls `addKnowledge(title, url, content)`; callback does not accept or validate `trustedContext`. | **NOT_ACTOR_SCOPED** |
| `knowledge.js` | Reads/writes a shared local `knowledge.json` and synchronizes the aggregate to Google Drive. | **LEGACY_GLOBAL_STORE** |
| `tools/knowledge-search.js` | Searches the shared local knowledge collection and may replace it with the Google Drive collection; no actor, project, membership, or operation authority filter. | **PROJECT_RETRIEVAL_BLOCKED** |
| `project-store.js` | Stores all projects in a local JSON file; project records are not linked to HFM owner/membership registry. | **UNASSIGNED_UNTIL_EVIDENCED** |
| `services/mira-hfm-postgres.js` | Dedicated Neon URL, bounded pool, TLS configuration, read-only metadata inspection; no authority CRUD or data migration. | **METADATA_ONLY** |

## Required boundary

1. Do not pass legacy global Memory/Knowledge results off as project-scoped retrieval.
2. Do not assign owners to existing projects from project creator, user role, email, display name, or other inferred fields.
3. Keep all existing projects unassigned/blocked until an independent evidence reference and explicit approval are recorded.
4. Do not retrofit actor metadata onto old global records and claim that this establishes ownership or provenance.
5. Do not migrate legacy Memory/Knowledge data to Neon automatically. Any future import needs a reviewed source inventory, explicit scope decision, provenance preservation, deduplication plan, backup, and a separate approval.
6. Do not authorize a write merely because `buildTrustedActorContext` returned `ACTOR_RESOLVED`. Actor authentication is not project membership or operation authority.
7. Project retrieval and mutation must remain unavailable until a transactionally enforced authority decision validates actor, project, operation, resource, purpose, request ID, current owner/membership revisions, status, and validity window. One-time authority consumption and audit append must be atomic with the protected operation or otherwise use a proven replay-safe protocol.

## Safe next implementation sequence

1. Complete and review the SQL migration on a **disposable Neon branch only**; execute no production migration.
2. Create a separate migration-owner credential and a distinct `mira_hfm_runtime` role. Verify runtime role is SELECT-only and cannot create objects or mutate rows.
3. Design a transactionally safe authority-consumption operation (including replay prevention, revision checks, revocation races, and append-only audit). Do not enable an authorization resolver that only performs an unlocked SELECT and then permits a later write.
4. Build isolated repository/service tests for owner assignment, explicit membership grant/revoke, stale revisions, expiry, wrong project/resource/purpose, replay, and concurrent revocation.
5. Only after the above is proven, add new HFM-specific memory/knowledge APIs. Keep legacy global stores separate and never silently merge them into project scope.
6. Plan a separately approved, provenance-preserving migration of any legacy data, if desired.
7. Only after disposable-branch validation and restore drill, consider Render runtime-secret configuration and a read-only live connection check. No deployment is implied.

## Release status

- Actor identity transport: **PASS (transport only)**.
- Legacy memory/knowledge actor-scoped authorization: **NOT_INTEGRATED**.
- Project owner/membership registry: **SCHEMA_ONLY**.
- Operation authority and atomic consumption: **NOT_IMPLEMENTED**.
- Project-scoped retrieval: **BLOCKED**.
- SQL migration execution: **NOT_PERFORMED**.
- Neon live connection: **NOT_PERFORMED**.
- Render environment/deployment changes: **NOT_PERFORMED**.
- PR merge: **NOT_PERFORMED**.

This review is a source-level boundary record, not a runtime or production certification.
