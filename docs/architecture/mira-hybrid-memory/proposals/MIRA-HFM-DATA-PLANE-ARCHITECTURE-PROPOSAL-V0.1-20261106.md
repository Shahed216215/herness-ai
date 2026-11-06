# Mira HFM Data Plane Architecture Proposal v0.1

**Status: PROPOSED / NOT APPROVED / NOT IMPLEMENTED**  
**Date:** 2026-11-06  
**Target:** PR #64 branch  
**Related evidence:** MIRA-HFM-DATA-PLANE-CALLSITE-AUDIT-20261106.md

> Design only. This proposal does not authorize schema creation, migration, data movement, role grants, production configuration changes, deployment, or deletion of legacy data.

## 1. Proposed architecture decision

Adopt a project-scoped canonical record model. Use PostgreSQL as the initial candidate for durable structured payloads, logically separated from the existing HFM authority registry. Keep the authority registry as the source of truth for ownership, membership, and operation grants. Place payloads in a dedicated schema (proposed: mira_hfm_data), accessed only through a narrow trusted service/database API.

Evaluate the existing Neon PostgreSQL project first to respect the zero-budget constraint. Before approval, recheck current free-tier compute, storage, branch, connection, backup, retention, sleep/cold-start, and availability limits. Free-tier durability and permanent zero cost are not assumed. No proposed schema or role is created by this document.

Use JSONB for bounded structured text. Binary attachments, large files, embeddings/vector search, and high-volume event streams are deferred to separate cost/security reviews.

## 2. Goals and exclusions

Goals:
- Every record has immutable identity, project scope, type, owner/provenance, classification, trust/lifecycle state, revision, timestamps, and integrity digest.
- Every operation is authorized against a trusted server-issued principal and current authority state.
- Authorization precedes retrieval ranking, snippets, model-context assembly, export, backup, and restore.
- Cross-project access is denied even when a caller guesses an identifier.
- Existing Memory/Knowledge data remains untouched until a separately approved migration.
- Idempotency, concurrency control, audit, backup/restore, and rollback are testable.

Exclusions:
- No unrestricted agent authority or self-granted permissions.
- No automatic migration, silent legacy fallback, or global cross-project search.
- No production rollout, data deletion, or legacy-store retirement.
- No vector database, binary object store, or paid AI API in v0.1.

## 3. Trust and storage boundaries

1. Identity boundary: authenticated server session resolves a canonical human principal. Request bodies, model output, email, display name, and caller-supplied roles never establish identity.
2. Authority registry: existing HFM owner, membership, operation-authority, and append-only audit concepts remain authoritative.
3. Data plane: proposed separate schema stores canonical records and revisions. It is not an authority source.
4. Service layer: trusted server-side services are the only application callers. Routes, tools, agents, and models do not query payload tables directly.
5. Retrieval policy: project, authorization, classification, trust, lifecycle, integrity, and conflict filters run before ranking.
6. Legacy adapters: local JSON and Google Drive remain isolated legacy sources until migration and cutover gates pass.

Proposed logical database separation:
- Existing authority schema: mira_hfm.
- Proposed payload schema: mira_hfm_data (not created).
- Migration/owner role: DDL and controlled migration only; never used by the live app.
- Authority runtime role: current read-only role remains read-only unless a separately approved API design replaces it.
- Data-plane runtime role: no broad table privileges. Prefer narrow database routines or table-specific least-privilege access with transaction-scoped authorization. Never grant schema CREATE, ownership, superuser, or unrestricted access.
- Test role: disposable database/branch only; no production credentials in CI.

Separate schemas provide logical, not physical, isolation. A separate database is a later option if blast-radius, residency, backup, or scale needs justify its cost.

## 4. Canonical record envelope

Use one versioned envelope for Memory, Knowledge, Project, Conversation, Message, and Lesson records. Domain-specific content lives in validated JSONB payloads.

