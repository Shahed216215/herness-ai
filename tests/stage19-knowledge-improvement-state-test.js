"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sourceModule = path.resolve(__dirname, "../knowledge-improvement.js");
const isolatedDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-stage19-approval-")
);

try {
  // The module's proposal JSON lives beside the copied module,
  // so this test never writes the real project proposal file.
  fs.copyFileSync(
    sourceModule,
    path.join(isolatedDir, "knowledge-improvement.js")
  );
  fs.copyFileSync(
    path.join(path.resolve(__dirname, ".."), "mira-storage.js"),
    path.join(isolatedDir, "mira-storage.js")
  );

  const governance = require(
    path.join(isolatedDir, "knowledge-improvement.js")
  );

  function createFixture() {
    return governance.createProposal({
      existing: {
        title: "Fixture",
        topic: "Governance",
        content: "Original content"
      },
      proposed: {
        title: "Fixture improved",
        topic: "Governance",
        content: "Proposed content"
      }
    });
  }

  const pending = createFixture();
  const pendingApply = governance.markProposalApplied(pending.id);
  assert.equal(pendingApply.success, false);
  assert.match(pendingApply.reason, /approved/i);
  assert.equal(governance.getProposal(pending.id).status, "pending");
  console.log("PASS: pending proposal cannot be marked applied");

  const approved = createFixture();
  const approval = governance.approveProposal(approved.id);
  assert.equal(approval.success, true);
  assert.equal(governance.getProposal(approved.id).status, "approved");

  const apply = governance.markProposalApplied(approved.id);
  assert.equal(apply.success, true);
  assert.equal(apply.proposal.status, "applied");
  assert.ok(apply.proposal.appliedAt);
  console.log("PASS: approved proposal can be marked applied");

  const repeatedApply = governance.markProposalApplied(approved.id);
  assert.equal(repeatedApply.success, false);
  assert.equal(governance.getProposal(approved.id).status, "applied");
  console.log("PASS: repeated apply transition is rejected");

  const rejected = createFixture();
  assert.equal(governance.rejectProposal(rejected.id).success, true);
  const rejectedApply = governance.markProposalApplied(rejected.id);
  assert.equal(rejectedApply.success, false);
  assert.equal(governance.getProposal(rejected.id).status, "rejected");
  console.log("PASS: rejected proposal cannot be marked applied");

  console.log("STAGE19_KNOWLEDGE_IMPROVEMENT_STATE_GATE=PASS");
} finally {
  fs.rmSync(isolatedDir, { recursive: true, force: true });
}
