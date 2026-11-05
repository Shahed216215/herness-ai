# MIRA HFM v0.2 — Phase 7 Authorization Provider Governance

Status: SIGNED DECISION CONTRACT IMPLEMENTED; NO PRODUCTION POLICY ISSUER OR REPLAY STORE SELECTED.

## Trust separation
- Snapshot-source signing keys and authorization-decision issuer keys MUST be distinct trust domains and independently provisioned.
- authorizationTrust maps an issuer ID to an Ed25519 public key, pinned key ID, SHA-256 SPKI fingerprint, and one exact allowed policy version.
- A source-signed snapshot attestation records issuer ID, decision ID, policy version, and authorization expiry. This preserves provenance but does not prove that the issuer's underlying policy was correct.

## Decision contract
The policy issuer returns an Ed25519-signed ALLOW decision bound to project ID, actor ID, exact scope (backup:read), request ID, request nonce, issuer ID, pinned key ID, pinned policy version, unique decision ID, issued-at and expiry timestamps.
- The verifier fails closed on missing/malformed claims, DENY, wrong project/actor/scope/request/nonce, unknown issuer, key fingerprint mismatch, unpinned policy version, invalid signature, future/expired decision, or excessive validity.
- Maximum decision validity is five minutes; the source adapter verifies and consumes the decision before opening either Memory or Knowledge file.

## Replay guard contract
replayGuard.consume(claim) MUST be an atomic, durable, one-time operation across all application instances and restarts. It must reject a previously consumed (issuerId, decisionId) and bind the stored claim to request ID, nonce and expiry. It must fail closed on storage outage, timeout, partition, or ambiguous commit. A process-local Set is test-only and MUST NOT be used in staging/production.
The current code validates the injected function's presence and requires literal true from the consume call. It cannot prove the provider's atomicity, durability, consistency model, identity, or auditability. Those require an independently reviewed provider implementation and concurrency/failure tests.

## Required production policy controls
1. Policy issuer workload identity and least-privilege access; only the approved backup operator/workload may request backup:read for the authorized project.
2. Policy version governance, change review, issuer key rotation/revocation, and emergency deny procedure.
3. Independent audit events for allow/deny, actor, project, scope, decision ID, policy version, expiry, and replay rejection; do not log credentials or snapshot contents.
4. Negative tests for wrong project/actor/scope, policy-version mismatch, invalid signature, expired/future decision, duplicate/replayed decision, issuer outage, replay-store outage, concurrent duplicate consumption, and recovery after restart.
5. Separate staging and production issuers/keys. Synthetic test keys must never be reused.
6. Independent security review of issuer implementation and replay-store consistency guarantees.

## Evidence and disposition
- Offline signed-decision contract: implemented; CI evidence pending.
- Policy version pinning: implemented in the verifier; synthetic negative test added.
- Real policy issuer identity/governance: NOT_SELECTED / NOT_VERIFIED.
- Durable distributed replay store: NOT_IMPLEMENTED / NOT_SELECTED.
- Production authorization: NOT_APPROVED.
- F7-SR-01: PARTIALLY_REMEDIATED / OPEN.