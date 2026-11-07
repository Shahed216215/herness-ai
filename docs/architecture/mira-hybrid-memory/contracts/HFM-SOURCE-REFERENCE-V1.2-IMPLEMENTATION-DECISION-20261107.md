# MIRA HFM v0.2 — Source Reference v1.2.0 Implementation Decision

**Decision ID:** HFM-SRC-DECISION-2026-11-07-01  
**Status:** IMPLEMENTATION DECISION FOR HFM v0.2 BRANCH  
**Scope:** Source-reference canonical schema, user-supplied writer, and lifecycle boundary  
**Compatibility baseline:** Canonical record schemas v1.0.0 and v1.1.0 remain unchanged

## 1. Representation decision

The HFM v0.2 implementation request explicitly calls for a source-reference canonical schema and authorized writer. This implementation therefore selects the separately versioned canonical-record representation (Option B in proposal HFM-SRC-2026-11-07-01), rather than silently adding source_reference to v1.1.0.

- source_reference is accepted only under canonical schema 1.2.0.
- Existing v1.0.0 and v1.1.0 record-type compatibility is preserved.
- The canonical outer Memory envelope and existing repository remain the persistence plane; no second source-reference database is introduced.
- The source-reference payload has its own referenceVersion 1.0.0 and strict validator.
- The implementation is within HFM v0.2; it does not create a v0.3 release.

## 2. Canonical payload

Required fields:

- referenceVersion
- sourceType
- sourceId
- retrievedAt
- accessResult
- retrievalMethod
- provenanceActor
- provenanceEventId
- policyVersion

Optional fields are canonicalUrl, contentHash, contentType, contentLength, retrievalTool, and sanitized notes.

The first writer supports only a user-supplied HTTPS URL:

- accessResult=NOT_FETCHED
- retrievalMethod=user_supplied_url
- retrievedAt is the server capture timestamp, not a claim that the URL was fetched.
- canonicalUrl strips query strings and fragments, rejects embedded credentials, non-HTTPS schemes, and local/private literal hosts.
- sourceId is a deterministic SHA-256 identifier over source type and canonical URL.
- provenanceActor comes from the verified server session principal.
- provenanceEventId is a deterministic SHA-256 identifier bound to project, task, tool-call, and tool name.
- User/model input cannot choose actor identity, event identity, trust, integrity, or lifecycle.

No page content, snippets, cookies, credentials, headers, private-group content, or fetched response body is stored by this writer.

## 3. Trust, integrity, classification, and lifecycle

Initial record state:

- recordType=source_reference
- schemaVersion=1.2.0
- classification=PROJECT_PRIVATE
- trust=SOURCE_RECORDED
- integrity=VERIFIED for the canonical metadata payload only
- lifecycle=ACTIVE
- searchEligible=false

NOT_FETCHED and SOURCE_RECORDED are independent from content accuracy. URL reachability, search snippets, or matching hashes do not automatically promote trust.

The canonical schema accepts the existing lifecycle vocabulary so a reference can remain historically represented. The currently wired authorized transitions are:

- Create: absent → ACTIVE
- Recoverable trash: ACTIVE → TRASHED, using the existing one-time exact-resource memory.trash authority
- Restore: TRASHED → ACTIVE, using the existing one-time exact-resource memory.restore authority

ARCHIVED, SUPERSEDED, and QUARANTINED remain representable states but do not have a source-reference-specific transition tool in this implementation. Trust promotion and content verification are not implemented here.

## 4. Authorization and persistence

The writer reuses the existing memory.write operation with an exact memory:<record-id> resource. This preserves the current permission vocabulary and avoids introducing an unreviewed standing or broad source-reference authority.

The write requires:

- explicit English or Bengali source/reference/link/URL save intent;
- the exact URL in the current user message;
- a verified admin principal and verified server-held project binding;
- dedicated writer and authority-issuer pools;
- a one-time, exact-resource authority;
- deterministic task/tool-call idempotency;
- canonical v1.2.0 validation;
- the existing canonical repository transaction, immutable version, and audit trail.

PROJECT_PRIVATE encryption, RLS, no-local-fallback, and no-Google-Drive-fallback behavior are inherited from the canonical Memory repository. Direct legacy tool execution fails closed.

## 5. Deliberate non-capabilities

This first implementation does not:

- fetch or re-fetch source URLs;
- authenticate to Facebook or access private Groups;
- claim AVAILABLE, CONTENT_VERIFIED, or HUMAN_VERIFIED;
- auto-promote Knowledge/Learning records;
- create a source-reference search index;
- link source references to Knowledge/Learning records through a relation table or source-reference ID array;
- implement source-reference-specific archive/quarantine/trust-promotion actions.

Those capabilities require separate authorized workflows and tests. A source reference is provenance metadata, not a trusted Knowledge item.

## 6. Validation and release boundary

Migration 017_source_reference_record_v1_2.sql is source-only and is included in the disposable PostgreSQL CI chain. It must not be applied to staging or production without explicit approval.

Required validation includes v1.0.0/v1.1.0 compatibility, v1.2.0 source payload validation, URL safety, exact user intent, server-derived provenance, project isolation, idempotency, audit, encrypted PROJECT_PRIVATE storage, and no fallback. CI success does not certify production readiness.
