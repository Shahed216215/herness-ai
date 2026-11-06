# Mira HFM v0.2 — Render Release & Repository Ownership Contract

**Document ID:** MIRA-HFM-V02-RENDER-RELEASE-001  
**Status:** DESIGN / PRE-CUTOVER — NOT APPROVED FOR PRODUCTION  
**Canonical project repository:** `Shahed216215/herness-ai`  
**Legacy Render source repository:** `Shahed216215/ai-agent`  
**Target service:** Existing Render Web Service `mira-ai-agent`  
**Version boundary:** Mira HFM v0.2 only

## 1. Decision: one canonical source of truth

After the one-time Render cutover is independently verified and explicitly approved:

- `Shahed216215/herness-ai` becomes the only source repository for ongoing Mira application and HFM v0.2 development.
- The existing Render service will build from the approved release branch in `herness-ai` (normally `main` after reviewed PRs are merged).
- `Shahed216215/ai-agent` becomes a legacy/reference repository for historical code and migration evidence. It is not a routine deployment source.
- No future feature, fix, HFM phase, or deployment change should require reopening or comparing `ai-agent`, unless a specific regression, missing legacy capability, or data migration question requires it.

This document does not change Render's repository connection. The current Render service is still reported as connected to `Shahed216215/ai-agent`, branch `main`, commit `e4471302d20fdde7a60a26742b4e0a6f6ab87746`.

## 2. Release flow after cutover

The intended repeatable workflow is:

1. Develop only in `herness-ai` feature branches.
2. Open a pull request to the designated integration/release branch.
3. Run the complete offline test suite, HFM phase-specific workflows, syntax checks, dependency checks, and release-contract checks.
4. Review the diff and confirm no secrets, runtime data, backup archives, or unapproved migrations are included.
5. Merge only when all required checks pass and the release is approved.
6. Render deploys the approved branch/commit using the one-time configured source connection.
7. Verify deployment commit, health endpoint, logs, and storage/restart behavior.
8. Record the deployment evidence and rollback target.

**Normal future update path:** update `herness-ai` → PR → CI and review → merge → Render deploy. No routine `ai-agent` inspection is part of this flow.

## 3. Branch and deployment policy

- Feature branches: `work/*`.
- Phase-specific HFM branches remain development branches; they are not production deployment targets.
- Do not deploy directly from an unfinished Phase branch or draft PR.
- Keep HFM v0.2 changes within v0.2. Do not introduce v0.3 scope.
- The production branch must contain a reviewed, integrated application state, not merely the latest numbered phase branch.
- Protect the production branch with required CI checks and review before enabling automatic deployment.
- If Render cannot be configured to wait for successful CI checks, use a controlled manual deploy after CI passes. Do not rely on an unverified assumption about Render's auto-deploy behavior.

## 4. Current blockers before a safe cutover

The following are observed from the current `herness-ai/main` source snapshot:

| Gate | Evidence | Current status |
|---|---|---|
| Main-branch CI workflow | No `.github/workflows/*` files on `main` | NOT_IMPLEMENTED |
| Test command integrity | `package.json` references four absent test files | FAIL — INVENTORY |
| Test runner breadth | `tests/run-tests.js` allowlists only the capacity-register test | INSUFFICIENT |
| Render deployment manifest | No `render.yaml` on `main` | NOT_IMPLEMENTED |
| HFM v0.2 integration | Phase work remains in unmerged draft PRs/branches | NOT_INTEGRATED |
| Persistent runtime storage | Target service's actual disk/mount configuration has not been verified | INCONCLUSIVE |
| Full cross-phase suite | No unified full-suite evidence for the integrated release | INCONCLUSIVE |
| Production recovery drill | No approved live restart/restore evidence | NOT_TESTED |

The current `package.json` test command refers to these paths which are absent from the inspected `main` tree:

- `tests/change-management-regression-test.js`
- `tests/custom-provider-config-v1.test.js`
- `tests/custom-provider-config-route-isolated.test.js`
- `tests/provider-claude-grok-contract.test.js`

Do not silently remove these test references or replace the suite with a one-test runner merely to obtain a green CI result. Reconcile each missing test with its intended source contract, restore or replace it with an equivalent test, and document any intentionally retired test.

