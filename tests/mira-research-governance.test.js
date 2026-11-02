"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  approveUrgentTask,
  reserveResearchBudget,
  getGovernanceSnapshot
} = require("../services/mira-research-governance");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mira-governance-test-"));
const file = path.join(root, "ledger.json");
const now = new Date("2026-10-25T12:00:00.000Z");
const task = {
  id: "research-urgent-1",
  type: "research",
  status: "new",
  risk: "low",
  title: "Research a safe market trend"
};
const actor = { role: "admin", id: "test-admin" };
let auditCount = 0;

try {
  const normal1 = reserveResearchBudget(
    { taskId: "normal-1" }, { file, now }
  );
  const normal2 = reserveResearchBudget(
    { taskId: "normal-2" }, { file, now }
  );
  const normal3 = reserveResearchBudget(
    { taskId: "normal-3" }, { file, now }
  );
  const normal4 = reserveResearchBudget(
    { taskId: "normal-4" }, { file, now }
  );

  assert.strictEqual(normal1.allowed, true);
  assert.strictEqual(normal2.allowed, true);
  assert.strictEqual(normal3.allowed, true);
  assert.strictEqual(normal4.allowed, false);
  assert.strictEqual(normal4.status, "normal_daily_limit_reached");

  const unapprovedUrgent = reserveResearchBudget(
    { taskId: task.id, urgent: true }, { file, now }
  );
  assert.strictEqual(unapprovedUrgent.allowed, false);
  assert.strictEqual(unapprovedUrgent.status, "urgent_approval_required");

  assert.throws(() => approveUrgentTask({
    taskId: task.id,
    task,
    reason: "Urgent business deadline",
    actor
  }, { file, now }), /Audit callback required/);

  const approved = approveUrgentTask({
    taskId: task.id,
    task,
    reason: "Urgent business deadline",
    actor
  }, {
    file,
    now,
    audit(entry) {
      auditCount += 1;
      assert.strictEqual(entry.action, "URGENT_RESEARCH_APPROVAL");
      assert.strictEqual(entry.resourceId, task.id);
    }
  });

  assert.strictEqual(approved.status, "approved");
  assert.strictEqual(auditCount, 1);

  const urgentReservation = reserveResearchBudget(
    { taskId: task.id, urgent: true }, { file, now }
  );
  assert.strictEqual(urgentReservation.allowed, true);
  assert.strictEqual(urgentReservation.kind, "urgent");
  assert.strictEqual(urgentReservation.normalCount, 3);
  assert.strictEqual(urgentReservation.urgentCount, 1);

  const reused = reserveResearchBudget(
    { taskId: task.id, urgent: true }, { file, now }
  );
  assert.strictEqual(reused.allowed, false);

  const snapshot = getGovernanceSnapshot({ file, now });
  assert.strictEqual(snapshot.normalCount, 3);
  assert.strictEqual(snapshot.urgentCount, 1);
  assert.strictEqual(snapshot.approvals[0].status, "consumed");

  const corrupt = path.join(root, "corrupt.json");
  fs.writeFileSync(corrupt, "{broken", "utf8");
  assert.throws(
    () => reserveResearchBudget({ taskId: "x" }, { file: corrupt, now }),
    /ledger invalid/
  );

  console.log("NORMAL_LIMIT=PASS");
  console.log("URGENT_REQUIRES_APPROVAL=PASS");
  console.log("AUDIT_CALLBACK_REQUIRED=PASS");
  console.log("URGENT_ONE_TIME_USE=PASS");
  console.log("SEPARATE_ACCOUNTING=PASS");
  console.log("CORRUPT_LEDGER_FAIL_CLOSED=PASS");
  console.log("NETWORK_TEST=NOT_RUN");
  console.log("LIVE_API_TEST=NOT_RUN");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
