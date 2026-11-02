const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');
const crypto = require("crypto");

const CAPACITY_CHANGE_FILE = storagePath("capacity-change-proposals.json");

const MAX_PROPOSALS = 50;

const ALLOWED_TARGETS = [
  "knowledge",
  "memory"
];

const ALLOWED_STATUSES = [
  "pending",
  "approved",
  "applied",
  "rolled_back",
  "rejected",
  "revoked"
];

function createId() {
  return crypto.randomUUID();
}

function loadProposals() {
  try {
    if (!fs.existsSync(CAPACITY_CHANGE_FILE)) {
      return [];
    }

    const raw = fs.readFileSync(
      CAPACITY_CHANGE_FILE,
      "utf8"
    );

    const data = JSON.parse(raw);

    return Array.isArray(data)
      ? data
      : [];
  } catch (error) {
    return [];
  }
}

function saveProposals(proposals) {
  const safeList =
    Array.isArray(proposals)
      ? proposals.slice(-MAX_PROPOSALS)
      : [];

  fs.writeFileSync(
    CAPACITY_CHANGE_FILE,
    JSON.stringify(
      safeList,
      null,
      2
    ),
    "utf8"
  );

  return true;
}

function validateTarget(target) {
  return ALLOWED_TARGETS.includes(
    String(target || "").toLowerCase()
  );
}

function normalizeTarget(target) {
  return String(target || "")
    .trim()
    .toLowerCase();
}

function validateCapacity(capacity) {
  const value = Number(capacity);

  if (!Number.isInteger(value)) {
    throw new Error(
      "Capacity must be an integer."
    );
  }

  if (value < 1) {
    throw new Error(
      "Capacity must be at least 1."
    );
  }

  if (value > 10000) {
    throw new Error(
      "Capacity cannot exceed 10000."
    );
  }

  return value;
}

function createProposal({
  target,
  currentCapacity,
  requestedCapacity,
  reason,
  source = null
}) {
  const normalizedTarget =
    normalizeTarget(target);

  if (!validateTarget(normalizedTarget)) {
    throw new Error(
      "Unsupported capacity target."
    );
  }

  const current =
    validateCapacity(currentCapacity);

  const requested =
    validateCapacity(requestedCapacity);

  if (requested === current) {
    throw new Error(
      "Requested capacity is unchanged."
    );
  }

  if (requested < current) {
    throw new Error(
      "New capacity proposals can only increase capacity. Use rollback to restore a previous capacity."
    );
  }

  const proposals =
    loadProposals();

  const duplicate =
    proposals.find(
      proposal =>
        proposal &&
        proposal.status === "pending" &&
        proposal.target === normalizedTarget &&
        proposal.currentCapacity === current &&
        proposal.requestedCapacity === requested
    );

  if (duplicate) {
    return {
      duplicate: true,
      proposal: duplicate
    };
  }

  const proposal = {
    id: createId(),

    target:
      normalizedTarget,

    currentCapacity:
      current,

    requestedCapacity:
      requested,

    reason:
      String(reason || "")
        .trim()
        .slice(0, 2000),

    source:
      source
        ? {
            title:
              String(source.title || "")
                .slice(0, 300),
            url:
              String(source.url || "")
                .slice(0, 1000)
          }
        : null,

    status: "pending",

    createdAt:
      new Date().toISOString(),

    approvedAt: null,
    appliedAt: null,
    rejectedAt: null,
    revokedAt: null
  };

  proposals.push(proposal);

  saveProposals(proposals);

  return {
    duplicate: false,
    proposal
  };
}

function getProposal(id) {
  return loadProposals().find(
    proposal =>
      proposal &&
      proposal.id === id
  ) || null;
}

function listPendingProposals() {
  return loadProposals().filter(
    proposal =>
      proposal &&
      proposal.status === "pending"
  );
}

function updateProposal(id, updater) {
  const proposals =
    loadProposals();

  const index =
    proposals.findIndex(
      proposal =>
        proposal &&
        proposal.id === id
    );

  if (index === -1) {
    throw new Error(
      "Capacity change proposal not found."
    );
  }

  const updated =
    updater({
      ...proposals[index]
    });

  proposals[index] = updated;

  saveProposals(proposals);

  return updated;
}

function approveProposal(id) {
  const proposal =
    getProposal(id);

  if (!proposal) {
    throw new Error(
      "Capacity change proposal not found."
    );
  }

  if (proposal.status !== "pending") {
    throw new Error(
      "Only pending proposals can be approved."
    );
  }

  return updateProposal(
    id,
    current => ({
      ...current,
      status: "approved",
      approvedAt:
        new Date().toISOString()
    })
  );
}

function rejectProposal(id) {
  const proposal =
    getProposal(id);

  if (!proposal) {
    throw new Error(
      "Capacity change proposal not found."
    );
  }

  if (proposal.status !== "pending") {
    throw new Error(
      "Only pending proposals can be rejected."
    );
  }

  return updateProposal(
    id,
    current => ({
      ...current,
      status: "rejected",
      rejectedAt:
        new Date().toISOString()
    })
  );
}

function markApplied(id) {
  const proposal =
    getProposal(id);

  if (!proposal) {
    throw new Error(
      "Capacity change proposal not found."
    );
  }

  if (proposal.status !== "approved") {
    throw new Error(
      "Only approved proposals can be applied."
    );
  }

  return updateProposal(
    id,
    current => ({
      ...current,
      status: "applied",
      appliedAt:
        new Date().toISOString()
    })
  );
}

function revokeProposal(id) {
  const proposal =
    getProposal(id);

  if (!proposal) {
    throw new Error(
      "Capacity change proposal not found."
    );
  }

  if (
    proposal.status !== "approved"
  ) {
    throw new Error(
      "Only approved proposals can be revoked."
    );
  }

  return updateProposal(
    id,
    current => ({
      ...current,
      status: "revoked",
      revokedAt:
        new Date().toISOString()
    })
  );
}

module.exports = {
  CAPACITY_CHANGE_FILE,
  MAX_PROPOSALS,
  ALLOWED_TARGETS,
  ALLOWED_STATUSES,
  loadProposals,
  saveProposals,
  createProposal,
  getProposal,
  listPendingProposals,
  updateProposal,
  approveProposal,
  rejectProposal,
  markApplied,
  revokeProposal
};
