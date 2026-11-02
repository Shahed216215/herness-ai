# MIRA HYBRID MEMORY
## Phase 2 — Core Memory Safety & Backend-Neutral Contract Design

Document ID: MIRA-HFM-PHASE2-CORE-001
Version: 0.1.0
Status: PROPOSED DESIGN — NOT IMPLEMENTED
Architecture: Backend-Neutral · Distributed · Evidence-Driven
Policy: Human-Controlled · Fail-Closed · Provider-Independent

---

## 1. Objective

Design a canonical Memory contract that separates Mira's Memory
logic from individual storage providers.

The system must not assume phone-local storage is its Memory backend.

The design must preserve existing subsystem ownership and must not
force all records into one provider or one physical database.

## 2. Proposed Logical Architecture

Application / Agent Layer
        |
        v
Unified Memory Interface
        |
        v
Memory Governance & Policy Layer
        |
        +---- Record Validation
        +---- Identity & Version Management
        +---- Provenance Verification
        +---- Conflict Detection
        +---- Access Control
        +---- Audit Evidence
        |
        v
Backend Adapter Layer
        |
        +---- Facebook Page Adapter
        +---- Facebook Group Import Adapter
        +---- Public Web Retrieval Adapter
        +---- Google Drive Emergency Backup Adapter
        |
        v
External Provider Platforms

All provider operations must pass through policy and capability checks.

This is a logical architecture, not a claim that these connectors
currently exist.

## 3. Canonical Memory Record

Proposed record fields:

- schemaVersion
- memoryId
- projectId
- recordType
- title
- content
- summary
- sourceType
- sourceId
- sourceUrl
- sourceOwner
- createdAt
- updatedAt
- observedAt
- version
- contentHash
- integrityStatus
- verificationStatus
- accessClassification
- tags
- relationships
- retentionPolicy
- provenance
- lifecycleStatus

Rules:

1. memoryId must remain stable across providers.
2. projectId must identify the owning project.
3. Every imported record must retain source provenance.
4. Provider-specific identifiers must not replace memoryId.
5. Secrets, access tokens and passwords must never enter Memory records.
6. Unknown fields must not silently bypass validation.
7. Schema migrations must be versioned and reversible where possible.

## 4. Backend-Neutral Interface

Proposed logical operations:

- capability(provider)
- read(query, context)
- write(record, context)
- update(memoryId, patch, context)
- search(query, filters, context)
- verify(memoryId, context)
- listVersions(memoryId, context)
- backup(scope, context)
- restore(backupId, context)

These are design-level operations, not existing implemented APIs.

Each operation must return:

- success
- provider
- operation
- result or safe error
- evidence
- timestamp
- correlationId

Provider adapters must not directly bypass governance.

## 5. Independent Read and Write Capabilities

Read and Write capabilities must be checked independently.

Example:

Provider A:
- Read: AVAILABLE
- Write: UNAVAILABLE

Provider B:
- Read: UNAVAILABLE
- Write: AVAILABLE

The system must never infer Write access from Read access.

Capability states:

- AVAILABLE
- UNAVAILABLE
- NOT_CONFIGURED
- PERMISSION_DENIED
- RATE_LIMITED
- UNKNOWN

UNKNOWN must not be treated as AVAILABLE.

## 6. Fail-Closed Rules

1. Failed authentication must not trigger an unsafe fallback.
2. Partial writes must be detected and reported.
3. An unverified write must not be reported as successful.
4. A provider timeout must not cause duplicate blind writes.
5. Invalid records must be quarantined, not silently discarded.
6. Conflicting versions must not be overwritten automatically.
7. Restore must require explicit authorization.
8. A failed verification must block promotion to trusted Memory.
9. No provider failure may silently redirect Memory to phone-local storage.

## 7. Identity, Version and Conflict Policy

Proposed rules:

