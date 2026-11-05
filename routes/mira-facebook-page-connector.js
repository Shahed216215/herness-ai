"use strict";

const express = require("express");
const { createFacebookPageConnector } = require("../services/mira-facebook-page-connector");

function registerFacebookPageConnectorRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS,
  options = {}
) {
  const router = express.Router();
  const createConnector = options.createConnector || createFacebookPageConnector;

  router.get("/capabilities", async (req, res) => {
    try {
      const result = await createConnector().detectCapabilities();
      return res.status(result.read === "VERIFIED" ? 200 : 503).json({
        success: result.read === "VERIFIED",
        capabilities: result
      });
    } catch (error) {
      return res.status(503).json({
        success: false,
        error: "FACEBOOK_PAGE_CAPABILITY_CHECK_FAILED",
        code: String(error && error.code || "CONFIGURATION_ERROR").slice(0, 64)
      });
    }
  });

  router.post("/draft", (req, res) => {
    try {
      const draft = createConnector().createManualPostDraft({
        message: req.body && req.body.message
      });
      return res.status(200).json({ success: true, draft });
    } catch (error) {
      return res.status(400).json({
        success: false,
        code: String(error && error.code || "INVALID_DRAFT").slice(0, 64)
      });
    }
  });

  router.post("/publish", async (req, res) => {
    try {
      if (!req.body || req.body.confirmPublish !== "PUBLISH_TO_FACEBOOK_PAGE")
        return res.status(403).json({
          success: false,
          code: "FACEBOOK_PUBLISH_CONFIRMATION_REQUIRED"
        });
      const result = await createConnector().publishPost({
        message: req.body.message,
        approved: true
      });
      return res.status(202).json({ success: true, result });
    } catch (error) {
      return res.status(400).json({
        success: false,
        code: String(error && error.code || "FACEBOOK_PUBLISH_FAILED").slice(0, 64)
      });
    }
  });

  router.post("/import-url", async (req, res) => {
    try {
      const result = await createConnector().importPostUrl({
        url: req.body && req.body.url
      });
      return res.status(200).json({ success: true, result });
    } catch (error) {
      return res.status(400).json({
        success: false,
        code: String(error && error.code || "FACEBOOK_IMPORT_FAILED").slice(0, 64)
      });
    }
  });

  router.post("/verify", async (req, res) => {
    try {
      const result = await createConnector().verifyPost({
        postId: req.body && req.body.postId
      });
      return res.status(200).json({ success: true, result });
    } catch (error) {
      return res.status(400).json({
        success: false,
        code: String(error && error.code || "FACEBOOK_READBACK_FAILED").slice(0, 64)
      });
    }
  });

  app.use(
    "/api/admin/facebook-page",
    requireAdminPermission(PERMISSIONS.SYSTEM_ADMIN),
    router
  );
}

module.exports = registerFacebookPageConnectorRoutes;
