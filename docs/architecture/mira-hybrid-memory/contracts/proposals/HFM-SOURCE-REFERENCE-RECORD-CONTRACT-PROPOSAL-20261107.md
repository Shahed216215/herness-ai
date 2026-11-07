# MIRA HFM v0.2 — Source Reference Domain Contract Proposal

**Document ID:** HFM-SRC-2026-11-07-01  
**Date:** 2026-11-07  
**Status:** PROPOSED / NOT APPROVED / NOT IMPLEMENTED  
**Architecture authority:** User-approved HFM Memory Topology & Daily Knowledge Amendment (2026-11-06)  
**Current schema baseline:** Canonical record schema v1.1.0  
**Representation:** unresolved; normalized domain entity recommended, canonical record type is an alternative  
**Release boundary:** HFM v0.2 only

> The approved topology amendment lists `source_reference` as the seventh domain record family, but its v1.1.0 schema-compatibility section and the implemented v1.1.0 validator omit a `source_reference` record type. This proposal resolves the gap for review only. It does not authorize schema changes, migrations, production writes, credentials, or deployment.

## 1. Purpose and contract mismatch

The approved topology amendment defines `source_reference` as a distinct domain family containing public URL, source type, retrieval timestamp, access result, content hash, and provenance metadata. It also explicitly distinguishes domain-level families from permission to send unsupported values to the canonical `recordType` validator. Its v1.1.0 compatibility section adds six canonical record types and does not add `source_reference` as a seventh `recordType`:

- `daily_activity`
- `learning_note`
- `knowledge_item`
- `social_post_draft`
- `client_vault_record`
- `financial_vault_record`

The implemented v1.1.0 validator therefore correctly rejects `recordType: source_reference`. The unresolved question is how the approved domain family is represented: a normalized relational entity/table linked to canonical records, or a separately versioned canonical record type. The current nested `source` object is provenance metadata, but it is not by itself a complete source-reference registry with independent identity, lifecycle, access result, and links.

## 2. Representation options and recommendation

Do not silently add `source_reference` to v1.1.0. The approved amendment calls it a domain-level family and the v1.1.0 schema section deliberately enumerates only six `recordType` values.

Two representations are possible:

**Option A — normalized domain entity (recommended for approval):**
- Add a dedicated project-scoped `source_references` relational entity/table with its own immutable ID, provenance, access result, integrity/trust/lifecycle, classification, and policy version.
- Add a bounded same-project relation table such as `memory_source_references` to link a canonical Memory record to one or more source-reference IDs.
- Keep v1.0.0 and v1.1.0 canonical record validation unchanged; the nested `source` object remains a compact origin hint.
- Apply dedicated RLS, least-privilege reader/writer grants, append-only audit, retention, and exact-resource operation authorization to the new entity and link table.

**Option B — canonical record type:**
- Introduce `source_reference` only through a separately versioned additive canonical schema revision (likely v1.2.0 if v1.1.0 is frozen).
- Define the complete canonical envelope, payload, link semantics, retrieval behavior, and backward-compatibility rules.
- Do not use this option unless the contract owner explicitly chooses to represent the domain family as a canonical Memory record.

The recommended normalized entity preserves the approved domain-family distinction without silently changing the v1.1.0 record-type vocabulary. The final choice and versioning must be explicit and recorded.

## 3. Proposed source-reference payload

The canonical envelope remains the outer HFM record. The `content` field of a `source_reference` record contains a canonical JSON string validated against a dedicated source-reference payload schema.

Proposed payload:

