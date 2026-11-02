"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  approveUrgentTask,
  reserveResearchBudget
} = require("../services/mira-research-governance");

const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "mira-audit-fail-closed-")
);
const file = path.join(root, "ledger.json");
const now = new Date("2026-10-25T12:00:00.000Z");
const task = {
  id: "audit-failure-task",
  type: "research",
  status: "new",
  risk: "low",
  title: "Offline audit failure test"
};
const input = {
  taskId: task.id,
  task,
  reason: "Urgent deadline requires review",
  actor: { role: "admin", id: "offline-test-admin" }
};

try {
  assert.throws(
    () => approveUrgentTask(input, {
      file,
      now,
      audit() {
        throw new Error("simulated audit failure");
      }
    }),
    /simulated audit failure/
  );
  console.log("AUDIT_FAILURE_PROPAGATES=PASS");

  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(state.approvals[task.id].status, "pending_audit");
  console.log("FAILED_AUDIT_REMAINS_PENDING=PASS");

  const reservation = reserveResearchBudget(
    { taskId: task.id, urgent: true },
    { file, now }
  );
  assert.equal(reservation.allowed, false);
  assert.equal(reservation.status, "urgent_approval_required");
  console.log("PENDING_APPROVAL_CANNOT_RESERVE_URGENT_BUDGET=PASS");

  const workerSource = fs.readFileSync(
    path.join(__dirname, "..", "services", "mira-autonomous-worker.js"),
    "utf8"
  );
  assert.match(
    workerSource,
    /\.filter\(item\s*=>\s*item\.status\s*===\s*"approved"\)/
  );
  console.log("WORKER_ONLY_SELECTS_APPROVED_STATUS=PASS");

  console.log("NETWORK_TEST=NOT_RUN");
  console.log("LIVE_API_TEST=NOT_RUN");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
