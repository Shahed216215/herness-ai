# Mira HFM Read/Write Call-Graph Audit

**Audit date:** 2026-11-06  
**Scope:** Read-only source inspection on `work/hfm-phase2-identity-guard-render-base-20261106` at the time of review.  
**Purpose:** Identify legacy persistence and HTTP/tool paths that must not be described as HFM actor- or project-scoped.

## Executive result

HFM identity transport is present in the governed tool-execution path, but the legacy stores below do not consume that identity and do not enforce HFM project membership or operation authority. A caller passing through an authenticated session or the HFM identity-context builder is not thereby authorized to read or mutate a project.

**Disposition:** Keep legacy behavior intact for compatibility, but classify it as legacy/unscoped. HFM project-scoped reads and writes remain **BLOCKED** until a transactionally enforced authority boundary is integrated and verified.

## Verified call graph

### Tool execution

`services/tool-runner.js` forwards `trustedContext` to `tools/index.js::executeTool`. The dispatcher invokes `tools[name].execute(args, trustedContext)`.

The two inspected save tools currently declare only a one-argument callback:

- `tools/memory-save.js` calls `addMemory("user", content)` in `memory.js`. The actor context is not consumed. `memory.js` loads and writes the local memory store through `services/mira-local-memory-store`; records contain role/content/time, not an HFM actor, project, membership revision, authority ID, or request ID.
- `tools/knowledge-save.js` calls `addKnowledge(title, url, content)` in `knowledge.js`. The actor context is not consumed. `knowledge.js` writes the shared `knowledge.json` store and attempts whole-store Google Drive synchronization. The default save call does not attach HFM actor/project/authority metadata.
- `tools/knowledge-search.js` calls `getKnowledge()` and may replace that result with `loadKnowledgeFromDrive()`. Search ranking and duplicate filtering operate over that shared collection; no actor, project, membership, operation authority, or resource scope is checked.

Consequently, adding a trusted-context parameter to these callbacks alone would not provide authorization. The downstream storage and search operations must themselves be guarded by the same atomic authority protocol.

### Project Store

`project-store.js` reads and writes `data/projects.json` through local filesystem operations. `getProject` and `listProjects` filter by project ID/status/acceptance/opportunity, not canonical actor membership or operation authority. Create validates work-acceptance relationships but does not establish an HFM owner or membership. Update and delete similarly have no HFM authorization input.

This store is a legacy project registry, not the HFM project-owner/membership registry. Existing records must remain unassigned until independently evidenced and approved; no owner inference or bulk migration is permitted.

### Conversation HTTP routes

The inspected `routes/conversations.js` routes use `requireAgentAuth` plus `CLIENT_PROJECTS` permission. The handlers call conversation-store and conversation-memory functions using conversation/client IDs from the route or request body. The visible route layer does not pass a canonical HFM actor context or validate HFM project membership/operation authority.

Relevant paths include conversation create/list/get/update, message create/list/get, context read/write, and conversation-memory read. The existence of role/permission middleware is not proof of HFM project authorization. These records must not be represented as HFM project-scoped memory.

### Knowledge improvement HTTP routes

`routes/knowledge-improvements.js` uses admin permission middleware and directly reads the legacy knowledge collection during controlled improvement apply. Its audit helper records actor role, not the canonical HFM subject and project authority. Approval gates and evolution snapshots are separate controls; they do not establish HFM ownership/membership.

## Required architectural boundary

Before any HFM project operation can be enabled, a single server-side service must:

1. Accept only a server-resolved canonical actor; reject caller-supplied actor IDs, roles, emails, and display names.
2. Bind the authority to actor, project, operation, resource, purpose, unique request ID, validity window, and current owner/membership revisions.
3. Validate and consume the authority transactionally, including revocation races and replay prevention; an unlocked SELECT followed by an independent write is insufficient.
4. Append an immutable audit event in the same transaction as authority consumption and the protected mutation, or use a separately proven replay-safe protocol.
5. Fail closed when the database, schema, authority, membership, owner record, or transaction guarantee is unavailable.
6. Keep legacy APIs and stores explicitly outside HFM scope until separately migrated under a reviewed compatibility plan. Do not retrofit actor metadata onto old records and thereby imply historical ownership.

## Verification boundaries

| Item | Status | Evidence boundary |
|---|---|---|
| Trusted context passed through governed tool dispatcher | PASS (source inspection) | Runner and dispatcher forward the second argument |
| Memory save consumes trusted actor | NOT_INTEGRATED | Callback writes role/content/time to legacy store |
| Knowledge save consumes trusted actor | NOT_INTEGRATED | Callback writes shared local/Drive collection |
| Knowledge search enforces actor/project scope | NOT_INTEGRATED | Shared local/Drive search has no authority check |
| Project Store enforces HFM owner/membership | NOT_INTEGRATED | Local JSON store filters legacy business fields only |
| Conversation routes enforce HFM authority | NOT_INTEGRATED | Role/permission middleware only in inspected handlers |
| Knowledge improvement apply enforces HFM authority | NOT_INTEGRATED | Admin permission and evolution controls are not HFM membership |
| HFM SQL migration executed | NOT_PERFORMED | No database migration was run |
| Live Neon connection / transaction behavior | NOT_PERFORMED | No live database call was made |
| Render configuration, production data, deploy, merge | NOT_PERFORMED | No production-side action was taken |

## Safe next sequence

1. Complete a route inventory for all direct memory/knowledge/project read and mutation endpoints.
2. Design a database-side transactional consume-and-audit operation against a disposable Neon branch, after schema review.
3. Test concurrency, replay, expiry, membership/owner revision changes, revocation races, rollback, and audit immutability.
4. Implement a feature-gated HFM-only repository/service that defaults disabled and fails closed.
5. Add route/tool regression tests proving that HFM-labelled operations cannot fall through to legacy unscoped stores.
6. Only after independent database evidence and explicit approval consider a controlled live read-only check. No production migration, secret change, deployment, or legacy data migration is implied by this audit.
