"use strict";

const {
  createProposal,
  getProposal,
  moveToPendingApproval,
  approveProposal,
  rejectProposal,
  revokeProposal
} = require("../change-management");

const {
  stageApprovedProposal
} = require("./mira-evolution-staging");

/**
 * Stage 4.8
 * Autonomous Change Governance
 *
 * Mira may:
 *   - detect an improvement
 *   - create a governed proposal
 *   - move the proposal to pending approval
 *
 * Mira may NOT:
 *   - approve its own proposal
 *   - bypass human approval
 *   - directly apply a change
 *
 * Human/admin approval remains the gateway to staging.
 */

function detectAndPropose(input = {}) {
  const proposal = createProposal({
    title: input.title,
    reason: input.reason,
    expectedBenefit: input.expectedBenefit,
    category: input.category || "self_improvement",
    risk: input.risk || "medium",
    affectedResources: input.affectedResources || [],
    estimatedComplexity:
      input.estimatedComplexity || "unknown",
    backupRequired:
      input.backupRequired !== false,
    testRequired:
      input.testRequired !== false,
    actor: input.actor || "mira"
  });

  const pending = moveToPendingApproval(
    proposal.changeId,
    input.actor || "mira"
  );

  return {
    ok: true,
    status: "pending_approval",
    proposal: pending,
    governance: {
      approvalRequired: true,
      autonomousApprovalAllowed: false,
      autonomousApplyAllowed: false
    }
  };
}

function autonomousApprovalAttempt() {
  return {
    ok: false,
    status: "approval_denied",
    reason:
      "Autonomous actors cannot approve change proposals.",
    governance: {
      humanApprovalRequired: true
    }
  };
}

function humanApprove(changeId, actor = "admin") {
  if (!/^admin(?::|$)/i.test(String(actor).trim())) {
    throw new Error(
      "Human/admin approval is required."
    );
  }

  const proposal = getProposal(changeId);

  if (!proposal) {
    throw new Error(
      "Change proposal not found."
    );
  }

  if (proposal.status !== "pending_approval") {
    throw new Error(
      `Proposal must be pending_approval before human approval. Current status: ${proposal.status}`
    );
  }

  return approveProposal(
    changeId,
    actor
  );
}

async function stageAfterHumanApproval(
  changeId,
  actor = "admin"
) {
  if (!/^admin(?::|$)/i.test(String(actor).trim())) {
    throw new Error(
      "Human/admin actor is required for controlled staging."
    );
  }

  const proposal = getProposal(changeId);

  if (!proposal) {
    throw new Error(
      "Change proposal not found."
    );
  }

  if (proposal.status !== "approved") {
    throw new Error(
      `Proposal must be approved before staging. Current status: ${proposal.status}`
    );
  }

  return await stageApprovedProposal(
    proposal,
    actor
  );
}

function humanReject(
  changeId,
  actor = "admin",
  reason = "Rejected by human reviewer."
) {
  if (!/^admin(?::|$)/i.test(String(actor).trim())) {
    throw new Error(
      "Human/admin rejection is required."
    );
  }

  return rejectProposal(
    changeId,
    actor,
    reason
  );
}

function humanRevoke(
  changeId,
  actor = "admin",
  reason = "Revoked by human reviewer."
) {
  if (!/^admin(?::|$)/i.test(String(actor).trim())) {
    throw new Error(
      "Human/admin revocation is required."
    );
  }

  return revokeProposal(
    changeId,
    actor,
    reason
  );
}

module.exports = {
  detectAndPropose,
  autonomousApprovalAttempt,
  humanApprove,
  stageAfterHumanApproval,
  humanReject,
  humanRevoke
};
