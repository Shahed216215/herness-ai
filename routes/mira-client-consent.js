"use strict";

const express = require("express");
const { createConsentService } = require("../services/mira-client-consent-service");
const { recordAudit, verifyAuditIntegrity } = require("../audit-log");

function actorIdentity(req) {
  const session = req.session;
  if (
    !session ||
    session.authenticated !== true ||
    session.role !== "admin" ||
    req.role !== "admin" ||
    typeof session.username !== "string" ||
    !session.username.trim()
  ) {
    throw new Error("VERIFIED_NAMED_ADMIN_SESSION_REQUIRED");
  }

  return {
    role: "admin",
    username: session.username.trim(),
    userId: typeof session.userId === "string" ? session.userId : null
  };
}

function registerMiraClientConsentRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS,
  dependencies = {}
) {
  const router = express.Router();
  const service = dependencies.service || createConsentService({
    recordAudit: dependencies.recordAudit || recordAudit,
    verifyAuditIntegrity: dependencies.verifyAuditIntegrity || verifyAuditIntegrity
  });

  router.get("/", (req, res) => {
    try {
      actorIdentity(req);
      return res.json({ success: true, events: service.list() });
    } catch {
      return res.status(403).json({
        success: false,
        error: "Named administrator session required."
      });
    }
  });

  router.post("/grant", (req, res) => {
    try {
      const actor = actorIdentity(req);
      const result = service.grant({
        clientId: req.body && req.body.clientId,
        scope: req.body && req.body.scope,
        consentEvidenceRef: req.body && req.body.consentEvidenceRef,
        consentReceivedAt: req.body && req.body.consentReceivedAt,
        actor
      });
      return res.status(result.success ? 200 :
        result.status === "CONFLICT" ? 409 : 503).json(result);
    } catch (error) {
      const status = /REQUIRED|INVALID|NOT_SUPPORTED/.test(error.message) ? 400 : 503;
      return res.status(status).json({
        success: false,
        error: status === 400 ? error.message : "Consent operation refused."
      });
    }
  });

  router.post("/revoke", (req, res) => {
    try {
      const actor = actorIdentity(req);
      const result = service.revoke({
        clientId: req.body && req.body.clientId,
        scope: req.body && req.body.scope,
        actor
      });
      return res.status(result.success ? 200 :
        result.status === "CONFLICT" ? 409 : 503).json(result);
    } catch (error) {
      const status = /REQUIRED|INVALID|NOT_SUPPORTED/.test(error.message) ? 400 : 503;
      return res.status(status).json({
        success: false,
        error: status === 400 ? error.message : "Consent operation refused."
      });
    }
  });

  app.use(
    "/api/admin/mira-client-consent",
    requireAdminPermission(PERMISSIONS.SYSTEM_ADMIN),
    router
  );
}

registerMiraClientConsentRoutes.actorIdentity = actorIdentity;
module.exports = registerMiraClientConsentRoutes;
