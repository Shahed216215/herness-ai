# MIRA HFM v0.2 — Human Review and Trust Promotion Contract Proposal

**Document ID:** HFM-CRP-2026-11-07-01  
**Date:** 2026-11-07  
**Status:** PROPOSED / NOT APPROVED / NOT IMPLEMENTED  
**Normative baseline:** HFM Phase 2 Detailed Technical Contract v0.2.4  
**Current implementation:** Read-only pending Knowledge/Learning review queue  
**Release boundary:** HFM v0.2 only

> This document proposes a narrowly scoped contract for human review of canonical `knowledge_item` and `learning_note` records. It does not amend v0.2.4 by itself and authorizes no schema change, migration, database write, role/grant, secret, runtime flag, merge, or deployment. Until formally approved, `promotionSupported: false` and `writeAllowed: false` remain mandatory.

## 1. Problem statement

The current HFM review queue can list same-project `PENDING_REVIEW` records whose trust state is `SOURCE_RECORDED`. It consumes a one-time `memory.read` authority and is read-only. It does not make a review decision, mutate a record, elevate trust, or activate a record.

The v0.2.4 contract already defines trust as evidence rather than authorization and requires every trust transition to record the actor/process, timestamp, evidence reference, policy version, and reason. It prohibits skipped evidence stages, automatic promotion from reachability or integrity, and trust elevation as a source of access or operation capability.

This proposal defines the missing decision and persistence boundary without adding a new canonical record family or changing the v0.2.4 record envelope.

## 2. Scope and non-goals

In scope:
- Human review of `knowledge_item` and `learning_note` records in one verified project.
- Explicit approve, reject/quarantine, and request-more-evidence decisions.
- Revision-bound decisions and append-only decision evidence.
- A narrowly scoped authorization and transaction boundary.
- Fail-closed behavior for stale, ambiguous, conflicting, or unverifiable records.

Out of scope:
- Automatic model promotion or autonomous trust elevation.
- Bulk approval, blanket trust, project-wide promotion, or review-by-default.
- Client/financial vault records, social drafts, daily activity, or transcript records.
- Editing source content during review.
- Facebook publishing, provider selection, backup/restore, legacy migration, or local/Drive fallback.
- New canonical record types, changes to the v0.2.4 envelope, or live database implementation.

## 3. Canonical invariants

1. The canonical record remains the existing v0.2.4 envelope. Review decision evidence is an audit/lifecycle concern, not a new record family.
2. `memoryId`, `projectId`, record type, revision, content hash, source identity, and source-observed timestamp are bound to the review request.
3. `PENDING_REVIEW` records remain excluded from trusted search, Work Learning, chat recall, counts, and derived trusted context.
4. A trust state is not an authorization grant. `HUMAN_VERIFIED` does not authorize read, write, export, restore, or cross-project access.
5. A successful review does not change record content. Any content/source mutation invalidates affected verification and requires a new revision and review.
6. No record may be promoted solely because its hash matches, its source is reachable, a model agrees with it, or an admin role exists.
7. The current disabled-by-default and no-fallback behavior remains unchanged until the entire approval and implementation gate passes.

## 4. Review decision model

A review decision applies to exactly one record revision and one project.

| Decision | Required outcome | Canonical state effect |
|---|---|---|
| `APPROVE` | Reviewer confirms the displayed revision and evidence are sufficient | Eligible transition to `HUMAN_VERIFIED / ACTIVE`, subject to evidence-stage validation |
| `REJECT` | Reviewer determines the item must not enter trusted use | `QUARANTINED / QUARANTINED`; record retained, never silently deleted |
| `REQUEST_EVIDENCE` | Evidence is insufficient but no rejection is justified | Remains `SOURCE_RECORDED / PENDING_REVIEW`; a reason/evidence request is audited |

The decision must include a bounded, non-empty reason. `APPROVE` must identify the evidence actually reviewed. A reviewer cannot approve a different revision than the one displayed. Empty evidence, implicit consent, timeout, missing response, or an unrecognized decision is not approval.

