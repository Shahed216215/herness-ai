# MIRA HFM v0.2 — Restricted Client and Financial Vault Writer Decision

**Decision ID:** HFM-VAULT-WRITER-2026-11-07-01  
**Scope:** Authorized creation of client_vault_record and financial_vault_record  
**Canonical schema:** v1.1.0  
**Status:** Implementation decision for the HFM v0.2 integration branch

## 1. Record families

Two separate tools create canonical restricted records:

- client_vault_save → client_vault_record
- financial_vault_save → financial_vault_record

Payloads are strict JSON objects with field allowlists. Unknown fields and credential-like field names are rejected. Every leaf value must be present in the current user message; the writer does not infer, enrich, or fabricate record values.

## 2. Data minimization

Client records may contain bounded client identity/contact fields, service scope, contract/project references, status, and notes. Financial records may contain transaction/invoice references, counterparty, amount/currency, dates, category, status, payment method, and accountLast4.

The writer rejects passwords, secrets, tokens, API keys, private keys, authorization material, cookies, sessions, OTP, PIN, CVV/CVC, full card/account/routing numbers, IBAN/SWIFT, government IDs, passport/tax IDs, recovery codes, and credential-bearing URLs. Financial paymentMethod may identify a method such as card or mobile_money, but no full payment credential is stored.

## 3. Canonical state and encryption

Both record families use:

- schemaVersion=1.1.0
- classification=RESTRICTED
- trust=SOURCE_RECORDED
- lifecycle=PENDING_REVIEW
- integrity=VERIFIED for the canonical metadata payload
- searchEligible=false

The existing vault crypto layer encrypts the payload before persistence. public_payload must remain NULL and encrypted_envelope must be present. Immutable record version and audit events are written in the same canonical repository transaction.

## 4. Separate authorization

Restricted writes do not reuse ordinary memory.write. They require:

- operation=memory.vault.write;
- exact resource memory:<record-id>;
- purpose prefix hfm-vault:;
- explicit client-vault or financial-vault save intent;
- verified admin session and server-held project binding;
- active membership with memory.vault.write in its operation permissions;
- a short-lived, single-use authority that is consumed in the same transaction;
- matching RLS checks on memory_records, memory_record_versions, operation registry, and audit trail.

The initial-project bootstrap grants this permission to the initial owner for newly bootstrapped projects. Existing project memberships are not silently changed; until separately approved, they fail closed.

## 5. Lifecycle boundary

Creation is PENDING_REVIEW/SOURCE_RECORDED. The writer does not promote trust, expose vault contents through normal search, or add a read/export/delete API. Restricted read and human-review decision workflows remain separate work.

Migration 018 changes source SQL only. It must be validated in disposable PostgreSQL CI and must not be applied to production without explicit approval. No production secret, membership, deployment, or live record is changed by this implementation.
