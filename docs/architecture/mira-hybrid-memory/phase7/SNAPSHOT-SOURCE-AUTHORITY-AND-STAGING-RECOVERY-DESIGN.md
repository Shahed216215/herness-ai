# Mira HFM v0.2 — Snapshot Source Authority and Staging Recovery Design

**Document ID:** MIRA-HFM-P7-SNAPSHOT-AUTHORITY-RECOVERY-001  
**Status:** DESIGN / SYNTHETIC OFFLINE CONTRACT ONLY  
**Phase:** 7 — Encrypted Emergency Backup  
**Version:** v0.2

## 1. Purpose and boundary

This design defines the security boundary between an authenticated, authorized, immutable HFM source snapshot and the existing Phase 7 encrypted emergency-backup pipeline. It also defines a non-production recovery drill that ends in an isolated staging directory.

This document does not implement or claim a production canonical snapshot exporter, production host authentication, a persistent project-owner registry, a production key provider, live Google Drive access, or canonical restore. It is not approval to access production Memory.

Any future offline prototype must use synthetic principals, synthetic registry records, synthetic snapshots, and fake storage/key providers. It must remain independent of routine Google Drive synchronization.

## 2. Evidence-based source-authority boundary

Phase 1–3 evidence identifies multiple stores and writers rather than one verified canonical HFM snapshot source. General Memory, Knowledge, CRM Conversation, Work Learning, Experience, and Work Knowledge have distinct schemas, ownership relationships, or projection semantics. Conversation, Audit, Research/Learning Governance, and Evolution stores have separate lifecycle and retention rules.

The following remain prerequisites, not facts this design may infer:

- authoritative store and schema/version for every included domain;
- authenticated host principal and its trust root;
- durable project-owner registry, including revocation and atomic replay protection;
- approved project-to-record mappings for every included source family;
- consistent-read/snapshot transaction boundary;
- completeness, tombstone, provenance, count, byte-size, and deterministic-manifest rules;
- explicit domain inclusion/exclusion and retention policy.

No file, array, user profile, project title, client ID, timestamp, or legacy Drive artifact may be promoted to canonical source authority by assumption. If required authority or mapping is absent, stale, ambiguous, revoked, or unavailable, snapshot creation must fail closed with a typed non-success result. It must never return an empty snapshot as a substitute for an unreadable source.

## 3. Trust and data-flow model

Required order:

1. **Authenticate:** accept a host-authenticated principal from a trusted integration boundary. The snapshot component must not parse bearer tokens, cookies, or caller-supplied identity claims itself.
2. **Authorize:** resolve the principal against an authoritative, persistent project-owner registry; verify project membership, allowed snapshot purpose, domain grants, registry version, revocation state, and authorization expiry.
3. **Consume replay protection:** atomically consume a one-time operation nonce/request ID bound to principal, project, purpose, and registry version. Duplicate, expired, mismatched, or previously consumed requests fail closed.
4. **Resolve sources:** obtain only approved source adapters and schema versions for the authorized project and domain set. Do not accept caller-supplied collection names, arbitrary paths, SQL fragments, or source selectors.
5. **Read consistently:** establish a source-provided consistent-read boundary. Capture source revision/watermark and reject mixed-revision reads when the source cannot guarantee a coherent snapshot.
6. **Validate completeness:** validate each domain's schema, ownership mapping, record identity, tombstones, provenance, count/size bounds, and completeness evidence. Any partial or truncated result is INCONCLUSIVE and cannot be encrypted as a complete snapshot.
7. **Build immutable manifest:** produce canonical manifest bytes binding project ID, snapshot ID, source-set ID, schema versions, source revisions, record counts, byte counts, domain digests, total payload digest, creation time, authorization evidence reference, and policy version. Do not embed credentials or raw secrets.
8. **Encrypt:** pass the bounded snapshot payload and manifest to the existing Phase 7 envelope API with a caller-supplied key version. Encryption does not upgrade source authority or completeness.
9. **Stage backup:** only the encrypted envelope crosses the cloud adapter. Existing journal-first, generated-ID, exact-ID readback and ciphertext digest checks remain mandatory.
10. **Recover to staging:** authenticate the envelope, verify manifest and project/backup identity, validate all bounds, and publish plaintext only into a fresh owner-only staging directory. No canonical write or automatic trust promotion is permitted.

