# Mira HFM v0.2 — F7-SR-05 Infrastructure Independence Acceptance Specification

Status: SIGNED POLICY VERIFIER, POLICY-STATE PROVIDER CONTRACT AND EVIDENCE VERIFIER IMPLEMENTED; SYNTHETIC CI PASS; OPERATIONAL TRUST AND STAGING INTEGRATION NOT APPROVED
Finding: F7-SR-05 — Baseline provenance claims do not independently certify infrastructure
Severity: HIGH
Scope: Phase 7 emergency-backup baseline/source independence
Execution boundary: This document defines evidence and acceptance requirements. It does not authorize live provider access, production data access, staging integration, deployment, workflow reruns, or changes to canonical Memory/Knowledge.

## 1. Objective

Establish whether the baseline source and backup source are operationally independent across the six dimensions enforced by `services/mira-hfm-source-provenance-contract.js`:

1. `storageSystemId`
2. `storageInstanceId`
3. `securityPrincipalId`
4. `trustDomainId`
5. `sourceSystemId`
6. `snapshotIssuerId`

The current contract compares signed claims against a caller-supplied `provenancePolicy`. This proves consistency with the policy object supplied to the function; it does not, by itself, prove who governed that policy, how it was distributed, whether its evidence is truthful, or whether the two infrastructures are independent in reality.

Acceptance must therefore establish both (A) the authenticity and governance of the policy/trust configuration and (B) the truth and independence of the underlying infrastructure evidence.

## 2. Threat model and security claims

The review must assume that:
- two distinct source IDs can alias the same account, tenant, storage instance, administrator, or workload;
- two different signing keys can be controlled by the same issuer, administrator, or compromised workload;
- a source can sign false provenance labels;
- a caller can substitute, downgrade, or replay a policy/trust bundle unless its origin, version, validity, and anti-rollback state are verified;
- a policy publisher and the infrastructure being assessed may collude;
- a valid signature proves possession/use of a signing key, not the truth of the signed infrastructure claim;
- a cloud account, KMS, identity provider, organization administrator, CI authority, or recovery administrator may be a shared control plane even when data-plane identifiers differ.

Out of scope for this finding alone: confidentiality of backup payloads, correctness of source snapshot contents, full authorization-policy correctness, key custody, filesystem race resistance, and recovery correctness. Those remain covered by F7-SR-01 through F7-SR-04 and their own gates.

## 3. Required trust architecture

### 3.1 Independently governed provenance policy

Replace the trust assumption "caller supplied policy object" with a policy bundle whose provenance is verifiable before any source read or backup publication.

The bundle must contain:
- schema/contract version and immutable policy version;
- unique policy bundle ID and monotonically increasing sequence;
- issued-at, not-before, expiry, and explicit environment/project scope;
- exact source IDs and six-dimension profiles for baseline and backup;
- evidence references and evidence digests for every dimension;
- issuer identity, signing key ID/version, signature algorithm, and detached signature;
- approval record identifying at least two authorized reviewers for production policy changes;
- previous accepted bundle digest or another authenticated anti-rollback anchor;
- revocation/status reference and a defined fail-closed behavior when status cannot be established.

The verifier module now checks a signed Ed25519 policy envelope against separately injected pinned issuer and reviewer trust maps, plus an accepted-policy-state descriptor. The accepted-state descriptor is required to assert authenticated, durable and atomic semantics and to identify a separate authority. These are interface assertions only: the module cannot prove that the caller actually obtained the maps/state from an independent provider, nor can it persist the next sequence checkpoint. A separately implemented, authenticated, durable and atomic state provider plus out-of-band trust provisioning remain mandatory. The verifier must obtain the trust anchor and accepted policy version from a separately controlled configuration boundary, not from the same caller that supplies the policy being evaluated. The policy issuer MUST be distinct from both snapshot sources, snapshot-signing issuers, authorization-decision issuer, and backup key provider. Distinct names are insufficient: administrative control and identity-provider dependencies must also be reviewed.

A signed policy bundle authenticates the publisher and integrity of the bundle. It does not prove that the evidence inside is true; Sections 4–6 remain mandatory.

