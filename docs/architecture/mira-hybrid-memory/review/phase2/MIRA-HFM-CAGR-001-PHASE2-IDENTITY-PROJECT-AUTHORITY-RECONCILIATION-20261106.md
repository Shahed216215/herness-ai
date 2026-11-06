MIRA HFM v0.2 — PHASE 2 IDENTITY / PROJECT-AUTHORITY RECONCILIATION
Date: 2026-11-06
Parent: MIRA-HFM-CAGR-001 v1.0.0
Branch: work/mira-hfm-v02-phase2-identity-guard-on-phase9-20261106
PR: #51
Status: SOURCE-REVIEW COMPLETE — RUNTIME AUTHORITY STILL BLOCKED

1. PURPOSE
Reconcile the Phase 2 runtime identity bridge added in PR #51 with the existing Phase 3 host-identity, project-owner, mapping, and authority contracts. Avoid duplicating already implemented validators or accidentally treating the new transport bridge as project authorization.

2. VERIFIED SOURCE ARTIFACTS
The following files exist at the reviewed PR head:
- services/mira-hfm-runtime-identity-context.js
- services/mira-memory-host-identity-contract.js
- services/mira-memory-project-owner-registry-contract.js
- services/mira-memory-project-mapping-contract.js
- services/mira-memory-project-mapping-owner-approval-adapter.js
- services/mira-memory-project-authority-contract.js
- services/mira-memory-host-authorization-adapter.js
- tests/mira-memory-project-owner-registry-contract.test.js
- tests/mira-memory-project-mapping-contract.test.js
- tests/mira-memory-project-mapping-owner-approval.test.js
- tests/mira-memory-project-authority-contract.test.js

The Phase 3 design document already specifies:
- Stable, immutable actor subjects; role/permissions are not identity.
- Registered-user identity from the verified users.json userId.
- A separately provisioned immutable admin subject; username is display metadata only.
- Legacy role-only Bearer authentication is denied unless a trusted token-to-subject adapter provides subject and validity/revocation evidence.
- A separate sidecar project-owner registry; no inferred owner assignment.
- Existing projects without independently evidenced ownership remain UNASSIGNED_BLOCKED.
- Project membership is explicit, operation-scoped, revocable, and revisioned.
- The project-authority decision must bind actor, project, operation, resource, purpose, request and validity window.
- Missing/ambiguous identity, missing registry, expired/revoked evidence, replay, or unavailable policy must fail closed.

3. IMPORTANT RECONCILIATION FINDING
The PR #51 runtime bridge is a narrow transport bridge, not the Phase 3 normalized identity contract:
- It currently accepts authenticated sessions with a non-empty session.userId and matching req.role/session.role.
- It emits the raw userId as actorId, plus role and authentication="session".
- It does not currently call normalizeTrustedActorIdentity().
- It does not carry the exact verified-principal envelope required by that normalizer (issuer, subject, actorType, authenticationMethod, authenticationRef, authenticatedAt, expiresAt).
- server.js sessionIdentity() currently returns role/permissions only; login persists authenticated=true, role, and optionally userId, but the inspected login/session code does not persist authenticatedAt or an HFM principal expiry.
- Admin sessions must not be assumed to be registered-user principals. The Phase 3 contract requires a separately provisioned admin subject.
Therefore ACTOR_RESOLVED from the PR bridge means only “a session userId was transported”; it does NOT mean a canonical HFM actor was normalized or authorized for any project.

4. EXISTING CONTRACTS TO REUSE — DO NOT DUPLICATE
A. normalizeTrustedActorIdentity() in mira-memory-host-identity-contract.js: validates the exact trusted principal envelope, namespaces actorId from issuer+subject, checks temporal validity, and returns a deeply frozen identity. It does not authenticate the request or mint missing timestamps.
B. validateProjectOwnerRegistryEntry() in mira-memory-project-owner-registry-contract.js: validates an explicit, digest-bound owner/membership record and requires an injected trusted registry verifier.
C. createProjectMappingOwnerApprovalVerifier() in mira-memory-project-mapping-owner-approval-adapter.js: validates that the mapping approver is the active HUMAN OWNER with APPROVE_MAPPING authority, within membership validity.
D. validateProjectMapping() in mira-memory-project-mapping-contract.js: validates explicit, snapshot-bound, approved domain-to-project mappings and requires trusted approval evidence.
E. validateProjectAuthorityEvidence() and createHostAuthorizationAdapter(): validate request-bound, purpose-specific project authority and injected replay/registry verification callbacks.
These are validators/adapters only. Their presence and synthetic tests do not prove a persistent registry, verifier, replay store, live authentication integration, or runtime project authorization exists.