- memoryId identifies the logical record.
- providerRecordId identifies the provider-side copy.
- version tracks logical record revision.
- contentHash verifies exact content integrity.
- source provenance records where the information originated.
- duplicate candidates require comparison before merging.
- conflicting updates enter CONFLICT_REVIEW.
- automated conflict resolution must preserve both source versions.
- no last-write-wins policy without an explicit approved rule.

## 8. Provenance and Trust

Proposed trust states:

- UNVERIFIED
- SOURCE_RECORDED
- SOURCE_REACHABLE
- CONTENT_VERIFIED
- HUMAN_VERIFIED
- QUARANTINED

A public Web Search result is not automatically trusted Memory.

Search result, source page, imported record and verified Memory
must remain distinguishable.

Private Group content must only be imported through authorized access.

## 9. Provider Responsibilities

### Facebook Page
Proposed primary Memory platform.

Must support:
- authorized publishing or updating
- record identity mapping
- source URL retention
- independent Read and Write checks
- reconciliation after uncertain writes

Connector implementation is not yet verified.

### Facebook Group
Proposed secondary/manual Memory platform.

Must support:
- authorized import only
- private-content access restrictions
- manual import fallback
- source attribution

No unauthorized scraping or access.

### Public Web Search
Alternative public retrieval, not a durable database.

Must support:
- query provenance
- source URL
- retrieval timestamp
- source verification
- trust classification

### Google Drive
Emergency backup only.

Must support:
- encrypted backup
- versioned manifests
- integrity verification
- explicit restore authorization
- recovery evidence

Routine synchronization is not part of this design.

## 10. Existing Subsystem Preservation

The following remain separate logical domains unless a verified
migration plan proves otherwise:

- General Memory
- Work Learning
- Experience Memory
- Experience Retrieval
- Future Strategy
- Cross-Task Learning
- Learning History
- Knowledge Consolidation
- Conversation Store
- Knowledge
- Evolution

Derived layers should retrieve canonical source records rather than
creating uncontrolled duplicate stores.

## 11. Evolution Integration Contract

Evolution must not maintain a separate unsafe Memory writer.

Future integration must require:

1. canonical record validation
2. explicit pre-state version
3. verified snapshot
4. policy authorization
5. backend adapter write
6. independent readback
7. content integrity verification
8. audit event
9. rollback or recovery plan

No Evolution integration is implemented in this phase.

## 12. Backup and Recovery

Proposed backup manifest:

- backupId
- createdAt
- scope
- schemaVersion
- recordCount
- providerReferences
- encryptedPayloadReference
- contentHash
- verificationStatus
- recoveryStatus

Restore must:
- validate the manifest
- verify integrity
- check target capability
- require explicit approval
- preserve current state through a recovery point
- verify restored content independently

No production backup or restore is authorized by this document.

## 13. Security and Privacy

- Never store provider tokens in Memory records.
- Never print credentials in reports.
- Apply least-privilege provider permissions.
- Separate public and private source classifications.
- Do not access private Group content without authorization.
- Record security-relevant actions in an audit trail.
- Do not expose one project's private Memory to another project.
- Do not silently use phone storage as a fallback backend.

## 14. Required Test Strategy

Future isolated tests:

- schema validation
- stable identity
- version handling
- duplicate detection
- conflict quarantine
- provenance retention
- read/write capability separation
- provider timeout
- partial write detection
- idempotency
- integrity verification
- backup manifest verification
- restore authorization
- Evolution integration
- regression and recovery

Tests must use isolated fixtures.

A skipped or unavailable test must be INCONCLUSIVE, never PASS.

## 15. Implementation Order Proposal

1. Approve canonical record schema.
2. Approve backend-neutral interface.
3. Define governance and capability contracts.
4. Build isolated contract tests.
5. Design provider adapter boundaries.
6. Design migration adapters for existing persistent stores.
7. Integrate Evolution through the canonical contract.
8. Design backup and recovery.
9. Implement provider connectors only after authorization.
10. Run independent regression and security verification.

