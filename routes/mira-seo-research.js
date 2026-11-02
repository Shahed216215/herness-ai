"use strict";

const express = require("express");
const {
  runSeoResearch
} = require("../services/mira-seo-research-orchestrator");

function namedAdminSession(req) {
  const session = req.session;

  if (
    !session ||
    session.authenticated !== true ||
    session.role !== "admin" ||
    req.role !== "admin" ||
    typeof session.username !== "string" ||
    !session.username.trim()
  ) {
    return null;
  }

  return {
    role: "admin",
    username: session.username.trim(),
    userId: typeof session.userId === "string"
      ? session.userId
      : null
  };
}

function registerMiraSeoResearchRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS,
  dependencies = {}
) {
  const router = express.Router();

  router.post("/run", async (req, res) => {
    const actor = namedAdminSession(req);

    if (!actor) {
      return res.status(403).json({
        success: false,
        status: "BLOCKED",
        reason: "NAMED_ADMIN_BROWSER_SESSION_REQUIRED"
      });
    }

    if (process.env.MIRA_SEO_RESEARCH_LIVE_ENABLED !== "true") {
      return res.status(403).json({
        success: false,
        status: "NOT_APPROVED",
        reason: "LIVE_SEO_RESEARCH_FEATURE_DISABLED"
      });
    }

    if (!req.body || req.body.confirmLiveResearch !== true) {
      return res.status(400).json({
        success: false,
        status: "NOT_APPROVED",
        reason: "EXPLICIT_LIVE_RESEARCH_CONFIRMATION_REQUIRED"
      });
    }

    const input = {
      brief: req.body.brief,
      query: req.body.query
    };

    try {
      const result = await (dependencies.runSeoResearch || runSeoResearch)(
        input,
        {
          permissionGranted: true,
          actor
        },
        dependencies.executionDependencies || {}
      );

      const status = result.success
        ? 200
        : result.status === "BLOCKED"
          ? 403
          : 503;

      return res.status(status).json(result);
    } catch (error) {
      const invalid = error instanceof TypeError ||
        error instanceof RangeError;

      return res.status(invalid ? 400 : 503).json({
        success: false,
        status: invalid ? "INVALID_INPUT" : "INCONCLUSIVE",
        reason: error.message
      });
    }
  });

  app.use(
    "/api/admin/mira-seo-research",
    requireAdminPermission(PERMISSIONS.SYSTEM_ADMIN),
    router
  );

  return router;
}

registerMiraSeoResearchRoutes.namedAdminSession = namedAdminSession;
module.exports = registerMiraSeoResearchRoutes;