The HFM phase workflows present on development branches must be preserved and included in the eventual integrated release branch. Their success is scoped evidence for those workflows, not proof that the full integrated application passes.

## 5. Render configuration and persistent data contract

The legacy `ai-agent/render.yaml` currently sets `MIRA_STORAGE_DIR=/tmp/mira-data`. This value must **not** be copied as a production durability solution.

Before cutover:

- Inspect the existing service's Disk tab and verify whether a persistent disk exists, its mount path, capacity, and backup/recovery arrangement.
- Map every application data path (memory, knowledge, users, audit, proposals, jobs, and HFM stores) to the intended durable backend.
- Confirm that all components use the same approved storage root and that no important state remains under `/tmp` or the ephemeral application filesystem.
- Verify audit durability independently from application-memory durability.
- Do not copy, overwrite, delete, or migrate existing user data as part of a code deployment.
- Do not add a `render.yaml` with guessed disk settings. Add it only after the actual target service configuration and storage design have been reconciled.
- Keep secrets in Render Environment settings, never in repository files, commits, CI logs, or this document.

The application currently requires `MIRA_SESSION_SECRET` to be at least 32 characters when `NODE_ENV=production`. Validate only whether the variable is present and meets the contract; never print or commit its value.

## 6. One-time Render cutover checklist

The cutover is a separate, human-approved production change. Complete all items before changing the service's repository or branch:

- [ ] HFM v0.2 integration release is complete and independently reviewed.
- [ ] Full application CI is green on the exact release commit.
- [ ] Current Render service settings and deployed commit are recorded.
- [ ] Current user data and audit data have verified backups and a tested recovery path.
- [ ] Persistent storage mount and all storage consumers are reconciled.
- [ ] Environment variable names and required configuration are inventoried without exposing values.
- [ ] The release commit has a working `/api/health` endpoint and verified startup command.
- [ ] A rollback target and rollback operator procedure are recorded.
- [ ] The owner explicitly approves replacing the service's repository/branch source.
- [ ] The first deployment is observed for startup, health, logs, persistence, and restart recovery.

Do not create a second Render service unless the owner separately requests it. The intended target is the existing `mira-ai-agent` service.

## 7. Post-cutover deployment gate

A deployment is considered verified only when evidence confirms all of the following for the exact commit:

- Render reports the expected `herness-ai` repository, approved branch, and commit SHA.
- Build and start complete successfully.
- `GET /api/health` returns the expected healthy response.
- No secret values appear in logs or reports.
- The service reads and writes only to approved durable storage.
- A controlled restart preserves required data and audit continuity.
- HFM retrieval, archive, backup, and learning features remain within their documented disabled-by-default and human-approval boundaries.
- Any failed or inconclusive gate blocks production certification; do not label it PASS.

## 8. Rollback

- Keep the last known-good Render deployment and commit identifiable.
- On failed startup, health, or data-integrity verification, stop further rollout and use Render's supported rollback to the last known-good application deployment.
- A code rollback does not reverse database migrations or restore deleted data. Those require a separately approved, verified recovery procedure.
- Never overwrite current data with an older backup as an automatic rollback action.
- Record incident evidence and the recovery result before retrying.

## 9. Explicit non-authorizations

This contract does not authorize:

- changing the existing Render repository, branch, environment variables, disk, or service plan;
- triggering a production deployment;
- merging any open HFM draft PR;
- applying Supabase migrations or writing production data;
- enabling live Facebook, Tavily, Google Drive, or AI-provider operations;
- purchasing a paid service or increasing the monthly budget;
- claiming production readiness before all required gates are independently verified.

## 10. Completion criterion for this contract

This contract is a design and release-policy artifact only. It becomes operational only after:

1. test inventory and CI gaps are repaired;
2. HFM v0.2 is integrated and approved;
3. persistent storage and recovery are verified;
4. Render source cutover is explicitly approved and completed once; and
5. the first `herness-ai` deployment passes the post-cutover gate.

Until then: **CUTOVER = NOT_APPROVED; PRODUCTION = NOT_CERTIFIED.**


## 11. Current repository and HFM v0.2 evidence refresh — 2026-11-05

