"use strict";

const express = require("express");
const { audit } = require("../services/mira-seo-engine");
const rejectUnsupportedUploads = require("../services/security/reject-unsupported-uploads");

function registerMiraSeoRoutes(app, requireAdminPermission, PERMISSIONS) {
  app.post(
    "/api/admin/mira-seo/audit",
    requireAdminPermission(PERMISSIONS.SYSTEM_ADMIN),

    // This route-specific parser runs only after SYSTEM_ADMIN authorization.
    express.json({ limit: "2mb" }),

    // Keep parser errors local and return a useful client error for malformed JSON.
    (error, req, res, next) => {
      if (error instanceof SyntaxError && error.status === 400) {
        return res.status(400).json({
          success: false,
          reason: "Malformed JSON request body."
        });
      }
      return next(error);
    },

    // Inspect parsed JSON for explicit attachment payloads.
    rejectUnsupportedUploads,

    (req, res) => {
      try {
        const result = audit(req.body || {});
        return res.json(result);
      } catch (error) {
        return res.status(400).json({
          success: false,
          reason: error.message || "SEO audit failed."
        });
      }
    }
  );
}

module.exports = registerMiraSeoRoutes;
