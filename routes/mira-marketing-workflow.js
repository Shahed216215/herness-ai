"use strict";

const express = require("express");

const {
  namedAdminSession
} = require("./mira-seo-research");

const {
  runMarketingWorkflow
} = require("../services/mira-marketing-workflow-orchestrator");

const ALLOWED_FIELDS = new Set([
  "brief",
  "query",
  "auditInput",
  "confirmLiveResearch"
]);

function validateRequestBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError("MARKETING_WORKFLOW_BODY_REQUIRED");
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new TypeError(
        `MARKETING_WORKFLOW_FIELD_NOT_ALLOWED:${key}`
      );
    }
  }

  if (body.confirmLiveResearch !== true) {
    throw new TypeError(
      "EXPLICIT_LIVE_RESEARCH_CONFIRMATION_REQUIRED"
    );
  }

  return {
    brief: body.brief,
    query: body.query,
    auditInput: body.auditInput
  };
}

function registerMiraMarketingWorkflowRoutes(
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

    if (
      process.env.MIRA_SEO_RESEARCH_LIVE_ENABLED !== "true"
    ) {
      return res.status(403).json({
        success: false,
        status: "NOT_APPROVED",
        reason: "LIVE_SEO_RESEARCH_FEATURE_DISABLED",
        networkAccess: "NOT_STARTED"
      });
    }

    let input;

    try {
      input = validateRequestBody(req.body);
    } catch (error) {
      return res.status(400).json({
        success: false,
        status: "INVALID_INPUT",
        reason: error.message
      });
    }

    try {
      const workflowRunner =
        dependencies.runMarketingWorkflow || runMarketingWorkflow;

      const result = await workflowRunner(
        input,
        {
          permissionGranted: true,
          actor
        },
        dependencies.workflowDependencies || {}
      );

      const status = result && result.success === true
        ? 200
        : result && (
          result.status === "BLOCKED" ||
          result.status === "NOT_APPROVED"
        )
          ? 403
          : 503;

      return res.status(status).json(result);
    } catch (error) {
      const invalid =
        error instanceof TypeError ||
        error instanceof RangeError;

      return res.status(invalid ? 400 : 503).json({
        success: false,
        status: invalid ? "INVALID_INPUT" : "INCONCLUSIVE",
        reason: error.message
      });
    }
  });

  app.use(
    "/api/admin/mira-marketing-workflow",
    requireAdminPermission(PERMISSIONS.SYSTEM_ADMIN),
    router
  );

  return router;
}

registerMiraMarketingWorkflowRoutes.validateRequestBody =
  validateRequestBody;

module.exports = registerMiraMarketingWorkflowRoutes;