A decision is final for its exact operation identity. A subsequent review requires a new operation identity and a new explicit human decision. Repeated submission with the same idempotency identity and identical payload returns the original outcome; the same identity with a different payload is rejected.

## 5. Trust and lifecycle transition constraints

### 5.1 Approval

For an imported source record, approval requires all of the following:
- The source identity and acquisition metadata are present and valid.
- The source was reached only through an authorized verification process when reachability is claimed.
- Content/schema/policy validation passed for the exact current revision.
- Integrity is `VERIFIED` for the exact content hash and revision.
- The reviewer was shown the complete bounded content or an explicitly disclosed truncation; a truncated display cannot support approval of unseen content.
- The reviewer explicitly confirms the exact record ID, project, revision, and content hash.
- No source/content change, quarantine event, revocation, or newer revision occurred before commit.

The allowed evidence progression is `SOURCE_RECORDED` → `SOURCE_REACHABLE` (only if actually checked) → `CONTENT_VERIFIED` (only after required checks) → `HUMAN_VERIFIED` (only after the explicit human decision). A stage may be omitted only where the baseline contract and evidence semantics genuinely make it inapplicable; it must never be fabricated to satisfy a sequence.

The lifecycle transition is `PENDING_REVIEW` → `ACTIVE` in the same approved transaction as the trust transition and audit decision. If any prerequisite is missing, approval is rejected and the record remains pending.

### 5.2 Rejection and quarantine

`REJECT` moves the exact current revision to `QUARANTINED` and trust `QUARANTINED`. It does not delete the record, erase evidence, or make the content visible to trusted retrieval. Quarantine release is not part of this proposal; no automatic or same-operation release is allowed.

### 5.3 Request more evidence

`REQUEST_EVIDENCE` leaves trust and lifecycle unchanged. It records the requested evidence and reviewer reason. The record remains excluded from trusted retrieval.

### 5.4 Revision and race protection

The transaction must compare the expected record revision and content hash with the current canonical row under a serialization/locking strategy. If either differs, the decision fails with a stale-review conflict. It must not rebase the decision onto a newer revision, retry against changed content, or perform last-write-wins.

## 6. Identity, authorization, and separation of duties

The review boundary must independently verify:
1. A server-verified human principal and stable canonical actor ID.
2. An active membership in the authenticated project.
3. A verified selected-project binding.
4. The owner-project authorization for the target record.
5. The target record's project, type, classification, lifecycle, revision, and trust state.
6. A one-time, exact-record review authority and applicable policy decision.
7. Fresh authentication/reauthentication under the approved admin policy.
8. Any separation-of-duties rule adopted by the contract owner.

A caller-supplied actor ID, role, project ID, record revision, trust state, or approval result is untrusted. The server must derive identity and project from the authenticated session and re-read the target record inside the write transaction.

Admin role alone is insufficient. A standing `memory.read` authority cannot authorize review, promotion, quarantine, or any write. A consumed `memory.write` authority for a different resource/purpose cannot be repurposed for review.

## 7. Proposed operation and persistence boundary

This proposal recommends a distinct one-time operation `memory.review`, not reuse of `memory.read` or a generic update route.

The authorization must bind:
- project ID and canonical actor;
- exact memory ID and expected revision;
- expected content hash and source identity;
- decision (`APPROVE`, `REJECT`, or `REQUEST_EVIDENCE`);
- purpose and bounded reason;
- stable operation ID and idempotency key;
- policy version and approval reference.

The operation must execute through a narrow trusted database API or separately isolated least-privilege reviewer service. It must not grant the runtime reader UPDATE privileges or broad table DML. Direct SQL, caller-controlled session variables, owner-role access, and cross-project attempts must be tested as adversarial cases.

The exact role, stored procedure, RLS policy, audit table/append-only enforcement, and transaction topology are intentionally unresolved. They require separate database security review and approval before migration or credential provisioning.

## 8. Audit evidence

Every decision must append an immutable, sanitized audit event containing at least:
- event ID and event type;
- project ID and canonical actor ID;
- operation ID and idempotency key;
- target memory ID, record type, expected and committed revision;
- expected content hash and source reference identifier;
- decision, reason code, bounded reviewer reason;
- prior and resulting trust/lifecycle states;
- evidence references actually reviewed;
- policy version and authorization decision reference;
- timestamp, result status, and sanitized error code where applicable.

