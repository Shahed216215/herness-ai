# MIRA HFM v0.2 — Daily Activity Provenance Contract Proposal

**Document ID:** HFM-DAILY-ACTIVITY-PROVENANCE-PROPOSAL-20261107  
**Status:** PROPOSED / NOT APPROVED / NOT IMPLEMENTED  
**Authority:** User-approved HFM Memory Topology Amendment v0.1 (2026-11-06)  
**Current schema:** Canonical Memory v1.1.0  
**Release boundary:** HFM v0.2 only

## 1. Problem statement

The approved topology amendment defines `daily_activity` as a record family for daily work performed, task state, outcomes, errors, lessons, decisions, and follow-up context. It further requires Mira to capture only actual observed conversation, tool execution, or verified project evidence, and to distinguish `observed`, `user_provided`, `inferred`, and `verified` provenance.

The current v1.1.0 canonical envelope has only a compact `source` object with `sourceType`, `sourceId`, optional `sourceUrl`, and `observedAt`. It has no explicit provenance-kind field, evidence reference, or evidence digest. The first `daily_activity_save` implementation supports only exact user-authored summaries and uses a manual source marker. It does not yet support independently evidenced tool-execution or project-evidence capture, and it must not claim that those workflows exist.

## 2. Proposed additive provenance object

Keep v1.0.0 and v1.1.0 validation and round-trip behavior unchanged. Subject to approval, introduce a separately versioned additive schema revision (candidate v1.2.0) with an optional, strictly validated `provenance` object:

| Field | Requirement | Purpose |
|---|---|---|
| `kind` | Required enum | `USER_PROVIDED`, `OBSERVED`, `INFERRED`, `VERIFIED` |
| `actorType` | Required enum | `user`, `assistant_runtime`, `tool_runtime`, `project_evidence` |
| `actorId` | Server-derived | Opaque actor/runtime identity; never caller-selected authority |
| `eventId` | Required | Immutable conversation/tool/project event ID |
| `evidenceRef` | Conditional | Authorized reference to the source event or evidence artifact |
| `evidenceDigest` | Conditional | SHA-256 of the exact bounded evidence representation |
| `observedAt` | Required RFC3339 | When the event was actually observed |
| `verifiedAt` | Conditional | When a separate verification step occurred |
| `verificationMethod` | Conditional enum | `human_review`, `tool_result_validation`, `file_integrity_check`, `test_evidence`, or separately approved method |
| `policyVersion` | Required | Capture policy applied |

Unknown keys, unknown enum values, invalid timestamps, caller-supplied actor authority, and mismatched evidence digests must fail validation.

## 3. Provenance semantics

- **USER_PROVIDED:** exact statement supplied by the user. It proves that the user supplied the statement, not that the reported external event independently occurred.
- **OBSERVED:** a bounded conversation or tool event actually present in server-held execution evidence. The model's unsupported summary is not evidence.
- **INFERRED:** an interpretation or conclusion derived from other records. It must remain explicitly labelled and must not be promoted to verified fact by the capture operation.
- **VERIFIED:** evidence was independently checked by an approved verification method. Verification must identify the evidence reference, digest, method, and timestamp.

Provenance kind is not a substitute for the existing trust, integrity, lifecycle, or classification state machines. A verified source event does not automatically verify every statement in a derived summary.

## 4. Capture-source rules

### User-provided conversation

- Capture only the exact user-authored span or a user-confirmed summary.
- Preserve `USER_PROVIDED` provenance.
- Do not rewrite user assertions as observed or verified facts.
- If the record contains sensitive details, reject it from the ordinary daily-activity writer and use only a separately approved encrypted-vault flow.

### Tool execution

