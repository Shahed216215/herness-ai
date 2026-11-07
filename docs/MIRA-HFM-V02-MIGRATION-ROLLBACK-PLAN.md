# Mira HFM v0.2 — Production Migration and Runtime Rollback Plan

**Status:** DESIGN ONLY — NOT EXECUTED  
**Target:** HFM v0.2  
**Scope:** migrations 002, 006, 010–015; Render runtime integration  
**Safety boundary:** no production migration, database write, role change, environment mutation, deployment, or restore is authorized by this document.

## 1. Current rollback baseline

- The inspected HFM production-candidate branch in Neon project `steep-grass-38696226` has the eight-table HFM baseline with RLS and FORCE RLS enabled. Its owner, membership, operation-authority, and Memory registries were empty at the last read-only inspection.
- The separate staging branch `br-lingering-dawn-a18x6pxx` is **not empty**: it has one owner, one membership, one Memory record, and two authority audit events. Preserve those rows. Migration 013 must not be run against that branch.
- The second same-name Neon project `fancy-wave-81945737` has no `mira_hfm` schema on its inspected production branch. Render's active `DATABASE_URL` target is not observable through the available service-inspection surface. The exact deployment database must be identified before any migration.
- Migrations 010–015 remain source-only. Migration 015 adds restrictive actor/membership/operation/authority scope to the writer and reader roles; it requires exact-target policy/role compatibility review before any separately approved application. Migration 002 and the project-selection Migration 006 remain separate approval gates. No HFM runtime flags have been enabled on Render.
- There are no approved in-place down migrations. This plan deliberately does not provide executable DROP/DELETE/role-reset SQL.

## 2. Mandatory pre-migration recovery point

Before any separately approved production or staging migration:

1. Confirm the exact Neon project ID, branch ID, database, region, and Render connection target using an authorized secret-safe inspection path. Do not infer the target from project names.
2. Create a Neon point-in-time recovery point or branch snapshot immediately before the migration window. Record the timestamp, source branch, and snapshot/branch identifier.
3. Verify that the account's PITR retention window covers the planned validation and rollback period. If retention is insufficient or restore access is unverified, stop.
4. Export a read-only schema/privilege baseline: table definitions, constraints, indexes, RLS/FORCE RLS, policies, triggers, functions, role attributes, role memberships, schema/table/sequence/function grants, and default privileges.
5. Record row counts only for the relevant registries and audit tables. Do not export or print Memory payloads or credentials. Preserve encrypted payloads and audit rows as part of the snapshot.
6. Verify the snapshot by restoring it to a separate isolated Neon branch and comparing schema fingerprints, RLS/policy inventory, role attributes, and row counts. Do not restore over the source branch.
7. Store the recovery evidence and approval reference outside the production database. Keep secrets out of reports.

**Gate:** if any prerequisite is missing, migration status is `NOT_APPROVED`; do not begin.

## 3. Migration-specific rollback posture

| Migration | Change class | Safe rollback posture |
|---|---|---|
| 002 — runtime read grants | Optional role grants | Target-specific and not approved. If ever applied, disable the affected runtime first; revoke only the exact reviewed grants. Do not remove roles or broad grants by assumption. |
| 006 — project-selection reader | NOLOGIN role, SELECT grants, two RLS policies | Source-only. If approved and later retired, disable project-selection runtime, remove only the two exact policies and their reviewed grants, and drop the role only after proving no LOGIN membership, ownership, dependency, or active connection remains. Never disable RLS/FORCE RLS. |
| 010 — Memory reader role | NOLOGIN reader role, SELECT/authority-consumption/audit INSERT grants, RLS policies | Source-only. Disable HFM read flags and stop new reader sessions first. Preserve authority audit events. Revoke exact grants and remove exact policies only after dependency/connection checks. Do not delete authority or Memory records. |
| 011 — issuer hardening | Alters issuer role to NOINHERIT; removes six older permissive policies; installs actor-bound policies | Do **not** restore the older permissive policies as an ordinary rollback. Keep the least-privilege NOINHERIT posture. If an emergency reversal is unavoidable, restore only from the verified pre-migration snapshot on a new isolated branch, review the exact policy diff, and require explicit security approval. |
| 012 — approval nonce registry | New nonce table, indexes, RLS/policies, grants | Preserve all nonce rows, including consumed/replayed/expired evidence. Disable approval issuance/consumption before any rollback. Do not drop the table or truncate nonce history if tokens have ever been issued. Prefer retaining the table with runtime access revoked. |
| 013 — one-time bootstrap latch | New latch table, bootstrap role/policies, initial owner/membership/audit inserts | Irreversible after bootstrap. Never delete the latch, owner, membership, or audit event to simulate rollback. The migration is not applicable to the inspected non-empty staging branch. If bootstrap has occurred, recover by forward repair or isolated snapshot restore with explicit approval; never re-run bootstrap. |
| 014 — 365-day standing read authority | New authority table, indexes, RLS, lifecycle/audit triggers, audit policy changes | Disable standing-read and Work Learning flags first. Preserve all standing-authority rows and append-only audit events. Do not delete grants or audit history. If the runtime must be withdrawn, revoke the runtime's exact privileges after stopping sessions; retain the table and audit evidence. |
| 015 — actor/membership/operation RLS | Replaces named reader/writer policies with RESTRICTIVE actor-bound policies; no tables or grants added | Source-only. If approved and later retired, stop reader/writer traffic first. Do not restore broad project-only policies. Any policy replacement must be reviewed against the exact pre-migration snapshot and least-privilege matrix; preserve all records and audit history. |

