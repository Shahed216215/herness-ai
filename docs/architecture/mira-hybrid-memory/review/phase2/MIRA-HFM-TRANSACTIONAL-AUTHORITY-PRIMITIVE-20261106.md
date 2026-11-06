# Mira HFM v0.2 — Transactional Project Authority Primitive

**Status:** Isolated implementation and mocked contract tests only. Not wired into routes or legacy Memory/Knowledge tools.

## Implemented boundary

`services/mira-hfm-authority-transaction.js` exports `executeWithConsumedAuthority`. It requires a caller-supplied PostgreSQL pool, a complete authority scope, and a protected callback. It:

1. Opens a SERIALIZABLE transaction with bounded statement and lock timeouts.
2. Locks the project owner row, then the active actor membership row, then the exact authority row using `FOR UPDATE` in a deterministic order.
3. Requires an active owner, active and currently valid membership, and an explicit operation permission.
4. Matches the authority to actor, project, operation, resource, purpose, request ID and the current owner/membership revisions.
5. Atomically consumes an unexpired ISSUED authority, appends an audit event, invokes the protected callback with the same transaction client, and commits.
6. Rolls back authority consumption, audit insertion and protected database changes together on any failure.

## Permission contract

The initial permission shape is deliberately narrow and deny-by-default:

```json
{ "operations": ["memory.read", "memory.write"] }
```

Only an exact string match grants an operation. Wildcards, missing fields, malformed values and implicit role grants are denied. This is a new contract for future HFM membership provisioning; it does not alter existing records.

## Critical callback constraint

The protected callback MUST perform only database operations through the supplied transaction client. Do not call external APIs, Google Drive, model providers, filesystem writes, or other non-transactional side effects from it. PostgreSQL rollback cannot undo external effects. The callback must not acquire locks in an order that conflicts with the documented owner → membership → authority order.

Any membership revocation or owner revision change must update/lock the same rows; the transaction's row locks prevent a validation-to-operation revocation race. SERIALIZABLE conflicts must be treated as failed operations and retried only with a new, separately issued request/authority—not by replaying a consumed request.

## Explicit non-goals

- No owner, membership, or authority provisioning API.
- No route, tool, project store, Memory or Knowledge integration.
- No legacy global data reads, writes, migration or reclassification.
- No runtime feature flag enablement.
- No Neon connection, SQL migration execution, SQL parser/integration test, concurrency test against PostgreSQL, or production authorization claim.

## Evidence and remaining gates

- Source implementation: committed to PR #52 branch.
- Contract tests: mocked PostgreSQL client only; validate lock ordering, scope/revision checks, one-time consume, audit sequencing, callback transaction reuse and rollback behavior.
- Actual row-lock concurrency, PostgreSQL SQL semantics, grants, append-only enforcement and SERIALIZABLE behavior: **NOT_VERIFIED** pending disposable Neon branch validation.
- Project-scoped retrieval/mutation: **BLOCKED**.
- Legacy Memory/Knowledge: **UNCHANGED / NOT_ACTOR_SCOPED**.
- Neon migration/live connection, Render changes, production data writes, merge and deployment: **NOT_PERFORMED**.

This primitive is a reviewable building block, not a production authorization release.
