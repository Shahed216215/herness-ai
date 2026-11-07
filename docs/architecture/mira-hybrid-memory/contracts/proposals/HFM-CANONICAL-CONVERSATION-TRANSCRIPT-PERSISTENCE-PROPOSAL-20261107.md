# MIRA HFM v0.2 — Canonical Conversation Transcript Persistence Proposal

**Document ID:** HFM-CTP-2026-11-07-01  
**Date:** 2026-11-07  
**Status:** PROPOSED / NOT APPROVED / NOT IMPLEMENTED  
**Normative baseline:** HFM Phase 2 Detailed Technical Contract v0.2.4  
**Current behavior:** HFM-aware transcript adapter fails closed; canonical transcript persistence is not configured  
**Release boundary:** HFM v0.2 only

> This document is a design proposal only. It does not amend the v0.2.4 canonical schema, authorize a new record family, authorize a database migration/write, create credentials, enable a runtime flag, or authorize merge/deployment. Until an exact contract is approved and implemented, HFM-mode transcript persistence must remain explicitly non-persistent with no local or Drive fallback.

## 1. Problem and safety boundary

The current server chat persistence adapter delegates to legacy local Memory when HFM mode is disabled. When any HFM Memory/reader/writer/standing-read/Work Learning mode is enabled, it returns `persisted: false` and `HFM_CANONICAL_TRANSCRIPT_NOT_CONFIGURED`. This prevents a silent local fallback but means the canonical transcript data plane is incomplete.

A transcript is not merely a pair of text strings. It may contain user messages, assistant messages, tool calls, tool results, structured content, attachments/references, errors, turn ordering, timestamps, and conversation-level context. The persistence contract must preserve these distinctions and must not treat tool output or model-generated text as user-authored facts.

## 2. Scope and non-goals

In scope:
- Canonical persistence semantics for conversation and message identity.
- User, assistant, tool-call, tool-result, and system/developer-originated message provenance.
- Ordered append, idempotency, retrieval, authorization, retention, and audit requirements.
- Privacy/classification and redaction boundaries.
- A no-fallback transition from legacy transcript persistence to an approved canonical provider.

Out of scope:
- Enabling transcript writes in production.
- Replaying tools or executing stored tool calls.
- Promoting transcript text into trusted Knowledge or Learning.
- Cross-project sharing, public transcript links, export, backup, restore, or retention deletion implementation.
- Selecting Neon as the canonical payload provider.
- Changing the v0.2.4 record schema without a separately approved versioned amendment.

## 3. Required decisions before implementation

The contract owner must explicitly decide:
1. Whether conversation and message are separate canonical entities or whether the existing `conversation_reference` record type is only a reference to an external transcript object.
2. Whether the existing v0.2.4 canonical record envelope can losslessly represent message structure or requires a versioned schema extension.
3. Which durable provider is authoritative for transcript payloads and which service is the Memory Core.
4. Whether tool payloads, attachment metadata, and multimodal content are persisted, referenced, redacted, or omitted.
5. Retention periods, user deletion semantics, legal hold behavior, and backup expiry.
6. The approved encryption/key custody profile for private transcript payloads.
7. The precise audit topology and recovery behavior for append-only transcript writes.

No implementation may resolve these decisions by inference.

## 4. Proposed logical model (not canonical schema or DDL)

The recommended logical model has two linked entities:

### 4.1 Conversation envelope

A conversation envelope would bind:
- canonical conversation ID;
- owning project ID;
- initiating/owning actor ID;
- creation and last-activity timestamps;
- conversation revision or append sequence;
- classification and retention policy reference;
- lifecycle state;
- schema/profile version.

The conversation envelope must not contain unrestricted transcript plaintext in routing metadata.

### 4.2 Message envelope

