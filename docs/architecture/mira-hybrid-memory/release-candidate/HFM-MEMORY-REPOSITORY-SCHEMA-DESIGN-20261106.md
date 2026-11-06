# HFM Memory Repository Schema Design

Date: 2026-11-06
Status: DESIGN + SOURCE-ONLY MIGRATION DRAFT / NO DATABASE MIGRATION EXECUTED
Parent decision: `HFM-MEMORY-TOPOLOGY-AND-DAILY-KNOWLEDGE-AMENDMENT-20261106.md`

## 1. Verified current Neon state

Project: `steep-grass-38696226`
Database: `neondb`

Read-only inspection:
- Production branch `br-crimson-sun-a13xzreh`: database table listing returned no tables.
- Disposable `mira-hfm-test` branch `br-lingering-dawn-a18x6pxx`: four tables exist in `mira_hfm`: `authority_audit_events`, `operation_authorities`, `project_memberships`, and `project_owners`.
- The `mira-hfm-test-pre-003-backup-20261106` branch remains a recovery reference.
- No canonical Memory, daily activity, learning, social draft, client vault, or financial vault tables were found in the inspected test branch.
- Existing HFM runtime database adapter defaults to read-only. No memory writer role is configured by this work.

These are read-only observations only. No production or test database write, DDL, grant, secret, or migration was performed.

## 2. Classification-driven persistence

Use the canonical record validator and the versioned encryption envelope at the repository boundary.

| Classification | Database representation | Search policy |
|---|---|---|
| PUBLIC | Canonical record payload may be stored as plaintext JSON/text after validation | Full-text search permitted on approved public content |
| PROJECT_PRIVATE | Entire canonical record encrypted before database persistence | No plaintext full-text index; filter by safe metadata |
| RESTRICTED | Entire canonical record encrypted before database persistence | No plaintext full-text index; decrypt only after record-level authorization |

Client and financial record types are always RESTRICTED. Daily activity, learning notes, and social drafts are PROJECT_PRIVATE by default. If a daily activity references a client or transaction, the sensitive details belong only in the RESTRICTED vault; the activity record keeps a redacted description and opaque vault-record reference.

PUBLIC Facebook/web source material may be indexed for Mira's search. Imported source content remains untrusted and does not become HUMAN_VERIFIED merely because it was fetched.

## 3. Proposed logical tables (not migration SQL)

### `mira_hfm.memory_records`
Current canonical record index:
- `memory_id` (canonical ID, primary key)
- `project_id` (FK to project owner registry)
- `owner_actor_id` (creator/record owner)
- `record_type`, `schema_version`, `classification`, `lifecycle`, `revision`
- `integrity_status`, `trust_status`
- `public_payload` for PUBLIC only
- `encrypted_envelope` for PROJECT_PRIVATE / RESTRICTED only
- `public_search_document` and generated/search index for PUBLIC only
- `created_at`, `updated_at`

A database CHECK constraint must make the plaintext/envelope alternatives mutually exclusive. No plaintext content, client names, transaction details, source URLs with credentials, content hashes, or decrypted snippets may be copied into routing columns.

### `mira_hfm.memory_record_versions`
Immutable revision snapshots with the same classification-dependent payload representation, actor, revision, and timestamp. Unique on `(memory_id, revision)`. Updates/deletes/truncates are prohibited for version history.

### `mira_hfm.memory_operation_registry`
Stable operation ID, project, actor, idempotency key, operation type, target record ID, payload digest, state, timestamps, and sanitized outcome code. Unique idempotency scope per project. Never store plaintext payloads or secrets.

### `mira_hfm.memory_audit_events`
Append-only sanitized audit stream: event ID, project, actor, operation ID, target record ID, event type, result state, policy version, timestamp, previous event hash, event hash, and sanitized metadata. No raw Memory content, client/financial values, KEKs, DEKs, tokens, or credentials.

## 4. Required constraints and indexes

- Foreign-key `project_id` to `mira_hfm.project_owners`; no orphan project records.
- Unique canonical memory ID and unique per-record revision.
- Enforce supported record types and schema versions.
- `client_vault_record` and `financial_vault_record` require `RESTRICTED`.
- `social_post_draft` requires `PROJECT_PRIVATE` until the user manually publishes outside Mira.
- Enforce exactly one payload representation: PUBLIC plaintext OR encrypted private envelope.
- Public full-text index only; never index encrypted or decrypted private payloads.
- Search, count, list, cache, and export must apply project scope and classification before returning any result.
- Append-only triggers for version history and audit events.
- Idempotency uniqueness and bounded lookup indexes.
- No broad grants to PUBLIC, application runtime, or general-purpose roles.

