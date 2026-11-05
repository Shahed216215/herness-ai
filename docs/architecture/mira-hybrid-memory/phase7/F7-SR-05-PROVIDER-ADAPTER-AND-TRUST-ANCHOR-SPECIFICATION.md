# F7-SR-05 Provider Adapter & Trust-Anchor Specification

**Release:** Mira Hybrid Memory v0.2  
**Finding:** F7-SR-05 — infrastructure provenance independence  
**Status:** DESIGN_ONLY / NOT_IMPLEMENTED / NOT_STAGING_APPROVED  
**Production readiness:** NOT_CERTIFIED

## 1. Purpose and boundary

Define a vendor-neutral implementation contract for the policy-state provider, evidence resolver, evidence collection adapters, and out-of-band trust-anchor provisioning. This is an architecture specification only.

This document does not select or provision a cloud vendor, create accounts or credentials, generate production keys, access staging, move backup data, or authorize deployment. Synthetic CI results do not satisfy operational acceptance.

## 2. Trust domains and role separation

The following roles require separate identities and independently reviewed administrative boundaries:

| Role | Responsibility | Must not be |
|---|---|---|
| Policy issuer | Sign immutable provenance policy | Any assessed operational issuer or evidence issuer |
| Policy reviewer(s) | Approve exact policy digest | Policy issuer, evidence issuer, state authority |
| State authority | Sign current state and CAS receipts | Policy issuer/reviewer or assessed operational identity |
| Evidence issuer | Sign evidence collected from authoritative control plane | Policy signer/reviewer, state authority, operational issuer |
| Evidence resolver | Retrieve immutable evidence by opaque ID | A policy-controlled arbitrary URL or caller-selected file path |
| Adapter workload | Call provider/resolver with scoped permissions | A human administrator or broad organization owner |
| Break-glass operator | Recover access under dual control | Sole routine operator or unilateral policy approver |

Distinct labels or keys do not prove separate control. Review parent organizations, administrators, federation roots, CI/CD authority, recovery paths, billing/account ownership, and key custody for common-mode dependencies.

## 3. Policy-state provider contract

The adapter must satisfy the existing JavaScript contract without changing its semantic boundary:

### 3.1 readState

Input:
- `authorityId`: exact configured authority identifier.

Output:
- signed envelope with canonical payload;
- authority ID and signer authority ID;
- key ID and key version;
- contract version;
- monotonically increasing accepted sequence;
- last accepted policy ID and canonical digest (both null only at sequence zero);
- unique revoked policy IDs;
- issued-at and expires-at timestamps;
- authenticated capability claims, which are informational and not independent proof.

The adapter must read from an authoritative consistency boundary. A stale replica must not return a state that can authorize rollback. If strong consistency is unavailable, return an explicit unavailable error; do not silently fall back to local cache.

### 3.2 compareAndSwap

Input:
- authority ID;
- expected prior sequence;
- expected prior digest;
- complete next-state tuple;
- deterministic idempotency key derived from the policy ID and verified policy digest.

Required behavior:
1. Validate caller workload identity and authorization for this authority.
2. Atomically compare both prior sequence and prior digest.
3. Require next sequence = prior sequence + 1.
4. Persist the complete next-state tuple as one atomic transaction.
5. Return a signed receipt binding authority, prior sequence, next sequence, policy ID, policy digest, idempotency key, canonical request digest, and commit time.
6. Make duplicate retries with the same idempotency key and identical request return the same logical commit result.
7. Reject reuse of an idempotency key with different request content.
8. Never partially advance sequence or update revocation list separately.

A conflict must return `HFM_POLICY_STATE_CAS_CONFLICT`. A known provider outage before commit must return `HFM_POLICY_STATE_UNAVAILABLE`. Do not report success without a verifiable signed receipt.

### 3.3 getCommitReceipt

Input:
- exact authority ID;
- exact idempotency key;
- SHA-256 digest of the canonical CAS request.

Return the original signed receipt for that exact committed request, or null only when the exact request is authoritatively known not to have committed. Reject a request-digest mismatch for an existing idempotency key. Receipt lookup must remain authoritative across provider restart and replica failover; a stale or eventually consistent replica is not sufficient to resolve an ambiguous commit.

### 3.4 Ambiguous commit outcome

A timeout or connection loss after request submission does not prove that the transaction failed. The adapter must support safe reconciliation using an immutable request/idempotency ID and authoritative read:

- query the exact request ID / idempotency key;
- if the exact signed receipt exists, return that receipt;
- if no commit occurred and the prior state remains authoritative, permit a same-request retry;
- if the state advanced to a different request or cannot be determined, fail closed and raise an operator-review event;
- never retry as a new policy acceptance with a new sequence based only on a client timeout.

