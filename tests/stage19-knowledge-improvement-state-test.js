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
  fs.mkdirSync(path.join(isolatedDir, "services"), { recursive: true });
  fs.copyFileSync(
    path.join(path.resolve(__dirname, ".."), "services", "mira-json-state-store.js"),
    path.join(isolatedDir, "services", "mira-json-state-store.js")
  );
  fs.copyFileSync(
    path.join(path.resolve(__dirname, ".."), "services", "mira-store-initialization-guard.js"),
    path.join(isolatedDir, "services", "mira-store-initialization-guard.js")
  );
  fs.copyFileSync(
    path.join(path.resolve(__dirname, ".."), "audit-log.js"),
    path.join(isolatedDir, "audit-log.js")
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

  const proposalFile = governance.PROPOSAL_FILE;
  const validProposalBytes = fs.readFileSync(proposalFile);
  fs.writeFileSync(proposalFile, "{invalid", "utf8");
  assert.throws(() => governance.loadProposals(), /invalid JSON/i);
  assert.throws(() => createFixture(), /invalid JSON/i);
  assert.equal(fs.readFileSync(proposalFile, "utf8"), "{invalid");
  fs.writeFileSync(proposalFile, validProposalBytes);
  console.log("PASS: malformed proposal state fails closed without overwrite");

  const externalTarget = path.join(isolatedDir, "external-proposals.json");
  fs.writeFileSync(externalTarget, JSON.stringify([{ id: "external" }]));
  fs.unlinkSync(proposalFile);
  fs.symlinkSync(externalTarget, proposalFile);
  assert.throws(() => governance.loadProposals(), /safe regular file/i);
  assert.deepEqual(JSON.parse(fs.readFileSync(externalTarget, "utf8")), [{ id: "external" }]);
  console.log("PASS: symlink proposal state is rejected without following target");

  console.log("STAGE19_KNOWLEDGE_IMPROVEMENT_STATE_GATE=PASS");
  console.log("KNOWLEDGE_PROPOSALS_FAIL_CLOSED=PASS");
  console.log("KNOWLEDGE_PROPOSALS_SYMLINK_PROTECTION=PASS");
} finally {
  fs.rmSync(isolatedDir, { recursive: true, force: true });
}