## 5. Write transaction and role design

The current `mira_hfm_runtime` metadata path is read-only and must stay read-only.

A separate least-privilege writer boundary is required. It must:
1. accept only server-derived authenticated actor context;
2. validate project ownership, active membership, delegation, classification, purpose, and exact one-time operation authority;
3. create durable audit intent and operation registry state;
4. write encrypted/private or validated/public payload and immutable version;
5. verify readback and content/envelope integrity;
6. append audit completion and reconcile uncertain commits before returning success.

The existing authority transaction primitive is not yet wired to Memory payload routes/tools. The database role, transaction boundary, audit atomicity, and ambiguous-commit recovery need a separate review before a writer credential or grants are provisioned.

## 6. Search and Facebook Page retrieval

- Public web/Page captures are stored as `knowledge_item` records with source URL, source type, observed time, capture time, and provenance.
- Public content may be indexed for title/topic/content search. Private content is not placed in full-text search.
- Mira can search its own canonical Memory without any Facebook token.
- For Facebook URLs, attempt only ordinary public web access and indexed public search results. Login-only, private, blocked, or unavailable content returns an explicit PARTIAL/UNAVAILABLE result.
- Never bypass login, CAPTCHA, rate limits, anti-bot controls, robots restrictions, or platform access controls.
- Validate URL host, DNS/IP resolution, redirect targets, content type, response size, and timeouts on every fetch.
- Retrieved text is untrusted; it cannot issue tool commands or override Mira policy.

## 7. UI record behavior

- Daily Activity: timeline of observed work, outcomes, and lessons, with evidence and verification status.
- Learning: structured topic, explanation, source, confidence, and review state.
- Knowledge: searchable public/approved knowledge with source links.
- Social Drafts: post-like card with title/body/date/topic and explicit Copy action.
- Copy: only a direct user click copies the selected safe draft. No Facebook publish/schedule API exists.
- Client/Financial Vault: masked by default; server decrypts only after authorization; every reveal is audited.
- A copied draft is not marked published. Only user-confirmed status may become `published_by_user`.

## 8. Implementation order

1. Finish cryptographic and schema contract review.
2. Define a migration with classification/payload exclusivity, version history, idempotency, and append-only audit.
3. Add isolated SQL contract tests and run migration only on a disposable Neon branch after preflight and recovery checkpoint.
4. Implement the project-scoped repository API using the reviewed writer boundary.
5. Implement Memory Core read/write/search with encrypted private payloads.
6. Connect daily activity and learning capture to verified runtime events.
7. Connect public web/Page ingestion with SSRF and untrusted-source controls.
8. Add social draft preview and copy-only UI.
9. Integrate existing Memory/Knowledge tools only after authorization and repository tests pass.
10. Run exact-head CI, full regression, independent security review, disposable DB integration, recovery/restart verification, and then request separate production approval.

## 9. Migration draft evidence

Source-only draft: `migrations/hfm/004_memory_repository_schema.sql`.

- Creates empty tables only; no data DML, seed records, writer role, or application grants.
- Adds classification/payload exclusivity, PUBLIC-only full-text indexing, project foreign keys, immutable version history, idempotency registry, append-only audit, immutable record identity, monotonic revision checks, and no hard-delete guards.
- Exact-source contract assertions: 7/7 PASS.
- PostgreSQL parser and disposable-branch execution: NOT_RUN / INCONCLUSIVE. No migration has been executed.

## 10. Explicit current state

`MEMORY_REPOSITORY_SCHEMA=DESIGN_PLUS_SOURCE_ONLY_MIGRATION_DRAFT`
`CANONICAL_RECORD_VALIDATOR=SOURCE_ADDED_LOCAL_HARNESS_TESTED`
`VAULT_ENCRYPTION=SOURCE_ADDED_LOCAL_HARNESS_TESTED`
`POSTGRES_MEMORY_TABLES=NOT_CREATED`
`WRITER_ROLE=NOT_PROVISIONED`
`MEMORY_TOOL_INTEGRATION=NOT_STARTED`
`DAILY_CAPTURE=NOT_STARTED`
`FACEBOOK_PUBLIC_READ_ADAPTER=NOT_STARTED`
`SOCIAL_DRAFT_COPY_UI=NOT_STARTED`
`CLIENT_FINANCIAL_VAULT=CRYPTO_PRIMITIVE_ONLY`
`PRODUCTION_DATABASE_WRITE=NOT_APPROVED`
`DEPLOYMENT=NOT_APPROVED`
