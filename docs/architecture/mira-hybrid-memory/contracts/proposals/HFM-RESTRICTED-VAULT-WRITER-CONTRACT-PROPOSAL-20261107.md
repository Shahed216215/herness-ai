# MIRA HFM v0.2 — Restricted Vault Writer Contract Proposal

**Document ID:** HFM-VAULT-WRITER-2026-11-07-01  
**Date:** 2026-11-07  
**Status:** PROPOSED / NOT APPROVED / NOT IMPLEMENTED  
**Architecture authority:** User-approved HFM Memory Topology & Daily Knowledge Amendment (2026-11-06)  
**Release boundary:** HFM v0.2 only

> The approved topology requires separate `client_vault_record` and `financial_vault_record` families, application-level envelope encryption, and fail-closed key handling. The current repository has envelope-crypto primitives, but no complete authorized vault writer workflow. This proposal defines the missing payload, authorization, and lifecycle contracts. It does not authorize a production migration, key provisioning, data write, runtime activation, merge, or deployment.

## 1. Current implementation boundary

The current code contains:
- AES-256-GCM payload encryption with a fresh per-record DEK.
- KEK wrapping with versioned `MIRA_VAULT_KEK_VN` configuration.
- AAD binding to record ID, owner, project, record type, classification, schema version, and envelope version.
- HMAC-derived digest candidates for encrypted-record idempotency.
- Fail-closed behavior when the active KEK version or key is missing/invalid.

The current memory writer policy does not authorize `RESTRICTED` record creation. No client-vault or financial-vault tool, dedicated restricted writer role, exact operation policy, or end-to-end writer lifecycle is claimed.

## 2. Record classification and payload boundary

Both record families must use:
- `classification: RESTRICTED`
- `integrity.status: VERIFIED` only after successful canonical validation, encryption, and readback verification
- `trust.status: HUMAN_VERIFIED` only for exact user-provided and explicitly confirmed content, otherwise the separately approved source/review lifecycle
- project-scoped ownership and lifecycle metadata
- application-level encryption before any sensitive payload reaches PostgreSQL

For every RESTRICTED record:
- `public_payload` must be SQL NULL.
- The full canonical record and all sensitive fields must be inside the authenticated encrypted envelope.
- Plaintext content, titles, names, contacts, transaction values, contract text, source text, search terms, and unkeyed low-entropy hashes must not appear in database columns, logs, tool output, analytics, or error messages.
- The database may retain only opaque routing metadata needed for authorization and query planning.
- The existing generic `mira_hfm_memory_writer` must not gain broad RESTRICTED access.

## 3. Proposed client-vault payload

The `client_vault_record` payload should be canonical JSON validated against a dedicated versioned schema. Proposed fields:

| Field | Requirement | Notes |
|---|---|---|
| `payloadVersion` | Required | Client-vault payload schema version |
| `clientRef` | Required | Opaque project-scoped identifier; not a public name |
| `displayName` | Optional | Encrypted; never database routing metadata |
| `legalName` | Optional | Encrypted; only where lawful and necessary |
| `contacts` | Optional array | Name, email, phone, role; bounded and encrypted |
| `relationshipStatus` | Required enum | `prospect`, `active`, `paused`, `closed`, `archived` |
| `industry` | Optional | Encrypted if client-identifying |
| `projectRefs` | Optional array | Same-project opaque project/task references |
| `contractRefs` | Optional array | Opaque references; no public link exposure |
| `deliverables` | Optional array | Encrypted metadata/content or separately authorized object references |
| `notes` | Optional | Encrypted; bounded |
| `sourceReferenceIds` | Optional array | References to the separately approved source-reference domain contract |

Unknown critical fields, unsupported versions, overlong values, cross-project references, and malformed contacts must fail validation. Raw credentials/secrets do not belong in this vault; use a dedicated secrets manager.

## 4. Proposed financial-vault payload

The `financial_vault_record` payload should be canonical JSON validated against a dedicated versioned schema. Proposed fields:

| Field | Requirement | Notes |
|---|---|---|
| `payloadVersion` | Required | Financial-vault payload schema version |
| `financialRef` | Required | Opaque project-scoped identifier |
| `recordKind` | Required enum | `quote`, `invoice`, `payment`, `fee`, `transaction`, `refund`, `other` |
| `currency` | Conditional | ISO 4217 code |
| `amountMinorUnits` | Conditional | Integer minor units; avoid floating-point money |
| `occurredAt` | Conditional | RFC3339 |
| `counterpartyRef` | Optional | Opaque same-project client reference |
| `invoiceRef` | Optional | Encrypted identifier |
| `paymentStatus` | Optional enum | `pending`, `paid`, `failed`, `refunded`, `unknown` |
| `projectRef` | Optional | Same-project opaque project/task reference |
| `evidenceRefs` | Optional array | Source-reference IDs or separately approved evidence pointers |
| `notes` | Optional | Encrypted; bounded |

Financial values, invoice identifiers, payment references, counterparty identity, and notes remain encrypted. Amounts must never appear in public payload, search snippets, logs, or social drafts.

## 5. Authorization model

Do not reuse the generic Memory writer's unrestricted `memory.write` permission for restricted vault data.

Proposed operation scopes:
- `client_vault.write`, `client_vault.read`, `client_vault.trash`, `client_vault.restore`
- `financial_vault.write`, `financial_vault.read`, `financial_vault.trash`, `financial_vault.restore`

