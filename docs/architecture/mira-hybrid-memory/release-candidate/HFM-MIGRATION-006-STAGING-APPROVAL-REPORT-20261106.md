# MIRA HFM v0.2 — Migration 006 Staging Review & Approval Report

**Date:** 2026-11-06  
**Original review decision:** NOT APPROVED FOR EXECUTION — REVIEW REQUIRED
**Current staging status (2026-11-07):** APPLIED TO NEON STAGING ONLY — POSITIVE/NEGATIVE RLS TESTS PASS; PRODUCTION NOT APPROVED  
**Scope:** HFM v0.2 source preparation only

## 1. Source target

- Repository: `Shahed216215/herness-ai`
- Branch: `work/hfm-v02-memory-runtime-gate-audit-20261106`
- Reviewed source head: `c40c7bcfbf3ebb364be35f2b6378c2040a4383bb`
- Baseline reviewed: `d89d14122aca08494a493384fc0c0a2941a46264`
- Migration: `migrations/hfm/006_project_selection_read_policy.sql`

## 2. Source hardening completed

1. Runtime preflight now verifies the reader group's NOLOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, and NOBYPASSRLS attributes.
2. Runtime preflight requires the table owners to be distinct from both the connected LOGIN role and the reader group.
3. Existing table-level and column-level non-SELECT privilege checks are retained, including INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER.
4. Runtime preflight checks the exact reader policy names, SELECT command, PERMISSIVE mode, exact role assignment, absence of WITH CHECK clauses, and absence of PUBLIC or additional reader-group policies.
5. Policy expressions are normalized only for whitespace and PostgreSQL type casts. Parentheses are preserved so the membership expiry expression's OR grouping remains part of the exact comparison.
6. Migration 006 now aborts before granting access if either registry table has a PUBLIC policy or a pre-existing policy assigned to the reader group.
7. Runtime and migration contract tests were expanded for the stricter role and policy contract.
8. Readiness documentation was updated to record the new controls.

## 3. Migration integrity

- File: `migrations/hfm/006_project_selection_read_policy.sql`
- Size: 4,526 bytes (UTF-8)
- SHA-256: `493a9aa1c8f3aad2f7d52fb793a0f58da9d6132c9c47fd7f6ff04cdf7058ed8b`
- GitHub blob SHA-1: `7cfaa3b27c61f9c6fc5bda136cb88a49c4e48f83`

The digest is for the current source-only draft. Recompute it again immediately before any execution approval.

## 4. Target boundary

The previously identified target remains:

- Neon Project: `mira-ai-agent-db`
- Project ID: `steep-grass-38696226`
- Branch: `mira-hfm-test`
- Branch ID: `br-lingering-dawn-a18x6pxx`
- Database: `neondb`
- Parent branch: `production`

This report does not authorize a database write. The target must be re-identified and rechecked immediately before any later execution.

## 5. Verification status

| Check | Status | Evidence boundary |
|---|---|---|
| GitHub branch and source files retrieved | PASS | Read-only source inspection |
| Scoped source diff reviewed | PASS | Five HFM v0.2 files only |
| Runtime role-attribute contract updated | PASS | Source and test assertions inspected |
| Exact owner/membership policy contract updated | PASS | Parentheses-preserving normalization |
| PUBLIC/pre-existing reader-policy migration guards added | PASS | Migration and contract assertions inspected |
| Migration SHA-256 / Git blob SHA-1 | PASS | Recomputed and Git blob SHA-1 matched |
| Node test execution | NOT RUN | No Termux test was run |
| Render runtime preflight | NOT RUN | No Render runtime test or environment change |
| Dedicated LOGIN role positive/negative RLS tests | NOT RUN | Requires migration and separately provisioned LOGIN role |
| Migration 006 applied | NO | Source-only draft remains unapplied |
| Production / merge / deploy | NOT PERFORMED | No such action authorized |

## 6. Remaining blockers