| Field | Type | Rule |
|---|---|---|
| record_id | UUID | Immutable primary ID |
| project_id | UUID | Required; never proof of access by itself |
| record_type | enum/text | memory, knowledge, project, conversation, message, lesson |
| owner_subject_id | UUID | Stable owner principal |
| created_by_subject_id | UUID | Trusted creator |
| updated_by_subject_id | UUID | Trusted latest updater |
| classification | enum | public, project_internal, confidential, restricted |
| trust_state | enum | unverified, verified, quarantined, rejected |
| lifecycle_state | enum | active, archived, deleted_pending_retention |
| schema_version | integer | Required versioned contract |
| revision | integer | Monotonically increasing per record |
| payload | JSONB | Type-specific, validated, size-bounded |
| provenance | JSONB | Source type/ID, import batch, source digest, capture time |
| content_digest | text | SHA-256 of canonicalized record content |
| created_at / updated_at | timestamptz | Server-generated UTC |
| deleted_at | nullable timestamptz | Retention lifecycle only |

Initial indexes: (project_id, record_type, lifecycle_state), (project_id, updated_at), (project_id, owner_subject_id), and (project_id, record_id, revision). Add JSONB indexes only after measured query need.

Domain payloads:
- Memory: role, content, optional conversation_id, occurred_at, memory_kind, retention metadata.
- Knowledge: title, content, topic, source_uri, source_type, language, tags, optional learning structure.
- Project: display metadata, lifecycle, approved settings. Ownership/membership remain in authority registry.
- Conversation: metadata and ordered message records. Each message references its conversation and project; authorize both parent and child.
- Lesson: task/learning provenance, source task ID, lessons, trust state, and read-only/non-executable policy metadata.

Reject unknown security-sensitive fields, enforce size limits, normalize safely, and version every shape. Never store session secrets, tokens, or raw authorization grants in payload JSON.

## 5. Authorization contract

Every API call receives an internal TrustedRequestContext created by authentication middleware:
- canonical actor subject UUID;
- actor type and role;
- authentication/session reference;
- request/correlation ID;
- issuance and expiry timestamps;
- server-side source marker.

This context is internal and cannot be constructed from model output, request body, email, display name, or caller-supplied role.

Operation flow:
1. Authenticate session and resolve trusted principal.
2. Validate project/resource identifiers syntactically.
3. Begin a database transaction and lock relevant authority rows in a consistent order.
4. Verify actor, project, membership state, role, operation scope, expiry, and replay constraints.
5. Enforce classification/trust policy.
6. Perform payload operation and append audit event in the same transaction.
7. Commit; on failure roll back and return a non-revealing denial.
8. Log correlation ID and outcome, never payload secrets.

Rules:
- Project ID is a resource selector, not proof of access.
- Owner, membership, and operation authority are checked on every operation, not only login.
- Revoked/expired membership is denied on the next transaction.
- READ, LIST, COUNT, SEARCH, CREATE, UPDATE, DELETE, EXPORT, BACKUP, RESTORE, and MIGRATE are distinct scopes.
- List/count/search authorize the request and each returned record before content is exposed.
- Parent-child authorization applies to conversation messages.
- Admin role alone does not imply unrestricted payload access.
- Fail closed. No fallback to global local/Drive data if identity, authority, database, or policy is unavailable.

Database enforcement:
Prefer a narrow database API that performs authority verification, payload mutation, and audit append transactionally. If stored procedures are used, independently review ownership, SECURITY DEFINER, fixed search_path, input validation, execution grants, and function-owner privileges. A SECURITY DEFINER routine must not trust arbitrary actor IDs supplied by callers; the service-to-database trust mechanism must be explicitly designed and tested.

RLS may be defense in depth, but is insufficient if the application role can set arbitrary actor/project session variables. Test direct SQL bypass attempts.

## 6. Retrieval and prompt-injection controls

Eligibility pipeline:
1. Resolve trusted principal and project.
2. Authorize SEARCH on the project.
3. Fetch project-scoped candidates.
4. Re-check READ for every candidate.
5. Exclude inactive, unverified, quarantined, rejected, expired, integrity-failed, and conflict-pending records as policy requires.
6. Validate provenance and digest.
7. Apply classification redaction/minimization.
8. Only then rank and produce snippets.
9. Treat retrieved content as untrusted data, never as instructions or policy.
10. Record record ID, revision, digest, project, and policy decision for audit.

