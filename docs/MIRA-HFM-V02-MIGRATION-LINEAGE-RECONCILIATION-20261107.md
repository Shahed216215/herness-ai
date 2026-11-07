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
| 016 | `016_memory_record_revision_authority.sql` | Exact-resource memory revision/update and lifecycle authority with immutable version history | SOURCE-ONLY; not approved for live application |
| 017 | `017_source_reference_record_v1_2.sql` | Adds source_reference under schema v1.2.0 while retaining v1.0.0/v1.1.0 compatibility | SOURCE-ONLY; not approved for live application |
| 018 | `018_restricted_vault_write_authority.sql` | Distinct memory.vault.write authority and restricted Client/Financial Vault insert policy | SOURCE-ONLY; not approved for live application |

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

The disposable PostgreSQL 16 workflow applies 001–009 in canonical order, then 010–015. Exact PR-head commit `0c9aeed03938cd1a3a966d5b0151729dc4d7b055` passed workflow `42366089608`, including bootstrap/issuer nonce flow, actor-bound writer and reader membership/operation RLS, standing-read RLS and audit behavior, forced RLS, and exact role-boundary checks. The actor-bound negative writer fixture uses an EXPIRED historical membership to satisfy the authority revision FK while verifying that RLS still rejects the write. The standing-read fixture asserts the exact eligible record IDs and excludes pending Knowledge/Social Draft records. Disposable-CI migration validation for 001–015 on the recorded historical commit is **PASS**; the later 016–018 additions require fresh exact-head CI evidence. Live Neon target compatibility remains **NOT_VERIFIED**. No migration was applied to Neon.

No Neon migration, production data write, role change, Render environment change, feature-flag enablement, merge, or deployment was performed as part of this source-lineage correction.

HFM remains v0.2. No v0.3 work is authorized.


## 2026-11-07 follow-up: migrations 016–018 and live Neon inventory

A later source review found three additional migration files. They are now listed in the canonical source sequence above, but remain source-only and are not approved for live application:

| ID | File | Scope | Disposition |
|---|---|---|---|
| 016 | `016_memory_record_revision_authority.sql` | Exact-resource `memory.update`/trash/restore authority, revision/version history, and constrained writer update policy | SOURCE-ONLY; not approved for live application |
| 017 | `017_source_reference_record_v1_2.sql` | Adds `source_reference` under schema v1.2.0 while retaining v1.0.0/v1.1.0 compatibility | SOURCE-ONLY; not approved for live application |
| 018 | `018_restricted_vault_write_authority.sql` | Adds distinct `memory.vault.write` authority and restricted Client/Financial Vault insert policy | SOURCE-ONLY; not approved for live application |

**Workflow/lineage mismatch:** `.github/workflows/hfm-postgres-migrations.yml` currently applies 001–018 in its disposable PostgreSQL job, while the canonical lineage section and its recorded CI evidence cover only 001–015. This mismatch must be reconciled before relying on that workflow as a release gate. The latest clean-integration HEAD `a08fb017065dde4962ba1835a03a65d8b9a008ea` had eight observed GitHub workflow checks complete successfully (HFM foundation, Memory repository, session persistence, Render host binding, dependency remediation, Run Agent regression, Competitor Intelligence, and approval diagnostic). The Render live HTTP smoke job was skipped. The commit's workflow-run listing did not include the PostgreSQL migration-chain workflow. Therefore migration validation on the latest HEAD is **NOT_VERIFIED**, not PASS.

### Read-only Neon branch inventory

Inspected using read-only SQL on 2026-11-07; no schema or data was changed:

- Project `steep-grass-38696226` (`mira-ai-agent-db`), default branch `br-crimson-sun-a13xzreh` (`production`): eight HFM tables; all eight had RLS and FORCE RLS enabled; policy counts per table matched the eight-table baseline; owner, membership, Memory, operation-authority, and audit/registry tables each returned zero rows.
- Same project branch `br-sparkling-dew-a19hib3f` (`mira-hfm-prod-migration-candidate-20261107`): same eight tables, RLS/FORCE RLS and policy counts, and zero rows in the inspected owner/membership/Memory/authority/audit registries.
- Staging branch `br-lingering-dawn-a18x6pxx` (`mira-hfm-test`): nine HFM tables including `memory_social_post_state`; it contains 3 owners, 3 memberships, 1 Memory record, 1 operation authority, 3 authority audit events, 1 operation-registry row, and 1 Memory version. Preserve all rows; Migration 013 remains NOT_APPLICABLE to this non-empty branch.
- Same-name second project `fancy-wave-81945737` has no `mira_hfm` tables on its inspected default branch. Project names alone do not establish the Render target.

The Render service's active database target still cannot be read through the available secret-safe service-inspection surface. Do not infer that Render uses either Neon project. No migration, role change, data write, or environment mutation was performed.

## 2026-11-07 follow-up: revision integrity guard and current PR CI

Migration 016 and the canonical Memory repository revision path were hardened so `memory.update` cannot change `integrity_status` or `trust_status`. The writer's column-level UPDATE grant excludes `integrity_status`; the trigger rejects any integrity/trust metadata change; the repository validates the incoming integrity status against the stored row and no longer updates that column. Regression coverage rejects integrity-status tampering and confirms the revision UPDATE statement does not touch trust/integrity metadata.

Exact branch HEAD `4a4fb954c31e7dd76c2bc55935a010224c0754ca` completed the eight existing PR workflow checks successfully: HFM runtime foundation, Memory repository contracts, session persistence, Render host binding, dependency remediation, Run Agent regression, Competitor Intelligence, and approval diagnostic. Render live HTTP smoke was skipped. The standalone `hfm-postgres-migrations.yml` push run still produced a failed run with zero jobs; no disposable PostgreSQL 001–018 execution evidence was obtained. Its migration-chain status remains **NOT_VERIFIED** (not PASS). This branch remains Draft and unmerged; Render and Neon were not changed.
