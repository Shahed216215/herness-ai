const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');
const crypto = require("crypto");

const PROPOSAL_FILE = storagePath("knowledge-improvement-proposals.json");

const MAX_PROPOSALS = 50;

function loadProposals() {
  try {
    if (!fs.existsSync(PROPOSAL_FILE)) {
      return [];
    }

    const raw = fs.readFileSync(
      PROPOSAL_FILE,
      "utf8"
    );

    if (!raw.trim()) {
      return [];
    }

    const data = JSON.parse(raw);

    return Array.isArray(data)
      ? data
      : [];
  } catch (error) {
    throw new Error(
      `Failed to load improvement proposals: ${error.message}`
    );
  }
}

function saveProposals(proposals) {
  const limited =
    proposals.slice(-MAX_PROPOSALS);

  const tempFile =
    `${PROPOSAL_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(limited, null, 2),
    "utf8"
  );

  fs.renameSync(
    tempFile,
    PROPOSAL_FILE
  );

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
