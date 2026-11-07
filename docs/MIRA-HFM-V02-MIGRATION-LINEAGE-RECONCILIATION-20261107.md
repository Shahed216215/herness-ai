# Mira HFM v0.2 — Migration Lineage Reconciliation

Date: 2026-11-07  
Status: **SOURCE_LINEAGE_RECONCILED / LIVE_TARGET_REVIEW_REQUIRED**

## Finding and source correction

The runtime-integration branch originally reused migration IDs 007–009 for SQL that differed from the previously applied Neon production lineage. That source-level collision has now been corrected on this branch.

The branch now preserves the exact previously applied 007–009 migration files from the Memory Core lineage and moves the runtime-integration additions to 010–014. The disposable PostgreSQL workflow has been updated to apply the preserved baseline followed by the additive runtime migrations.

## Canonical migration sequence in this branch

| ID | Canonical migration | Purpose |
|---|---|---|
| 001 | `001_project_authority_registry.sql` | Project authority registry |
| 002 | `002_runtime_readonly_grants.sql` | Optional legacy runtime read grants; target-specific prerequisite remains unverified |
| 003 | `003_authority_relational_integrity.sql` | Relational integrity |
| 004 | `004_memory_repository_schema.sql` | Canonical Memory repository schema |
| 005 | `005_memory_writer_role_and_project_rls.sql` | Memory writer capability and project RLS |
| 006 | `006_project_selection_read_policy.sql` | Project-selection reader policy |
| 007 | `007_authority_issuer_role.sql` | Previously applied authority issuer capability role |
| 008 | `008_project_bootstrap_issuer.sql` | Previously applied owner/membership bootstrap capability extension |
| 009 | `009_dedicated_login_principals.sql` | Previously applied writer/issuer LOGIN principals |
| 010 | `010_memory_retrieval_runtime_role.sql` | Constrained Memory reader role |
| 011 | `011_authority_issuer_role_hardening.sql` | Hardens the existing issuer role and replaces legacy permissive issuer policies |
| 012 | `012_authority_approval_nonce_registry.sql` | Persistent single-use approval nonce registry |
| 013 | `013_one_time_initial_project_bootstrap.sql` | One-time initial-project bootstrap latch and role |
| 014 | `014_standing_read_authority_365_days.sql` | Project-scoped, revocable, 365-day standing read authority |
| 015 | `015_actor_membership_operation_rls.sql` | RESTRICTIVE actor-bound writer/reader RLS for active owner/member, operation permission, exact resource, and live/consumed authority |

The 007–009 files are copied byte-for-byte from the previously verified Memory Core branch. The new 011 migration uses the existing issuer role rather than creating a second migration identity. It changes the role to NOINHERIT, removes the old project-only/owner-insert issuer policies, and installs the newer actor-bound policies. The dedicated issuer LOGIN principal remains the only intended member and inherits the group because the LOGIN role itself has INHERIT.

## Migration 006 source conflict

A separate Memory Core branch contains `006_social_post_manual_publish_payload_erasure.sql`. That migration was not applied to the inspected Neon target because its prerequisite social-post state table/columns were absent. The runtime-integration branch keeps `006_project_selection_read_policy.sql`, which is required by project-selection runtime preflight. Do not merge both different SQL files under migration ID 006. Keep the social-post payload-erasure migration deferred until its schema prerequisite and a new canonical migration identity are reviewed.

## Live-target prerequisites remain

1. The exact Neon project and branch used by Render are not yet unambiguously mapped. Do not conflate the previously verified production branch with the non-empty staging branch.
2. Migration 002 was not applied to the previously inspected production target because its legacy runtime role was absent. Whether it is required for the final target must be determined from the exact role/runtime design; do not apply it by default.
3. Migration 006 is source-only and must be tested against the exact target's policy state before any application.
4. Migration 013 bootstrap requires empty owner, membership, operation-authority, and Memory registries. The inspected staging target already contained owner, membership, and Memory rows, so migration 013 is **NOT_APPLICABLE** to that target. Preserve those rows.
5. Migration 011 must be validated against the exact target role attributes and legacy policy names. It deliberately drops six prior issuer policy names and replaces them with actor-bound policies; review its effects before applying.
6. Dedicated LOGIN role credentials, exact grants, RLS policies, and runtime preflight must be verified without exposing credential values.
7. Any previously existing operation-registry rows created before private payload digests were keyed must be treated as legacy idempotency evidence. Do not replay those idempotency keys blindly; reconcile them through a controlled, audited process.

## Validation boundary

The disposable PostgreSQL 16 workflow applies 001–009 in canonical order, then 010–015. Exact PR-head commit `0c9aeed03938cd1a3a966d5b0151729dc4d7b055` passed workflow `42366089608`, including bootstrap/issuer nonce flow, actor-bound writer and reader membership/operation RLS, standing-read RLS and audit behavior, forced RLS, and exact role-boundary checks. The actor-bound negative writer fixture uses an EXPIRED historical membership to satisfy the authority revision FK while verifying that RLS still rejects the write. The standing-read fixture asserts the exact eligible record IDs and excludes pending Knowledge/Social Draft records. Disposable-CI migration validation for 001–015 is **PASS**; live Neon target compatibility remains **NOT_VERIFIED**. No migration was applied to Neon.

No Neon migration, production data write, role change, Render environment change, feature-flag enablement, merge, or deployment was performed as part of this source-lineage correction.

HFM remains v0.2. No v0.3 work is authorized.
