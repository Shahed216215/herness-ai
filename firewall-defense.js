const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');
const { execFile } = require("child_process");

const STATE_FILE = storagePath("firewall-defense-state.json");

const DEFAULT_STATE = {
  enabled: false,
  lastInspection: null,
  lastProposal: null,
  pendingApproval: null,
  lastDecision: null,
  history: []
};

const MAX_HISTORY = 50;

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { ...DEFAULT_STATE };
  }

  try {
    const data = JSON.parse(
      fs.readFileSync(STATE_FILE, "utf8")
    );

    return {
      ...DEFAULT_STATE,
      ...data,
      history: Array.isArray(data.history)
        ? data.history.slice(-MAX_HISTORY)
        : []
    };
  } catch (error) {
    console.error(
      "FIREWALL_STATE_ERROR:",
      error.message
    );

    return { ...DEFAULT_STATE };
  }
}

function saveState(state) {
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(state, null, 2),
    "utf8"
  );
}

function setEnabled(enabled) {
  if (typeof enabled !== "boolean") {
    throw new Error(
      "enabled must be true or false."
    );
  }

  const state = loadState();

  state.enabled = enabled;

  saveState(state);

  return {
    success: true,
    enabled: state.enabled
  };
}

function getStatus() {
  const state = loadState();

  return {
    enabled: state.enabled,
    lastInspection: state.lastInspection,
    lastProposal: state.lastProposal,
    pendingApproval: state.pendingApproval,
    lastDecision: state.lastDecision,
    history: state.history
  };
}

function runReadOnlyCommand(command, args = []) {
  return new Promise(resolve => {
    execFile(
      command,
      args,
      {
        timeout: 5000,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        resolve({
          command,
          args,
          available: !error,
          exitCode:
            typeof error?.code === "number"
              ? error.code
              : error
                ? 1
                : 0,
          stdout: String(stdout || "").trim(),
          stderr: String(stderr || "").trim()
        });
      }
    );
  });
}

async function collectFirewallEvidence() {
  const evidence = [];

  const commands = [
    {
      name: "iptables",
      command: "iptables",
      args: ["-L", "-n", "-v"]
    },
    {
      name: "ip6tables",
      command: "ip6tables",
      args: ["-L", "-n", "-v"]
    },
    {
      name: "nft",
      command: "nft",
      args: ["list", "ruleset"]
    },
    {
      name: "ufw",
      command: "ufw",
      args: ["status", "verbose"]
    },
    {
      name: "firewall-cmd",
      command: "firewall-cmd",
      args: ["--state"]
    }
  ];

  for (const item of commands) {
    const result = await runReadOnlyCommand(
      item.command,
      item.args
    );

    evidence.push({
      name: item.name,
      available: result.available,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    });
  }

  return evidence;
}

async function createInspection(observations = []) {
  const state = loadState();

  if (!Array.isArray(observations)) {
    throw new Error(
      "observations must be an array."
    );
  }

  const evidence =
    await collectFirewallEvidence();

  const availableTools = evidence
    .filter(item => item.available)
    .map(item => item.name);

  const unavailableTools = evidence
    .filter(item => !item.available)
    .map(item => item.name);

  let assessment = "unknown";
  let assessmentReason =
    "No supported firewall backend was available; compliance could not be determined.";

  if (availableTools.length > 0) {
    assessment = "evidence_available";
    assessmentReason =
      "At least one supported firewall backend returned read-only evidence. The evidence requires review before making a compliance determination.";
  }

  const inspection = {
    timestamp: new Date().toISOString(),
    mode: "read_only",
    changesApplied: false,

    observations: observations
      .map(item =>
        String(item || "").trim()
      )
      .filter(Boolean),

    systemEvidence: evidence,

    summary: {
      availableFirewallTools:
        availableTools,

      unavailableFirewallTools:
        unavailableTools,

      evidenceCollected:
        evidence.length,

      configurationReadOnly: true,

      assessment,

      assessmentReason
    }
  };

  state.lastInspection = inspection;

  state.history.push({
    timestamp: inspection.timestamp,
    type: "read_only_inspection",
    result: inspection
  });

  state.history =
    state.history.slice(-MAX_HISTORY);

  saveState(state);

  return {
    success: true,
    inspection
  };
}

function createProposal(changes = []) {
  const state = loadState();

  if (!Array.isArray(changes)) {
    throw new Error(
      "changes must be an array."
    );
  }

  const proposal = {
    id: `FW-${Date.now()}`,
    createdAt:
      new Date().toISOString(),
    status: "approval_required",
    automaticChangesAllowed: false,

    changes: changes
      .map(item => ({
        description: String(
          item.description || ""
        ).trim(),

        reason: String(
          item.reason || ""
        ).trim(),

        risk: String(
          item.risk || ""
        ).trim(),

        rollback: String(
          item.rollback || ""
        ).trim()
      }))
      .filter(
        item => item.description
      )
  };

  state.lastProposal = proposal;
  state.pendingApproval = proposal;

  saveState(state);

  return {
    success: true,
    proposal
  };
}

function decideProposal(decision) {
  const normalized = String(
    decision || ""
  )
    .trim()
    .toUpperCase();

  if (
    normalized !== "APPROVE" &&
    normalized !== "DENY"
  ) {
    throw new Error(
      "Decision must be APPROVE or DENY."
    );
  }

  const state = loadState();

  if (!state.pendingApproval) {
    throw new Error(
      "No pending firewall proposal."
    );
  }

  const proposal =
    state.pendingApproval;

  const result = {
    proposalId: proposal.id,
    decision: normalized,
    decidedAt:
      new Date().toISOString(),

    changesApplied: false,

    message:
      normalized === "APPROVE"
        ? "Approved for controlled implementation. This module does not execute firewall rule changes."
        : "Proposal denied. No firewall change was executed."
  };

  state.lastDecision = result;

  state.history.push({
    timestamp: result.decidedAt,
    type: "proposal_decision",
    result
  });

  state.history =
    state.history.slice(-MAX_HISTORY);

  state.pendingApproval = null;

  saveState(state);

  return {
    success: true,
    result
  };
}

function clearPendingProposal() {
  const state = loadState();

  state.pendingApproval = null;

  saveState(state);

  return {
    success: true,
    message:
      "Pending firewall proposal cleared."
  };
}

module.exports = {
  name: "firewall_defense",
  setEnabled,
  getStatus,
  createInspection,
  createProposal,
  decideProposal,
  clearPendingProposal
};