## 16. Explicit Non-Goals

This phase does not:

- modify production Memory
- migrate or delete existing files
- connect Facebook
- connect Google Drive
- make network requests
- install packages
- change server.js
- activate autonomous restore
- certify production readiness

## 17. Approval Gates

Separate approval is required before:

- live provider authentication
- network/API operations
- paid services
- production data migration
- production restore
- deletion of legacy data
- persistent Memory behavior changes
- changes to access permissions

## 18. Phase 2 Design Status

DESIGN_CREATED = pending verification
IMPLEMENTATION = NOT_STARTED
PRODUCTION_READINESS = NOT_CERTIFIED
MIGRATION = NOT_AUTHORIZED

---

## 19. PHASE 1 TO PHASE 2 TRACEABILITY MATRIX

Purpose:
Map every Phase 1 architecture gap to its corresponding Phase 2 design
sections. This matrix establishes design coverage only. It does not
mean that a gap has been implemented, migrated or production-closed.

| Gap ID | Phase 1 finding | Phase 2 design references | Design coverage | Implementation |
|---|---|---|---|---|
| HFM-01 | Phone-local General Memory dependency | Sections 1, 2, 9, 13, 16, 17 | Addressed by backend-neutral architecture and explicit prohibition on phone-local fallback | NOT_STARTED |
| HFM-02 | Evolution and Local Store writer mismatch | Sections 11, 14, 15, 17 | Addressed by canonical writer, readback, integrity and recovery requirements | NOT_STARTED |
| HFM-03 | No backend-neutral Memory contract | Sections 2, 3, 4, 5 | Addressed by canonical record and adapter interface | NOT_STARTED |
| HFM-04 | Work Learning migration adapter missing | Sections 10, 15 | Existing subsystem preservation and migration adapter planning | NOT_STARTED |
| HFM-05 | Knowledge Consolidation migration adapter missing | Sections 10, 15 | Existing subsystem preservation and migration adapter planning | NOT_STARTED |
| HFM-06 | Conversation Store migration adapter missing | Sections 10, 15 | Existing subsystem preservation and migration adapter planning | NOT_STARTED |
| HFM-07 | Knowledge and Drive lifecycle reconciliation | Sections 9, 10, 12, 15 | Addressed at design level; detailed migration and reconciliation procedure remains to be specified | NOT_STARTED |
| HFM-08 | Facebook connector not detected or verified | Sections 2, 9, 13, 16, 17 | Adapter boundary and authorization requirements defined; connector not implemented or verified | NOT_STARTED |
| HFM-09 | Web Search provenance and retrieval contract incomplete | Sections 3, 8, 9, 13 | Source URL, retrieval time, provenance and trust states defined | NOT_STARTED |
| HFM-10 | Emergency backup and recovery design incomplete | Sections 9, 12, 14, 17 | Backup manifest, integrity and restore authorization requirements defined | NOT_STARTED |
| HFM-11 | Conflict, duplicate, version and source identity policy incomplete | Sections 3, 7, 8, 14 | Identity, version, conflict and provenance policies proposed | NOT_STARTED |
| HFM-12 | Learning and Evolution governance integration incomplete | Sections 10, 11, 13, 14, 15, 17 | Governance and integration requirements proposed; implementation not started | NOT_STARTED |

### Traceability interpretation

- DESIGN_COVERED means a relevant design requirement exists.
- DESIGN_PARTIAL means further detailed design is still required.
- NOT_STARTED means no implementation or production migration is claimed.
- A design reference does not prove runtime behavior.
- Every gap requires implementation evidence and independent tests before closure.

Current traceability status:
- HFM-01 through HFM-12: MAPPED
- Production gap closure: NOT_VERIFIED
- Production migration: NOT_AUTHORIZED
- Production readiness: NOT_CERTIFIED

