# F7-SR-05 — Baseline Source Provenance Independence

Date: 2026-11-05  
Project: Mira Hybrid Memory v0.2 / Phase 7  
Status: PARTIALLY_REMEDIATED / OPEN  
Staging gate: NOT_APPROVED  
Production readiness: NOT_CERTIFIED

## Finding

Different source IDs or signing keys do not prove independent failure domains. Two adapters can use different labels while reading the same storage instance, running under the same security principal, or relying on the same trust domain.

## Implemented contract

- `services/mira-hfm-source-provenance-contract.js` requires a versioned provenance policy with pinned profiles for both source IDs.
- Six dimensions must be present and non-empty for each source: storage system ID, storage instance ID, security principal ID, trust domain ID, source system ID, and snapshot-signing trust issuer ID.
- `services/mira-hfm-local-staging-snapshot-source.js` includes configured provenance in the source attestation before signing.
- `services/mira-hfm-authoritative-snapshot.js` checks the signed provenance against the corresponding source trust record and carries it into verified evidence.
- `services/mira-hfm-staging-backup-drill.js` invokes the pair contract before comparing baseline payloads or publishing an encrypted backup. Any shared dimension, missing profile, duplicate source ID, or pin mismatch fails closed.
- CI workflow includes the provenance service and its dedicated test suite.

## Synthetic offline test coverage

`tests/mira-hfm-source-provenance-contract.test.js` covers:
- fully distinct synthetic profiles;
- same storage system;
- same storage instance;
- same security principal;
- same trust domain;
- same source system;
- same snapshot-signing trust issuer;
- duplicate source IDs;
- forged/mismatched provenance claims;
- missing/unpinned policy profiles.

The staging-drill fixture also carries signed provenance claims and pinned synthetic profiles. These tests demonstrate contract mechanics only.

## Evidence and limits

The provenance fields are claims authenticated by each source signing key and compared with caller-supplied pinned trust/policy records. The application cannot prove that real infrastructure identifiers are truthful, that administrative control planes are separate, or that a policy distribution channel is trustworthy.

Real staging approval still requires independently obtained infrastructure inventory, storage/account evidence, workload identity evidence, signer/issuer governance, and independent review of the policy provisioning channel. No production data, live API, Drive, secret, deployment, canonical Memory or Knowledge store was accessed by this implementation.

## Disposition

F7-SR-05 is PARTIALLY_REMEDIATED / OPEN. The contract blocks obvious shared-boundary claims, but real infrastructure independence remains unverified. Production remains NOT_CERTIFIED.
