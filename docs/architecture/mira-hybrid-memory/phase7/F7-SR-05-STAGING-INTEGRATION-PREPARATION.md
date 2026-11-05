# F7-SR-05 Staging Integration Preparation

**Release boundary:** Mira Hybrid Memory v0.2  
**Finding:** F7-SR-05 — actual provenance independence  
**Document status:** DESIGN_ONLY / NOT_STAGING_APPROVED  
**Implementation status:** provider and evidence contracts are synthetic-contract tested only  
**Production status:** NOT_CERTIFIED

## 1. Purpose and non-goals

This document defines the prerequisites and verification plan for a future, separately approved staging integration. It does not provision infrastructure, create credentials, select a vendor, connect to staging, move real backups, or authorize production use.

The objective is to establish whether the six provenance dimensions are independently sourced and operationally isolated:

- `storageSystemId`
- `storageInstanceId`
- `securityPrincipalId`
- `trustDomainId`
- `sourceSystemId`
- `snapshotIssuerId`

Matching six different strings is not evidence of independence. Each claim must be traced to an authoritative control plane, independently authenticated identity, and retained collection evidence.

## 2. Trust and data-flow model

The intended trust roles must be separately provisioned and separately governed:

1. **Policy issuer:** signs the policy describing the required provenance relationships.
2. **Policy reviewers:** independently approve the exact canonical policy digest.
3. **Policy-state authority:** maintains monotonic sequence, revocation state, and atomic acceptance receipts.
4. **Evidence issuers:** attest to collected infrastructure facts; must not be the policy issuer, policy reviewers, policy-state authority, or operational issuers under review.
5. **Evidence resolver:** retrieves immutable evidence by identifier from a separately controlled evidence store.
6. **Operational systems:** source, snapshot, backup, authorization, and key-provider systems whose identities are being evaluated.

The policy-state and evidence signing public keys must be pinned through an out-of-band trust-provisioning process. A key, fingerprint, issuer ID, or capability statement supplied by the policy being checked is not a trust anchor.

## 3. Adapter boundaries

### 3.1 Policy-state provider adapter

A future adapter must implement the existing contract:

- `readState({ authorityId })`: return a signed, freshness-bounded state envelope.
- `compareAndSwap({ authorityId, expectedSequence, expectedDigest, nextState })`: atomically compare the current version and commit exactly one next state, returning a signed receipt bound to the exact request.

Required operational properties to demonstrate independently:

- durable commit across process restart and host restart;
- linearizable or equivalently documented atomic compare-and-swap semantics;
- concurrent writers cannot both accept the same prior sequence;
- read-after-write returns the committed sequence and digest;
- stale replicas, partial writes, unavailable quorum, and ambiguous commit outcomes fail closed;
- audit logs identify authority, request digest, outcome, and correlation ID without exposing private keys.

A signed `durable: true` or `atomic: true` claim is not proof of these properties. The adapter's deployment, storage semantics, identity boundary, and recovery behavior require independent evidence.

### 3.2 Evidence collection and resolver adapters

Each evidence record must be collected from the authoritative control plane for the dimension it asserts. It must include:

- unique immutable evidence ID;
- source and dimension;
- exact environment and project scope;
- issuer and signing-key version;
- collection timestamp and expiry;
- reviewer/collector identity where applicable;
- canonical record digest;
- source-native reference or verifiable control-plane receipt.

The resolver must reject missing, duplicate, replayed, expired, out-of-scope, or digest-mismatched evidence. Evidence IDs must be globally unique across all sources and dimensions in one policy acceptance. Evidence issuers must be disjoint from policy signer, policy reviewers, state authority, and operational issuers.

## 4. Six-dimension independence matrix

Before staging approval, populate this matrix with actual provider names, immutable account/project identifiers, trust boundaries, evidence references, and independently verified ownership. Do not fill it with invented or synthetic values.

| Dimension | Required authoritative source | Independence question |
|---|---|---|
| storageSystemId | Storage control plane | Is this a separately administered storage service, not a label supplied by the application? |
| storageInstanceId | Storage account/instance API | Is the actual instance distinct from the source and backup instances? |
| securityPrincipalId | IAM/workload identity provider | Is the principal independently provisioned and least-privileged? |
| trustDomainId | Identity/security administration | Is the trust domain governed independently from the workload being evaluated? |
| sourceSystemId | Source platform control plane | Can the source identity be verified without trusting the backup system? |
| snapshotIssuerId | Snapshot service/control plane | Is the issuer identity authenticated by an independently pinned authority? |

