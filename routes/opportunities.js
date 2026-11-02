"use strict";

const express = require("express");

const {
  createStoredOpportunity,
  getOpportunity,
  listOpportunities
} = require("../opportunity-store");

const {
  discoverOpportunity
} = require(
  "../services/mira-opportunity-discovery-engine"
);

const {
  evaluateOpportunity
} = require(
  "../services/mira-opportunity-match-policy-engine"
);

const {
  understandOpportunity
} = require(
  "../services/mira-opportunity-understanding-engine"
);

const {
  matchOpportunity
} = require(
  "../services/mira-opportunity-matching-engine"
);

const {
  evaluateOpportunityPolicy
} = require(
  "../services/mira-opportunity-risk-policy-service"
);

function registerOpportunityRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS
) {
  const router = express.Router();

  const requireAdmin =
    requireAdminPermission(
      PERMISSIONS.SYSTEM_ADMIN
    );

  router.get(
    "/",
    requireAdmin,
    (req, res) => {
      try {
        const opportunities =
          listOpportunities({
            status: req.query.status,
            type: req.query.type,
            risk: req.query.risk,
            source: req.query.source,
            domain: req.query.domain,
            matchStatus:
              req.query.matchStatus
          });

        return res.json({
          success: true,
          count: opportunities.length,
          opportunities
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
    "/:opportunityId",
    requireAdmin,
    (req, res) => {
      try {
        const opportunity =
          getOpportunity(
            req.params.opportunityId
          );

        if (!opportunity) {
          return res.status(404).json({
            success: false,
            error:
              "Opportunity not found"
          });
        }

        return res.json({
          success: true,
          opportunity
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  );

  router.post(
    "/discover",
    requireAdmin,
    (req, res) => {
      try {
        const opportunity =
          discoverOpportunity(
            req.body || {}
          );

        return res.status(201).json({
          success: true,
          opportunity
        });
      } catch (error) {
        if (
          error.code ===
          "DUPLICATE_OPPORTUNITY"
        ) {
          return res.status(409).json({
            success: false,
            error: error.message,
            code: error.code,
            existingOpportunity:
              error.existingOpportunity
          });
        }

        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
    }
  );

  router.post(
    "/:opportunityId/understand",
    requireAdmin,
    (req, res) => {
      try {
        const opportunity =
          getOpportunity(
            req.params.opportunityId
          );

        if (!opportunity) {
          return res.status(404).json({
            success: false,
            error:
              "Opportunity not found"
          });
        }

        const understanding =
          understandOpportunity({
            title:
              opportunity.title,
            description:
              opportunity.description,
            requirements:
              opportunity.requirements,
            skills:
              opportunity.skills
          });

        return res.json({
          success: true,
          opportunityId:
            opportunity.opportunityId,
          understanding:
            understanding.understanding,
          task:
            understanding.task,
          capabilityMatches:
            understanding.capabilityMatches,
          executionAllowed:
            false,
          understandingOnly:
            true
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
    }
  );

  router.post(
    "/:opportunityId/match",
    requireAdmin,
    (req, res) => {
      try {
        const result =
          matchOpportunity(
            req.params.opportunityId
          );

        return res.json({
          success: true,
          opportunityId:
            result.opportunityId,
          decision:
            result.decision,
          evidenceOnly:
            result.evidenceOnly,
          capability:
            result.capability,
          requirements:
            result.requirements,
          skills:
            result.skills,
          experience:
            result.experience,
          workload:
            result.workload,
          reasons:
            result.reasons
        });
      } catch (error) {
        if (
          error.message.includes(
            "Opportunity not found"
          )
        ) {
          return res.status(404).json({
            success: false,
            error: error.message
          });
        }

        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
    }
  );


  router.post(
    "/:opportunityId/policy-check",
    requireAdmin,
    (req, res) => {
      try {
        const opportunity =
          evaluateOpportunityPolicy(
            req.params.opportunityId
          );

        return res.json({
          success: true,
          opportunityId:
            opportunity.opportunityId,
          policy:
            opportunity.policy,
          governance:
            opportunity.governance,
          provenance:
            opportunity.provenance
        });
      } catch (error) {
        if (
          error.message.includes(
            "Opportunity not found"
          )
        ) {
          return res.status(404).json({
            success: false,
            error: error.message
          });
        }

        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
    }
  );

  router.post(
    "/:opportunityId/evaluate",
    requireAdmin,
    (req, res) => {
      try {
        const opportunity =
          evaluateOpportunity(
            req.params.opportunityId
          );

        return res.json({
          success: true,
          opportunity
        });
      } catch (error) {
        if (
          error.message.includes(
            "Opportunity not found"
          )
        ) {
          return res.status(404).json({
            success: false,
            error: error.message
          });
        }

        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
    }
  );

  app.use(
    "/api/admin/opportunities",
    router
  );
}

module.exports = {
  registerOpportunityRoutes
};
