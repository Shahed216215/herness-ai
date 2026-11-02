"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');
const crypto = require("crypto");

const CHANGE_FILE =
  process.env.MIRA_CHANGE_FILE ||
  storagePath("change-proposals.json");

const MAX_PROPOSALS = 1000;

const STATUSES = Object.freeze({
  PROPOSED: "proposed",
  PENDING_APPROVAL: "pending_approval",
  APPROVED: "approved",
  REJECTED: "rejected",
  REVOKED: "revoked"
});

const CATEGORIES = Object.freeze([
  "knowledge",
  "memory",
  "tool",
  "provider",
  "security",
  "performance",
  "ui",
  "testing",
  "automation",
  "cloud",
  "self_improvement",
  "other"
]);

function createId() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function loadChanges() {
  if (!fs.existsSync(CHANGE_FILE)) {
    return [];
  }

  const raw = fs.readFileSync(CHANGE_FILE, "utf8");

  if (!raw.trim()) {
    return [];
  }

  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error(
      "Change proposal store must contain an array."
    );
  }

  return data;
}

function saveChanges(changes) {
  const limited = changes.slice(-MAX_PROPOSALS);

  const tempFile =
    `${CHANGE_FILE}.${process.pid}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(limited, null, 2),
    "utf8"
  );

  fs.renameSync(tempFile, CHANGE_FILE);

  return limited;
}


const PROPOSAL_SECRET_KEY_PATTERN =
  /token|secret|password|api.?key|authorization|credential|private.?key/i;

const PROPOSAL_SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g
];

function sanitizeProposalMetadata(value, depth = 0) {
  if (depth > 6) {
    return "[TRUNCATED]";
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    let result = value.slice(0, 500);

    for (const pattern of PROPOSAL_SECRET_VALUE_PATTERNS) {
      result = result.replace(pattern, "[REDACTED]");
    }

    return result;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map(item =>
        sanitizeProposalMetadata(item, depth + 1)
      );
  }

  if (typeof value === "object") {
    const result = {};

    for (const [key, child] of Object.entries(value)) {
      if (
        PROPOSAL_SECRET_KEY_PATTERN.test(key) &&
        key !== "secretSafety"
      ) {
        result[key] = "[REDACTED]";
        continue;
      }

      result[key] =
        sanitizeProposalMetadata(child, depth + 1);
    }

    return result;
  }

  return String(value).slice(0, 500);
}

function validateText(value, field, maxLength = 2000) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new Error(
      `${field} exceeds maximum length of ${maxLength}.`
    );
  }

  return trimmed;
}

function validateCategory(category) {
  if (!CATEGORIES.includes(category)) {
    throw new Error(
      `Invalid category. Allowed: ${CATEGORIES.join(", ")}`
    );
  }

  return category;
}

function validateRisk(risk) {
  const allowed = [
    "low",
    "medium",
    "high",
    "critical"
  ];

  if (!allowed.includes(risk)) {
    throw new Error(
      `Invalid risk. Allowed: ${allowed.join(", ")}`
    );
  }

  return risk;
}

function createProposal(input = {}) {
  const title = validateText(
    input.title,
    "title",
    300
  );

  const reason = validateText(
    input.reason,
    "reason",
    3000
  );

  const expectedBenefit = validateText(
    input.expectedBenefit,
    "expectedBenefit",
    3000
  );

  const category = validateCategory(
    input.category || "other"
  );

  const risk = validateRisk(
    input.risk || "medium"
  );

  const actor = validateText(
    input.actor || "system",
    "actor",
    200
  );

  const affectedResources = Array.isArray(
    input.affectedResources
  )
    ? input.affectedResources
        .filter(item =>
          typeof item === "string" &&
          item.trim()
        )
        .map(item => item.trim())
        .slice(0, 100)
    : [];

  const estimatedComplexity =
    typeof input.estimatedComplexity === "string"
      ? input.estimatedComplexity.trim().slice(0, 100)
      : "unknown";

  const backupRequired =
    input.backupRequired !== false;

  const testRequired =
    input.testRequired !== false;

  const proposal = {
    changeId: createId(),
    category,
    title,
    reason,
    expectedBenefit,
    risk,
    affectedResources,
    estimatedComplexity,
    backupRequired,
    testRequired,

    status: STATUSES.PROPOSED,

    createdAt: now(),
    createdBy: actor,

    approval: null,
    rejection: null,
    revocation: null,

    ...(input.metadata !== undefined
      ? {
          metadata:
            sanitizeProposalMetadata(input.metadata)
        }
      : {}),

    lifecycle: [
      {
        status: STATUSES.PROPOSED,
        at: now(),
        actor
      }
    ]
  };

  const changes = loadChanges();

  changes.push(proposal);

  saveChanges(changes);

  return proposal;
}

function getProposal(changeId) {
  if (!changeId) {
    return null;
  }

  return loadChanges().find(
    proposal => proposal.changeId === changeId
  ) || null;
}

function listProposals(options = {}) {
  const changes = loadChanges();

  let result = changes;

  if (options.status) {
    result = result.filter(
      proposal =>
        proposal.status === options.status
    );
  }

  if (options.category) {
    result = result.filter(
      proposal =>
        proposal.category === options.category
    );
  }

  return result.slice().reverse();
}

function moveToPendingApproval(changeId, actor) {
  return transition(
    changeId,
    STATUSES.PENDING_APPROVAL,
    actor
  );
}

function approveProposal(changeId, actor) {
  return transition(
    changeId,
    STATUSES.APPROVED,
    actor
  );
}

function rejectProposal(changeId, actor, reason) {
  const rejectionReason = validateText(
    reason || "Rejected without additional reason.",
    "rejection reason",
    2000
  );

  const proposal = getProposal(changeId);

  if (!proposal) {
    throw new Error("Change proposal not found.");
  }

  if (
    proposal.status !== STATUSES.PENDING_APPROVAL &&
    proposal.status !== STATUSES.PROPOSED
  ) {
    throw new Error(
      `Cannot reject proposal from status "${proposal.status}".`
    );
  }

  proposal.status = STATUSES.REJECTED;

  proposal.rejection = {
    actor,
    reason: rejectionReason,
    at: now()
  };

  proposal.lifecycle.push({
    status: STATUSES.REJECTED,
    at: now(),
    actor
  });

  replaceProposal(proposal);

  return proposal;
}

function revokeProposal(changeId, actor, reason) {
  const revocationReason = validateText(
    reason || "Revoked without additional reason.",
    "revocation reason",
    2000
  );

  const proposal = getProposal(changeId);

  if (!proposal) {
    throw new Error("Change proposal not found.");
  }

  if (
    proposal.status !== STATUSES.PROPOSED &&
    proposal.status !== STATUSES.PENDING_APPROVAL &&
    proposal.status !== STATUSES.APPROVED
  ) {
    throw new Error(
      `Cannot revoke proposal from status "${proposal.status}".`
    );
  }

  proposal.status = STATUSES.REVOKED;

  proposal.revocation = {
    actor,
    reason: revocationReason,
    at: now()
  };

  proposal.lifecycle.push({
    status: STATUSES.REVOKED,
    at: now(),
    actor
  });

  replaceProposal(proposal);

  return proposal;
}

function transition(changeId, targetStatus, actor) {
  const proposal = getProposal(changeId);

  if (!proposal) {
    throw new Error("Change proposal not found.");
  }

  const validTransitions = {
    [STATUSES.PROPOSED]: [
      STATUSES.PENDING_APPROVAL,
      STATUSES.REJECTED,
      STATUSES.REVOKED
    ],

    [STATUSES.PENDING_APPROVAL]: [
      STATUSES.APPROVED,
      STATUSES.REJECTED,
      STATUSES.REVOKED
    ],

    [STATUSES.APPROVED]: [
      STATUSES.REVOKED
    ],

    [STATUSES.REJECTED]: [],
    [STATUSES.REVOKED]: []
  };

  const allowed =
    validTransitions[proposal.status] || [];

  if (!allowed.includes(targetStatus)) {
    throw new Error(
      `Invalid lifecycle transition: ${proposal.status} -> ${targetStatus}`
    );
  }

  const actorName = validateText(
    actor || "system",
    "actor",
    200
  );

  proposal.status = targetStatus;

  if (targetStatus === STATUSES.APPROVED) {
    proposal.approval = {
      actor: actorName,
      at: now()
    };
  }

  proposal.lifecycle.push({
    status: targetStatus,
    at: now(),
    actor: actorName
  });

  replaceProposal(proposal);

  return proposal;
}

function replaceProposal(updatedProposal) {
  const changes = loadChanges();

  const index = changes.findIndex(
    proposal =>
      proposal.changeId === updatedProposal.changeId
  );

  if (index === -1) {
    throw new Error("Change proposal not found.");
  }

  changes[index] = updatedProposal;

  saveChanges(changes);
}


function completeProposal(changeId, actor = "system") {
  const proposal = getProposal(changeId);

  if (!proposal) {
    throw new Error("Evolution proposal not found.");
  }

  if (proposal.status !== STATUSES.APPROVED) {
    throw new Error("Proposal must be approved before completion.");
  }

  proposal.status = "complete";

  proposal.lifecycle = Array.isArray(proposal.lifecycle)
    ? proposal.lifecycle
    : [];

  proposal.lifecycle.push({
    status: "complete",
    at: new Date().toISOString(),
    actor
  });

  replaceProposal(proposal);

  return proposal;
}

function getGovernanceStatus() {
  const changes = loadChanges();

  const counts = {
    proposed: 0,
    pending_approval: 0,
    approved: 0,
    rejected: 0,
    revoked: 0
  };

  for (const proposal of changes) {
    if (counts[proposal.status] !== undefined) {
      counts[proposal.status]++;
    }
  }

  return {
    ok: true,
    governance: "operational",
    totalProposals: changes.length,
    maxStoredProposals: MAX_PROPOSALS,
    counts,
    productionModification: "approval_required"
  };
}

module.exports = {
  completeProposal,
  CHANGE_FILE,
  MAX_PROPOSALS,
  STATUSES,
  CATEGORIES,

  createProposal,
  getProposal,
  listProposals,

  moveToPendingApproval,
  approveProposal,
  rejectProposal,
  revokeProposal,

  getGovernanceStatus
};