Audit payloads must not include raw credentials, tokens, encryption keys, restricted plaintext, or unnecessary private content. A hash chain alone does not prove reviewer identity or trusted authorship.

If durable audit intent cannot be confirmed, the state transition must not begin. If the record transition commits but audit completion is uncertain, the operation must remain unresolved (for example, `COMMITTED_AUDIT_PENDING`) and be reconciled using the same operation identity. It must not return normal success or blindly repeat the transition.

## 9. Failure behavior

| Condition | Required behavior |
|---|---|
| Missing/invalid reviewer identity or project binding | Deny before data disclosure or write |
| Missing membership or owner-project authorization | Deny |
| Standing-read authority only | Deny review mutation |
| Missing/expired/revoked one-time review authority | Deny |
| Record not pending, unsupported type, or wrong classification | Deny |
| Revision/content hash/source identity changed | Stale-review conflict; no mutation |
| Evidence insufficient for approval | Keep pending; require a new decision |
| Audit intent unavailable or uncertain | Do not mutate |
| Commit/audit outcome unknown | Reconcile same operation; never report success |
| Database role/RLS/preflight drift | Disable review mutation and fail closed |
| Facebook/provider unavailable | No change to review authorization or canonical Memory fallback |
| Any legacy local/Drive path | Must remain blocked in HFM mode |

No failure path may promote trust, activate a record, delete a record, or silently fall back to another store.

## 10. Required acceptance tests

Implementation cannot begin until the contract is approved. After approval, the minimum isolated tests are:

- Explicit approval is required; absent, ambiguous, negative, and implicit intent are denied.
- Only authenticated, fresh, authorized human reviewers can decide.
- Project mismatch, missing membership, missing owner-project authorization, and cross-project access are denied.
- Standing read and unrelated one-time write grants cannot authorize review.
- Exact record ID, type, classification, revision, source identity, and content hash are transaction-bound.
- Approval of stale revision/content/source is rejected without mutation.
- `APPROVE` performs only the approved evidence transitions and activates only the exact record revision.
- `REJECT` quarantines without deleting or exposing the record.
- `REQUEST_EVIDENCE` leaves trust/lifecycle unchanged.
- Trust elevation does not grant permissions or bypass per-record read authorization.
- Content/source mutation invalidates prior verification and prevents stale approval.
- Concurrent decisions serialize; at most one decision commits for a given operation identity.
- Same idempotency key and same payload reconcile to the original result; a different payload is rejected.
- Audit-intent failure prevents mutation; audit-completion uncertainty remains unresolved and is reconciled.
- Reader role remains read-only; reviewer role has no broad DML, ownership, superuser, or BYPASSRLS capability.
- Forced-RLS tests deny cross-project and caller-controlled context attempts.
- Legacy local/Drive fallback remains disabled; no Facebook API action occurs.
- Tests run against synthetic fixtures and a disposable PostgreSQL database only; production data, Neon, Render, credentials, and external services remain untouched.

## 11. Approval checklist

This proposal remains NOT APPROVED until the contract owner explicitly decides:
- Whether the three decision outcomes and transition graph are accepted.
- Whether `memory.review` is the correct operation name and scope.
- The required reviewer authentication freshness and separation-of-duties policy.
- The exact evidence required for each record/source type.
- The approved database transaction, role, RLS, and append-only audit topology.
- The handling of already quarantined records and any future quarantine-release process.
- The policy version and migration/recovery requirements.

Approval must identify this exact document ID and revision. Approval of this proposal does not itself authorize database migration, secret provisioning, runtime activation, merge, or deployment; those remain separate gates.

## 12. Current implementation disposition

Until formal approval and a separately reviewed implementation:
- Review queue remains read-only.
- `promotionSupported: false`.
- `writeAllowed: false`.
- `PENDING_REVIEW` records remain excluded from trusted search and Work Learning.
- No trust/lifecycle mutation is performed by Mira.
- HFM v0.2 remains incomplete; no v0.3 work is started.
