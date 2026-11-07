# MIRA HFM v0.2 — Source Reference Record Contract Proposal

**Document ID:** HFM-SRC-2026-11-07-01  
**Date:** 2026-11-07  
**Status:** PROPOSED / NOT APPROVED / NOT IMPLEMENTED  
**Architecture authority:** User-approved HFM Memory Topology & Daily Knowledge Amendment (2026-11-06)  
**Current schema baseline:** Canonical record schema v1.1.0  
**Proposed schema target:** v1.2.0 additive revision, subject to approval  
**Release boundary:** HFM v0.2 only

> The approved topology amendment lists `source_reference` as the seventh domain record family, but its v1.1.0 schema-compatibility section and the implemented v1.1.0 validator omit a `source_reference` record type. This proposal resolves the gap for review only. It does not authorize schema changes, migrations, production writes, credentials, or deployment.

## 1. Purpose and contract mismatch

The approved topology amendment defines `source_reference` as a distinct domain family containing public URL, source type, retrieval timestamp, access result, content hash, and provenance metadata. The implemented v1.1.0 canonical validator currently accepts six extended record types and models provenance only as the nested `source` object:

- `daily_activity`
- `learning_note`
- `knowledge_item`
- `social_post_draft`
- `client_vault_record`
- `financial_vault_record`

The nested `source` object is not a complete implementation of the approved `source_reference` family. Conversely, adding a record type without defining the link between a source reference and the records that cite it would create disconnected provenance data.

## 2. Proposed schema versioning

Do not silently add `source_reference` to v1.1.0 after that schema version has been consumed by current HFM v0.2 code and tests.

This proposal recommends a separately versioned additive schema revision, target `1.2.0`, that:
- preserves v1.0.0 and v1.1.0 validation and round-trip behavior unchanged;
- adds `source_reference` as a supported record type;
- defines an explicit, bounded link from Knowledge/Learning and other eligible records to one or more source-reference IDs;
- rejects unsupported future schema versions and malformed links;
- includes migration, retrieval, authorization, and compatibility tests.

The final schema version must be selected by the contract owner. If v1.1.0 is formally declared unreleased and mutable, a different version decision may be considered, but it must be explicit and recorded.

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

## 4. Linking source references to other records

The current v1.1.0 nested `source` object contains `sourceType`, `sourceId`, `sourceUrl`, and `observedAt`. The proposed v1.2.0 contract adds an optional bounded `sourceReferenceIds` array to the nested source object.

Rules:
- Each referenced ID must resolve to an existing `source_reference` record in the same project.
- Cross-project links are denied by default.
- A Knowledge/Learning record may cite multiple references; duplicates are rejected and a bounded maximum is required.
- A `source_reference` record may not recursively cite itself.
- Updating or quarantining a source reference must not silently rewrite dependent Knowledge/Learning records.
- Deleting or archiving a source reference must preserve lineage evidence or leave an explicit unresolved reference state.
- The nested `sourceUrl` remains a compact display/cache hint, not the authority for provenance. The canonical source-reference record is the provenance object.

The exact array name, maximum cardinality, and dependency behavior require approval.

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
- the schema version and exact payload schema;
- the nested source link field name/cardinality and dependency behavior;
- source type and access-result enums;
- trust/lifecycle behavior for unavailable, partial, blocked, and quarantined sources;
- classification defaults and encryption/HMAC requirements;
- the operation names, resource binding, RLS roles, and audit topology;
- retention, archival, and deletion semantics for source references and dependent records.

Approval must identify this exact document ID and revision. Approval does not itself authorize migration, grants, credentials, production writes, runtime activation, merge, or deployment.

## 11. Current implementation disposition

Until formal approval and implementation:
- The v1.1.0 nested `source` object remains the only implemented provenance structure.
- No `source_reference` canonical record type is claimed.
- No source-reference writer, list/read API, or lifecycle manager is claimed.
- The approved seven-family architecture remains incompletely implemented at this boundary.
- HFM v0.2 remains incomplete; no v0.3 work is started.