### 3.2 Trust separation matrix

Document and verify the following control relationships:

| Role | Must be distinct from | Evidence required |
|---|---|---|
| Baseline source workload | Backup source workload | Provider-issued workload identity and principal details |
| Baseline storage account/tenant | Backup storage account/tenant | Provider control-plane inventory and ownership evidence |
| Snapshot signing issuer | Authorization decision issuer | Separate key IDs, issuer identities, policies and administrators |
| Provenance policy issuer | Both sources and all operational issuers | Independent identity, signing and governance records |
| Backup DEK key provider | Snapshot signing issuer and policy issuer | Separate purpose, identity and key custody |
| Emergency/recovery administrator | Sole normal backup operator | Documented two-person recovery and audit controls |

Shared parent organizations or cloud organizations are not automatically disqualifying, but must be disclosed and assessed as shared administrative/control-plane dependencies. A shared privileged administrator, shared identity root, shared break-glass account, or shared policy deployment authority is a material common-mode risk and requires explicit risk acceptance; it cannot be described as fully independent.

## 4. Evidence requirements for each provenance dimension

For BOTH baseline and backup sources, obtain independently verifiable, environment-specific evidence.

### 4.1 storageSystemId
Acceptable evidence:
- provider/service identity from an authoritative provider control plane;
- service/resource type and tenant context;
- provider documentation or signed inventory showing the identifier's semantics.

Reject:
- arbitrary application labels;
- values copied from the same source attestation without external corroboration.

### 4.2 storageInstanceId
Acceptable evidence:
- immutable provider resource ID, account/bucket/database/volume identifier as applicable;
- account/tenant ownership and region/project context;
- control-plane export or provider-signed inventory captured by an independently authorized reviewer.

Reject:
- display names, aliases, folder names, or two IDs whose parent resource/account is the same without explicit risk analysis.

### 4.3 securityPrincipalId
Acceptable evidence:
- provider-issued workload/service principal identity;
- federation subject/audience and workload binding;
- effective permissions and resource scope;
- proof that baseline and backup principals are separately provisioned and least-privileged.

Reject:
- caller-provided principal labels;
- shared human/admin credentials;
- static credentials whose owner and rotation cannot be established.

### 4.4 trustDomainId
Acceptable evidence:
- identity/security authority, key administration boundary, and privileged administrator set;
- organization/tenant control-plane relationships;
- independent review of common administrators, recovery paths, federation roots, and break-glass access.

Reject:
- different textual domain names under the same unreviewed administrative authority.

### 4.5 sourceSystemId
Acceptable evidence:
- independently inventoried application/service deployment identity;
- separate runtime/workload boundary, release provenance and owner;
- source-control/deployment authority and CI identity mapping.

Reject:
- different service names or processes deployed and controlled by the same unexamined workload identity and administrative plane.

### 4.6 snapshotIssuerId
Acceptable evidence:
- issuer identity and key ID/version from the independently governed signing service;
- key purpose restricted to snapshot attestation;
- provider-side audit trail, access policy, rotation/revocation and workload binding;
- independently pinned public-key fingerprint and issuer metadata.

Reject:
- an ID embedded only in the source's own claim;
- an in-process software-key wrapper represented as an independent provider;
- the authorization-decision issuer or policy issuer reused as snapshot issuer without an approved trust-separation exception.

## 5. Evidence provenance and anti-circularity

Every evidence item must have:
- evidence ID, issuing authority, collection method, collector identity and collection time;
- immutable source reference or provider export ID;
- cryptographic digest and signature/verification method where available;
- scope (account, tenant, project, workload, region, environment);
- validity interval and revocation/status check;
- reviewer and review decision;
- relationship to the exact provenance field and source ID it supports.

Evidence must not be self-authenticated solely by the source whose independence is being claimed. At least one reviewer/collector must have read-only access through an independently governed administrative identity. If evidence is exported by a provider, preserve the provider-origin metadata and independently verify the export where supported.

Do not store credentials, private keys, access tokens, raw secrets, customer records, or backup payloads in the evidence register. Store references and redacted metadata only.

## 6. Policy governance and lifecycle

