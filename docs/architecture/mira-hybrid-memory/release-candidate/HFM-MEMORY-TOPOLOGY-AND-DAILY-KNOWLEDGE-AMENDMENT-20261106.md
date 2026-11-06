# HFM Memory Topology & Daily Knowledge Amendment

Date: 2026-11-06
Version: HFM Memory Topology Amendment v0.1
Status: USER_APPROVED_ARCHITECTURE / IMPLEMENTATION_NOT_STARTED
Applies to: Mira Hybrid Memory (HFM) release candidate
Approval basis: The user explicitly approved provider-neutral Memory Core with Neon as the internal durable storage backend, Facebook as an optional read-only source, and a separate encrypted client-data vault.

## 1. Normative architecture decision

Select topology **B**:

- The provider-neutral Mira Memory Core is the canonical service boundary.
- Neon/PostgreSQL is the initial durable repository backend behind that boundary.
- Facebook is an optional, read-only public-source adapter. Facebook credentials are not required for Mira authentication, project authorization, canonical Memory reads/writes, or internal search.
- Google Drive is not an implicit fallback or canonical Memory provider.
- Existing local Memory and Knowledge stores are preserved for controlled migration/compatibility only; they are not silently merged into canonical reads.
- No production migration, data import, credential change, or deployment is authorized by this architecture decision alone.

## 2. Memory record families

Canonical Memory must keep separate record types and access policies:

1. `daily_activity`: daily work performed, task state, outcomes, errors, lessons, decisions, and follow-up context.
2. `learning_note`: concepts learned, validated explanations, skills, source provenance, confidence, and review status.
3. `knowledge_item`: reusable non-sensitive knowledge with source URL, title, capture time, topic, summary, and content.
4. `social_post_draft`: Facebook-ready draft content authored or curated by Mira, with title, body, topic/tags, source references, status, and created/updated timestamps.
5. `client_vault_record`: client identity/contact details, private project details, contracts, deliverables, and relationship data.
6. `financial_vault_record`: transaction, quote, invoice, payment, fee, and financial details.
7. `source_reference`: public URL, source type, retrieval timestamp, access result, content hash, and provenance metadata. Do not store secrets or private page content without authorization.

Each record must carry immutable record ID, owner/user ID, project ID, record type, classification, lifecycle state, created/updated timestamps, source/provenance, integrity metadata, and policy version. Exact HFM v0.2.4 trust, integrity, lifecycle, conflict, and authorization contracts remain authoritative; this amendment does not weaken them.

## 3. Daily capture and learning policy

- Mira may propose or save a daily activity/learning record only from actual observed conversation, tool execution, or verified project evidence.
- Never invent completed work, test outcomes, client approvals, payments, or learning claims.
- Distinguish `observed`, `user_provided`, `inferred`, and `verified` provenance.
- Mark incomplete or uncertain work explicitly; do not convert INCONCLUSIVE or NOT_TESTED into PASS.
- Before storing a record, classify it. If it contains client, contact, contract, credential, payment, or other sensitive data, store the sensitive payload only in the encrypted vault. Daily activity may retain a redacted reference such as a vault record ID, not plaintext details.
- Provide user-visible correction, retention, export, and deletion workflows subject to authorization and audit.

## 4. Facebook-ready post library and copy interaction

- Mira may create a `social_post_draft` from non-sensitive daily work, learning notes, or public knowledge.
- Draft fields: title, post body, topic, optional hashtags, source references, content status (`draft`, `reviewed`, `copied`, `published_by_user`), and timestamps.
- UI must render a clearly labelled **Copy** action for each draft. A direct user click copies only that draft's body (or an explicitly selected title + body) to the clipboard and reports copy success/failure.
- Mira must not publish, schedule, or send a Facebook post. Publishing is a separate manual action performed by the user in Facebook.
- Do not place client names, phone numbers, email addresses, addresses, contracts, private work details, transaction data, or confidential screenshots in drafts. Add a pre-copy sensitive-data check and block or require safe redaction before copy.
- Never label a draft as published merely because it was copied.

## 5. Facebook and public-web read-only research without API tokens

