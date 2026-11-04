const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');
const crypto = require("crypto");
const jsonStateStore = require("./services/mira-json-state-store");

const PROPOSAL_FILE = storagePath("knowledge-improvement-proposals.json");

const MAX_PROPOSALS = 50;

function loadProposals() {
  return jsonStateStore.readJsonArray(
    PROPOSAL_FILE,
    "Knowledge improvement proposals",
    { missing: "empty" }
  );
}

function saveProposals(proposals) {
  if (!Array.isArray(proposals)) {
    throw new Error("Knowledge improvement proposals must be an array.");
  }
  const limited = proposals.slice(-MAX_PROPOSALS);
  const result = jsonStateStore.atomicWriteJson(
    PROPOSAL_FILE,
    limited,
    "Knowledge improvement proposals"
  );
  try {
    jsonStateStore.recordStateAudit(
      "knowledge_improvement_proposals_write_committed",
      "success",
      PROPOSAL_FILE,
      {
        stateHash: result.sha256,
        entryCount: limited.length
      }
    );
  } catch (error) {
    error.code = "KNOWLEDGE_PROPOSALS_COMMITTED_AUDIT_FAILED";
    error.stateCommitted = true;
    throw error;
  }
  return limited;
}

function createContentHash(content) {
  return crypto
    .createHash("sha256")
    .update(String(content || ""), "utf8")
    .digest("hex");
}

function createProposal({
  existing,
  proposed,
  sourceTitle = "",
  sourceUrl = ""
}) {
  if (!existing || !proposed) {
    throw new Error(
      "Existing and proposed knowledge are required."
    );
  }

  const proposals =
    loadProposals();

  const proposal = {
    id: crypto.randomUUID(),

    status: "pending",

    existing: {
      title: existing.title || "",
      topic: existing.topic || "",
      contentHash:
        createContentHash(existing.content)
    },

    proposed,

    source: {
      title: sourceTitle || "",
      url: sourceUrl || ""
    },

    createdAt:
      new Date().toISOString(),

    approvedAt: null,
    appliedAt: null
  };

  proposals.push(proposal);

  saveProposals(proposals);

  return proposal;
}

function getProposal(id) {
  const proposals =
    loadProposals();

  return (
    proposals.find(
      proposal =>
        proposal.id === String(id)
    ) || null
  );
}

function listPendingProposals() {
  return loadProposals()
    .filter(
      proposal =>
        proposal.status === "pending"
    );
}

function approveProposal(id) {
  const proposals =
    loadProposals();

  const index =
    proposals.findIndex(
      proposal =>
        proposal.id === String(id)
    );

  if (index === -1) {
    return {
      success: false,
      reason: "Improvement proposal not found."
    };
  }

  const proposal =
    proposals[index];

  if (proposal.status !== "pending") {
    return {
      success: false,
      reason:
        `Proposal is already ${proposal.status}.`
    };
  }

  proposal.status = "approved";
  proposal.approvedAt =
    new Date().toISOString();

  saveProposals(proposals);

  return {
    success: true,
    proposal
  };
}

function markProposalApplied(id) {
  const proposals =
    loadProposals();

  const index =
    proposals.findIndex(
      proposal =>
        proposal.id === String(id)
    );

  if (index === -1) {
    return {
      success: false,
      reason: "Improvement proposal not found."
    };
  }

  const proposal = proposals[index];

  if (proposal.status !== "approved") {
    return {
      success: false,
      reason:
        "Only an approved improvement proposal can be marked applied."
    };
  }

  proposal.status = "applied";
  proposal.appliedAt = new Date().toISOString();

  saveProposals(proposals);

  return {
    success: true,
    proposal: proposals[index]
  };
}

function rejectProposal(id) {
  const proposals =
    loadProposals();

  const index =
    proposals.findIndex(
      proposal =>
        proposal.id === String(id)
    );

  if (index === -1) {
    return {
      success: false,
      reason: "Improvement proposal not found."
    };
  }

  const proposal =
    proposals[index];

  if (proposal.status !== "pending") {
    return {
      success: false,
      reason:
        `Proposal is already ${proposal.status}.`
    };
  }

  proposal.status = "rejected";

  saveProposals(proposals);

  return {
    success: true,
    proposal
  };
}

module.exports = {
  PROPOSAL_FILE,
  loadProposals,
  saveProposals,
  createContentHash,
  createProposal,
  getProposal,
  listPendingProposals,
  approveProposal,
  markProposalApplied,
  rejectProposal
};
