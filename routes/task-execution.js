"use strict";

const express = require("express");

const {
  executeWork
} = require("../services/mira-work-execution-engine");

function registerTaskExecutionRoutes(
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
    "/execute",
    requireSystemAdmin,
    async (req, res) => {
      try {
        const input =
          req.body?.input ||
          req.body?.task ||
          req.body?.description ||
          "";

        const result =
          await executeWork(
            input,
            {
              plan:
                req.body?.plan,
              taskUnderstanding:
                req.body?.taskUnderstanding,
              toolCalls:
                req.body?.toolCalls,
              persist:
                req.body?.persist !== false,

              /*
               * The authenticated admin route
               * supplies execution permission.
               */
              permissionGranted:
                true
            }
          );

        const status =
          result.success
            ? 200
            : result.status ===
                "autonomous_approval_denied"
              ? 403
              : 400;

        return res
          .status(status)
          .json(result);
      } catch (error) {
        return res.status(400).json({
          success: false,
          stage: "5.4",
          status:
            "task_execution_failed",
          error:
            error.message
        });
      }
    }
  );

  app.use(
    "/api/admin/task-execution",
    router
  );

  return router;
}

module.exports = {
  registerTaskExecutionRoutes
};
