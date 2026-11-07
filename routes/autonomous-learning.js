"use strict";

const express = require("express");

const {
  createAutonomousProposal
} = require("../autonomous-learning-engine");

const {
  createProposal,
  editProposal,
  getProposal,
  listProposals,
  approveProposal,
  rejectProposal,
  getProposalStats
} = require("../autonomous-learning-proposals");

const {
  applyAutonomousLearningControlled
} = require("../autonomous-learning-controlled-apply");

const {
  recordAudit
} = require("../audit-log");

function writeAudit({
  actorRole,
  action,
  resourceId = "",
  status = "success",
  details = {}
}) {
  return recordAudit({
    actorRole:
      actorRole || "unknown",

    action,

    resource:
      "autonomous_learning",

    resourceId,

    status,

    details
  });
}

function getActor(req) {
  return (
    req.role ||
    "admin"
  );
}

function registerAutonomousLearningRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS
) {
  const router =
    express.Router();

  // This router is backed by legacy proposal storage and controlled apply.
  // HFM grants memory.read only, so block every legacy endpoint before route
  // handlers can read or mutate proposal/Knowledge state.
  router.use((req, res, next) => {
    if (process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === "true" ||
        process.env.MIRA_HFM_WORK_LEARNING_ENABLED === "true") {
      return res.status(403).json({
        success: false,
        blocked: true,
        code: "HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_AUTONOMOUS_LEARNING",
        reason: "HFM standing authority grants memory.read only; legacy autonomous Learning routes are unavailable."
      });
    }
    return next();
  });

  const requireSystemAdmin =
    requireAdminPermission(
      PERMISSIONS.SYSTEM_ADMIN
    );

  /*
   * GET proposal statistics
   */
  router.get(
    "/stats",
    requireSystemAdmin,
    (req, res) => {
      try {
        return res.json({
          success: true,
          stats:
            getProposalStats()
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error:
            "Failed to load autonomous learning statistics."
        });
      }
    }
  );

  /*
   * GET proposals
   *
   * Optional:
   * ?status=pending
   * ?limit=50
   */
  router.get(
    "/proposals",
    requireSystemAdmin,
    (req, res) => {
      try {
        const status =
          req.query.status
            ? String(
                req.query.status
              )
            : undefined;

        const requestedLimit =
          Number(
            req.query.limit
          );

        const limit =
          Number.isFinite(
            requestedLimit
          )
            ? Math.min(
                Math.max(
                  Math.floor(
                    requestedLimit
                  ),
                  1
                ),
                200
              )
            : 50;

        const proposals =
          listProposals({
            status,
            limit
          });

        return res.json({
          success: true,
          count:
            proposals.length,
          proposals
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error:
            error.message ||
            "Failed to load autonomous learning proposals."
        });
      }
    }
  );

  /*
   * GET one proposal
   */
  router.get(
    "/proposals/:id",
    requireSystemAdmin,
    (req, res) => {
      try {
        const id =
          String(
            req.params.id || ""
          ).trim();

        const proposal =
          getProposal(id);

        if (!proposal) {
          return res.status(404).json({
            success: false,
            error:
              "Proposal not found."
          });
        }

        return res.json({
          success: true,
          proposal
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error:
            "Failed to load proposal."
        });
      }
    }
  );

  /*
   * CREATE autonomous proposal
   *
   * This performs public research and
   * creates a PENDING proposal only.
   *
   * It does NOT modify knowledge.json.
   */
  router.post(
    "/proposal",
    requireSystemAdmin,
    async (req, res) => {
      const actor =
        getActor(req);

      const topic =
        String(
          req.body?.topic || ""
        ).trim();

      if (!topic) {
        writeAudit({
          actorRole: actor,
          action:
            "AUTONOMOUS_PROPOSAL_CREATE_BLOCKED",
          status: "blocked",
          details: {
            reason:
              "topic_required"
          }
        });

        return res.status(400).json({
          success: false,
          status:
            "topic_required",
          error:
            "topic is required."
        });
      }

      try {
        const result =
          await createAutonomousProposal({
            topic
          });

        const proposalId =
          result?.proposal?.id ||
          null;

        writeAudit({
          actorRole: actor,
          action:
            result.status ===
            "proposal_created"
              ? "AUTONOMOUS_PROPOSAL_CREATED"
              : "AUTONOMOUS_PROPOSAL_CREATE_DUPLICATE",
          resourceId:
            proposalId || "",
          status:
            result.status ===
            "proposal_created"
              ? "success"
              : "blocked",
          details: {
            topic:
              topic.slice(0, 500),
            status:
              result.status,
            sourceCount:
              result.research?.sourceCount ||
              0
          }
        });

        return res.status(
          result.success
            ? 201
            : 409
        ).json(result);
      } catch (error) {
        writeAudit({
          actorRole: actor,
          action:
            "AUTONOMOUS_PROPOSAL_CREATE_FAILED",
          status: "failed",
          details: {
            topic:
              topic.slice(0, 500),
            reason:
              error.message
          }
        });

        return res.status(500).json({
          success: false,
          status:
            "proposal_creation_failed",
          error:
            error.message ||
            "Failed to create autonomous learning proposal."
        });
      }
    }
  );

  /*
   * CREATE ADMIN KNOWLEDGE PROPOSAL
   *
   * Admin can manually submit legitimate
   * educational knowledge.
   *
   * IMPORTANT:
   * This creates a PENDING proposal only.
   * It does NOT modify knowledge.json.
   *
   * Required:
   * title
   * topic
   * content
   *
   * Optional:
   * category
   * track
   * difficulty
   * concept
   * technique
   * safeLabExample
   * defense
   * detection
   * sources
   * researchSummary
   * selectedTopic
   * researchMethod
   */
  router.post(
    "/admin-proposal",
    requireSystemAdmin,
    (req, res) => {
      const actor =
        getActor(req);

      const body =
        req.body || {};

      const learning =
        body.learning &&
        typeof body.learning === "object"
          ? body.learning
          : body;

      const title =
        String(
          learning.title || ""
        ).trim();

      const topic =
        String(
          learning.topic || ""
        ).trim();

      const content =
        String(
          learning.content || ""
        ).trim();

      if (!title) {
        writeAudit({
          actorRole: actor,
          action:
            "ADMIN_KNOWLEDGE_PROPOSAL_CREATE_BLOCKED",
          status: "blocked",
          details: {
            reason:
              "title_required"
          }
        });

        return res.status(400).json({
          success: false,
          status:
            "title_required",
          error:
            "title is required."
        });
      }

      if (!topic) {
        writeAudit({
          actorRole: actor,
          action:
            "ADMIN_KNOWLEDGE_PROPOSAL_CREATE_BLOCKED",
          status: "blocked",
          details: {
            reason:
              "topic_required"
          }
        });

        return res.status(400).json({
          success: false,
          status:
            "topic_required",
          error:
            "topic is required."
        });
      }

      if (!content) {
        writeAudit({
          actorRole: actor,
          action:
            "ADMIN_KNOWLEDGE_PROPOSAL_CREATE_BLOCKED",
          status: "blocked",
          details: {
            reason:
              "content_required"
          }
        });

        return res.status(400).json({
          success: false,
          status:
            "content_required",
          error:
            "content is required."
        });
      }

      try {
        const result =
          createProposal({
            learning: {
              title,
              topic,
              content,

              category:
                learning.category,

              track:
                learning.track,

              difficulty:
                learning.difficulty,

              concept:
                learning.concept,

              technique:
                learning.technique,

              safeLabExample:
                learning.safeLabExample,

              defense:
                learning.defense,

              detection:
                learning.detection,

              tags:
                Array.isArray(
                  learning.tags
                )
                  ? learning.tags
                  : []
            },

            sources:
              Array.isArray(
                body.sources
              )
                ? body.sources
                : [],

            researchSummary:
              body.researchSummary,

            selectedTopic:
              body.selectedTopic ||
              topic,

            researchMethod:
              body.researchMethod ||
              "admin_manual",

            proposalSource:
              "admin",

            createdBy:
              actor
          });

        const proposalId =
          result?.proposal?.id ||
          null;

        if (
          result.duplicate
        ) {
          writeAudit({
            actorRole: actor,
            action:
              "ADMIN_KNOWLEDGE_PROPOSAL_CREATE_DUPLICATE",
            resourceId:
              proposalId || "",
            status: "blocked",
            details: {
              title:
                title.slice(0, 500),
              topic:
                topic.slice(0, 500)
            }
          });

          return res.status(409).json({
            success: false,
            status:
              "duplicate_proposal",
            duplicate: true,
            error:
              "A pending, approved, or applied proposal with the same title and topic already exists.",
            proposal:
              result.proposal
          });
        }

        writeAudit({
          actorRole: actor,
          action:
            "ADMIN_KNOWLEDGE_PROPOSAL_CREATED",
          resourceId:
            proposalId || "",
          status: "success",
          details: {
            title:
              title.slice(0, 500),
            topic:
              topic.slice(0, 500),
            proposalSource:
              "admin",
            status:
              result.proposal?.status ||
              "pending"
          }
        });

        return res.status(201).json({
          success: true,
          status:
            "proposal_created",
          proposal:
            result.proposal
        });
      } catch (error) {
        writeAudit({
          actorRole: actor,
          action:
            "ADMIN_KNOWLEDGE_PROPOSAL_CREATE_FAILED",
          status: "failed",
          details: {
            title:
              title.slice(0, 500),
            topic:
              topic.slice(0, 500),
            reason:
              error.message
          }
        });

        return res.status(400).json({
          success: false,
          status:
            "proposal_creation_failed",
          error:
            error.message ||
            "Failed to create admin knowledge proposal."
        });
      }
    }
  );

  /*
   * APPROVE proposal
   */
  /*
   * EDIT pending proposal
   *
   * Pending proposals may be edited by
   * a system admin before approval.
   */
  router.post(
    "/proposals/:id/edit",
    requireSystemAdmin,
    (req, res) => {
      try {
        const id =
          req.params.id;

        const body =
          req.body || {};

        const learning =
          body.learning &&
          typeof body.learning === "object"
            ? body.learning
            : body;

        const actor =
          getActor(req);

        const result =
          editProposal(
            id,
            {
              learning,
              sources:
                Array.isArray(body.sources)
                  ? body.sources
                  : [],
              researchSummary:
                body.researchSummary,
              selectedTopic:
                body.selectedTopic ||
                learning.topic,
              researchMethod:
                body.researchMethod ||
                "admin_manual"
            },
            actor
          );

        if (!result.success) {
          writeAudit({
            actorRole: actor,
            action:
              "ADMIN_KNOWLEDGE_PROPOSAL_EDITED",
            resourceId: id,
            status: "blocked",
            details: {
              resultStatus:
                result.status,
              error:
                result.error || ""
            }
          });

          const statusCode =
            result.status ===
            "proposal_not_found"
              ? 404
              : result.status ===
                "validation_error"
                ? 400
                : 409;

          return res.status(statusCode).json({
            success: false,
            status: result.status,
            error:
              result.error ||
              "Proposal could not be edited.",
            currentStatus:
              result.currentStatus
          });
        }

        writeAudit({
          actorRole: actor,
          action:
            "ADMIN_KNOWLEDGE_PROPOSAL_EDITED",
          resourceId: id,
          status: "success",
          details: {
            title:
              result.proposal?.learning?.title ||
              "",
            topic:
              result.proposal?.learning?.topic ||
              "",
            difficulty:
              result.proposal?.learning?.difficulty ||
              ""
          }
        });

        return res.json({
          success: true,
          status: "edited",
          proposal:
            result.proposal
        });
      } catch (error) {
        writeAudit({
          actorRole:
            getActor(req),
          action:
            "ADMIN_KNOWLEDGE_PROPOSAL_EDITED",
          resourceId:
            req.params.id,
          status: "failed",
          details: {
            error:
              error.message
          }
        });

        return res.status(500).json({
          success: false,
          status: "edit_failed",
          error:
            "Failed to edit proposal."
        });
      }
    }
  );

  router.post(
    "/proposals/:id/approve",
    requireSystemAdmin,
    (req, res) => {
      const actor =
        getActor(req);

      const id =
        String(
          req.params.id || ""
        ).trim();

      if (!id) {
        return res.status(400).json({
          success: false,
          error:
            "Proposal ID is required."
        });
      }

      try {
        const result =
          approveProposal(
            id,
            actor
          );

        if (!result.success) {
          writeAudit({
            actorRole: actor,
            action:
              "AUTONOMOUS_PROPOSAL_APPROVE_BLOCKED",
            resourceId: id,
            status: "blocked",
            details: {
              reason:
                result.status,
              currentStatus:
                result.currentStatus ||
                null
            }
          });

          return res.status(
            result.status ===
            "proposal_not_found"
              ? 404
              : 409
          ).json(result);
        }

        const proposal =
          result.proposal;

        writeAudit({
          actorRole: actor,
          action:
            "AUTONOMOUS_PROPOSAL_APPROVED",
          resourceId: id,
          status: "success",
          details: {
            topic:
              String(
                proposal?.selectedTopic ||
                proposal?.learning?.topic ||
                ""
              ).slice(0, 500),
            title:
              String(
                proposal?.learning?.title ||
                ""
              ).slice(0, 500)
          }
        });

        return res.json({
          success: true,
          status:
            "approved",
          proposal
        });
      } catch (error) {
        writeAudit({
          actorRole: actor,
          action:
            "AUTONOMOUS_PROPOSAL_APPROVE_FAILED",
          resourceId: id,
          status: "failed",
          details: {
            reason:
              error.message
          }
        });

        return res.status(500).json({
          success: false,
          error:
            error.message ||
            "Failed to approve proposal."
        });
      }
    }
  );

  /*
   * REJECT proposal
   */
  router.post(
    "/proposals/:id/reject",
    requireSystemAdmin,
    (req, res) => {
      const actor =
        getActor(req);

      const id =
        String(
          req.params.id || ""
        ).trim();

      const reason =
        String(
          req.body?.reason || ""
        ).trim();

      if (!id) {
        return res.status(400).json({
          success: false,
          error:
            "Proposal ID is required."
        });
      }

      try {
        const result =
          rejectProposal(
            id,
            actor,
            reason
          );

        if (!result.success) {
          writeAudit({
            actorRole: actor,
            action:
              "AUTONOMOUS_PROPOSAL_REJECT_BLOCKED",
            resourceId: id,
            status: "blocked",
            details: {
              reason:
                result.status,
              currentStatus:
                result.currentStatus ||
                null
            }
          });

          return res.status(
            result.status ===
            "proposal_not_found"
              ? 404
              : 409
          ).json(result);
        }

        writeAudit({
          actorRole: actor,
          action:
            "AUTONOMOUS_PROPOSAL_REJECTED",
          resourceId: id,
          status: "success",
          details: {
            reason:
              reason.slice(0, 500)
          }
        });

        return res.json({
          success: true,
          status:
            "rejected",
          proposal:
            result.proposal
        });
      } catch (error) {
        writeAudit({
          actorRole: actor,
          action:
            "AUTONOMOUS_PROPOSAL_REJECT_FAILED",
          resourceId: id,
          status: "failed",
          details: {
            reason:
              error.message
          }
        });

        return res.status(500).json({
          success: false,
          error:
            error.message ||
            "Failed to reject proposal."
        });
      }
    }
  );

  /*
   * CONTROLLED APPLY
   *
   * Only an APPROVED proposal can reach
   * the controlled engine.
   *
   * The controlled engine handles:
   * snapshot
   * local apply
   * Drive sync
   * verification
   * rollback on failure
   */
  router.post(
    "/proposals/:id/apply",
    requireSystemAdmin,
    async (req, res) => {
      const actor =
        getActor(req);

      const id =
        String(
          req.params.id || ""
        ).trim();

      if (!id) {
        return res.status(400).json({
          success: false,
          error:
            "Proposal ID is required."
        });
      }

      const proposal =
        getProposal(id);

      if (!proposal) {
        writeAudit({
          actorRole: actor,
          action:
            "AUTONOMOUS_APPLY_BLOCKED",
          resourceId: id,
          status: "blocked",
          details: {
            reason:
              "proposal_not_found"
          }
        });

        return res.status(404).json({
          success: false,
          status:
            "proposal_not_found",
          error:
            "Proposal not found."
        });
      }

      if (
        proposal.status !==
        "approved"
      ) {
        writeAudit({
          actorRole: actor,
          action:
            "AUTONOMOUS_APPLY_BLOCKED",
          resourceId: id,
          status: "blocked",
          details: {
            reason:
              "approval_required",
            currentStatus:
              proposal.status
          }
        });

        return res.status(409).json({
          success: false,
          status:
            "approval_required",
          error:
            `Proposal status is ${proposal.status}; approved status is required.`
        });
      }

      writeAudit({
        actorRole: actor,
        action:
          "AUTONOMOUS_APPLY_STARTED",
        resourceId: id,
        status: "success",
        details: {
          topic:
            String(
              proposal.selectedTopic ||
              proposal.learning?.topic ||
              ""
            ).slice(0, 500),
          title:
            String(
              proposal.learning?.title ||
              ""
            ).slice(0, 500)
        }
      });

      try {
        const result =
          await applyAutonomousLearningControlled({
            changeId: id,
            actor
          });

        if (!result.ok) {
          writeAudit({
            actorRole: actor,
            action:
              "AUTONOMOUS_APPLY_FAILED",
            resourceId: id,
            status: "failed",
            details: {
              status:
                result.status,
              error:
                result.error,
              snapshotId:
                result.snapshotId ||
                null,
              rollbackStatus:
                result.rollback?.status ||
                null,
              rollbackOk:
                result.rollback?.ok ??
                null
            }
          });

          return res.status(500).json({
            success: false,
            ...result
          });
        }

        writeAudit({
          actorRole: actor,
          action:
            "AUTONOMOUS_APPLY_VERIFIED",
          resourceId: id,
          status: "success",
          details: {
            snapshotId:
              result.snapshotId ||
              null,
            knowledgeCount:
              result.knowledgeCount,
            appliedLearningId:
              result.appliedLearningId ||
              null,
            driveSynced:
              result.driveSynced === true,
            verified:
              result.verified === true
          }
        });

        return res.json({
          success: true,
          ...result
        });
      } catch (error) {
        writeAudit({
          actorRole: actor,
          action:
            "AUTONOMOUS_APPLY_FAILED",
          resourceId: id,
          status: "failed",
          details: {
            error:
              error.message
          }
        });

        return res.status(500).json({
          success: false,
          status:
            "autonomous_apply_failed",
          error:
            error.message ||
            "Failed to apply autonomous learning proposal."
        });
      }
    }
  );

  app.use(
    "/api/admin/autonomous-learning",
    router
  );
}

module.exports =
  registerAutonomousLearningRoutes;
