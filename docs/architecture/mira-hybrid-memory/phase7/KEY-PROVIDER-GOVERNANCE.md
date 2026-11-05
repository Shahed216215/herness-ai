# MIRA HFM v0.2 — Phase 7 Key Provider Governance

Status: CONTRACT DEFINED; NO PRODUCTION PROVIDER SELECTED OR APPROVED.

## Contract boundary
The emergency-backup service accepts an injected external key provider. The provider must expose both `wrapDataKey` and `unwrapDataKey`, plus a descriptor:
- `contractVersion: "1"`
- non-empty `providerId` and `providerVersion`
- `keyId` and `keyVersion` exactly matching the backup metadata/manifest
- `keyPurpose: "MIRA_HFM_BACKUP"`
- `environment: "test" | "staging" | "production"`

The validator checks declared interface shape and key-reference consistency only. A descriptor is caller-supplied data: it does not authenticate the provider, prove that a KMS/HSM is used, prove authorization, or constitute security approval. Its result is deliberately `CONTRACT_SHAPE_VALID_NOT_APPROVAL`; production use remains disabled.

## Required production decisions before integration
1. Select a managed KMS/HSM or another independently reviewed key-custody service. Do not store KEKs beside encrypted backups, in source control, application logs, or the same Drive account.
2. Establish workload identity and least-privilege authorization for wrap/unwrap. Backup creation and recovery permissions must be separately scoped where supported.
3. Define key version pinning, rotation, old-version decrypt availability, revocation, and compromise response. Never rotate by silently making historical backups undecryptable.
4. Define recovery/escrow with at least two-person control, audited access, offline recovery procedure, and tested restoration of key access. No single operator should be able to both silently replace backups and destroy all recovery paths.
5. Specify provider-side audit events, retention, alerting, region/residency, service availability, rate limits, and cost ceilings.
6. Review threat model, provider terms, data-processing/privacy implications, and independent security assessment.
7. Perform staging-only wrap/unwrap, wrong-identity denial, wrong-key/version denial, rotation compatibility, provider outage, and recovery-drill tests before production approval.

## Secret-handling rules
- DEKs are generated per backup and are never persisted in plaintext.
- The service zeroizes its DEK buffer and the temporary copy passed to `wrapDataKey` after the provider call. JavaScript/Node cannot guarantee erasure of every runtime/GC copy; this is defense-in-depth, not a hard memory-erasure guarantee.
- Provider errors must not include credentials, plaintext DEKs, tokens, or raw provider responses in user-facing logs.
- Wrapped DEKs are sensitive encrypted metadata and must not be treated as public identifiers.
- No test fixture or local-development key may be reused in staging or production.

## Evidence and approval gates
| Gate | Required evidence | Current status |
|---|---|---|
| Interface shape | Offline conformance tests | PASS_CI when workflow succeeds |
| Provider identity | Independently verified provider identity and workload principal | PENDING |
| Key custody | Architecture/security review and documented ownership | REVIEW_REQUIRED |
| Authorization | Least-privilege policy and negative authorization tests | PENDING |
| Rotation/recovery | Versioned recovery drill and restore evidence | PENDING |
| Production approval | Explicit owner approval after all prior gates | NOT_APPROVED |

No production KMS, secret manager, Drive API, production Memory, or deployment was accessed while defining this contract.
