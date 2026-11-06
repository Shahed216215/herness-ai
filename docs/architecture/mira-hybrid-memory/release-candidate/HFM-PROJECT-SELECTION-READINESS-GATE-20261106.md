# HFM v0.2 — Project Selection Readiness Gate

**Status:** SOURCE COMPONENTS ADDED — STAGING DATABASE VERIFICATION NOT RUN  
**Scope:** HFM v0.2; no route, database write, or deployment is authorized by this document.

## 1. Current source implementation

The audit branch now contains:

- `services/mira-hfm-project-selection-read-runtime.js`: isolated read-only project lookup runtime, separate connection URL, explicit enable flag, expected login role, Neon/TLS validation, default read-only connection mode, exact role/database preflight, no-write privilege checks, FORCE RLS checks, and policy-expression checks.
- `migrations/hfm/006_project_selection_read_policy.sql`: SOURCE-ONLY DRAFT that creates a NOLOGIN reader group and SELECT-only policies for active owner and the authenticated actor's own active, time-valid membership.
- `tests/mira-hfm-project-selection-read-runtime.test.js`: source-level tests for fail-closed configuration, least privilege, role inheritance, RLS, session-derived actor, parameterized lookup, read-only transaction boundaries, and hidden/absent membership denial.
- `tests/mira-hfm-project-selection-read-policy-contract.test.js`: source-contract checks for the migration's role, grants, actor/project-scoped policies, validity windows, and absence of data mutation.
- Both new tests are included in `npm test`.

The lookup derives the actor internally through `buildTrustedActorContext(req)`; it does not accept actorId as a caller parameter or request-body field. It sets transaction-local `mira.project_id` and `mira.actor_id`, then queries only the requested project and authenticated actor. The RLS policies are designed to expose only the active owner row for that project and the requesting actor's own active membership. A hidden or absent membership is denied identically.

## 2. Required environment configuration

The runtime remains disabled unless all are explicitly configured:

- `MIRA_HFM_PROJECT_READ_ENABLED=true`
- `MIRA_HFM_PROJECT_READ_DATABASE_URL` — dedicated Neon read-only LOGIN role URL
- `MIRA_HFM_PROJECT_READ_ROLE` — exact expected PostgreSQL LOGIN role name

No values or credentials were set by this source-only work. Do not reuse the writer credential. The LOGIN role must be a member of `mira_hfm_project_reader` and inherit its grants. The group role itself is NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS, owns no database objects, has no parent-role memberships, and has only USAGE on the schema plus SELECT on the two registry tables. The migration rejects unsafe pre-existing role attributes, parent memberships, object ownership, and policy-name collisions. The preflight checks actual inherited role usage and rejects any write grants.

## 3. Staging migration gate

The draft migration requires the existing owner and membership tables to have RLS and FORCE RLS enabled. It creates these policies:

- Owner policy: transaction-local project ID must match and owner status must be ACTIVE.
- Membership policy: transaction-local project ID and actor ID must both match; membership must be ACTIVE and within its validity window.

The migration intentionally does not create a LOGIN role, password, owner, membership, or authority. The dedicated LOGIN role must be provisioned separately by the database operator and granted membership in the NOLOGIN reader group. The migration has not been executed. Review the exact target project/branch/database, current roles, policies, grants, migration digest, and expected effects, then obtain explicit staging-write approval before execution.

The runtime preflight now checks the expected group membership, direct role-membership isolation, NOINHERIT on the reader group, absence of parent-role memberships and object ownership, SELECT grants, absence of write grants, table ownership separation, FORCE RLS, the two exact policy names/expressions, absence of PUBLIC policies, and absence of additional policies assigned to the reader group. This reduces the risk that PostgreSQL's permissive-policy OR behavior widens visibility. The real positive and negative row-visibility tests must still be run with the dedicated LOGIN role after migration.

## 4. Not yet wired

This remains a read-runtime component, not a project-selection endpoint. It is not imported by `server.js`, does not mutate session state, does not regenerate sessions, and does not create owner/membership rows. This is intentional: session binding should be added only after the actual read-only database role and RLS behavior are verified.

The existing session binding resolver accepts only a binding already issued by trusted server code. It is not an authorization grant. Every sensitive operation must continue to revalidate owner, membership, permissions, revisions, and one-time authority in its own protected transaction.


## 5. Database identity boundary and GUC limitation

PostgreSQL custom settings such as `mira.project_id` and `mira.actor_id` are settable by a database session holding the LOGIN credential. Transaction-local settings prevent connection-pool leakage; they do **not** cryptographically authenticate the actor to PostgreSQL and must not be treated as an unforgeable identity boundary. The dedicated LOGIN credential must remain server-side, must never be sent to a browser or user-controlled client, and must be used only by the trusted runtime after session-derived actor resolution. A holder of that database credential can potentially set different custom GUC values directly. If the threat model includes compromise or untrusted use of the LOGIN credential, this policy design alone is insufficient; use a stronger database-verifiable identity mechanism before enabling project selection.

## 6. Acceptance checks before endpoint integration

- Apply the reviewed migration only to the named disposable Neon staging branch after explicit approval.
- Provision a dedicated read-only LOGIN role and grant it membership in the NOLOGIN reader group; store credentials only in the approved secret manager.
- Verify the exact role, database, inherited grants, no-write privileges, RLS + FORCE RLS, and both policy expressions.
- With that actual role, test active member success; non-member, different actor, suspended owner, revoked membership, future start, expired membership, and cross-project lookup failure.
- Verify the selection transaction cannot write.
- Only then design the session selection route, including session regeneration and clearing on logout/revocation/access changes.
- Keep operation-authority issuance separate; project selection never issues authority.

## 7. Disposition

**Source preparation is under security hardening; staging database verification is NOT RUN.** No actual Neon connection was made in this source-only step; no database writes, role changes, policy changes, secret changes, Render environment changes, production changes, merge, or deployment were performed. The Node tests have been updated for the stricter role contract but have not been executed in this environment. Test status remains NOT_RUN.