Define before any staging approval:
1. policy owner and independent security approver;
2. authorized publisher identities and signing-key custody;
3. two-person approval for create/update/revoke;
4. immutable versioning and anti-rollback state;
5. expiry, revocation and emergency deny process;
6. change-impact review whenever an account, principal, trust root, key, issuer, or provider changes;
7. audit retention, alerting and incident response;
8. policy distribution channel independent from the application caller and source workloads;
9. recovery procedure if the policy issuer or trust anchor is unavailable.

Fail closed if policy signature, version, scope, validity, revocation status, or anti-rollback state cannot be verified. A stale cached policy may be used only under an explicitly approved bounded-staleness policy; otherwise deny. No silent fallback to caller-supplied or test policy is permitted.

## 7. Required implementation behavior

The signed policy verifier contract is implemented as `services/mira-hfm-signed-provenance-policy.js`. It validates Ed25519 policy signatures, pinned issuer/key fingerprint, reviewer signatures, project/environment scope, validity window, revocation status, anti-rollback sequence, evidence-reference shape, and the six distinct provenance dimensions.

The policy-state contract is implemented as `services/mira-hfm-policy-state-provider-contract.js`. It verifies a signed policy-state envelope from a separately pinned authority, checks freshness/revocation/sequence metadata, requires the provider to expose `readState` and `compareAndSwap`, and verifies a signed commit receipt bound to the exact expected and next sequence/digest. The acceptance orchestrator fails closed on CAS conflict and does not commit before evidence verification. The `durable` and `atomic` fields are authenticated provider claims, not independent proof that the real backing store has those properties. A production adapter must demonstrate those properties under concurrency, restart and outage testing.

Evidence verification is implemented as `services/mira-hfm-provenance-evidence-verifier.js`. It resolves all 12 evidence references through a separate evidence resolver, verifies each evidence issuer's Ed25519 signature and pinned key fingerprint, checks source/dimension/project/environment/reviewer binding and freshness, and recomputes the canonical record digest. The synthetic acceptance tests exercise valid evidence and fail-closed cases.

The combined `verifyAndAcceptSignedProvenancePolicy` orchestration requires both the state provider and evidence resolver, verifies all evidence before attempting state compare-and-swap, and returns explicit evidence/state receipt summaries. It is not yet wired into the staging backup drill or production path. It must not be treated as operational approval.

Remaining integration requirements:
- validate a signed policy envelope against a separately pinned policy-issuer trust anchor;
- enforce exact environment/project/source scope and schema version;
- enforce sequence/anti-rollback and expiry/revocation;
- bind each profile to evidence digests and reviewer approvals;
- reject missing, duplicated, malformed, unknown, stale, revoked, downgraded, or scope-mismatched policy;
- reject shared values in any of the six required dimensions;
- reject unreviewed shared administrative roots and common-mode dependencies according to the approved risk policy;
- verify source claims against the authenticated policy profiles before opening source files where architecture permits, and always before backup publication;
- emit structured, secret-free audit events with policy ID/version/digest and decision reason;
- return an explicit status such as `PROVENANCE_POLICY_AUTHENTICATED_AND_CLAIMS_MATCHED_NOT_INFRASTRUCTURE_CERTIFIED`;
- never set an infrastructure-certification or production-approval boolean merely because the software checks pass.

The current six-field equality/inequality contract remains a necessary control, but is not sufficient acceptance evidence.

## 8. Offline test acceptance matrix

Add isolated synthetic tests. These validate mechanics only and must never be described as real infrastructure certification.

Required positive tests:
- valid signed policy, valid pinned issuer and two fully distinct synthetic profiles accepted;
- exact policy version, environment and project scope accepted;
- valid evidence digests and approval quorum accepted.

Required negative tests:
- invalid/missing policy signature;
- unknown or mismatched policy issuer/key fingerprint;
- policy issuer equals a source or operational issuer where separation is required;
- duplicate policy bundle ID or sequence rollback;
- expired, not-yet-valid or revoked policy;
- stale policy and unavailable revocation/status service;
- wrong environment/project/source scope;
- missing or malformed evidence reference/digest;
- evidence signed only by the source being assessed;
- one shared value in each of the six dimensions;
- shared parent account/tenant, identity root, privileged administrator, recovery authority or policy deployment authority;
- reviewer quorum missing or same person occupying incompatible roles;
- policy substitution between validation and use;
- caller attempts to override authenticated policy with a function argument;
- audit output contains no secrets or payload content;
- failure occurs before source read and before publication.