The orchestrator retries an explicitly confirmed pre-commit request loss once with the same idempotency key and uses getCommitReceipt to reconcile an ambiguous post-commit response. It still cannot resolve an outcome when the adapter cannot authoritatively retrieve the exact receipt; in that case it fails closed and requires operator review. Real adapter-level durability and restart-safe receipt lookup remain unimplemented and unverified.

## 4. State persistence and consistency requirements

The real provider implementation must document and independently demonstrate:

- transaction isolation and exact compare conditions;
- durability model, replication/quorum behavior, and acknowledged-write semantics;
- linearizability or the precise consistency guarantee used for state reads/writes;
- crash consistency and recovery after process, host, zone, or service restart;
- behavior under partition, quorum loss, stale replica, throttling, and provider maintenance;
- backup/restore of the policy-state store without sequence rollback;
- retention and tamper resistance of audit records;
- idempotency retention period and duplicate request handling;
- clock source, allowed skew, and timestamp validation.

If the provider cannot provide a property, document the limitation and mark the related gate NOT_VERIFIED. Do not replace provider guarantees with a boolean supplied by configuration.

## 5. Evidence collection and resolver contract

### 5.1 Collector

Each dimension-specific collector must query its authoritative control plane using a dedicated least-privilege identity. It must preserve the provider-native resource identifier and provenance metadata, and must not infer independence from application config or display names.

Each signed evidence payload must bind:
- schema and evidence type;
- immutable evidence ID;
- project and environment;
- source ID and exactly one provenance dimension;
- observed resource/account/tenant/principal identity;
- authoritative provider/control-plane name and native record reference;
- collection timestamp, expiry, and source version/revision;
- collector workload identity and issuer key ID/version;
- canonical payload digest;
- reviewer reference where independent review is required.

Evidence for one dimension cannot be reused for another. Evidence IDs must be globally unique within an acceptance. A single operational principal must not issue evidence asserting its own independence.

### 5.2 Resolver

The resolver accepts only an opaque evidence ID and resolves it inside a configured allowlisted store. It must not accept caller-provided URLs, arbitrary paths, query fragments, or network destinations.

It must return the signed immutable envelope plus retrieval metadata. It must reject missing, duplicated, revoked, expired, malformed, wrong-scope, wrong-dimension, wrong-source, or digest-mismatched records. It must enforce evidence issuer disjointness from policy signer, reviewers, state authority, and operational issuers.

### 5.3 Evidence provenance

For every record, retain source-native reference, collector identity, timestamp, digest, issuer key version, review outcome, and audit correlation ID. Store references and redacted metadata only; never persist private keys, access tokens, raw credentials, customer data, or backup payloads in the evidence register.

## 6. Out-of-band trust-anchor provisioning

Trust anchors are configured independently of the application policy and independently of the workload that requests policy acceptance.

### 6.1 Bootstrap ceremony

1. Appoint an authorized security owner and a second independent witness.
2. Verify authority identity and public-key fingerprints through an authenticated administrative channel separate from the application and its CI workflow.
3. Confirm key type, algorithm, key ID, key version, validity, intended role, and revocation contact.
4. Record the exact SPKI SHA-256 fingerprint and authority metadata in a controlled trust-anchor registry.
5. Require two-person review of the registry change and immutable audit evidence.
6. Deliver only public verification material to the runtime through a protected, reviewed configuration mechanism.
7. Verify at startup that runtime pins match the approved registry version; fail closed on mismatch, missing pin, unknown key, or downgrade.
8. Preserve ceremony record, approvers, timestamp, registry revision, and code/configuration commit.

Do not bootstrap trust from a public key embedded in the policy being verified, from an unverified repository commit, or from an environment variable writable by the assessed workload.

### 6.2 Rotation

- Introduce a new key as a separately reviewed pin before it is used.
- Define an overlap window and exact accepted key versions.
- Sign rotation metadata with the currently trusted authority and independently approve it.
- Test new-key acceptance, old-key rejection after cutoff, and rollback resistance.
- Revoke compromised keys through an authenticated emergency channel.
- Never silently accept an unknown key because the old key is unavailable.

### 6.3 Recovery and compromise

If a state-authority or evidence-issuer key is suspected compromised:
- stop policy acceptance;
- preserve audit/evidence records;
- revoke the affected key and authority through the approved independent control plane;
- assess all policies/evidence signed during the exposure window;
- re-establish trust through the two-person ceremony;
- require independent review before resuming.

## 7. Security and operational test matrix

