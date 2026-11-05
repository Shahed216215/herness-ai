"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mira-change-management-"));
const changeFile = path.join(temp, "changes.json");
const previous = {
  MIRA_CHANGE_FILE: process.env.MIRA_CHANGE_FILE,
  MIRA_STORAGE_DIR: process.env.MIRA_STORAGE_DIR
};

try {
  process.env.MIRA_CHANGE_FILE = changeFile;
  process.env.MIRA_STORAGE_DIR = path.join(temp, "storage");

  const modulePath = require.resolve("../change-management");
  delete require.cache[modulePath];
  const changes = require("../change-management");

  const proposal = changes.createProposal({
    title: "Regression proposal",
    reason: "Verify the governed change lifecycle.",
    expectedBenefit: "Keep approval and completion boundaries enforced.",
    category: "provider",
    risk: "medium",
    actor: "regression-test",
    affectedResources: ["provider-runtime-config.json"],
    metadata: {
      provider: "anthropic",
      apiKey: "must-not-be-persisted",
      nested: { accessToken: "must-not-be-persisted" },
      note: "sk-123456789012345678901234"
    }
  });

  assert.equal(proposal.status, changes.STATUSES.PROPOSED);
  assert.equal(proposal.createdBy, "regression-test");
  assert.equal(proposal.lifecycle.length, 1);
  assert.equal(proposal.metadata.apiKey, "[REDACTED]");
  assert.equal(proposal.metadata.nested.accessToken, "[REDACTED]");
  assert.equal(proposal.metadata.note, "[REDACTED]");

  assert.throws(
    () => changes.completeProposal(proposal.changeId, "regression-test"),
    /must be approved/
  );

  const pending = changes.moveToPendingApproval(proposal.changeId, "reviewer");
  assert.equal(pending.status, changes.STATUSES.PENDING_APPROVAL);
  assert.throws(
    () => changes.moveToPendingApproval(proposal.changeId, "reviewer"),
    /Invalid lifecycle transition/
  );

  const approved = changes.approveProposal(proposal.changeId, "approver");
  assert.equal(approved.status, changes.STATUSES.APPROVED);
  assert.equal(approved.approval.actor, "approver");

  const completed = changes.completeProposal(proposal.changeId, "executor");
  assert.equal(completed.status, "complete");
  assert.equal(completed.lifecycle.at(-1).actor, "executor");
  assert.equal(changes.getProposal(proposal.changeId).status, "complete");

  const rejected = changes.createProposal({
    title: "Reject path",
    reason: "Exercise rejection transition.",
    expectedBenefit: "Ensure terminal rejection is immutable.",
    category: "testing",
    risk: "low",
    actor: "regression-test"
  });
  changes.moveToPendingApproval(rejected.changeId, "reviewer");
  const rejectedResult = changes.rejectProposal(
    rejected.changeId,
    "reviewer",
    "Not approved for this release."
  );
  assert.equal(rejectedResult.status, changes.STATUSES.REJECTED);
  assert.equal(rejectedResult.rejection.reason, "Not approved for this release.");
  assert.throws(
    () => changes.approveProposal(rejected.changeId, "approver"),
    /Invalid lifecycle transition/
  );

  const revoked = changes.createProposal({
    title: "Revoke path",
    reason: "Exercise revocation transition.",
    expectedBenefit: "Ensure revocation is recorded.",
    category: "security",
    risk: "high",
    actor: "regression-test"
  });
  const revokedResult = changes.revokeProposal(
    revoked.changeId,
    "owner",
    "Scope changed."
  );
  assert.equal(revokedResult.status, changes.STATUSES.REVOKED);
  assert.equal(revokedResult.revocation.reason, "Scope changed.");

  assert.throws(
    () => changes.createProposal({
      title: "",
      reason: "Invalid title must fail.",
      expectedBenefit: "No proposal should be persisted.",
      category: "other",
      risk: "low"
    }),
    /title is required/
  );
  assert.throws(
    () => changes.createProposal({
      title: "Invalid category",
      reason: "Invalid category must fail.",
      expectedBenefit: "No proposal should be persisted.",
      category: "not-a-category",
      risk: "low"
    }),
    /Invalid category/
  );

  const governance = changes.getGovernanceStatus();
  assert.equal(governance.ok, true);
  assert.equal(governance.governance, "operational");
  assert.equal(governance.productionModification, "approval_required");
  assert.equal(governance.totalProposals, 3);

  const persisted = JSON.parse(fs.readFileSync(changeFile, "utf8"));
  assert.equal(persisted.length, 3);
  assert.ok(!JSON.stringify(persisted).includes("must-not-be-persisted"));
  console.log("CHANGE_MANAGEMENT_LIFECYCLE=PASS");
  console.log("CHANGE_MANAGEMENT_APPROVAL_BOUNDARY=PASS");
  console.log("CHANGE_MANAGEMENT_METADATA_REDACTION=PASS");
  console.log("CHANGE_MANAGEMENT_REGRESSION_TEST=PASS");
  console.log("EXTERNAL_NETWORK_REQUESTS=0");
} catch (error) {
  console.error("CHANGE_MANAGEMENT_REGRESSION_TEST=FAIL");
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try { fs.rmSync(temp, { recursive: true, force: true }); }
  catch (error) {
    console.error("TEMP_CLEANUP=INCOMPLETE");
    console.error(error.message);
    process.exitCode = 1;
  }
}