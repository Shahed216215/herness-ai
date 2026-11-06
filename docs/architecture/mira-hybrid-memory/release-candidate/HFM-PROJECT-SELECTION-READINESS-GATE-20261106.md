# HFM v0.2 — Project Selection Readiness Gate

**Status:** SOURCE COMPONENTS ADDED — DATABASE/RLS VERIFICATION BLOCKED  
**Scope:** HFM v0.2; no route, database write, or deployment is authorized by this document.

## 1. Current implementation

The source branch now contains:

- `services/mira-hfm-project-selection-read-runtime.js`: isolated project-read runtime with a separate connection URL, explicit enable flag, expected database role, Neon/TLS validation inherited from the shared adapter, read-only connection mode, role/grant preflight, FORCE RLS and policy-presence checks, and an actor/project-scoped membership lookup.
- `tests/mira-hfm-project-selection-read-runtime.test.js`: source-level contract tests for fail-closed config, least-privilege role checks, RLS requirements, authenticated-session actor derivation, parameterized project lookup, read-only transaction boundaries, and no-membership denial.
- The new test is included in `npm test`.

The membership lookup derives the actor internally using `buildTrustedActorContext(req)`; it does not accept actorId from a caller parameter or request body. It sets transaction-local `mira.project_id` and `mira.actor_id`, then queries only the requested project and authenticated actor. It returns only an active owner + time-valid active membership. A hidden or absent row is denied identically.

## 2. Required environment configuration

The new read runtime is disabled unless all of these are explicitly configured:

- `MIRA_HFM_PROJECT_READ_ENABLED=true`
- `MIRA_HFM_PROJECT_READ_DATABASE_URL` — dedicated Neon read-only login URL
- `MIRA_HFM_PROJECT_READ_ROLE` — exact expected PostgreSQL login role name

No values or credentials were set by this source-only work. Do not reuse the writer credential. The expected role must be a dedicated LOGIN role with SELECT only on the required owner and membership tables, no superuser/BYPASSRLS, no schema CREATE, and no table write privileges.

## 3. Important RLS requirement

The runtime preflight refuses to become ready unless both `project_owners` and `project_memberships` have RLS and FORCE RLS enabled, applicable policies are present for both tables, and the role has the required SELECT grants without write grants.

The lookup also sets both project and actor transaction-local context. The final policy expressions must be reviewed against these context values and tested under the actual read-only login. Merely having a policy row in `pg_policies` is not sufficient evidence that it exposes only the intended membership row.

The earlier staging audit found no applicable policies for the runtime read path (policy count was zero in the inspected scope). Therefore, the current staging database is expected to fail this preflight until a separately reviewed, narrowly scoped policy migration is approved and applied.

## 4. Not yet wired

This is a read-runtime component, not a project-selection endpoint. It is not imported by `server.js`, does not mutate session state, does not regenerate sessions, and does not create owner/membership rows. This is intentional: a successful lookup must be connected to a carefully reviewed session lifecycle flow only after the database role and RLS behavior are proven.

The existing session binding resolver still accepts only a binding already issued by trusted server code. It is not an authorization grant. Every sensitive operation must continue to revalidate owner, membership, permissions, revisions, and one-time authority in its own protected transaction.

## 5. Acceptance checks before endpoint integration

- Verify the dedicated role identity and exact target database/branch.
- Verify SELECT-only grants, no BYPASSRLS/superuser, RLS + FORCE RLS on both tables, and reviewed policy expressions.
- Execute read-only positive and negative tests with the actual role: active member succeeds; non-member, other actor, suspended owner, revoked membership, future start, expired membership, and cross-project lookup fail.
- Verify no write is possible in the selection runtime.
- Only then design the session selection route, including session regeneration and clearing on logout/revocation/access changes.
- Keep operation-authority issuance separate; project selection never issues authority.

## 6. Disposition

**Database/RLS verification remains BLOCKED.** No actual Neon connection was made in this source-only step; no database writes, role changes, policy changes, secret changes, Render environment changes, production changes, merge, or deployment were performed. The runtime test has been added to the test chain but has not been executed in this environment. Until real database evidence exists, test status remains INCONCLUSIVE.
