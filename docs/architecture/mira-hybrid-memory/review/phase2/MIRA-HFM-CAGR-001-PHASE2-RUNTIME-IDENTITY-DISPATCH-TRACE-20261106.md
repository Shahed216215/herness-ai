# Mira HFM v0.2 — Runtime Actor/Project Identity Dispatch Trace

**Document ID:** MIRA-HFM-CAGR-001-PHASE2-RUNTIME-IDENTITY-DISPATCH-TRACE-20261106  
**Baseline:** Phase 9 head `da1c2ccc954cf686c6e1886a18719dd561ef0b8d`  
**Review mode:** Read-only GitHub source trace; no runtime invocation  
**Status:** `AUTHORITATIVE_PROJECT_MAPPING_NOT_ESTABLISHED / LEGACY_RETRIEVAL_INTEGRATION_BLOCKED`

## 1. Purpose

Determine whether existing authenticated request identity is carried through Mira's model/tool execution path and can be mapped authoritatively to one HFM `projectId`. This is a prerequisite to enabling project-scoped canonical retrieval in legacy Knowledge consumers.

## 2. Source trace

| Boundary | Observed source behavior | HFM implication |
|---|---|---|
| Login/session creation — `server.js` | Successful login stores authenticated role and, when returned by authentication, `username`, `userId` and `email` on the session. | Some actor identifiers exist at the HTTP session boundary. |
| Session identity — `server.js: sessionIdentity()` | Returns only `role` and permissions; it does not return `userId`, username or email. | The helper used by authenticated routes discards the stable actor fields needed by a future mapping resolver. |
| Prompt/tool authorization — `services/mira-hfm-prompt-boundary.js: authorizeAgentToolCall()` | Receives role/session for the named-admin check. For ordinary tools it checks registration and tool policy, then returns an allow decision; it does not resolve or attach actor/project scope. | Authorization is not equivalent to HFM project identity or retrieval authorization. |
| Tool dispatcher — `tools/index.js: executeTool(name, args)` | Calls `tools[name].execute(args)`; no trusted runtime context is forwarded. | Model-supplied tool arguments are the only tool input at this boundary. They cannot be accepted as authoritative actor/project identity. |
| Tool runner — `services/tool-runner.js: runTool(name, args)` | Delegates to `executeTool(name, args)` without a context parameter. | The current execution wrapper does not bridge authenticated request context into tools. |
| Legacy Knowledge search — `tools/knowledge-search.js` | Reads global local Knowledge, may replace it with a Drive-loaded array, then returns matching content. No actor, project ID, canonical adapter, or trusted-record filter is supplied. | Direct model-facing retrieval is not project-scoped. Provider failure is logged, while local data may still be returned; this is not a canonical provider-state contract. |
| Learning consumer — `services/learning.js` | Calls global `searchKnowledge()` during duplicate and improvement candidate selection. | Model-assisted Learning can consume global legacy Knowledge without project scope. |
| Improvement proposal tool — `tools/knowledge-improve.js` | Reads global Knowledge and creates a proposal using title/topic matching; tool arguments do not provide trusted actor context. | Candidate selection and proposal source are not project-scoped. |
| Project store/schema — `project-store.js`, `project-schema.js` | Project records include `projectId`, acceptance/opportunity references, status and work-scope fields. The inspected schema does not define an authenticated owner/user binding. | A project registry exists, but it does not establish an authoritative actor-to-project mapping. |

## 3. Findings

1. Authenticated login may establish a user ID, but the session identity helper currently exposes only role and permissions to its consumers.
2. The HFM prompt-boundary authorizer does not resolve a project or bind actor context to ordinary tool execution.
3. The tool dispatch chain forwards model arguments, not trusted server context.
4. Existing project records do not, in the inspected schema, provide an authenticated owner/user binding.
5. The adapter in this PR requires an explicit project ID and explicit per-record identity mapping. It does not and must not invent either value.
6. Therefore, adding a project ID to a model tool schema, deriving it from content, selecting the first project, or using a global/default project would create an unsafe identity boundary.

## 4. Required decision and implementation contract

Before connecting legacy retrieval consumers, a separately reviewed identity contract must define:

- The authoritative authenticated principal key (prefer stable server-issued user ID; not model input, display name or email alone).
- The persistent, auditable principal-to-project membership/ownership relation, including multi-project behavior and revocation.
- Which principal roles may read which project records and under what purpose.
- How the trusted request context is passed out-of-band through server authorization, execution engine, tool runner and tool dispatcher.
- How missing, ambiguous, revoked or unavailable identity/membership fails closed.
- How project membership changes are audited and how cached context is invalidated.

The resolver must be injected from trusted server state. It must not accept `actorId`, `projectId`, role or membership as authoritative when supplied by the model.

## 5. Safe disposition

- Do not wire `knowledge-search`, Learning or `knowledge-improve` to the legacy adapter until the identity contract is approved and implemented.
- Do not add a guessed/default project ID or use a model-supplied project ID.
- Keep the adapter read-only and keep all legacy records outside canonical trusted retrieval until explicit mapping, source digest, project scope, lifecycle, integrity and trust requirements are satisfied.
- Continue with isolated tests for the future context bridge and resolver only after the authoritative mapping schema is decided.
- Treat existing global legacy Knowledge behavior as legacy behavior, not as evidence of HFM project isolation.

## 6. Evidence boundary and disposition

- Source trace: `SOURCE_REVIEWED` for the listed callsites and dispatch functions.
- Authenticated actor carried end-to-end into tool execution: `NOT_ESTABLISHED`.
- Persistent authenticated principal-to-project mapping: `NOT_ESTABLISHED`.
- Canonical project-scoped legacy retrieval integration: `BLOCKED / NOT_IMPLEMENTED`.
- Production Memory/Knowledge access or writes: `NOT_PERFORMED`.
- Provider/API/network calls, migration, restore, merge and deployment: `NOT_PERFORMED`.
- HFM Phase 2: `IN_PROGRESS / REVIEW_REQUIRED`.
- HFM v0.2 production readiness: `NOT_CERTIFIED`.
