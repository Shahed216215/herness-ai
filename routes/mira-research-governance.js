"use strict";

const express = require("express");
const { getTask, listTasks } = require("../task-store");
const { recordAudit } = require("../audit-log");
const {
  approveUrgentTask,
  getGovernanceSnapshot,
  validateResearchTask
} = require("../services/mira-research-governance");

function actorIdentity(req) {
  const session = req.session;
  const role = req.role;
  const id = session && session.username;

  // Bearer-token authentication alone does not establish a named approver.
  if (
    !session ||
    session.authenticated !== true ||
    role !== "admin" ||
    session.role !== "admin" ||
    typeof id !== "string" ||
    !id.trim()
  ) {
    throw new Error("Verified administrator session identity unavailable.");
  }

  return { role, id: id.trim() };
}

function registerMiraResearchGovernanceRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS
) {
  const router = express.Router();

  router.get("/tasks", (req, res) => {
    try {
      const snapshot = getGovernanceSnapshot();
      const approvals = new Map(
        snapshot.approvals.map(item => [item.taskId, item])
      );

      const tasks = (listTasks({ status: "new", risk: "low" }) || [])
        .filter(task => ["research", "web_research"].includes(task.type))
        .map(task => {
          const approval = approvals.get(task.id);
          return {
            id: task.id,
            title: task.title,
            description: task.description,
            type: task.type,
            status: task.status,
            risk: task.risk,
            deadline: task.deadline || null,
            createdAt: task.createdAt || null,
            urgentApprovalStatus: approval ? approval.status : "none",
            approvedAt: approval ? approval.approvedAt : null
          };
        });

      return res.json({
        success: true,
        tasks,
        budget: {
          day: snapshot.day,
          normalLimit: snapshot.normalLimit,
          normalCount: snapshot.normalCount,
          urgentCount: snapshot.urgentCount
        }
      });
    } catch (error) {
      return res.status(503).json({
        success: false,
        error: "Research governance unavailable; operation refused."
      });
    }
  });

  router.post("/tasks/:taskId/approve-urgent", (req, res) => {
    try {
      const actor = actorIdentity(req);
      const taskId = String(req.params.taskId || "");
      const task = getTask(taskId);

      validateResearchTask(task);

      const result = approveUrgentTask({
        taskId,
        task,
        reason: req.body && req.body.reason,
        actor
      }, {
        audit(entry) {
          recordAudit(entry);
        }
      });

      return res.json({ success: true, ...result });
    } catch (error) {
      const message = String(error && error.message || "");
      const status = /not found/i.test(message) ? 404
        : /already has/i.test(message) ? 409
        : /required|must be|invalid|only research|mismatch/i.test(message) ? 400
        : 503;

      return res.status(status).json({
        success: false,
        error: status === 503
          ? "Approval could not be safely recorded; no authorization granted."
          : message
      });
    }
  });

  app.use(
    "/api/admin/research-governance",
    requireAdminPermission(PERMISSIONS.SYSTEM_ADMIN),
    router
  );
}

module.exports = registerMiraResearchGovernanceRoutes;
module.exports.actorIdentity = actorIdentity;