| Field | Requirement | Meaning |
|---|---|---|
| `referenceVersion` | Required | Source-reference payload schema version |
| `sourceType` | Required enum | `web`, `facebook_page`, `facebook_group`, `manual`, `internal_system`, `legacy_import`, or separately approved provider |
| `canonicalUrl` | Optional | Sanitized canonical public URL; HTTPS only for public web retrieval |
| `sourceId` | Required | Stable opaque source identifier; no access token or private credential |
| `retrievedAt` | Required RFC3339 | Time the source was actually checked or imported |
| `accessResult` | Required enum | `AVAILABLE`, `PARTIAL`, `UNAVAILABLE`, `AUTH_REQUIRED`, `BLOCKED`, `HTTP_ERROR`, `USER_SUPPLIED`, `NOT_FETCHED` |
| `contentHash` | Conditional | SHA-256 for approved public content, or keyed digest for private/restricted content where separately approved |
| `contentType` | Optional | Sanitized media type |
| `contentLength` | Optional | Bounded byte count, not source content |
| `retrievalMethod` | Required | `public_web_search`, `public_http_fetch`, `user_supplied_url`, `manual_import`, or approved internal source |
| `retrievalTool` | Optional | Tool/provider name and bounded version identifier |
| `provenanceActor` | Required | Server-derived canonical actor or internal service identity |
| `provenanceEventId` | Required | Immutable capture/retrieval event reference |
| `policyVersion` | Required | Policy under which the source was accessed |
| `notes` | Optional | Short sanitized access note; no raw response headers or private content |

Unknown critical fields or enum values must fail validation. URLs must be normalized and secrets, credentials, query tokens, fragments, cookies, authorization headers, and session data must never be stored in this record.

## 4. Linking source references to canonical records

Under the recommended normalized-entity option, use an explicit relation table rather than trusting a caller-supplied ID array:
- Each link binds `project_id`, canonical `memory_id`, and `source_reference_id`.
- Both parent records must belong to the same project; cross-project links are denied by database constraints and RLS.
- A Knowledge/Learning record may cite multiple references; duplicate links are rejected and a bounded maximum is required.
- A source reference may not link to itself or form invalid recursive provenance chains.
- Updating or quarantining a source reference must not silently rewrite dependent Knowledge/Learning records.
- Deleting or archiving a source reference must preserve lineage evidence or leave an explicit unresolved reference state.
- The nested v1.1.0 `source` object remains a compact origin hint; it is not treated as the authoritative registry.
- If Option B is chosen, the contract must instead define the exact bounded link field and compatibility behavior in the new schema version.

The exact relation name, cardinality, and dependency behavior require approval.

## 5. Trust and lifecycle semantics

A source reference is provenance metadata, not verified knowledge.

Proposed trust progression:
- `SOURCE_RECORDED`: URL/identifier was supplied or captured, but no access result is verified.
- `SOURCE_REACHABLE`: the source was actually reached through an approved method; this does not prove its content is accurate.
- `CONTENT_VERIFIED`: the retrieved content's bounded representation and content digest were checked against the recorded capture.
- `HUMAN_VERIFIED`: a human explicitly reviewed the reference and the associated claim/content under the separate human-review contract.
- `QUARANTINED`: integrity, policy, provenance, or safety checks failed.

Rules:
- No automatic trust elevation based only on URL reachability, HTTP status, search snippets, or matching hashes.
- `accessResult` records availability; trust records evidence quality. They are not interchangeable.
- An unavailable source may remain an active historical reference with `accessResult=UNAVAILABLE`; availability failure alone does not require deletion.
- `AUTH_REQUIRED` or `BLOCKED` must not trigger login bypass, scraping of private content, or alternate credential use.
- Source text and metadata are untrusted input and never system/developer instructions.

## 6. Classification and privacy

Proposed defaults:
- Public, unauthenticated source metadata may be `PUBLIC` only after URL sanitization and policy checks.
- User-supplied or project-specific capture metadata is at least `PROJECT_PRIVATE`.
- Private-group metadata, client records, account identifiers, personal data, or sensitive provenance is `RESTRICTED` and requires application-level encryption.
- Never store private page content, cookies, access tokens, passwords, API secrets, private message text, or non-public personal information without a separately approved lawful basis and access contract.
- Do not store low-entropy plaintext hashes for private content. If a private-content integrity digest is needed, use a separately keyed HMAC with documented key custody and equality-leakage analysis.
- Source-reference payloads must be excluded from public social drafts unless the source is public and a separate sensitive-content check passes.