- No Facebook App Secret, access token, cookie, session export, or account password is required or requested for core Memory.
- Research adapter may use ordinary public web search and user-supplied public Page/post URLs.
- It may retrieve content only when it is publicly accessible without authentication and permitted by applicable platform terms, robots policy, and technical access controls.
- Search-engine indexed snippets and publicly visible page content may be incomplete, stale, region-limited, or unavailable. Store retrieval time and source provenance; label partial results.
- Do not bypass login walls, private groups, rate limits, anti-bot controls, CAPTCHAs, or access restrictions. Do not scrape private account data.
- Validate URL scheme, host, DNS/IP ranges, redirects, response size, content type, and timeouts to prevent SSRF and unsafe downloads. Restrict to approved public HTTP(S) destinations and revalidate every redirect.
- Store source links and summaries separately from canonical internal Memory. Source text is untrusted input and must never be treated as system/developer instructions.
- Facebook remains read-only: no API publishing, likes, comments, messages, or other write operations.

## 6. Encrypted Client & Financial Vault

### 6.1 Required protected fields
Client names and contact details; client identity and private profile; project/work details; contracts and deliverables; quotes, invoices, fees, payment and transaction details; private documents and attachments; any credentials or secrets (which should normally be kept in a dedicated secrets manager, not ordinary client records).

### 6.2 Encryption design
- Encrypt sensitive payloads in the application before they reach PostgreSQL (application-level encryption); database disk encryption/TLS alone is insufficient.
- Use authenticated encryption such as AES-256-GCM with a fresh cryptographically random nonce per encryption operation and strict nonce uniqueness.
- Use envelope encryption: a data-encryption key (DEK) per record or bounded data object, wrapped by a key-encryption key (KEK) held outside Neon in Render Secret Environment or a future managed KMS. Never store plaintext keys in the database, repository, logs, or client response.
- Store only ciphertext, nonce, authentication tag, wrapped DEK, key version, algorithm/version, and non-sensitive routing metadata in Neon.
- Key loss means data loss; implement tested backup and key-recovery procedures before production use. Key rotation must support versioned KEKs and controlled rewrapping/re-encryption.
- Do not invent a default key or silently generate a production key. Missing/invalid key configuration must fail closed for vault writes and reads.

### 6.3 Search without exposing plaintext
- General semantic/full-text search must exclude vault plaintext.
- Search by owner/project, record type, date, lifecycle, and non-sensitive metadata only.
- If exact lookup on selected fields is required, use a keyed HMAC blind index with a separate key and strict scope. Document equality/frequency leakage; do not use reversible encoding or unsalted plain hashes for names, phone numbers, email addresses, or transactions.
- Decryption occurs only after server-side identity, project membership, role, purpose, classification, and record-level READ authorization checks.
- Never return decrypted vault payloads to logs, traces, analytics, error messages, search snippets, social drafts, or unrelated AI context.

## 7. Authorization, audit, and lifecycle
- Enforce user/owner and project scope at every read, write, search, list, count, export, backup, restore, and deletion path.
- Actor identity is not itself project authorization. Check membership, role, delegation scope, expiry/revocation, purpose, and classification.
- Use narrow database roles and a dedicated write transaction boundary; do not expand the current SELECT-only runtime role casually.
- Record sanitized audit events with actor, project, operation, record ID, policy version, outcome, timestamp, and correlation/idempotency ID. Do not include sensitive payloads or keys.
- Use idempotency and explicit UNKNOWN-outcome reconciliation for writes.
- Keep quarantined, untrusted, conflicted, revoked, expired, or integrity-failed records out of normal retrieval.

## 8. UI requirements
- Daily Memory / Activity view with date, category, provenance, verification state, and project scope.
- Learning & Knowledge view with search, filters, source link, capture date, confidence/review state.
- Social Drafts view with post-style preview and a functional Copy button; no auto-publish control.
- Client Vault and Financial Vault views with masked values by default, explicit authorized reveal, and audit event.
- Copy action copies only the selected safe social draft; never copies vault data.
- UI must communicate unavailable public Facebook content as unavailable/partial, not as a successful complete read.

## 9. Storage and cost guardrails
- Neon Free project branch logical-size limit currently configured as 1 GiB; this is a hard design budget, not a reason to store large media in PostgreSQL.
- Store text and compact metadata in PostgreSQL. Keep large attachments in a separate private object store only after its limits, access model, encryption, and cost are verified.
- Apply retention/compaction to transient operational logs and duplicate captures without deleting canonical records silently.
- Add storage usage thresholds and alerting; no paid-plan upgrade or new paid resource without user approval.