Global cross-project search is not allowed in v0.1. It requires a separate explicit authorization design.

## 7. Internal service contract

Illustrative methods:
- createRecord(context, projectId, type, payload, idempotencyKey)
- getRecord(context, projectId, recordId)
- listRecords(context, projectId, filters, cursor, limit)
- countRecords(context, projectId, filters)
- searchRecords(context, projectId, query, filters, limit)
- updateRecord(context, projectId, recordId, expectedRevision, patch, idempotencyKey)
- archiveRecord(context, projectId, recordId, expectedRevision)
- exportProject(context, projectId, exportPolicy)
- prepareRestore(context, projectId, snapshotId)
- applyRestore(context, projectId, snapshotId, explicitApprovalRef)

All methods require trusted context. Mutations require optimistic revision checks and idempotency keys. Routes/tools cannot call storage adapters directly.

## 8. Migration and cutover

Migration is a separate approved project.

A. Inventory every local/Drive source, record count, size, source path, modification time, and read error. Read-only.  
B. Create immutable source snapshots and verify SHA-256. Preserve original bytes and metadata.  
C. Map each record to a project only when ownership/scope is provable. Unknown or ambiguous scope is quarantined; never assign a default project.  
D. Dry run: report counts, rejected records, duplicates/conflicts, mapping decisions, digests, and projected storage.  
E. Import synthetic/approved test data into a disposable environment first.  
F. Independently verify source-target counts/digests, authorization, and recovery.  
G. Human approval must identify the exact source snapshot, target project, import manifest digest, and cutover plan.  
H. Controlled cutover: freeze legacy source read-only, import, verify, then switch only an approved scope.  
I. Retain immutable source snapshot and tested rollback/recovery path. No automatic source deletion.  
J. Retire legacy stores only after separate retention/recovery approval.

No legacy data is deleted in v0.1.

## 9. Backup, restore, and disaster recovery

- Backups are project-scoped, encrypted, integrity-manifested, and access-authorized.
- Manifest includes schema version, export time, source database identity, project ID, record count, IDs/revisions, per-record digest, and whole-snapshot digest.
- Backup and restore are distinct authorities. Possession of a file is not restore permission.
- Restore begins in PREVIEW/DRY_RUN and validates schema, project ownership, digest, duplicates, revisions, conflicts, and retention.
- Applying restore requires explicit human approval and unique approval reference; never silently overwrite newer records.
- Audit backup, export, restore preparation, approval, apply, failure, and rollback.
- Test restore in a disposable target and verify counts/digests before production readiness.
- Provider free-tier backups are not assumed to satisfy Mira recovery objectives. Maintain independently encrypted exports where policy and free storage permit.

RPO/RTO are NOT APPROVED. Set targets only after measuring provider limits and real export/restore times. Do not claim zero data loss.

## 10. Security, privacy, and operations

- TLS with certificate verification.
- Provider encryption at rest is baseline, not a substitute for application encryption where restricted data requires it.
- Keys and credentials stay out of Git, logs, payloads, and browser code.
- Define key custody, rotation, recovery, and revocation before restricted data is stored.
- Minimize personal data; never ingest passwords, tokens, payment credentials, or unnecessary sensitive data.
- Structured logs contain IDs/outcomes only; redact payloads and secrets.
- Enforce request size, query, pagination, timeout, rate, and connection-pool limits.
- Monitor quota, storage, compute, connection exhaustion, backup age, failed migrations, and restore verification.
- Free plans can sleep, throttle, impose caps, or change terms. Availability and recovery remain unproven until measured.

## 11. Hosting and cost decision

Preferred candidate for evaluation: current Neon PostgreSQL project, with separate payload schema and least-privilege boundary, only if current free-tier quotas and recovery controls are adequate.