Each message would bind:
- canonical message ID;
- canonical conversation ID and project ID;
- monotonic sequence/turn position within the conversation;
- message origin/type (user, assistant, tool call, tool result, system/developer instruction, or approved extension);
- speaker/actor identity where verified and applicable;
- tool name and call ID where applicable;
- parent/causal message or tool-call reference;
- created timestamp;
- content representation/profile version;
- classification;
- integrity and provenance evidence;
- append operation identity and audit reference.

This is a logical proposal only. The final contract must define exact fields, bounds, canonical serialization, ID generation, uniqueness, and whether any of these fields are represented in the existing envelope or a new schema version.

## 5. Message provenance and trust

Message origin is not equivalent to trust:
- A user message is attributable to the authenticated conversation actor only when the server has verified that binding.
- An assistant message is model output, not a human-authored fact.
- A tool call is an assistant-requested action descriptor, not proof the action occurred.
- A tool result is untrusted tool output until validated against the tool/provider's response and policy.
- System/developer instructions are control-plane data and must not be exposed as ordinary user transcript content.
- Imported or externally supplied content remains untrusted and retains its source provenance.

Transcript persistence MUST NOT automatically create `HUMAN_VERIFIED` Knowledge or `learning_note` records. Any extraction/consolidation into Knowledge is a separate operation requiring explicit user intent, canonical record validation, source reference, review/trust lifecycle, and its own authorization.

## 6. Append and ordering contract

The preferred write model is append-only:
- Existing message content is immutable.
- A correction or replacement is a new linked message/revision event; it does not rewrite the historical message.
- Sequence allocation and append must be concurrency-safe within a conversation.
- Duplicate delivery with the same operation/idempotency identity returns the original committed result.
- Reuse of an idempotency key with a different payload hash is rejected.
- Out-of-order, missing-parent, duplicate-sequence, and ambiguous commit outcomes are explicitly represented and reconciled.
- Tool-call and tool-result links must be validated; stored tool calls are never replayed during retrieval.

The contract must specify how partial turns are represented when a user message commits but assistant generation fails, when a tool call commits but its result is missing, or when a process restarts during a turn.

## 7. Authorization and project isolation

Every append/read/list/count/export/backup/restore request must independently verify:
1. authenticated canonical actor;
2. verified conversation/project binding;
3. active project membership;
4. conversation ownership and any explicitly approved delegation;
5. requested operation capability and purpose;
6. record classification, lifecycle, and retention policy;
7. message-level and parent/child scope;
8. provider capability and audit requirements.

A conversation ID, message ID, tool name, role label, or project ID supplied by the model or request body is not authority. Admin role alone does not grant unrestricted transcript access. A standing Knowledge read grant must not authorize transcript reads or writes.

Cross-project search, counts, caches, summaries, snippets, and tool-context retrieval must apply the same authorization boundary as direct message retrieval. Unauthorized existence and counts must not leak.

## 8. Privacy, classification, and content handling

The contract must classify transcript content before persistence. At minimum:
- user and assistant text must not default to PUBLIC;
- tool outputs inherit the most restrictive relevant classification of their request/result context;
- credentials, session tokens, API keys, authentication headers, and secret values must be rejected or redacted before persistence;
- private attachments and multimodal payloads require a separately approved encrypted representation and size/type limits;
- system/developer instructions and internal control-plane content require an explicit exclusion or restricted handling policy;
- derived summaries and embeddings inherit source access restrictions and must not bypass the original transcript scope.

The exact default classification, redaction rules, retention, and encryption profile remain approval items. Provider encryption at rest alone is insufficient for RESTRICTED content.

## 9. Audit, idempotency, and crash recovery

Each append operation must bind:
- operation ID and idempotency key;
- conversation ID and message ID;
- project and server-verified actor;
- message type/origin;
- payload hash and schema/profile version;
- expected sequence/revision;
- policy decision and purpose;
- provider request reference and sanitized outcome.