5. REQUIRED NEXT IMPLEMENTATION — DEPENDENCIES
5.1 Trusted authentication principal
- Add a server-owned verified-principal envelope at the authentication boundary.
- Registered-user principal: issuer + stable users.json userId, actorType HUMAN, USER_SESSION, a non-secret session reference, authenticatedAt and an expiry derived from authoritative session lifetime.
- Admin principal: BLOCKED until a separately provisioned immutable admin subject and lifecycle/revocation source exist. Do not substitute username, email, role, or a shared Bearer token.
- Bearer principal: BLOCKED until a trusted token-to-subject mapping, expiry and revocation source exist.
- Do not synthesize historical timestamps or expiry values in the HFM bridge.
- Then call normalizeTrustedActorIdentity() and pass only the normalized immutable result out-of-band.

5.2 Authoritative registry persistence
- Select and implement a durable sidecar registry store with atomic revision/CAS semantics, integrity verification, backup/recovery and append-only audit.
- Registry lookup must be by exact projectId and tenant boundary; no default project.
- Registry verifier must be backed by a trusted authority/key or equivalent integrity mechanism. A callback that returns true in a unit fixture is not production verification.
- Multi-project membership, membership revocation, owner transfer, and administrator provisioning require explicit lifecycle rules.
- Existing projects remain UNASSIGNED_BLOCKED until independently evidenced and explicitly approved.

5.3 Runtime authorization integration
- Compose normalized actor identity + exact project-owner registry lookup + request-bound authority adapter.
- Resolve exact project scope from a trusted server-side resource/operation context, never model arguments alone.
- Deny missing, ambiguous, suspended, revoked, expired, replayed, stale-revision or unverifiable authority.
- Integrate read-only retrieval first; do not connect controlled writers or migrations in this step.
- Keep legacy stores and all production data unchanged.

6. ACCEPTANCE GATES
- Registered-user session produces a normalized namespaced actorId only when verified principal timestamps and issuer are authoritative.
- Admin session and role-only Bearer fail closed until separately provisioned subject adapters exist.
- Caller/model-supplied actorId, issuer, projectId, ownerActorId, tenantId or membership cannot override trusted context.
- Owner, editor, viewer, non-member, cross-project, suspended, revoked, expired and replay cases are tested against synthetic registry fixtures.
- Persistent registry read/write, CAS conflict, revision monotonicity, audit, backup and recovery tests pass before runtime activation.
- Read-only retrieval integration tests prove project and trust/lifecycle filtering without production data access.
- CI output must distinguish synthetic contract PASS from runtime and production verification.

7. CURRENT STATUS
PR51_SESSION_USER_ID_TRANSPORT=SOURCE_IMPLEMENTED
PR51_TRANSPORT_REGRESSION_CI=PASS (see workflow run 42162761178)
CANONICAL_HOST_PRINCIPAL_NORMALIZATION=NOT_INTEGRATED
ADMIN_SUBJECT_PROVISIONING=NOT_ESTABLISHED
BEARER_SUBJECT_MAPPING=NOT_ESTABLISHED
PERSISTENT_PROJECT_OWNER_REGISTRY=NOT_IMPLEMENTED
PROJECT_MEMBERSHIP_RUNTIME_LOOKUP=NOT_IMPLEMENTED
PROJECT_AUTHORITY_RUNTIME_INTEGRATION=NOT_IMPLEMENTED
LEGACY_PROJECT_OWNER_ASSIGNMENTS=NOT_APPROVED
CANONICAL_PROJECT_SCOPED_RETRIEVAL=BLOCKED
LIVE_RUNTIME_VERIFICATION=NOT_PERFORMED
PRODUCTION_MEMORY_OR_KNOWLEDGE_TOUCHED=NO
PRODUCTION_APPROVAL=NOT_APPROVED
HFM_PHASE2=IN_PROGRESS
HFM_V0_2_PRODUCTION_READINESS=NOT_CERTIFIED

8. CHANGE BOUNDARY
This reconciliation is documentation-only. No project owner or member was assigned; no registry was created; no production Memory/Knowledge, session, credential, Drive, CRM, or project data was read or changed; no external API, migration, merge, or deployment was performed.