This section supersedes the earlier inventory statuses in §4 where newer PR-branch evidence exists. It does not authorize merging or deployment.

### 11.1 CI and test reconciliation

- PR #19 adds the Node 24 GitHub Actions CI workflow on its feature branch and restores the four missing tests referenced by the existing package script.
- GitHub Actions run 42000927060 completed SUCCESS for PR #19 head 4cc596392211d0886a97e3aa306f17f6b858e362.
- npm ci and the full declared 23-command npm test suite passed on Node 24.
- PR #19 remains open and unmerged. Therefore herness-ai/main does not yet inherit this workflow or restored tests. Main-branch CI remains NOT_ACTIVE until an approved merge.

### 11.2 HFM v0.2 clean-restack chain

The current reviewable branch chain is:

- Phase 5: branch work/mira-hfm-v02-phase5-facebook-group-import — manual import implementation; offline CI evidence exists, but no target Supabase migration/persistence/restart verification.
- Phase 6: PR #15, branch work/mira-hfm-v02-phase6-web-search-retrieval-restacked-20261105, corrected head ca741d3ed8d7f8ae8184cf92180345824599fc07; CI run 42003779726 SUCCESS.
- Phase 7: PR #23, branch work/mira-hfm-v02-phase7-clean-restack-v3-20261105, head 749df61f64580ff8110389f0d3edca50a7469301; CI run 42003937395 SUCCESS.
- Phase 8: PR #24, branch work/mira-hfm-v02-phase8-clean-restack-v3-20261105, head 68ff4869125c9a0142a17a8546ed5cf26796e059; CI run 42004325157 SUCCESS.
- Phase 9: PR #25, branch work/mira-hfm-v02-phase9-clean-restack-v3-20261105, latest head ec3d57826897cbddc6ec862391d509f1e32f5f43; CI run 42005728175 SUCCESS after threshold, trust-filter and tokenizer-cost input validation fixes.
- Phase 10 evidence report: PR #28, branch work/mira-hfm-v02-phase10-clean-restack-v5-20261105; unified workflow run 42006026788 SUCCESS for the latest report-updated PR merge candidate.

All HFM PRs remain draft/unmerged. The branch chain is cleanly restacked and the unified Phase 5–9 offline workflow passes, but this is not production readiness.

### 11.3 Unified offline verification

- Workflow: .github/workflows/mira-hfm-v02-unified-offline.yml.
- Latest exact report-head workflow run: 42006026788 — completed SUCCESS.
- It installs locked dependencies, checks integrated runtime syntax, then runs all configured Phase 5, 6, 7, 8 and 9 offline tests in one merged-tree job.
- The workflow records zero live Facebook/Tavily/model/Google Drive requests, zero Supabase writes/migrations, and zero canonical Memory writes.
- This does not prove real Supabase persistence, live provider correctness, Drive durability, production restart/restore, or independent security certification.

### 11.4 Render remains unchanged

The existing Render service mira-ai-agent is still reported as connected to Shahed216215/ai-agent, branch main, commit e4471302d20fdde7a60a26742b4e0a6f6ab87746. No repository/branch switch, environment change, disk change, or deployment has occurred.

The current herness-ai/main branch does not yet contain the integrated HFM v0.2 release chain. The first safe deployment source cannot be selected until the required PRs are reviewed and integrated, persistent storage is verified, and a unified release candidate is approved.

### 11.5 Updated cutover status

| Gate | Current status |
|---|---|
| CI/test reconciliation branch | PASS — PR #19 scoped CI; unmerged |
| Phase 6–9 clean-restack scoped CI | PASS |
| Unified Phase 5–9 offline workflow | PASS — run 42006026788 |
| HFM v0.2 integrated into main | NOT_INTEGRATED |
| Independent security review | NOT_TESTED |
| Live Supabase/Drive/provider validation | NOT_TESTED |
| Persistent Render storage verification | INCONCLUSIVE |
| Render source switch to herness-ai | NOT_APPROVED / NOT_PERFORMED |
| Production readiness | NOT_CERTIFIED |

Decision remains: continue development and review in herness-ai; do not switch Render or deploy until the owner explicitly approves the one-time cutover after all mandatory gates close.