Required operation outcomes include `COMMITTED`, `NOT_COMMITTED`, `IN_PROGRESS`, `CONFLICT`, and `UNKNOWN`. Retention expiry never implies `NOT_COMMITTED`. An unknown outcome must be reconciled using the original operation identity and payload hash; it must not be blindly retried with a new identity.

If durable audit intent cannot be confirmed, the append must not begin. If a message commit is confirmed but audit completion is uncertain, the operation remains unresolved (for example, `COMMITTED_AUDIT_PENDING`) and is not reported as normal success.

The chosen payload and audit transaction topology must be proven. No distributed or same-database atomicity may be claimed without exact infrastructure and failure-injection evidence.

## 10. Retention, deletion, and lifecycle

The contract must distinguish:
- conversation closure from deletion;
- message supersession/correction from deletion;
- user-requested deletion from retention expiry;
- legal hold from ordinary retention;
- tombstone metadata from payload erasure;
- backup expiry from live-store deletion.

Deletion and erasure require explicit authorization, auditable scope, verified provider capability, and backup/replica propagation semantics. A UI delete action must not claim erasure if immutable backups, replicas, or legal holds retain content. No delete/purge implementation is authorized by this proposal.

## 11. Failure and fallback behavior

| Condition | Required behavior |
|---|---|
| Canonical transcript provider not configured | Explicit non-persistent result; no local/Drive fallback |
| Provider unavailable | Explicit failure or unresolved state; no provider substitution |
| Project/actor binding missing | Deny before persistence or disclosure |
| Tool result missing or malformed | Preserve explicit incomplete-turn state; do not fabricate result |
| Duplicate message operation | Reconcile same operation identity |
| Sequence/revision conflict | Reject and return conflict; do not overwrite |
| Audit intent unavailable/uncertain | Do not append payload |
| Commit outcome unknown | Reconcile same operation; do not report success |
| Secret-bearing content detected | Reject or apply an approved redaction policy before persistence |
| Retention or classification metadata missing | Fail closed |
| HFM mode enabled | Never write legacy local Memory or Google Drive |

## 12. Required acceptance tests

After formal contract approval, isolated tests must cover:
- Exact conversation/message schema and version validation.
- Stable canonical IDs, uniqueness, sequence ordering, and parent/tool-call references.
- User/assistant/tool-call/tool-result provenance distinction.
- No automatic trust promotion or Knowledge/Learning creation from transcript text.
- Server-derived actor/project binding and cross-project denial.
- Standing Knowledge read authority cannot authorize transcript access.
- Append-only behavior and immutable prior messages.
- Idempotent retry, payload mismatch rejection, concurrent sequence allocation, and ambiguous commit recovery.
- Audit intent failure blocks append; audit completion uncertainty remains unresolved.
- Secret/token redaction and private/multimodal payload boundaries.
- Retention, deletion, tombstone, backup, and legal-hold behavior.
- No local/Drive fallback under every HFM feature-flag combination.
- Synthetic fixtures and disposable database only; no production data, Neon, Render, credential, Facebook, or external action.

## 13. Approval and release boundary

This proposal remains NOT APPROVED until the contract owner explicitly approves:
- logical entity model and canonical schema/version;
- provider topology and authority;
- message-origin and provenance vocabulary;
- classification, encryption, and key custody;
- append transaction, audit, and reconciliation topology;
- retention/deletion/backup semantics;
- supported message/tool/multimodal payload profiles.

Approval must identify this exact document ID and revision. Approval does not itself authorize migrations, grants, credentials, production data writes, runtime activation, merge, or deployment. Those require separate explicit gates.

## 14. Current implementation disposition

Until approval and implementation:
- HFM-mode transcript persistence remains disabled/non-persistent.
- Legacy local transcript writes remain blocked whenever an HFM mode is active.
- Google Drive is not a transcript fallback.
- No canonical transcript writer or transcript read API is claimed.
- Transcript content is not automatically promoted to Knowledge or Learning.
- HFM v0.2 remains incomplete; no v0.3 work is started.
