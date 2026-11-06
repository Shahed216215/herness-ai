# MIRA HYBRID MEMORY
# Phase 2 Entry Gate & Execution Plan — 2026-11-04

**Document ID:** MIRA-HFM-PHASE2-ENTRY-GATE-20261104  
**Release line:** v0.2  
**Status:** DRAFT — REVIEW REQUIRED  
**Authority:** Planning and read-only reconciliation only  
**Implementation approval:** NOT_APPROVED  
**Production Memory access:** NOT_AUTHORIZED  
**Production migration / restore:** NOT_AUTHORIZED

## 1. Purpose

This document establishes a bounded Phase 2 scope proposal from the latest Phase 1 closure evidence and the v0.2 design-review artifacts. It does not authorize application-source changes or production operations.

## 2. Verified starting point

- Phase 1 is recorded as COMPLETE_WITH_EXPLICIT_RESIDUAL_RISKS.
- The Phase 1 report records six isolated fixture tests as PASS.
- Phase 1 source reconciliation is scoped; runtime completeness is not claimed.
- Phase 2 implementation is recorded as NOT_STARTED.
- The current v0.2.5 Prototype E remains a design proposal: DESIGN_APPROVAL=NOT_APPROVED, INDEPENDENT_DESIGN_REVIEW=NOT_PERFORMED, OPEN_DESIGN_DECISIONS=16, IMPLEMENTATION=NOT_STARTED.
- DR-08 records unresolved design decisions and gates, including genesis, backend arbitration, canonical test registry, timestamp profile, independent verification, and explicit authorization.

## 3. Phase 1 residual risks to carry forward

1. **R01 — Knowledge read/write safety (HIGH):** malformed/missing Knowledge JSON can be treated as an empty array; direct writes and partial Local/Drive dual-write behavior need a safe contract.
2. **R02 — Evolution writer duplication (HIGH):** Evolution and Local Store have separate write paths.
3. **R03 — Storage-root divergence (HIGH):** MIRA_STORAGE_DIR does not govern every persistence path; per-domain migration and rollback are required.
4. **R04 — Missing schedule store (HIGH for affected service/tests):** a referenced module is absent; scope and caller impact require focused verification.
5. **R05 — Drive dependency:** Drive synchronization must not be removed before a tested replacement and separate cutover approval.
6. **R06 — Provider account configuration:** effective OAuth scopes and provider/account retention settings remain unknown.
7. **R07 — Facebook connector absence:** no Page/Group Graph API connector was found in the reviewed source tree; no connector implementation is authorized.
8. **R08 — Audit consistency:** audit-failure propagation differs across Knowledge Improvement and Autonomous Learning routes.
9. **R09 — Runtime completeness:** dynamic paths and indirect runtime callers remain outside the static proof boundary.

## 4. Proposed Phase 2 work packages

### P2-A — Source and authority reconciliation
- Reconfirm the controlling v0.2.4 contract, v0.2.5 blueprint, Prototypes B–E, DR-08 matrix, and Phase 1 closure artifacts.
- Reconcile source hashes against an authoritative baseline; do not treat a malformed 62-character historical Blueprint hash as a valid SHA-256.
- Preserve every existing source artifact; no silent rewrite or supersession.

### P2-B — Design decision closure
- Reconcile Prototype E decisions E-01 through E-16 with the DR-08 decision matrix.
- Preserve already recorded v0.2 design-only approvals for DR08-U01 and DR08-U02 without interpreting them as implementation approval.
- Resolve or explicitly retain as OPEN every decision concerning operation identity, provider reconciliation, audit lifecycle, recovery, sequence allocation, backend durability, timestamp profile, hashes, manifest, key lifecycle, delegation, trust, idempotency, verifier independence, and source compatibility.

### P2-C — Contract and traceability candidate
- Prepare a single v0.2 contract-candidate proposal only after source conflicts are mapped.
- Give each normative requirement a stable ID, source section, exact behavior, failure behavior, authorization boundary, and unique test definition.
- Retain status distinctions: TESTED_PASS, TESTED_FAIL, INCONCLUSIVE, NOT_APPROVED, REVIEW_REQUIRED, NOT_APPLICABLE, NOT_EXECUTED.
- Do not convert a document mapping or structural check into runtime test evidence.

### P2-D — Independent review and implementation gate
- Require independent design review of security, privacy, cryptography, provider capability, recovery, and compatibility.
- Require explicit user approval of the exact implementation scope before application-source changes.
- Keep Production Memory access, migration, restore, network/provider calls, OAuth changes, Drive cutover, Facebook integration, and self-modification separately unauthorized unless explicitly approved.

## 5. Proposed execution order

1. Complete P2-A read-only source and integrity reconciliation.
2. Build a decision-by-decision matrix for P2-B, with evidence and unresolved alternatives.
3. Produce the requirement-to-test traceability candidate for P2-C.
4. Obtain independent review; classify every open item honestly.
5. Present the exact bounded implementation scope for explicit approval.
6. Only after approval, create a separate implementation branch and execute isolated, reversible work with backups and evidence.

## 6. Acceptance criteria for Phase 2 design readiness

- All controlling sources and hashes are reconciled or explicitly marked REVIEW_REQUIRED.
- No source requirement is silently dropped or weakened.
- All 16 Prototype E decisions have a recorded disposition.
- DR-08 decisions and Prototype E references are consistent or documented as unresolved.
- Every normative requirement maps to one canonical test definition.
- Test execution evidence is independent and status-accurate.
- Provider guarantees are not inferred from static documentation.
- Independent design review is recorded.
- The exact implementation scope receives separate explicit approval.

## 7. Prohibited actions under this plan

- No Production Memory read/write/search/export/restore.
- No migration, deletion, overwrite, or recovery against production data.
- No application-source modification or self-modification.
- No live network, provider API, Facebook/Meta API, Google Drive API, or model call.
- No package installation or credential/OAuth configuration change.
- No Drive-sync removal or Facebook connector implementation.
- No merge to the default branch.

## 8. Current decision

`PHASE1=COMPLETE_WITH_EXPLICIT_RESIDUAL_RISKS`  
`PHASE2_DESIGN_RECONCILIATION=PROPOSED`  
`PHASE2_IMPLEMENTATION=NOT_AUTHORIZED_PENDING_EXPLICIT_SCOPE_APPROVAL`  
`PRODUCTION_READINESS=NOT_CERTIFIED`

This plan is a planning artifact only. It does not amend the controlling contract or authorize implementation.
