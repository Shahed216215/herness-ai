# MIRA HFM Phase 2 — Render-base identity guard follow-up

**Date:** 2026-11-06  
**PR:** #52  
**Base:** `work/render-host-binding-env-compat-audit`  
**Candidate head at review:** `3a410a66931c06b59e68a6952e00838e58b18c4b`

## Result

The narrow identity-context transport patch is based directly on the current Render branch (0 commits behind, 7 commits ahead at candidate creation). Source inspection confirms the context is passed from the authenticated `/api/agent` request into `executeWork`, then through `runTool` and `executeTool`.

This is transport plumbing only. It does not establish canonical HFM principal verification, project membership, project ownership, project authority, or project-scoped retrieval.

## Authentication boundary findings

- Registered local users are assigned a UUID in the user store. Successful user login returns that stable `userId`, which is persisted in the session.
- The configured admin login path currently returns role and username, but no immutable admin subject/userId. The new context builder therefore rejects that admin session as `IDENTITY_UNAVAILABLE`.
- Shared bearer authentication assigns only a role and permissions; it does not establish a unique actor subject. Bearer requests therefore remain unavailable to this actor-context bridge.
- No issuer/subject/authentication reference/authoritative authentication timestamp/expiry envelope is produced at the authentication boundary. The bridge intentionally does not fabricate these values.
- Email, username, role, model arguments, and project identifiers are not accepted as substitutes for an immutable actor identity.

## Test and CI evidence

- Focused test source covers registered session actor resolution, missing/legacy/bearer-like/admin-without-subject and role-mismatch fail-closed cases, model-argument spoofing resistance, and dispatch wiring.
- Source inspection confirms the expected dispatch statements exist on the Render-base candidate.
- GitHub combined commit status returned no status entries.
- The available workflow-run lookup returned no workflow runs for the candidate commit. Therefore automated CI is **NOT ESTABLISHED**; no CI PASS is claimed.
- No full repository test suite, Node syntax check against the complete checkout, Render deploy, HTTP health check, authenticated route test, or HFM live-runtime test has been executed in this follow-up.

## Gate decision

**DEPLOYMENT: BLOCKED**  
**HFM LIVE TEST: NOT PERFORMED**  
**ADMIN PRINCIPAL: NOT ESTABLISHED**  
**BEARER PRINCIPAL: NOT ESTABLISHED**  
**PROJECT AUTHORITY / SCOPED RETRIEVAL: BLOCKED**

## Safe next sequence

1. Establish an immutable, separately provisioned admin subject at the authentication boundary, with rotation/revocation and audit semantics.
2. Design a trusted bearer token-to-subject verifier with issuer, subject, audience, expiry, revocation, and authentication reference. Do not map the shared bearer token itself to an actor.
3. Normalize the complete canonical HFM principal envelope only from verified authentication facts.
4. Add durable project-owner and explicit membership registries with revision/CAS, audit, backup, and revocation semantics.
5. Integrate operation-scoped project authority and only then retrieval enforcement.
6. Run focused tests plus the full repository suite on the candidate; require visible CI success.
7. Use a test-only environment and synthetic data for runtime validation. Deploy to Render only after compatibility, rollback, and explicit release gates pass.

## Production safety

No Render service settings, environment variables, credentials, production Memory/Knowledge data, project ownership, or membership records were changed. No merge or deployment was performed.


## Expanded regression-suite result

A repository-wide regression attempt was added to CI after the focused identity check had passed.

- `npm ci`: **PASS** (242 packages installed from the lockfile).
- `npm test`: **FAIL / BASELINE TEST-SCRIPT GAP**.
- The first capacity-register test passed.
- The script then stopped because `tests/change-management-regression-test.js` is referenced by the Render-base `package.json` test command but is absent from that branch.
- Because the shell uses `&&`, subsequent repository tests did not run in that attempt.
- The install reported 9 dependency audit findings (6 moderate, 3 high). No `npm audit fix`, dependency update, or lockfile mutation was attempted.
- CI workflow was separated into two jobs so the focused identity syntax/test job can complete independently while the repository regression job truthfully reports the existing missing-test-file failure.

This baseline suite failure is not attributed to the identity-context patch. It remains a release gate until the missing test is restored or the package test command is reconciled in a separately reviewed change.


## Regression-gap reconciliation progress

Two test files were restored from the Phase 9 branch onto the Render-base candidate after confirming their directly exercised implementation dependencies were byte-identical on both branches:

- `tests/change-management-regression-test.js`: restored; its change-management regression checks passed in run #16.
- `tests/custom-provider-config-v1.test.js`: restored; schema, endpoint policy, atomic persistence, and secret-exclusion checks passed in run #16.

The next `npm test` blocker is `tests/custom-provider-config-route-isolated.test.js`, which is absent from the Render-base branch. Its fixture also copies `services/mira-json-state-store.js` and `services/mira-store-initialization-guard.js`, both absent from the Render-base branch. That test and those runtime dependencies were **not** copied because they form a wider implementation dependency set requiring separate compatibility review.

Latest run #16:
- `identity-context`: **PASS**.
- `repository-regression`: **FAIL / NEXT BASELINE GAP** after the two restored tests passed.
- No production runtime code was changed to make the regression command pass.
