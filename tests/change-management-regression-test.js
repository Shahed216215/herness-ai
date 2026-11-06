"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mira-change-management-"));
const file = path.join(temp, "changes.json");
process.env.MIRA_CHANGE_FILE = file;

const changes = require("../change-management");

function run() {
  const proposal = changes.createProposal({
    title: "Offline regression",
    reason: "Verify proposal lifecycle persistence.",
    expectedBenefit: "Keep approvals and audit metadata reliable.",
    category: "provider",
    risk: "medium",
    actor: "offline-test",
    metadata: {
      provider: "groq",
      apiKey: "ghp_123456789012345678901234567890",
      nested: { password: "do-not-store" }
    }
  });

  assert.equal(proposal.status, "proposed");
  assert.ok(proposal.changeId);
  assert.equal(changes.getProposal(proposal.changeId).status, "proposed");

  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].metadata.apiKey, "[REDACTED]");
  assert.equal(stored[0].metadata.nested.password, "[REDACTED]");

  changes.moveToPendingApproval(proposal.changeId, "reviewer");
  assert.equal(changes.getProposal(proposal.changeId).status, "pending_approval");
  changes.approveProposal(proposal.changeId, "reviewer");
  const approved = changes.getProposal(proposal.changeId);
  assert.equal(approved.status, "approved");
  assert.equal(approved.approval.actor, "reviewer");
  assert.equal(approved.lifecycle.at(-1).status, "approved");

  assert.throws(
    () => changes.completeProposal("missing-id", "reviewer"),
    /not found/i
  );

  const second = changes.createProposal({
    title: "Reject path",
    reason: "Check rejection lifecycle.",
    expectedBenefit: "Preserve explicit rejection.",
    category: "testing",
    risk: "low",
    actor: "offline-test"
  });
  changes.moveToPendingApproval(second.changeId, "reviewer");
  changes.rejectProposal(second.changeId, "reviewer", "Not required.");
  assert.equal(changes.getProposal(second.changeId).status, "rejected");

  assert.throws(
    () => changes.approveProposal(second.changeId, "reviewer"),
    /invalid lifecycle transition/i
  );

  const governance = changes.getGovernanceStatus();
  assert.equal(governance.totalProposals, 2);
  assert.equal(governance.counts.approved, 1);
  assert.equal(governance.counts.rejected, 1);
  console.log("CHANGE_MANAGEMENT_REGRESSION=PASS");
  console.log("SECRET_REDACTION=PASS");
  console.log("PERSISTENCE_AND_LIFECYCLE=PASS");
}

try {
  run();
} finally {
  delete process.env.MIRA_CHANGE_FILE;
  fs.rmSync(temp, { recursive: true, force: true });
}