Every test must assert both the expected error/status code and that no source read/publication side effect occurred. Run only in isolated CI with synthetic keys/data. Preserve commit-matched logs and exact test markers.

## 9. Independent operational verification plan

Only after a separate explicit authorization for staging integration:
1. Select provider/account topology and document data residency and cost.
2. Create least-privilege read-only evidence collection identities.
3. Collect provider-origin inventories for both sources.
4. Independently inspect workload identity, IAM policies, administrators, federation roots, KMS/HSM issuer, policy publisher and recovery path.
5. Verify the policy issuer and trust anchors out of band.
6. Review common-mode dependencies and record accepted residual risks.
7. Run staging-only negative authorization, outage, revocation, rotation, concurrency and recovery tests with synthetic/non-production data.
8. Obtain independent security reviewer sign-off.
9. Reassess F7-SR-01 through F7-SR-04; F7-SR-05 cannot override their open gates.

No production data, live Drive API, production KMS, or deployment is needed to complete this specification or the offline tests.

## 10. Acceptance gates and disposition

| Gate | Acceptance evidence | Status until evidence is reviewed |
|---|---|---|
| G1 — Policy authenticity | Signed bundle, independent pinned issuer, anti-rollback and revocation | SYNTHETIC_CONTRACT_PASS; OPERATIONAL_NOT_VERIFIED |
| G2 — Storage separation | Provider-origin account/tenant/resource inventories | NOT_VERIFIED |
| G3 — Workload identity | Provider-issued identities, effective permissions and separation | NOT_VERIFIED |
| G4 — Trust-domain separation | Administrative/federation/recovery dependency review | NOT_VERIFIED |
| G5 — Source-system separation | Deployment/runtime/control-plane evidence | NOT_VERIFIED |
| G6 — Snapshot issuer separation | Independent issuer/key governance and audit evidence | NOT_VERIFIED |
| G7 — Evidence independence | Independent collection, integrity, reviewer and provenance | SYNTHETIC_SIGNATURE_AND_DIGEST_PASS; REAL_COLLECTION_NOT_VERIFIED |
| G8 — Offline implementation tests | Commit-matched CI logs for all positive/negative cases | PASS_CI — RUN #149 |
| G9 — Staging operational review | Approved staging evidence and adversarial results | NOT_APPROVED |
| G10 — Production approval | Explicit security/owner approval after all prior gates | NOT_APPROVED |

F7-SR-05 may be closed only when G1–G8 pass, G9 is approved by an independent reviewer, and all residual common-mode risks are documented and accepted by the accountable owner. Production approval remains a separate decision and also requires closure/approval of F7-SR-01 through F7-SR-04.

## 11. Current disposition

- Existing six-dimension synthetic provenance contract: implemented.
- Existing synthetic provenance tests: CI PASS on the specifically inspected commit/run only.
- Authenticated and independently governed policy distribution: synthetic signature contract PASS; real out-of-band trust provisioning NOT_VERIFIED.
- Signed policy-state provider interface and compare-and-swap contract: synthetic CI PASS; no production adapter or independently verified durable/atomic backing store.
- Independent evidence signature and digest verification: synthetic CI PASS for 12 references; real provider-origin evidence collection/review NOT_VERIFIED.
- Combined policy/state/evidence acceptance orchestration: synthetic CI PASS; not wired into the staging backup drill.
- Real storage/account separation: NOT_VERIFIED.
- Real workload identity separation: NOT_VERIFIED.
- Real trust-domain and administrative independence: NOT_VERIFIED.
- Independent evidence collection/review: NOT_VERIFIED.
- F7-SR-05: PARTIALLY_REMEDIATED / OPEN.
- Real staging integration: NOT_APPROVED.
- Production readiness: NOT_CERTIFIED.

This document is an acceptance specification, not evidence that any gate has passed.