Source-authority and encryption/storage decisions are separate attestations. Valid ciphertext proves integrity of the bytes encrypted; it does not prove those bytes were a complete or authorized canonical snapshot.

## 4. Authorization evidence contract

An offline contract prototype may model these immutable decision fields:

- principalId: opaque synthetic host principal identifier;
- projectId: exact authorized project identifier;
- purpose: fixed enum HFM_EMERGENCY_BACKUP;
- allowedDomains: normalized allowlist of domain identifiers;
- registryVersion: immutable registry revision;
- authorizationId: opaque decision reference;
- issuedAt and expiresAt: canonical UTC timestamps;
- requestId/nonce: one-time replay-protection identity;
- policyVersion: exact policy contract version;
- decisionDigest: digest over canonical decision fields.

The decision must be produced by an injected trusted authorization adapter. A caller cannot construct a decision object and have it treated as trusted merely because its fields are well-formed. In the synthetic prototype, the test harness is the only issuer and must be clearly marked synthetic.

The snapshot operation must bind authorization evidence to the exact project, purpose, domain set, registry version, source-set version, request ID, and resulting manifest digest. Any mismatch invalidates the operation. Authorization must be checked at operation start and immediately before source reads; expiry or revocation during the operation aborts publication.

## 5. Source snapshot contract

A future source adapter must return an explicit structured result, never an unqualified array:

- projectId, domainId, schemaVersion;
- sourceId and sourceRevision/consistent-read token;
- records with stable immutable record IDs;
- recordCount and canonical serialized byteLength;
- complete=true only when the source proves all pages/records in the selected boundary were read;
- nextCursor=null only when enumeration is complete;
- tombstoneDigest and provenanceDigest where applicable;
- observedAt and source watermark;
- typed source errors without sensitive payloads.

Reject duplicate IDs, cross-project records, unknown schema versions, malformed/repeated cursors, page-limit exhaustion, record-count mismatch, byte-count mismatch, invalid timestamps, missing required tombstone/provenance evidence, and inconsistent source revisions.

Timeout, permission denial, missing source, or partial listing must never become records=[] with complete=true.

## 6. Immutable manifest and binding

The canonical manifest must use deterministic serialization and an explicit schema version. Its digest must bind:

- project and snapshot identifiers;
- exact domain inclusion list and schema versions;
- source adapter IDs and source revisions;
- per-domain record count, byte count, and digest;
- tombstone and provenance digests;
- consistent-read boundary;
- authorization decision digest and registry/policy versions;
- snapshot creation timestamp and payload digest.

The encrypted envelope metadata must bind the manifest digest and exact project/snapshot identifiers through allowlisted authenticated metadata. If the current Phase 7 envelope schema does not support a required binding, extend it only through a separately tested v0.2 schema-compatible change; do not overload unrelated metadata fields.

## 7. Staging recovery drill

The drill is synthetic and non-destructive. It must use a temporary test root, fake source adapter, fake key provider, fake Drive provider, and synthetic project. It must not read personal Memory, client/CRM data, Facebook data, real credentials, or production databases.

### Drill sequence

1. Generate a synthetic project and registry record with a test-only principal.
2. Issue a short-lived synthetic authorization decision for HFM_EMERGENCY_BACKUP.
3. Read two or more synthetic domains through fake source adapters with stable source revisions and explicit complete pagination.
4. Build the canonical manifest and payload; verify counts, sizes, and digests independently in the test harness.
5. Encrypt with a test-only key version and create the immutable local artifact.
6. Upload through the existing fake journaled provider; verify journal-before-upload ordering, exact ID, metadata, and exact ciphertext readback.
7. Start a fresh recovery process with no in-memory source state; resolve exact backup identity and historical key version through injected fakes.
8. Authenticate/decrypt into a new isolated staging directory; verify manifest digest, project/snapshot identity, per-domain digests, record counts, and exact bytes.
9. Re-read staged bytes and compare them to the original synthetic payload.
10. Confirm canonical-write counter remains zero and no trust/promotion flag changed.
11. Repeat negative cases with wrong project, wrong key, tampered manifest, stale/revoked authorization, duplicate request ID, missing source page, inconsistent revision, truncated listing, duplicate record ID, and staging path collision. Every negative case must fail closed without publishing a partial plaintext artifact.
12. Preserve synthetic evidence and hashes; clean up only the test-owned temporary directory after verifying it is inside the test root.