## 4. Runtime rollback sequence

If a deployed HFM runtime fails an approved smoke/security gate:

1. Stop further HFM traffic using the approved operational control. Do not silently fall back to phone storage, local JSON, or Google Drive.
2. Disable the specific HFM feature flags through an explicitly approved Render configuration change. Do not change secrets or flags from this plan alone.
3. Stop or drain active writer/reader sessions where the platform supports it. Preserve request IDs and audit events.
4. Keep the canonical database schema, RLS/FORCE RLS, append-only audit tables, nonce history, bootstrap latch, and standing-authority history intact.
5. If application code must be reverted, use the verified prior deployment/commit only after confirming its database compatibility. Do not assume a code rollback makes a schema rollback safe.
6. Verify that the service reports HFM unavailable/non-persistent explicitly and that no local/Drive fallback is activated.
7. Capture health, authorization, audit, and error evidence. Re-enable any HFM capability only after a new approval and full gate rerun.

## 5. Database recovery sequence

- Prefer restore to a **new isolated branch** from the pre-migration recovery point.
- Compare the restored branch with the source using schema fingerprints, role/policy/grant inventory, row counts, and audit continuity.
- Never use `DROP TABLE`, `TRUNCATE`, payload deletion, registry deletion, or role reset as a routine rollback.
- Never restore an older snapshot over a branch that has accepted new user data without an explicit data-reconciliation plan and approval.
- If any post-snapshot writes occurred, preserve both branches and reconcile records by immutable IDs, version/digest, idempotency key, provenance, and audit history. Do not silently discard either side.
- Keep append-only audit events immutable. A correction must be a new audited event, not an update/delete.

## 6. Rollback triggers

Stop and invoke the approved rollback decision path if any of these occurs:

- Database/project identity differs from the approved target.
- Any RLS/FORCE RLS, role, membership, grant, or policy preflight differs from the reviewed baseline.
- A runtime principal has superuser, BYPASSRLS, object ownership, unexpected role inheritance, or privileges outside its approved matrix.
- Cross-project or unauthorized read/write succeeds.
- Audit insert fails, an audit event is mutable, a nonce/request ID replays, or page authority identity drifts.
- Read-after-write digest/version/idempotency verification fails.
- Canonical writer unavailable but local/Drive fallback occurs.
- Render HFM flags/secrets cannot be verified or service health/authorization smoke fails.
- Any migration unexpectedly changes user data or violates the expected row-count/integrity baseline.

## 7. Approval gates

This plan does not authorize execution. Separate explicit approval is required for:

- exact Neon project/branch selection;
- applying 002 or 006;
- applying 010–015;
- any role/grant/policy change;
- bootstrap or production data write;
- Render environment/secret changes or flag enablement;
- deployment, merge, restore, or irreversible recovery action.

## 8. Current disposition

- Rollback design: **PREPARED — DESIGN ONLY**
- Pre-migration snapshot: **NOT_CREATED / NOT_VERIFIED**
- Restore rehearsal: **NOT_RUN**
- Production migrations 010–015: **NOT_APPLIED**
- Render HFM runtime: **NOT_CONFIGURED / NOT_VERIFIED**
- Production deployment: **NOT_APPROVED**

HFM v0.2 remains incomplete. No v0.3 work is included.
