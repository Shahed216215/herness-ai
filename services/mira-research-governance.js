"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const storagePath = require("../mira-storage");

const NORMAL_DAILY_LIMIT = 3;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 25;

function defaultLedgerPath() {
  return process.env.MIRA_RESEARCH_GOVERNANCE_FILE ||
    storagePath("data/mira-research-governance.json");
}

function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Short bounded wait. No external process or network activity.
  }
}

function withFileLock(file, callback, options = {}) {
  const lock = `${file}.lock`;
  const timeout = options.timeoutMs || LOCK_TIMEOUT_MS;
  const started = Date.now();

  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

  while (true) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
      if (Date.now() - started >= timeout) {
        throw new Error(
          "Governance lock unavailable; refusing operation. " +
          "Inspect the lock before manual recovery."
        );
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }

  try {
    fs.writeFileSync(
      path.join(lock, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString()
      }) + "\n",
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
    return callback();
  } finally {
    // Only release a lock whose owner marker belongs to this process.
    let owner;
    try {
      owner = JSON.parse(
        fs.readFileSync(path.join(lock, "owner.json"), "utf8")
      );
    } catch (_) {
      throw new Error(
        "Governance lock owner cannot be verified; manual recovery required."
      );
    }

    if (owner.pid !== process.pid) {
      throw new Error(
        "Governance lock owner mismatch; refusing to release lock."
      );
    }

    fs.unlinkSync(path.join(lock, "owner.json"));
    fs.rmdirSync(lock);
  }
}

function emptyState() {
  return {
    schemaVersion: 1,
    approvals: {},
    dailyUsage: {}
  };
}

function readState(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return emptyState();
    throw new Error("Governance ledger unavailable; refusing operation.");
  }

  let state;
  try {
    state = JSON.parse(raw);
  } catch (_) {
    throw new Error("Governance ledger invalid; refusing operation.");
  }

  if (
    !state ||
    state.schemaVersion !== 1 ||
    !state.approvals ||
    typeof state.approvals !== "object" ||
    Array.isArray(state.approvals) ||
    !state.dailyUsage ||
    typeof state.dailyUsage !== "object" ||
    Array.isArray(state.dailyUsage)
  ) {
    throw new Error("Governance ledger schema invalid; refusing operation.");
  }

  return state;
}

function writeState(file, state) {
  const temp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });

  try {
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch (_) {}
    throw error;
  }
}

function validateResearchTask(task) {
  if (!task || typeof task !== "object") {
    throw new Error("Task not found; urgent approval refused.");
  }
  if (!task.id || typeof task.id !== "string") {
    throw new Error("Task ID invalid; urgent approval refused.");
  }
  if (!["research", "web_research"].includes(task.type)) {
    throw new Error("Only research tasks may receive urgent approval.");
  }
  if (task.status !== "new" || task.risk !== "low") {
    throw new Error("Task must be new and low-risk for urgent approval.");
  }
}

function approveUrgentTask(input, options = {}) {
  const file = options.file || defaultLedgerPath();
  const now = options.now || new Date();
  const task = input && input.task;
  const taskId = input && input.taskId;
  const reason = input && typeof input.reason === "string"
    ? input.reason.trim()
    : "";
  const actor = input && input.actor;

  validateResearchTask(task);

  if (task.id !== taskId) {
    throw new Error("Task ID mismatch; urgent approval refused.");
  }
  if (reason.length < 8 || reason.length > 500) {
    throw new Error("Approval reason must be 8–500 characters.");
  }
  if (
    !actor ||
    typeof actor.role !== "string" ||
    !["admin", "system_admin"].includes(actor.role.toLowerCase()) ||
    typeof actor.id !== "string" ||
    !actor.id.trim()
  ) {
    throw new Error("Verified administrator identity required.");
  }
  if (typeof options.audit !== "function") {
    throw new Error("Audit callback required; urgent approval refused.");
  }

  return withFileLock(file, () => {
    const state = readState(file);
    const existing = state.approvals[taskId];

    if (existing && ["approved", "consumed"].includes(existing.status)) {
      throw new Error("Task already has an active or consumed approval.");
    }

    const approval = {
      id: crypto.randomUUID(),
      taskId,
      status: "pending_audit",
      priority: "URGENT",
      reason,
      approverId: actor.id.trim().slice(0, 200),
      approverRole: actor.role,
      approvedAt: now.toISOString(),
      consumedAt: null,
      utcDay: utcDay(now)
    };

    state.approvals[taskId] = approval;
    writeState(file, state);

    // Worker must ignore pending_audit. Audit failure therefore fails closed.
    options.audit({
      actorRole: actor.role,
      action: "URGENT_RESEARCH_APPROVAL",
      resource: "research_task",
      resourceId: taskId,
      status: "success",
      details: {
        approvalId: approval.id,
        reason,
        approverId: approval.approverId,
        approvedAt: approval.approvedAt
      }
    });

    const verified = readState(file);
    const stored = verified.approvals[taskId];
    if (!stored || stored.id !== approval.id) {
      throw new Error("Approval persistence verification failed.");
    }

    stored.status = "approved";
    writeState(file, verified);

    return {
      ok: true,
      taskId,
      approvalId: approval.id,
      status: "approved",
      approvedAt: approval.approvedAt
    };
  });
}