## 8. Required offline regression matrix

| Area | Required synthetic assertions |
|---|---|
| Authentication boundary | Missing/untrusted principal rejected; caller-supplied identity cannot override injected principal |
| Project authorization | Wrong project, revoked owner, missing domain grant, wrong purpose, expired decision rejected |
| Replay protection | Duplicate, expired, or altered request ID rejected atomically |
| Source completeness | Partial page, repeated cursor, truncation, source timeout, permission denial never become an empty complete snapshot |
| Source integrity | Cross-project record, duplicate ID, wrong schema, count/size/digest mismatch rejected |
| Consistency | Mixed source revisions or expired snapshot token rejected |
| Manifest | Deterministic bytes; every authority/source field affects digest; unknown fields rejected |
| Encryption binding | Project/snapshot/manifest digest tampering fails authenticated verification |
| Storage | Journal persisted before upload; same generated ID used for retry; exact metadata and ciphertext readback required |
| Recovery | Historical key version resolved exactly; wrong key and wrong project fail; no alternate-key fallback |
| Staging | Create-only publication, owner-only permissions, symlink/path collision rejection, exact readback |
| Non-mutation | Canonical write count remains zero; routine sync untouched; no automatic promotion |
| Failure hygiene | No plaintext, keys, tokens, raw principal data, or sensitive provider errors in logs |

All fixtures and keys must be synthetic. The test suite must assert zero OAuth client creation, zero network calls, zero canonical writes, zero production database access, and zero routine-sync mutations. If the environment cannot prove any assertion, report INCONCLUSIVE rather than PASS.

## 9. Implementation sequence and gates

1. **Design review:** reconcile this contract with Phase 1–3 source, identity, authorization, and replay evidence. No source is canonical until independently verified.
2. **Synthetic contract prototype:** implement only injected interfaces and deterministic validation with fake providers. No production adapter wiring.
3. **Offline recovery drill:** execute the full positive and negative matrix in an isolated temporary root.
4. **Independent review:** review trust-root assumptions, authorization freshness, replay atomicity, source completeness, manifest canonicalization, and recovery isolation.
5. **Owner/host integration prerequisites:** obtain approved authoritative source, persistent owner registry, authenticated host principal, replay store, and per-domain mappings. These are not supplied by this design.
6. **Separate live authorization:** only after the above gates, request explicit approval for each live provider/OAuth operation. No approval is implied here.
7. **Production certification:** requires independent source completeness review, key custody/recovery, live synthetic Drive verification, and a separately approved staging restore drill. Canonical restore remains a separate approval.

## 10. Explicit non-goals

- No production canonical snapshot exporter or source adapter.
- No production identity provider, owner registry, replay store, KMS, OAuth, or Drive client wiring.
- No live network, provider, Supabase, Render, or database access.
- No canonical Memory writes, migration, restore, or trust promotion.
- No routine Google Drive sync changes.
- No merge, deployment, secret changes, or production certification.

## 11. Current disposition

**DESIGN_READY_FOR_SYNTHETIC_CONTRACT_REVIEW**  
**CANONICAL_SOURCE=BLOCKED_PENDING_PHASE1_3_AUTHORITY_EVIDENCE**  
**PRODUCTION_IDENTITY_AND_OWNER_REGISTRY=NOT_IMPLEMENTED**  
**LIVE_GOOGLE_DRIVE=NOT_AUTHORIZED**  
**PRODUCTION_KEY_CUSTODY=NOT_CERTIFIED**  
**CANONICAL_RESTORE=NOT_AUTHORIZED**  
**PHASE7=NOT_COMPLETE**  
**VERSION=v0.2**