All tests below are future adapter/staging tests, not run by synthetic unit CI:

| Area | Test | Expected behavior |
|---|---|---|
| CAS | Two writers submit same prior sequence/digest | Exactly one commit |
| CAS | Same idempotency ID, same request | Same logical receipt |
| CAS | Same idempotency ID, altered request | Reject |
| Ambiguous outcome | Drop response after durable commit | Reconcile exact receipt; no duplicate commit |
| Ambiguous outcome | Drop request before commit | State unchanged; same-request retry safe |
| Restart | Restart provider after acknowledged commit | Sequence/digest preserved |
| Recovery | Restore older backup snapshot | Rollback prevented or recovery held for independent reconciliation |
| Partition | Remove quorum | Fail closed |
| Replica | Read stale replica | No policy acceptance from stale state |
| Trust | Unknown or substituted state key | Reject |
| Trust | Rotate and revoke key | Enforce approved version window |
| Roles | Evidence issuer equals policy signer/reviewer/state authority | Reject |
| Evidence | Duplicate evidence ID across dimensions | Reject |
| Evidence | Tampered, stale, revoked, wrong-scope record | Reject |
| Resolver | Arbitrary URL/path injection | Reject; no outbound request |
| Audit | Inspect events and error output | No secrets or payload leakage |

Each test record must include commit SHA, adapter version, environment, provider region/account, test ID, run ID, expected and actual outcome, timestamps, and independent reviewer.

## 8. Operational controls

Before any staging request, define:
- provider/service selection with cost, data residency, retention, and exit strategy;
- service owner and security owner;
- workload identity and minimum permissions;
- alerting for failed CAS, repeated conflicts, key mismatch, revocation, stale state, and ambiguous commit;
- immutable audit retention and access review;
- incident response and recovery contacts;
- backup/restore and key rotation runbooks;
- change control and rollback plan;
- independent reviewer who is not an implementer or provider administrator.

## 9. Implementation sequencing

No code changes to existing runtime paths are authorized by this specification. Once a separate implementation request and staging approval are obtained, proposed sequence:

1. Define adapter interface conformance tests and error taxonomy in isolated tests.
2. Build a local fake provider for deterministic unit and concurrency simulation only.
3. Review idempotency and ambiguous-commit semantics with independent security review.
4. Select a real provider only after cost/privacy/data-residency review.
5. Implement provider adapter in a separately scoped module with no default production wiring.
6. Add contract tests against a dedicated non-production account.
7. Perform restart, concurrency, outage, restore, rotation, and rollback drills.
8. Collect independently signed six-dimension evidence.
9. Obtain written staging approval and independent acceptance.
10. Only then consider a separately approved integration into the backup drill.

## 10. Current disposition

- Provider adapter: NOT_IMPLEMENTED.
- Evidence collectors/resolver backed by real infrastructure: NOT_IMPLEMENTED.
- Out-of-band trust-anchor ceremony: NOT_PERFORMED.
- Real provider durability/atomicity: NOT_VERIFIED.
- Ambiguous commit reconciliation: NOT_VERIFIED.
- Staging: NOT_APPROVED / NOT_RUN.
- F7-SR-05: PARTIALLY_REMEDIATED / OPEN.
- Production readiness: NOT_CERTIFIED.

This specification is a design artifact only. It does not authorize infrastructure provisioning, credential creation, staging access, production integration, or release advancement beyond Mira HFM v0.2.


## 10. Orchestrator idempotency and authoritative receipt lookup

The Phase 7 policy-acceptance orchestrator now requires three provider operations: `readState`, `compareAndSwap`, and `getCommitReceipt`. A provider that lacks authoritative receipt lookup is not conformant.

- The orchestrator derives a deterministic idempotency key from the immutable policy ID and verified policy digest: `mira-hfm-policy-acceptance-v1:<policyId>:<policyDigest>`.
- The request digest is SHA-256 over the canonical JSON representation of exactly `{ authorityId, expectedSequence, expectedDigest, nextState }`. The idempotency key is a separate request field and is not included in that digest.
- `compareAndSwap` receives the idempotency key. Its signed receipt must bind the authority, previous/next sequence, policy ID/digest, idempotency key, and exact request digest.
- `getCommitReceipt({ authorityId, idempotencyKey, requestDigest })` must query the authoritative receipt store. It returns the exact original signed receipt for a committed request, or null only when the exact request is known not to have committed. A different digest for the same key is rejected.
- If the adapter explicitly reports `HFM_POLICY_STATE_REQUEST_NOT_COMMITTED`, the orchestrator retries once with the identical request and idempotency key. If it reports `HFM_POLICY_STATE_AMBIGUOUS_COMMIT`, the orchestrator retrieves and verifies the exact receipt through `getCommitReceipt`. Missing, unavailable, or mismatched receipt evidence fails closed as unresolved; it must not create a new key or sequence.
- The in-memory fake provider and synthetic tests cover pre-commit request loss, post-commit response loss, receipt lookup, request-digest binding, and unresolved receipt failure. They do not prove that a real provider stores state and idempotency receipts atomically or durably.
- A real provider must demonstrate that state mutation and receipt persistence are one atomic durable transaction and that receipt lookup is authoritative across restart, replica failover, and ambiguous network outcomes. Until then, the policy-state provider remains NOT_CERTIFIED and staging remains NOT_APPROVED.


