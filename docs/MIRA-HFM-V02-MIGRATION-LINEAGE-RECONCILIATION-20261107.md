# Mira HFM v0.2 — Migration Lineage Reconciliation

Date: 2026-11-07  
Status: **REVIEW_REQUIRED — no migration execution authorized by this record**

## Finding

The runtime-integration branch currently contains migrations numbered 007–011. The existing Neon production lineage previously verified for the HFM Memory foundation already applied migrations numbered 007–009 from the separate Memory Core branch. Those IDs refer to different SQL contents.

This is a migration identity collision, not a harmless filename difference. A fresh disposable PostgreSQL chain can pass while the same migration files remain unsafe or inapplicable to an already-migrated Neon database.

## Conflicting migration identities

| Migration ID | Previously applied Neon production lineage | Runtime-integration branch |
|---|---|---|
| 007 | `007_authority_issuer_role.sql` — creates the authority issuer capability role and project-scoped issuer policies | `007_memory_retrieval_runtime_role.sql` — creates a dedicated Memory reader role |
| 008 | `008_project_bootstrap_issuer.sql` — adds owner/membership INSERT capability to the existing authority issuer role | `008_authority_issuer_role.sql` — redefines/hardens the same authority issuer role and policy set |
| 009 | `009_dedicated_login_principals.sql` — creates dedicated writer/issuer LOGIN principals | `009_authority_approval_nonce_registry.sql` — creates the approval nonce registry |

The runtime branch's 010 bootstrap and 011 standing-read migrations depend on the runtime branch's versions of 007–009. They must not be assumed to follow the already-applied production lineage.

## Additional compatibility conflicts

1. The previously applied 007 issuer migration creates `mira_hfm_authority_issuer` without explicitly setting `NOINHERIT`. Runtime migration 008 requires an existing issuer role to have `rolinherit = false`; it therefore fails its own role-attribute preflight against that previously created role unless a reviewed compatibility migration is prepared.
2. The previous issuer migration created policy names `authority_issuer_owner_read`, `authority_issuer_membership_read`, `authority_issuer_insert`, and `authority_issuer_audit_insert`. Runtime migration 008 adds a second set of issuer policies. PostgreSQL permissive policies combine with OR semantics; retaining both sets may preserve broader access than the newer actor-bound policy intended.
3. Runtime migration 010 is a one-time bootstrap and explicitly requires empty owner, membership, operation-authority, and Memory registries. A separate read-only staging inspection recorded existing owner, membership, and Memory rows. It is not applicable to that non-empty staging target.
4. The Neon target mapping remains ambiguous across the duplicate projects/branches previously inspected. Production and staging migration histories must not be conflated.

## Required reconciliation before any staging or production migration

- Obtain a read-only migration inventory from the exact target Neon project and branch, including table/role/policy state and any migration ledger that exists.
- Preserve the existing 007–009 applied SQL identity. Never overwrite an applied migration ID with different contents.
- Prepare a new, strictly additive migration sequence after the highest verified applied ID. Each new migration must declare exact prerequisites and be tested against a disposable database seeded with the **same prior 001–009 schema and role state**, not only a fresh empty database.
- Replace duplicate issuer policies rather than leaving permissive legacy policies active. Verify the resulting exact policy set and effective grants for every dedicated LOGIN principal.
- Keep the bootstrap route/migration disabled for any target containing owner, membership, authority, or Memory rows. Do not rewrite or delete those rows to make the bootstrap precondition pass.
- Verify the target branch identity, snapshot/recovery point, dedicated role credentials, and runtime preflight before considering activation.

## Current disposition

- Migrations 007–011 in the runtime-integration branch remain **SOURCE_ONLY / NOT_APPLIED**.
- Migration 010 initial bootstrap is **NOT_APPLICABLE** to the inspected non-empty staging registry.
- Migration 011 standing-read authority remains **SOURCE_ONLY** until its role/policy dependencies are reconciled against the actual target lineage.
- No Neon migration, data write, role change, Render environment change, feature-flag enablement, merge, or deployment was performed as part of this reconciliation.
- HFM remains v0.2. No v0.3 work is authorized.