Requirements:
- Exact project, actor, operation, resource, request ID, and purpose binding.
- One-time, short-lived, consumed operation authority for every write/lifecycle mutation.
- Server-derived actor/project identity; no caller-supplied owner or role.
- Active project owner or active membership with the exact vault permission.
- Dedicated vault reader/writer login roles with NOINHERIT and no BYPASSRLS.
- The generic memory reader remains read-only and cannot decrypt restricted vault payloads unless a separately approved vault-read capability is present.
- No database owner, superuser, or migration role as runtime identity.
- Unknown or expired authority, missing membership, invalid project binding, or missing key fails closed.

The exact role split (separate client and financial roles versus one restricted-vault role with operation-specific RLS) requires database security review.

## 6. Writer and lifecycle behavior

Proposed write flow:
1. User explicitly requests saving a specific client or financial record.
2. The complete payload is present in user-provided content or retrieved from an approved source with an explicit human confirmation step.
3. Validate the payload schema and classify it as RESTRICTED.
4. Verify server-derived project/actor identity and active membership.
5. Obtain a one-time exact-resource vault operation authority.
6. Create the canonical envelope and encrypt it with a fresh DEK; wrap the DEK using the active KEK version and AAD.
7. Insert only encrypted envelope plus minimum routing metadata.
8. Read back under the authorized vault reader path, authenticate/decrypt, validate the canonical payload, and verify keyed digest/idempotency.
9. Commit the immutable audit event and operation result in the same transaction.

Content updates should create a new immutable revision. Direct in-place payload mutation is prohibited. Trash/restore may change only lifecycle metadata and must preserve encrypted payload bytes and digest. Delete/retention/export operations require separately approved, audited workflows.

## 7. Retrieval, search, and output restrictions

- No general text search over decrypted client or financial payloads.
- No plaintext snippets, embeddings, or semantic indexes for restricted records.
- Exact-ID retrieval only by default, with authorization before decryption.
- Any future exact-match search must use a separately keyed blind index with documented equality/frequency leakage and narrow field scope.
- Decrypted payloads must not be copied into ordinary chat history, logs, traces, tool diagnostics, or social drafts.
- Daily activity may retain only a redacted opaque vault record ID; never plaintext client or financial detail.
- Tool responses return status and opaque record ID only, not decrypted payload.
- Cross-project access and cross-project record movement are denied.

## 8. Key custody, rotation, and recovery

- KEKs remain outside Neon and the repository, in Render Secret Environment or a future managed KMS.
- No default, demo, deterministic, or silently generated production key.
- Missing/invalid active KEK blocks all restricted reads and writes.
- Key rotation requires versioned KEKs, controlled DEK rewrapping/re-encryption, dual-version read tests, rollback planning, and audited activation.
- Encrypted backups must not include the KEK or recovery secret.
- Key recovery must be tested before production data is stored; loss of the KEK is data loss.
- Synthetic test keys are permitted only in disposable CI and must never be reused in staging or production.

## 9. Required tests

After approval, isolated tests must cover:
- Client and financial payload schema validation and unknown-field rejection.
- Exact user intent and human confirmation; no model-invented or caller-asserted content.
- Missing/invalid KEK fail-closed behavior.
- AES-GCM authentication failure on tampered ciphertext, nonce, tag, or wrapped DEK.
- AAD mismatch for record ID, owner, project, classification, record type, schema version, or envelope version.
- Same-project membership and exact-operation/resource authorization.
- Cross-project read/write denial.
- Generic memory writer cannot insert/read/decrypt RESTRICTED records.
- Vault reader cannot write; vault writer cannot perform unrelated Memory operations.
- Public payload remains NULL for RESTRICTED records.
- No plaintext content or low-entropy unkeyed digest in database rows, logs, or tool results.
- Idempotent retry, payload-digest conflict, and unknown-outcome reconciliation.
- Lifecycle trash/restore cannot mutate encrypted payload or immutable identity.
- KEK rotation, old-key reads, rewrapping, and recovery/rollback.
- Disposable PostgreSQL and synthetic fixtures only.

## 10. Approval checklist

This proposal remains NOT APPROVED until the contract owner explicitly approves:
- Exact client and financial payload schemas and their versions.
- Whether one restricted vault role or separate client/financial reader/writer roles are required.
- Exact operation names, permissions, resource formats, and RLS policy structure.
- Source-reference relationship and provenance rules.
- Retention, archival, deletion, export, and correction semantics.
- User confirmation UX and the boundary for externally sourced records.
- Key custody, recovery, rotation, and backup procedures.
- The precise allowed metadata visible to the database, search, logs, and tools.

Approval must identify this exact document ID and revision. Approval does not itself authorize KEK provisioning, migration, production data writes, runtime activation, merge, or deployment.

## 11. Current implementation disposition

Until formal approval and implementation:
- Envelope encryption primitives remain available but no restricted vault writer is claimed.
- `client_vault_record` and `financial_vault_record` remain schema-supported but end-to-end write-incomplete.
- Generic `memory.write` does not gain RESTRICTED access.
- No vault keys are provisioned or changed.
- No client or financial data has been written to HFM.
- HFM v0.2 remains incomplete; no v0.3 work is started.
