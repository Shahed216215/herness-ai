# Mira HFM v0.2 — Knowledge and Learning Search Contract

Status: IMPLEMENTED WITH REVIEW-LIFECYCLE LIMITATION
Scope: HFM v0.2 only
Date: 2026-11-07

## Canonical record types

- `knowledge_item`: user-authored facts and saved knowledge records.
- `learning_note`: user-requested learning material. The save path records it as a canonical HFM item.

Both record types use the same project-scoped canonical repository and the standing-read authorization boundary. Phone-local JSON and Google Drive are not read fallbacks in HFM mode.

## Save and trust lifecycle

- A personal memory save is `HUMAN_VERIFIED / ACTIVE` only when the current user message explicitly asks Mira to remember the user-authored content.
- A knowledge source or learning note is saved as `SOURCE_RECORDED / PENDING_REVIEW`.
- Pending records are returned only by the explicit one-time review queue. They are not eligible for ordinary trusted search or Work Learning transfer.
- Search accepts only records that pass canonical schema validation, project/access checks, active lifecycle, verified integrity, trusted-state checks, and per-record host authorization.
- An active `learning_note` becomes searchable only after its trust and lifecycle state have been legitimately verified through an approved human-review process.

## Retrieval behavior

- `knowledge_search` reads both `knowledge_item` and `learning_note` under standing read authority.
- Search results label the record type as Knowledge or Learning.
- The Work Learning transfer adapter remains narrower: it accepts only structured `legacy_import` records in the `work_learning` domain. A generic learning note is never converted into executable task instructions.
- No local or Drive fallback is permitted when HFM mode is active.

## Explicit limitation / gate

The current review queue is read-only and reports that promotion is unsupported. The repository's ordinary `memory.update` revision path preserves lifecycle and does not itself establish a human verification decision. Therefore this implementation does not promote `PENDING_REVIEW` records, change their trust status, or activate them.

A future verification transition requires a separately specified and approved authorization contract, including an explicit per-record human decision, audit event, allowed trust transition, lifecycle transition, idempotency, and database role/RLS enforcement. Until that contract exists, pending knowledge and learning records remain excluded from trusted search.

## Verification boundary

Automated tests use synthetic records and injected readers. They do not connect to production Neon, write production rows, alter credentials, or enable HFM write/read flags. Production readiness and deployment remain separate gates.
