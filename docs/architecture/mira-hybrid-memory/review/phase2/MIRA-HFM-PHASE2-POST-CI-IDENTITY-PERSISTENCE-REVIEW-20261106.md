# MIRA HFM Phase 2 — Post-CI Identity and Persistence Review

**Review date:** 2026-11-06  
**Target:** `work/hfm-phase2-identity-guard-render-base-20261106`  
**Base:** Render-connected branch `work/render-host-binding-env-compat-audit`  
**Scope:** Read-only review of the PR #52 candidate after CI run #46. No production service, credentials, environment variables, deployment, or user data were changed.

## Result

- Canonical login-session identity issuance: **PASS (code-path review)**
- Legacy configured user without a stable UUID: **FAIL-CLOSED by design**
- Shared bearer authentication as a canonical HFM actor: **FAIL-CLOSED by design**
- Canonical principal validation and session binding: **PASS (unit-test evidence from CI #46)**
- Trusted identity transport to tool dispatch: **PASS (transport only)**
- Trusted identity consumption by existing memory/knowledge tools: **NOT_INTEGRATED**
- Durable Project Owner Registry: **BLOCKED**
- Render production HFM authorization: **NOT_ESTABLISHED**
- Production deployment/live HFM test: **NOT_PERFORMED**

## Authentication review

The login route regenerates the Express session before setting authenticated state and issuing the HFM principal. The principal is issued only from server-side authentication output:
- Registered users use the authenticated user record UUID.
- Admin sessions require `MIRA_ADMIN_SUBJECT_ID` to contain a UUID.
- The principal binds its authentication reference to the regenerated `req.sessionID`.
- `authenticatedAt` is server-generated; `expiresAt` is derived from the configured eight-hour session max age.
- The runtime context checks authenticated session state, role consistency, expected issuer and method, UUID subject format, session-reference equality, and temporal validity.
- Legacy configured users without a stable UUID and shared bearer-token requests do not receive a canonical HFM principal.

The Render environment has not been modified to provision `MIRA_ADMIN_SUBJECT_ID`. Do not treat the synthetic admin test fixture as evidence that a production admin subject exists.

## Identity transport boundary

The request path passes `buildTrustedActorContext(req)` into the work execution engine, then through the tool runner and registry to `tool.execute(args, trustedContext)`.

However, the currently inspected `tools/memory-save.js` and `tools/knowledge-save.js` callbacks accept only the arguments object and do not read or validate the second `trustedContext` parameter. Therefore the present result proves transport, not identity-aware memory persistence or authorization. Do not describe HFM project authorization or actor-scoped memory operations as implemented.

This is a staged integration gap, not evidence that the canonical identity validator itself failed.

## Persistence and Render deployment review

The Render service currently reports:
- Plan: **Free**
- Service: `mira-ai-agent`
- Connected branch: `work/render-host-binding-env-compat-audit`
- Build/start: `npm install` / `node server.js`
- No Render Postgres instances were returned for the workspace.
- The service detail response did not establish a persistent disk.

Repository storage review:
- `mira-storage.js` resolves local filesystem storage; without a configured root it defaults to the repository directory.
- `project-store.js` persists projects in `data/projects.json` through local filesystem reads/writes.
- The package manifest on the Render base has no PostgreSQL, Supabase, SQLite, Prisma, or Knex database client dependency.
- Existing Google Drive code supports memory/knowledge JSON synchronization, but it is not a transactional project-owner/membership registry and is not currently wired into `project-store.js`.

Consequently, a JSON Project Owner Registry on the current Free web-service filesystem would not meet the durability requirement. No owner registry or project membership records were created.

## Required gates before implementation or release

1. Select and explicitly approve a durable persistence backend and its cost/privacy/backup model. Do not create a paid database or provision external credentials without approval.
2. Define a schema and migration/recovery strategy for project-owner records, explicit memberships, revocation, revisions, and audit events.
3. Establish trusted actor identity consumption at the storage/authorization boundary; passing context through callbacks alone is insufficient.
4. Keep legacy bearer requests and unassigned projects blocked until independently verified mappings and approvals exist.
5. Add isolated integration tests for login → principal → authorization → durable write/read/revocation, including restart/redeploy recovery.
6. Only after those gates, plan a controlled deployment and authenticated live HFM test.

## Change and release statement

This review adds documentation only. No production code was changed by this review. PR #52 remains a draft candidate; it must not be merged or deployed on the strength of CI #46 alone. Production HFM readiness remains **NOT_CERTIFIED**.
