"use strict";

const express = require("express");

const {
  createTaskPlan,
  replanTask,
  validatePlan
} = require("../services/mira-task-planner");

function registerTaskPlanningRoutes(
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

  router.use(requireSystemAdmin);

  router.post("/plan", async (req, res) => {
    try {
      const input =
        req.body?.input ||
        req.body?.task ||
        req.body?.description ||
        "";

      const result = await createTaskPlan(input, {
        persist: true
      });

      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  });

  router.post("/replan", async (req, res) => {
    try {
      const input =
        req.body?.input ||
        req.body?.task ||
        req.body?.description ||
        "";

      const result = await replanTask(
        input,
        req.body?.failureContext || {},
        {
          persist: true
        }
      );

      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  });

  router.post("/validate", (req, res) => {
    try {
      const validation = validatePlan(req.body?.plan);

      return res.status(validation.valid ? 200 : 400).json({
        success: validation.valid,
        validation
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  });

  app.use(
    "/api/admin/task-planning",
    router
  );

  return router;
}

module.exports = {
  registerTaskPlanningRoutes
};