function reserveResearchBudget(input, options = {}) {
  const file = options.file || defaultLedgerPath();
  const now = options.now || new Date();
  const taskId = input && input.taskId;
  const urgent = input && input.urgent === true;

  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("Valid task ID required for budget reservation.");
  }

  return withFileLock(file, () => {
    const state = readState(file);
    const day = utcDay(now);

    if (!state.dailyUsage[day]) {
      let priorNormalCount = 0;
      const legacyFile = options.legacyBudgetFile;

      if (legacyFile) {
        try {
          const legacy = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
          if (
            !legacy ||
            typeof legacy.day !== "string" ||
            !Number.isInteger(legacy.count) ||
            legacy.count < 0
          ) {
            throw new Error("Legacy research budget invalid.");
          }
          if (legacy.day === day) priorNormalCount = legacy.count;
        } catch (error) {
          if (!error || error.code !== "ENOENT") {
            throw new Error(
              "Legacy research budget unavailable or invalid; refusing research."
            );
          }
        }
      }

      state.dailyUsage[day] = {
        normalCount: priorNormalCount,
        urgentCount: 0,
        reservations: {}
      };
    }

    const usage = state.dailyUsage[day];
    if (
      !Number.isInteger(usage.normalCount) ||
      usage.normalCount < 0 ||
      !Number.isInteger(usage.urgentCount) ||
      usage.urgentCount < 0 ||
      !usage.reservations ||
      typeof usage.reservations !== "object"
    ) {
      throw new Error("Daily usage ledger invalid; refusing research.");
    }

    if (usage.reservations[taskId]) {
      return {
        allowed: false,
        status: "already_reserved",
        day,
        normalCount: usage.normalCount,
        urgentCount: usage.urgentCount
      };
    }

    if (urgent) {
      const approval = state.approvals[taskId];
      if (!approval || approval.status !== "approved") {
        return {
          allowed: false,
          status: "urgent_approval_required",
          day,
          normalCount: usage.normalCount,
          urgentCount: usage.urgentCount
        };
      }

      // Consume the one-time approval before external execution.
      // Failed or interrupted work cannot silently reuse the authorization.
      approval.status = "consumed";
      approval.consumedAt = now.toISOString();
      usage.urgentCount += 1;
      usage.reservations[taskId] = {
        kind: "urgent",
        approvalId: approval.id,
        reservedAt: now.toISOString()
      };
    } else {
      if (usage.normalCount >= NORMAL_DAILY_LIMIT) {
        return {
          allowed: false,
          status: "normal_daily_limit_reached",
          day,
          normalCount: usage.normalCount,
          urgentCount: usage.urgentCount
        };
      }

      usage.normalCount += 1;
      usage.reservations[taskId] = {
        kind: "normal",
        reservedAt: now.toISOString()
      };
    }

    writeState(file, state);

    return {
      allowed: true,
      status: "reserved",
      day,
      kind: urgent ? "urgent" : "normal",
      normalCount: usage.normalCount,
      urgentCount: usage.urgentCount
    };
  });
}

function getGovernanceSnapshot(options = {}) {
  const file = options.file || defaultLedgerPath();
  return withFileLock(file, () => {
    const state = readState(file);
    const day = utcDay(options.now || new Date());
    const usage = state.dailyUsage[day] || {
      normalCount: 0,
      urgentCount: 0,
      reservations: {}
    };

    return {
      day,
      normalLimit: NORMAL_DAILY_LIMIT,
      normalCount: usage.normalCount,
      urgentCount: usage.urgentCount,
      approvals: Object.values(state.approvals).map(item => ({
        taskId: item.taskId,
        status: item.status,
        priority: item.priority,
        approverId: item.approverId,
        approvedAt: item.approvedAt,
        consumedAt: item.consumedAt
      }))
    };
  });
}

module.exports = {
  NORMAL_DAILY_LIMIT,
  approveUrgentTask,
  reserveResearchBudget,
  getGovernanceSnapshot,
  validateResearchTask
};
