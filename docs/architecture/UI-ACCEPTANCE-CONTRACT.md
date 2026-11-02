# Mira UI Acceptance Contract
Version: 1.0.0
Status: LOCKED
Purpose: Stable user-facing architecture independent of backend stages.

## 1. Permanent Main Menu
1. Home
2. Work
3. Find Work
4. Clients
5. Skills & Learning
6. Tools
7. Projects
8. Deliveries
9. Earnings
10. Evolution
11. Security & Governance
12. Activity & Audit
13. Settings

Backend stage numbers must not be exposed as ordinary user-facing navigation.

## 2. Home
- Today
- Active Work
- Pending Actions
- Client Messages
- Deadlines
- Learning
- Earnings
- System Health
- Quick Actions

## 3. Quick Actions
- Find Work
- Create Task
- Check Clients
- Learn Skill
- Excel/Data Work
- Research
- Coding Task
- Create Document
- Check Deliveries

## 4. Command Box
Prompt: "What do you want Mira to do?"
Natural-language requests must be interpreted and routed through authorized
backend workflows. UI input is not itself permission to execute an action.

## 5. Permitted Autonomy
Discover -> Understand -> Plan -> Research -> Execute -> QA -> Prepare
-> Learn -> Improve Proposal

Every execution remains subject to policy, permissions, risk controls,
appropriate audit logging, verification, and recovery requirements.

## 6. Sensitive Action Boundary
Protected actions include:
- Contract acceptance or contractual commitment
- Payment transfer or financial commitment
- Legal commitment
- Credential access or disclosure
- Irreversible client action
- Unrestricted self-modification

Required control:
Request -> Policy Gateway -> Permission Check -> Risk Assessment
-> Required Human Approval -> Controlled Action -> Verification -> Audit

Approval does not override policy, legal requirements, or security controls.
Credentials must never be exposed in ordinary UI output or logs.
Unrestricted self-modification is prohibited.

## 7. Evolution and Learning
Work -> Learn -> Evidence -> Proposal -> Validation -> Human Approval
-> Staging -> Test Gates -> Apply Approval -> Transactional Apply
-> Verification -> Audit or Rollback

Learning must not directly modify protected production code or bypass governance.

## 8. UI Acceptance Criteria
- Exactly the 13 permanent main-menu entries above.
- Menu -> Submenu -> Action navigation.
- Responsive, understandable user-facing language.
- Visible status for pending approvals, deadlines, work, and system health.
- No backend-stage numbering in ordinary navigation.
- All sensitive operations routed through centralized governance.
- Auditability, failure handling, verification, and recovery for consequential work.
- UI must not report an action as completed without evidence.

## 9. Stage 19/20 Compatibility
- Preserve existing Stage 19 security evidence and completed tests.
- Do not treat missing or unverified evidence as PASS.
- Stage 20 readiness must not bypass Stage 19 security gates.
- Contract creation does not establish implementation or E2E test completion.
- Existing production code and unrelated stages are outside this contract-only change.

## 10. Change Control
This contract is locked as the intended UI architecture.
Changes require an explicit, reviewed architecture change and a new version.
This document alone does not prove that the running UI conforms to it.
