"use strict";

const express = require("express");

const {
  listLearningHistory,
  getLearningHistory,
  getLearningHistoryTimeline,
  getLearningHistoryStats
} = require("../services/mira-learning-history");

const {
  listLessons
} = require("../services/mira-experience-memory");

function registerLearningHistoryRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS
) {
  const router = express.Router();

  const requireSystemAdmin =
    requireAdminPermission(
      PERMISSIONS.SYSTEM_ADMIN
    );

  function denyLegacyLearningHistory(req, res, next) {
    const env = process.env;
    const hfmMode = env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === "true" ||
      env.MIRA_HFM_WORK_LEARNING_ENABLED === "true" ||
      env.MIRA_HFM_MEMORY_READ_ENABLED === "true" ||
      env.MIRA_HFM_MEMORY_WRITE_ENABLED === "true";
    if (hfmMode) {
      return res.status(403).json({
        success: false,
        blocked: true,
        code: "HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_LEARNING_HISTORY",
        error: "Legacy local Learning History is not an authorized HFM memory source."
      });
    }
    return next();
  }

  router.use(denyLegacyLearningHistory);

  router.get(
    "/stats",
    requireSystemAdmin,
    (req, res) => {
      try {
        return res.json({
          success: true,
          stats:
            getLearningHistoryStats()
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  );

  router.get(
    "/lessons",
    requireSystemAdmin,
    (req, res) => {
      if (process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === "true" ||
          process.env.MIRA_HFM_WORK_LEARNING_ENABLED === "true") {
        return res.status(403).json({
          success: false,
          blocked: true,
          code: "HFM_READ_ONLY_AUTHORITY_BLOCKS_LOCAL_EXPERIENCE_LESSONS",
          error: "Local experience lessons are not an authorized HFM memory source."
        });
      }
      try {
        const limit =
          Math.min(
            Number(req.query.limit) || 100,
            100
          );

        return res.json({
          success: true,
          lessons:
            listLessons({
              limit
            })
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  );

  router.get(
    "/",
    requireSystemAdmin,
    (req, res) => {
      try {
        const limit =
          Math.min(
            Number(req.query.limit) || 100,
            100
          );

        return res.json({
          success: true,
          history:
            listLearningHistory({
              historyId:
                req.query.historyId,
              taskId:
                req.query.taskId,
              status:
                req.query.status,
              qaStatus:
                req.query.qaStatus,
              executionStatus:
                req.query.executionStatus,
              success:
                req.query.success,
              limit
            })
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  );

  router.get(
    "/:id/timeline",
    requireSystemAdmin,
    (req, res) => {
      try {
        const history =
          getLearningHistoryTimeline(
            String(req.params.id || "")
          );

        if (!history) {
          return res.status(404).json({
            success: false,
            error:
              "Learning history was not found."
          });
        }

        return res.json({
          success: true,
          ...history
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  );

  router.get(
    "/:id",
    requireSystemAdmin,
    (req, res) => {
      try {
        const history =
          getLearningHistory(
            String(req.params.id || "")
          );

        if (!history) {
          return res.status(404).json({
            success: false,
            error:
              "Learning history was not found."
          });
        }

        return res.json({
          success: true,
          history
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  );

  app.use(
    "/api/admin/learning-history",
    router
  );
}

module.exports =
  registerLearningHistoryRoutes;