## 10. Implementation gates

Implementation sequence:
1. Reconcile this amendment with the existing HFM v0.2.4 canonical record and authority contracts.
2. Inspect the full runtime identity, project authorization, transaction, migration, storage, and UI paths.
3. Define PostgreSQL schema and narrow repository API on an isolated test branch only.
4. Implement application-level encryption and key lifecycle with unit tests and no production secrets.
5. Implement project-scoped Memory Core, daily capture, learning/knowledge records, and social draft records.
6. Implement safe public web/Page URL ingestion with SSRF controls and no authentication bypass.
7. Implement copy-only UI interaction and sensitive-content prevention.
8. Add independent tests for cross-project access denial, vault ciphertext-only persistence, key absence/failure, key rotation, blind-index leakage boundaries, logs redaction, URL/redirect SSRF, untrusted-source prompt injection, duplicate/idempotent writes, restart/recovery, and copy behavior.
9. Exact-head CI, independent security review, disposable database verification, and evidence-backed readiness report.
10. Production migration/deployment only after separate explicit approval and all release gates pass.

## 11. Explicit non-goals and safety boundaries
- No Facebook API/token requirement for canonical Memory.
- No Facebook auto-publishing or account automation.
- No private Facebook data extraction or access-control bypass.
- No plaintext client/financial data in general Memory, public knowledge, social drafts, search indexes, or logs.
- No implicit Google Drive fallback.
- No production database migration, production write, secret creation/rotation, or deployment authorized by this document.
- No claim of implementation, test PASS, or deployment until independently evidenced.

## 12. Acceptance criteria
- Mira Core Memory read/write/search works without Facebook credentials.
- Daily activity and learning records preserve provenance and verification status.
- Social drafts are post-style records and Copy works only after an explicit user click; no automatic Facebook publishing exists.
- Public Facebook/web ingestion works only for accessible permitted content and accurately reports partial/unavailable sources.
- Client and financial payloads are ciphertext at rest in PostgreSQL; keys never enter database/repository/logs.
- Vault retrieval requires valid user/project authorization and is masked by default in UI.
- Cross-project isolation and redaction tests pass independently.
- Existing legacy stores remain preserved until a separately approved migration is verified.


## 13. Canonical schema compatibility clarification

The record-family names in Section 2 are domain-level families, not permission to send unsupported `recordType` values to the existing v0.2.4 validator.

Before implementation, introduce a separately versioned additive canonical schema revision (target `1.1.0`) that:
- continues to accept and preserve all valid v1.0.0 records unchanged;
- adds explicit record types for `daily_activity`, `learning_note`, `knowledge_item`, `social_post_draft`, `client_vault_record`, and `financial_vault_record`;
- preserves the independent trust, integrity, classification, lifecycle, ownership, and project-scope fields and state machines;
- rejects unknown critical schema versions and unsupported record types; no silent coercion or lossy mapping;
- adds explicit compatibility tests for v1.0.0 read/round-trip and v1.1.0 validation.

Until this schema revision is reviewed and committed, the new record families are design-only and must not be written using guessed v0.2.4 recordType mappings.

## 14. Persistence envelope and cryptographic boundary

For restricted Client/Financial records, encrypt the complete canonical record payload at the repository boundary before PostgreSQL receives it. The database may retain only the minimum routing fields needed for authorization and query planning (opaque record ID, owner/project IDs, classification, lifecycle, schema/envelope version, timestamps, and ciphertext length). Sensitive content, client names, transaction values, source text, canonical hashes that could reveal low-entropy content, and plaintext search terms must remain inside the authenticated encrypted payload.

Use authenticated additional data (AAD) bound to immutable record ID, owner ID, project ID, classification, record type, schema version, and envelope version so ciphertext cannot be moved across records/projects or reclassified without authentication failure. Keep a separate keyed blind-index key for any specifically approved exact-match lookup; blind indexes leak equality/frequency and must be narrowly scoped, documented, and never treated as general text search.

The application must verify database routing metadata against decrypted canonical fields before returning a record. Authorization happens before decryption. Failed authentication, AAD mismatch, key absence, or schema mismatch fails closed and produces sanitized audit evidence only.