- Capture only after the server has a completed tool result and the execution audit records its final status.
- Bind the event to the immutable task ID, tool-call ID, tool name, completion status, and a digest of the bounded result/evidence.
- Never trust model-authored claims such as “tool succeeded” when the server result is failed, missing, or inconclusive.
- Preserve FAIL, INCONCLUSIVE, NOT_TESTED, and REVIEW_REQUIRED without promotion to PASS.
- Do not persist credentials, raw headers, full HTTP bodies, private source content, or unredacted tool output.

### Verified project evidence

- Accept only an existing authorized file/evidence reference and a server-computed digest.
- A source filename or user assertion alone is not evidence of successful tests.
- Link to the existing evidence record; avoid copying entire files or logs into daily activity.
- If the evidence is stale, unavailable, or has a digest mismatch, preserve an explicit unresolved/failed state.

### Inference

- Inferred summaries must be labelled `INFERRED`, include the supporting evidence references, and remain non-authoritative until separately reviewed.
- Inference must never create a claim of completed work, client approval, payment, deployment, or test success without supporting evidence.

## 5. Classification and redaction

- Ordinary daily activity remains `PROJECT_PRIVATE`.
- Credentials, client identity/contact data, contract details, financial identifiers, payment details, and other restricted payloads must never be copied into ordinary daily activity.
- Where a restricted event is relevant, daily activity may contain only a redacted reference to a separately authorized vault record ID; it must not contain plaintext sensitive payload.
- Redaction is defence in depth, not a substitute for classification. Unknown sensitive formats must be rejected or sent to human review rather than assumed safe.
- No private Facebook Group content, API tokens, cookies, session identifiers, or Drive credentials may be captured.

## 6. Runtime and authorization requirements

- A user-provided save requires explicit current-user intent and exact content provenance.
- An observed tool event requires server-held task execution context and a completed, auditable tool result; the model cannot supply its own event ID, actor ID, or evidence digest.
- Verified project evidence requires server-held authorization to the project and evidence artifact.
- All writes use the existing one-time, exact-resource `memory.write` authority and canonical repository.
- No local storage or Google Drive fallback.
- Runtime identity remains a dedicated least-privilege writer; no owner, superuser, or BYPASSRLS identity.
- Retries must be idempotent on the immutable event identity and payload digest.

## 7. Required tests

- v1.0.0 and v1.1.0 compatibility and round-trip.
- v1.2.0 provenance validation and canonical serialization.
- Exact user-provided span preservation and explicit consent.
- Tool result success/failure/inconclusive/missing-state mapping.
- Rejection of model-invented event IDs, actor IDs, evidence references, or digests.
- Evidence digest mismatch and stale evidence rejection.
- Inferred records remain labelled and are never auto-promoted.
- Restricted data classification, redaction, and no plaintext leakage.
- Cross-project evidence reference denial.
- Idempotent retry and duplicate/conflicting event handling.
- Disposable PostgreSQL only; no production writes or credentials.

## 8. Decisions required

The contract owner must approve:
1. Whether the provenance object belongs in the canonical envelope or a normalized event/provenance relation.
2. The schema version and exact field names/enums.
3. Whether tool events are captured automatically after completed execution or only after a user-visible proposal/confirmation.
4. Which tool result fields may be retained and their maximum size.
5. Verification methods and trust-state mapping.
6. Retention, correction, export, and deletion semantics.
7. How restricted-vault references are represented without exposing sensitive data.

Approval must identify this exact document ID and revision. Approval does not authorize production migrations, grants, credentials, deployment, PR merge, or external provider actions.

## 9. Current implementation boundary

The current `daily_activity_save` writer is a narrow user-provided path:
- exact user-authored content only;
- activity-specific explicit save intent;
- common sensitive-value redaction and rejection of recognized vault-only content;
- canonical v1.1.0 `daily_activity` record;
- one-time `memory.write` authorization;
- no automatic tool-execution capture or verified-project-evidence capture.

The broader approved daily-capture policy remains incomplete until the provenance contract is approved and implemented. HFM v0.2 remains NOT COMPLETE.
