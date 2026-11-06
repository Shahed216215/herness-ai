# HFM v0.2 — Project Owner Bootstrap Contract

**Status:** DESIGN ONLY — NOT EXECUTED  
**Scope:** Disposable Neon staging branch only after explicit approval.  
**Production:** Prohibited by this document.

## 1. Current evidence and blocker

The audited disposable branch has empty `mira_hfm.project_owners`,
`project_memberships`, and `operation_authorities` tables. No project owner,
project UUID, or dedicated writer login has been approved or provisioned.
The current runtime identity establishes an authenticated actor, but does not
establish which HFM project that actor may access.

The source-level resolver in
`services/mira-hfm-project-binding-context.js` accepts only a binding already
verified by trusted server code and stored in the authenticated session. It
does not create that binding or query the database.

## 2. Required inputs — obtain and verify, never infer

Before any bootstrap operation, an operator must independently confirm:

- Target Neon project ID, branch ID, and database name; target must be the
  disposable staging branch, not production.
- Canonical HFM project ID, validated against the intended project registry.
- Owner actor ID derived from an authenticated, stable principal using the
  canonical identity contract; display name, email, username, model output,
  request body, and guessed UUID are not acceptable.
- Whether the owner is the user/admin principal or a dedicated service actor.
  This decision requires explicit human confirmation.
- Exact migration/schema revision and current row/policy/grant inventory.
- Dedicated writer LOGIN role identity and its membership in the NOLOGIN
  writer group. Credentials must be created and stored outside source control.
- KEK custody, version, rotation/recovery procedure, and Render secret names.
  Never put key material in this runbook, SQL, Git, logs, or chat.

If any input is missing or ambiguous, stop without writes.

## 3. Bootstrap invariants

1. Bootstrap only on the named disposable staging branch.
2. Use a dedicated, least-privilege bootstrap operator; never the application
   runtime role, database owner, or broad test runner.
3. Enforce a unique owner row per project and a unique active owner identity
   according to the schema's constraints.
4. Create owner and matching owner membership atomically in one transaction.
5. Membership permissions must be an explicit allow-list, not wildcard access.
6. The operation must be idempotent: an identical existing owner/membership
   may be reported as already provisioned; any conflicting row is a hard stop.
7. Do not create operation authorities during owner bootstrap.
8. Do not loosen FORCE RLS, add global policies, grant DELETE/TRUNCATE, or
   permit silent fallback.
9. Capture an immutable audit event containing actor, project, operation,
   approved change reference, and outcome; exclude credentials and key material.
10. Verify with the actual runtime identity that cross-project reads fail and
    authorized project reads succeed before enabling any application write path.

## 4. Project selection contract

A project-selection endpoint must authenticate the session, query the
authoritative membership table using a narrowly scoped server-side transaction,
verify ACTIVE status and validity dates, and then set the exact
`hfmProjectBinding` session envelope:

- `verified: true`
- `bindingVersion: HFM_PROJECT_BINDING_V1`
- `actorId`: derived from the authenticated principal, never request input
- `projectId`: selected from the verified membership result, never trusted
  directly from a model/tool argument
- `selectedAt`: server-generated timestamp

The binding must be cleared on logout, session regeneration, membership
revocation, owner transfer, or project access change. Revalidate membership
before sensitive operations; a session binding is a selection hint, not a
permanent authorization grant.

## 5. Explicit approval gate

No SQL or API write is authorized by this design. Before executing bootstrap,
obtain explicit approval naming the disposable Neon project, branch, database,
canonical project ID, owner actor ID, permission set, and exact SQL/migration
digest. Review the final SQL and expected row effects first.

## 6. Acceptance checks

- Missing/invalid owner or project identifiers: no writes.
- Duplicate identical bootstrap: idempotent no-op.
- Conflicting owner/membership: fail closed.
- Runtime cannot read without verified actor + project context.
- Runtime cannot cross project boundaries.
- Writer role cannot delete or truncate records/audit history.
- No authority is auto-issued and no production resource is touched.

**Current disposition:** NOT_APPROVED — owner/project identifiers and explicit
staging-write approval are not present.
