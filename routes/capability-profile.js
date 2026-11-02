"use strict";

const express = require("express");

const {
  createProfileCapability,
  getCapability,
  listCapabilities,
  updateProfileCapability,
  verifyProfileCapability,
  createProfileSkill,
  listSkills,
  checkDependencies,
  getProfileSummary
} = require("../services/mira-capability-profile");

function registerCapabilityProfileRoutes(
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

  router.get(
    "/summary",
    requireSystemAdmin,
    (req, res) => {
      try {
        return res.json({
          success: true,
          summary:
            getProfileSummary()
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error:
            error.message
        });
      }
    }
  );

  router.get(
    "/capabilities",
    requireSystemAdmin,
    (req, res) => {
      try {
        return res.json({
          success: true,
          capabilities:
            listCapabilities({
              status:
                req.query.status,
              verification:
                req.query.verification,
              category:
                req.query.category
            })
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error:
            error.message
        });
      }
    }
  );

  router.get(
    "/capabilities/:id",
    requireSystemAdmin,
    (req, res) => {
      const capability =
        getCapability(
          String(req.params.id || "")
        );

      if (!capability) {
        return res.status(404).json({
          success: false,
          error:
            "Capability not found."
        });
      }

      return res.json({
        success: true,
        capability
      });
    }
  );

  router.post(
    "/capabilities",
    requireSystemAdmin,
    (req, res) => {
      try {
        const result =
          createProfileCapability(
            req.body || {}
          );

        return res.status(
          result.ok ? 201 : 409
        ).json({
          success:
            result.ok,
          ...result
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          status:
            "invalid_capability",
          error:
            error.message
        });
      }
    }
  );

  router.patch(
    "/capabilities/:id",
    requireSystemAdmin,
    (req, res) => {
      try {
        const result =
          updateProfileCapability(
            String(req.params.id || ""),
            req.body || {}
          );

        return res.status(
          result.ok ? 200 : 409
        ).json({
          success:
            result.ok,
          ...result
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          status:
            "invalid_capability_update",
          error:
            error.message
        });
      }
    }
  );

  router.get(
    "/capabilities/:id/dependencies",
    requireSystemAdmin,
    (req, res) => {
      return res.json({
        success: true,
        ...checkDependencies(
          String(req.params.id || "")
        )
      });
    }
  );

  router.post(
    "/capabilities/:id/verify",
    requireSystemAdmin,
    (req, res) => {
      try {
        const result =
          verifyProfileCapability(
            String(req.params.id || ""),
            req.body || {}
          );

        return res.status(
          result.ok ? 200 : 409
        ).json({
          success:
            result.ok,
          ...result
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          status:
            "verification_failed",
          error:
            error.message
        });
      }
    }
  );

  router.get(
    "/skills",
    requireSystemAdmin,
    (req, res) => {
      try {
        return res.json({
          success: true,
          skills:
            listSkills({
              verification:
                req.query.verification,
              category:
                req.query.category
            })
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error:
            error.message
        });
      }
    }
  );

  router.post(
    "/skills",
    requireSystemAdmin,
    (req, res) => {
      try {
        const result =
          createProfileSkill(
            req.body || {}
          );

        return res.status(
          result.ok ? 201 : 409
        ).json({
          success:
            result.ok,
          ...result
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          status:
            "invalid_skill",
          error:
            error.message
        });
      }
    }
  );

  app.use(
    "/api/admin/capability-profile",
    router
  );
}

module.exports =
  registerCapabilityProfileRoutes;