A dimension remains **NOT_VERIFIED** if its evidence comes only from application configuration, environment variables, caller-supplied JSON, a self-asserted provider response, or the same administrative/security principal as another supposedly independent role.

## 5. Staging test plan

All tests below are future staging gates. They are not represented as executed.

| Test | Procedure | Required result |
|---|---|---|
| Trust-anchor substitution | Replace each pinned key, issuer, or key version | Reject before policy acceptance |
| Role-collision | Reuse policy signer/reviewer/state authority as evidence issuer | Reject |
| Duplicate evidence | Reuse one evidence ID across dimensions or sources | Reject |
| Evidence tampering | Change a collected record after signing | Signature or digest rejection |
| Scope substitution | Replay evidence from another project/environment | Reject |
| Freshness/replay | Use expired evidence or replay an old policy sequence | Reject |
| Concurrent acceptance | Submit two policies against the same prior sequence | Exactly one CAS succeeds |
| Crash before commit | Terminate before durable commit | No accepted state change |
| Crash after commit, before receipt | Restart and read authoritative state | State is unambiguous; retry is idempotently reconciled |
| Provider outage/partition | Remove quorum or make authoritative state unavailable | Fail closed; no local fallback acceptance |
| Replica lag | Read from a stale replica | Reject stale sequence or use authoritative read |
| Restore drill | Restore backup to an isolated test target | Verify source/backup identities and audit trail independently |
| Rollback drill | Revert staged adapter/configuration | Restore prior approved configuration without weakening trust pins |

Record run ID, commit SHA, environment, operator, timestamps, test evidence IDs, expected/actual outcomes, and independent reviewer for every drill. Redact secrets and personal data.

## 6. Staging entry gates

Staging work may begin only after a separate explicit approval and completion of all of the following:

- named staging environment and data classification approved;
- provider and evidence-source choices documented with terms, data residency, cost, and retention reviewed;
- trust anchors provisioned out of band by an authorized administrator;
- workload identities and least-privilege permissions reviewed;
- provider durability and CAS semantics documented by the provider and independently tested;
- evidence issuer roles proven disjoint from policy and operational roles;
- isolated test data and recovery target prepared;
- backup, restore, outage, concurrency, and rollback procedures reviewed;
- independent security reviewer assigned;
- monitoring, audit retention, incident response, and stop conditions defined.

A failed or unavailable gate means **NOT_APPROVED**; it must not be waived by a synthetic CI result.

## 7. Stop conditions and rollback

Stop the drill immediately on trust-anchor mismatch, issuer-role collision, duplicate evidence, unexpected state advancement, ambiguous commit outcome, unauthorized data access, audit gap, or unexplained identity mismatch.

Rollback must disable the staged adapter through the approved change mechanism, preserve immutable logs and evidence, restore the previous approved configuration, verify that no policy was accepted through an untrusted fallback, and obtain independent review before any retry. Do not delete evidence needed for incident analysis.

## 8. Acceptance and release classification

F7-SR-05 can move beyond partial remediation only when:

1. all six dimensions have independently collected and authenticated evidence;
2. policy, reviewer, state-authority, evidence-issuer, and operational trust roles are demonstrably separated;
3. real provider durability, atomicity, concurrency, restart, outage, and recovery behavior pass staging drills;
4. an independent reviewer validates the evidence and signs the acceptance record;
5. the acceptance record is tied to the exact code commit and environment configuration.

Current classification:

- Contract hardening: implemented in code; synthetic CI result pending for the latest hardening commit.
- Real provider adapter: NOT_IMPLEMENTED.
- Independently provisioned trust anchors: NOT_VERIFIED.
- Real six-dimension evidence collection: NOT_VERIFIED.
- Staging integration and drills: NOT_APPROVED / NOT_RUN.
- F7-SR-05: PARTIALLY_REMEDIATED / OPEN.
- Production readiness: NOT_CERTIFIED.

This document is a preparation blueprint only. It does not authorize staging or production integration and does not advance the release beyond v0.2.
