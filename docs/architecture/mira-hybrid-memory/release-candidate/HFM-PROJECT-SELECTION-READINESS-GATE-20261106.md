# HFM v0.2 — Project Selection Readiness Gate

**Status:** BLOCKED — DESIGN / SOURCE AUDIT ONLY  
**Scope:** HFM v0.2; no runtime endpoint, database write, or deployment is authorized by this document.

## 1. Finding

The project-binding resolver exists, but it deliberately accepts only a binding already issued by trusted server code and stored in the authenticated session. It does not select a project or query Neon.

The current server does not import the resolver or expose a project-selection route. The current HFM Postgres runtime exposes a dedicated memory-writer pool, not a dedicated read-only project-discovery pool. The authority transaction executor is not a discovery mechanism: it starts a serializable transaction, consumes a one-time authority, writes an audit event, and invokes a protected callback.

Therefore, adding a route that merely copies a caller-supplied project ID into the session would create a privilege-escalation vulnerability. Reusing the writer/authority executor for project discovery would also be an unsafe coupling.

## 2. Required implementation boundary

A future project-selection flow must:

1. Require a valid authenticated session and derive the actor exclusively from `session.hfmPrincipal` through the canonical identity resolver.
2. Accept a requested project identifier only as an untrusted lookup hint; it must never itself establish access.
3. Use a dedicated Neon read-only pool and a transaction with statement/lock timeouts. The pool must use TLS verification and enforce read-only mode at both connection and transaction levels.
4. Query the authoritative owner and membership rows using parameterized SQL. Require an ACTIVE owner, an ACTIVE membership for the derived actor, `valid_from <= clock_timestamp()`, and `expires_at IS NULL OR expires_at > clock_timestamp()`.
5. Verify that the read-only database role can see the required rows under the existing RLS policies. Empty results caused by RLS must be treated as access denied / unavailable, never as proof that the project does not exist.
6. Only after successful database verification, regenerate or safely update the server session and set the exact `HFM_PROJECT_BINDING_V1` envelope. The project ID must come from the verified database row.
7. Clear the binding on logout, session regeneration, membership revocation, owner transfer, and access changes. Revalidate membership inside every sensitive operation; the session binding is a selection hint, not an authorization grant.
8. Never issue operation authorities as a side effect of project selection.

## 3. Current blockers

- No dedicated read-only HFM project-selection pool/service is wired.
- The earlier Neon staging audit found the runtime SELECT role had no applicable RLS policy for `memory_records`; visibility of owner/membership rows must be independently verified before an endpoint is enabled.
- The audited staging owner, membership, and authority tables were empty. No canonical project ID or owner actor has been approved.
- No verified read-only membership query has been run against the intended staging branch in this work.
- The project-binding resolver is not integrated into `server.js`.

## 4. Acceptance tests before endpoint implementation

- Missing authentication, missing stable principal, invalid project hint, and absent membership all fail closed.
- A caller cannot select another actor's project by changing JSON, query, tool, or model arguments.
- Suspended owner, revoked/expired membership, future membership start, and RLS-hidden membership are denied.
- A successful selection stores only the server-verified project row and derived actor in the session.
- The selection transaction is read-only; no authority is consumed and no audit or memory data is mutated.
- Every sensitive memory operation rechecks owner, membership, permission, revision, and one-time authority in its own protected transaction.
- Logout/session regeneration clears the binding; revocation prevents subsequent use.

## 5. Disposition

**Do not wire a project-selection endpoint yet.** First implement and independently test the dedicated read-only pool and membership repository against the disposable Neon staging branch, then verify the effective RLS policies and actual role visibility. Owner bootstrap remains separately NOT_APPROVED and must not be inferred from a successful login.

No database writes, role changes, policy changes, secrets, Render environment changes, production changes, merge, or deployment were performed for this gate.