## 7. Authorization and operation model

A source reference is project-scoped by default. Reads, writes, list, count, export, and lifecycle operations require the same server-derived actor/project membership and exact resource checks as other canonical Memory records.

This proposal recommends a distinct operation `source_reference.write` for creation/update and `source_reference.read` for retrieval rather than relying on generic `memory.write` purpose strings. If the contract owner prefers reuse of `memory.read/write`, the exact purpose/resource binding and audit semantics must be approved and tested.

Required controls:
- One-time, exact-resource authorization; no standing write authority.
- No caller-supplied actor/project/role authority.
- No runtime reader role write privileges.
- No broad database owner, superuser, or BYPASSRLS identity.
- Immutable source identity and retrieval-event provenance.
- Idempotent capture keyed by project, source identity, retrieval event, and canonical payload digest.
- Unknown write outcomes reconciled using the original operation identity.

## 8. Retrieval and use boundaries

A `source_reference` record:
- may be returned as provenance metadata when the caller is authorized to read the dependent Knowledge/Learning record;
- must not be ranked as a standalone Knowledge item or used as a trusted factual answer by itself;
- must not expose private source content in snippets, logs, counts, analytics, or social drafts;
- must preserve `PARTIAL`, `UNAVAILABLE`, `AUTH_REQUIRED`, and `BLOCKED` states to downstream consumers;
- must not cause a retrieval system to treat search-engine snippets as complete source content.

A Knowledge/Learning record's trust remains independent. A `HUMAN_VERIFIED` source reference does not automatically promote every dependent record.

## 9. Required tests

After approval, isolated tests must cover:
- v1.0.0 and v1.1.0 backward compatibility and round-trip.
- v1.2.0 `source_reference` validation and canonical serialization.
- Unknown fields, invalid enums, invalid URL schemes, credential-bearing URLs, and overlong values.
- Same-project link resolution and cross-project link denial.
- Missing, duplicate, self-referential, stale, and quarantined reference handling.
- Trust-state progression and no automatic promotion from reachability.
- Public/private/restricted classification and encryption at rest.
- Hash/HMAC selection and no plaintext low-entropy digest leakage.
- Retrieval of a dependent Knowledge record returns only authorized provenance metadata.
- Source unavailable/partial/auth-required states remain explicit.
- Idempotent retry and payload-digest conflict handling.
- No Facebook login bypass, private group scraping, API write, or Google Drive fallback.
- Disposable PostgreSQL and synthetic fixtures only; no production data or credentials.

## 10. Approval checklist

This proposal remains NOT APPROVED until the contract owner explicitly decides:
- whether `source_reference` is a distinct canonical record type (recommended to match the approved topology amendment);
- the normalized entity-vs-canonical-record representation and exact payload schema;
- the link-table or nested source link name/cardinality and dependency behavior;
- source type and access-result enums;
- trust/lifecycle behavior for unavailable, partial, blocked, and quarantined sources;
- classification defaults and encryption/HMAC requirements;
- the operation names, resource binding, RLS roles, and audit topology;
- retention, archival, and deletion semantics for source references and dependent records.

Approval must identify this exact document ID and revision. Approval does not itself authorize migration, grants, credentials, production writes, runtime activation, merge, or deployment.

## 11. Current implementation disposition

Until formal approval and implementation:
- The v1.1.0 nested `source` object remains the only implemented provenance metadata; no independent source-reference registry or canonical record type exists.
- No `source_reference` canonical record type is claimed.
- No source-reference writer, list/read API, or lifecycle manager is claimed.
- The approved seven-family architecture remains incompletely implemented at this boundary.
- HFM v0.2 remains incomplete; no v0.3 work is started.