- Execute the relevant source-level test suites in the approved test environment.
- Run the runtime preflight on Render only after the correct source revision is available there and the required environment is separately approved.
- After a separately approved staging migration, provision the dedicated LOGIN role through the approved secret-handling process and run real positive/negative row-visibility tests.
- Recheck the exact Neon project, branch, database, role memberships, grants, RLS state, policy state, and migration digest immediately before any staging write.

## 7. Approval decision

**Migration 006 execution remains NOT APPROVED.**

Source hardening is committed, but tests have not been executed and the actual LOGIN-role RLS behavior has not been verified. Do not execute Migration 006, create or alter database roles, change secrets or Render environment variables, deploy, merge, or touch Production under this report.

The next permitted work is test planning and the approved Render runtime verification path. A separate explicit staging-write approval is required before Migration 006 is executed.


## 8. Revalidation and staging execution addendum (2026-11-07)

**Execution target (re-identified immediately before execution):**
- Neon Project: mira-ai-agent-db
- Project ID: steep-grass-38696226
- Branch: mira-hfm-test
- Branch ID: br-lingering-dawn-a18x6pxx
- Database: neondb
- Branch state: ready; non-default, non-primary staging branch
- Parent branch: production

**Source integrity:**
- Current migration file GitHub blob SHA-1: 7cfaa3b27c61f9c6fc5bda136cb88a49c4e48f83
- This exactly matches the reviewed report's GitHub blob SHA-1.
- Recorded SHA-256 remains 493a9aa1c8f3aad2f7d52fb793a0f58da9d6132c9c47fd7f6ff04cdf7058ed8b.
- Migration source content was unchanged from the reviewed blob.

**Preflight immediately before execution:**
- Both target tables exist and have ENABLE + FORCE RLS.
- Reader group role did not exist.
- No reader policy-name collisions or PUBLIC policies were present.
- Both target tables had zero owner/membership fixture rows.
- No production branch was targeted.

**Execution:**
- Migration 006 statements executed transactionally on the staging branch only after explicit user authorization.
- Created NOLOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS role mira_hfm_project_reader.
- Granted schema USAGE and SELECT only on project_owners and project_memberships.
- Created the two SELECT policies:
  - hfm_project_reader_owner_select
  - hfm_project_reader_own_membership_select

**Dedicated LOGIN RLS verification:**
- Created temporary read-only LOGIN role mira_hfm_project_reader_test_20261107, scoped to schema mira_hfm.
- Revoked its direct SELECT grants on all HFM tables and granted membership only in mira_hfm_project_reader.
- Role attributes verified: LOGIN, INHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS.
- Positive test: selected project owner rows = 1; selected actor membership rows = 1.
- Cross-project negative test: other-project owner rows = 0; other-project membership rows = 0.
- Cross-actor negative test: selected project owner row remains visible = 1; another actor's membership rows = 0.
- Missing-project-context negative test: owner rows = 0; membership rows = 0.
- All tests were read-only while using the temporary LOGIN role.

**Cleanup verification:**
- Both synthetic project owner rows and both synthetic membership rows were deleted.
- Temporary LOGIN role was revoked from the reader group and deleted.
- Post-cleanup verification: owner_fixture_rows = 0; membership_fixture_rows = 0; test_role_still_exists = false.

**Current boundary:**
- Migration 006 is applied to the staging branch only.
- The permanent mira_hfm_runtime LOGIN role was not granted reader-group membership.
- No real project owner, membership, or operation-authority rows were provisioned.
- No Render environment variables or secrets were changed.
- No production migration, production database write, merge, or deployment occurred.

**Updated assessment:**
| Gate | Status |
|---|---|
| Migration 006 staging apply | PASS |
| Reader group role hardening | PASS |
| Exact owner and membership SELECT policy contract | PASS |
| Dedicated temporary LOGIN positive/negative RLS tests | PASS |
| Synthetic fixture cleanup | PASS |
| Permanent runtime LOGIN membership | NOT_CONFIGURED |
| Real project owner/membership bootstrap | BLOCKED / NOT_APPROVED |
| Render HFM read runtime activation | NOT_CONFIGURED |
| Production readiness | NOT_CERTIFIED |