Before approval, record current plan limits for compute, storage, branches, connections, backup/PITR, idle suspension, cold starts, export bandwidth, and data residency. Estimate payload growth and restore storage.

No second database, paid plan, vector DB, object store, or paid AI API is approved. Any recurring cost requires explicit budget approval. If free-tier limits cannot meet the security/durability requirement, status is NOT_READY; do not weaken isolation to preserve zero cost.

## 12. Required verification matrix

| Test | Expected result |
|---|---|
| No session / invalid principal | Denied; no data disclosure |
| User A reads Project B | Denied |
| Membership revoked during session | Next operation denied |
| Expired authority | Denied |
| Guessed foreign record ID | Denied |
| Cross-project list/count/search | No foreign metadata/snippets |
| Message without parent authorization | Denied |
| Quarantined/unverified retrieval item | Excluded before ranking |
| Digest mismatch | Quarantined, never served |
| Duplicate idempotency key | No duplicate mutation |
| Stale revision update | Conflict, no overwrite |
| Concurrent authority consumption | At most one successful consume |
| Audit append failure | Transaction fails closed |
| Database unavailable | No legacy/global fallback |
| Backup without export authority | Denied |
| Restore without approval | Preview only |
| Partial restore failure | Rollback or explicit recovery state |
| Unknown migration project mapping | Quarantine |
| Restart/redeploy | Committed records retained |
| Independent restore drill | Counts and digests match |

## 13. Implementation sequence after approval

1. Approve data-plane contract and threat model.
2. Finalize schema DDL and API; independent security review.
3. Build disposable DB fixtures and narrow roles/functions.
4. Implement adapter without connecting legacy routes.
5. Implement authorization and cross-project negative tests.
6. Implement read-only canonical retrieval in isolation.
7. Implement controlled writes with idempotency, revisions, audit.
8. Implement backup/restore preview and disposable recovery drills.
9. Build migration inventory/dry-run tooling; no import yet.
10. Obtain explicit migration/cutover approval.
11. Run independent E2E, security, recovery, restart, integrity verification.
12. Reassess readiness; deployment requires separate explicit approval.

## 14. Decision register

| Decision | Proposal | Status |
|---|---|---|
| Canonical record envelope | Versioned project-scoped JSONB envelope | PROPOSED |
| Initial payload store | PostgreSQL on candidate Neon project | PROPOSED / PLAN REVIEW REQUIRED |
| Payload schema | Separate mira_hfm_data schema | PROPOSED / NOT CREATED |
| Authority source | Existing HFM registry | PROPOSED |
| App DB access | Narrow API / least privilege | PROPOSED |
| Authorization | Per-operation, transactional, fail-closed | REQUIRED DESIGN |
| Retrieval | Trust filters before ranking | REQUIRED DESIGN |
| Migration | Snapshot → map → dry-run → verify → approval | PROPOSED |
| Backup/restore | Project-scoped, encrypted, digest-verified, gated | PROPOSED |
| Binary attachments/vector search | Excluded from v0.1 | DEFERRED |
| Production rollout | Not authorized | BLOCKED |

## 15. Approval checklist

Remain NOT APPROVED until the project owner explicitly approves:
- canonical schema and record lifecycle;
- hosting and free-tier risk;
- authorization and database trust boundary;
- classification, encryption, and key custody;
- backup/restore objectives;
- migration and quarantine policy;
- verification matrix and independent test gate.

Approval of this document does not approve production deployment or data migration. Those are separate decisions.

## 16. Release posture

DATA_PLANE_DESIGN=PROPOSED  
CANONICAL_SCHEMA=NOT_APPROVED  
PAYLOAD_SCHEMA=NOT_CREATED  
AUTHORIZATION_ENFORCEMENT=NOT_IMPLEMENTED  
DURABLE_PAYLOAD_STORAGE=NOT_IMPLEMENTED  
MIGRATION=NOT_STARTED  
BACKUP_RESTORE_DRILL=NOT_RUN  
PRODUCTION_DEPLOYMENT=BLOCKED

No database schema, role, grant, secret, Render setting, production record, or legacy data was changed by this proposal.
