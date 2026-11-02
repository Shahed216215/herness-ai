"use strict";

const express = require("express");

const {
  understandTask
} = require("../services/mira-task-understanding");

const {
  getTask,
  listTasks,
  getTaskSummary
} = require("../task-store");

function registerTaskUnderstandingRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS
) {
  const router =
    express.Router();

  const requireSystemAdmin =
    requireAdminPermission(
      PERMISSIONS.SYSTEM_ADMIN
    );

  router.post(
    "/understand",
    requireSystemAdmin,
    (req, res) => {
      try {
        const input =
          req.body?.input ??
          req.body?.task ??
          req.body?.description;

        if (
          typeof input !== "string" ||
          !input.trim()
        ) {
          return res.status(400).json({
            success: false,
            error:
              "Task input is required."
          });
        }

        const result =
          understandTask(input, {
            persist: true
          });

        return res.status(200).json({
          success: true,
          ...result
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          status:
            "task_understanding_failed",
          error:
            error.message
        });
      }
    }
  );

  router.get(
    "/tasks",
    requireSystemAdmin,
    (req, res) => {
      try {
        const tasks =
          listTasks({
            status:
              req.query.status || undefined,
            type:
              req.query.type || undefined,
            risk:
              req.query.risk || undefined
          });

        return res.status(200).json({
          success: true,
          tasks
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          status:
            "task_list_failed",
          error:
            error.message
        });
      }
    }
  );

  router.get(
    "/tasks/:taskId",
    requireSystemAdmin,
    (req, res) => {
      try {
        const task =
          getTask(req.params.taskId);

        if (!task) {
          return res.status(404).json({
            success: false,
            error:
              "Task not found."
          });
        }

        return res.status(200).json({
          success: true,
          task
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          status:
            "task_read_failed",
          error:
            error.message
        });
      }
    }
  );

  router.get(
    "/summary",
    requireSystemAdmin,
    (req, res) => {
      try {
        return res.status(200).json({
          success: true,
          summary:
            getTaskSummary()
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          status:
            "task_summary_failed",
          error:
            error.message
        });
      }
    }
  );

  app.use(
    "/api/admin/task-understanding",
    router
  );
}

module.exports = {
  registerTaskUnderstandingRoutes
};