## 11. Trust-role key separation and authenticated-input snapshots

The signed provenance policy reviewer trust map must pin each reviewer's role in addition to key ID, key version, public key, and fingerprint. Every approval role must match its pinned reviewer identity, and reviewer roles must be distinct within the approval quorum. Reviewer key fingerprints must be unique and must not match the policy signer or verified policy-state authority.

Evidence issuer public-key fingerprints must be disjoint from the policy signer, state authority, and reviewer keys. Evidence reviewer identities must not overlap policy reviewers or operational issuer identities. Evidence issuer IDs must not alias the same signing-key fingerprint under multiple names.

Evidence records are semantically bound to the exact policy source ID, provenance dimension, observed value, environment, and project ID; the digest and signature alone are not enough. The policy source/evidence maps must contain exactly two sources and exactly the six required dimensions per source.

Before asynchronous provider access, the orchestrator snapshots the signed policy envelope and state/policy/reviewer/evidence trust maps. The evidence verifier independently snapshots source profiles, evidence references, and evidence trust before the first resolver await. Staging also snapshots source descriptors, pinned source trust, requests, key-provider descriptor/method references, and schema allowlists before the policy-state provider is awaited.

These are software-level contract controls. They do not prove independent administration of real trust anchors, non-exportable key custody, durable evidence stores, or infrastructure separation.


## 12. Backup key-provider secret boundary

The backup wrapping/unwrapping adapter accepts only the declared wrap/unwrap interface and public descriptor metadata. Raw private keys, master keys, KEKs, encryption-key bytes, generic key-material fields, credential objects, access/refresh tokens, and client secrets are rejected on both the provider object and its descriptor. Snapshot signing providers apply the equivalent sign-only boundary.

Exceptions from external `wrapDataKey` and `unwrapDataKey` calls are normalized to generic `BACKUP_KEY_WRAP_FAILED` and `BACKUP_KEY_UNWRAP_FAILED` errors; upstream exception text and provider-specific codes are not exposed to the caller. Temporary copied DEK buffers are zeroed after wrap attempts, including failure paths.

These controls reduce accidental secret transport and error-detail leakage. They do not prove KMS/HSM non-exportability, workload identity, IAM separation, key rotation/revocation, or provider auditability. Production key custody remains NOT_APPROVED pending independent evidence.


## 13. Authorization replay guard contract

The authorization verifier calls `replayGuard.consume({issuerId, decisionId, requestId, nonce, expiresAt})` only after signature, issuer, request binding, and freshness checks succeed. The call must atomically claim the exact one-time decision tuple and return literal `true` only to the first claimant. Duplicate claims, expired entries, unavailable stores, exceptions, or any result other than literal `true` fail closed as `HFM_AUTHZ_REPLAY_REJECTED`.

The verifier snapshots the signed decision, request, and issuer trust map before awaiting the replay guard, and captures the consume method reference before the await. This prevents a callback from changing the decision reported after signature verification.

A local fake replay guard and concurrency test demonstrate one winner among simultaneous duplicate claims and a restart simulation using an exported digest snapshot. The fake is explicitly process-local and NOT durable. Real acceptance requires an independently administered atomic durable store, multi-process/multi-replica concurrency evidence, restart and failover recovery, expiry/retention behavior, and audit records. No production replay store is implemented or certified by the fake.


## 14. Adapter method-reference stability

The policy-state orchestrator captures `readState`, `compareAndSwap`, and `getCommitReceipt` method references before its first provider await. The evidence verifier captures `resolve` before the first evidence lookup. The staging drill captures source `readSnapshot` and key-provider wrap/unwrap method references before policy-provider interaction. The Google Drive adapter similarly captures list/create/get/quota methods before its first list await.

These controls prevent a callback from replacing methods on the original caller-owned adapter object midway through an authenticated operation. They do not make a malicious adapter truthful, authenticate a provider, or prove its real storage/cryptographic guarantees.
