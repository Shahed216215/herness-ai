"use strict";

const {
  getProposal,
  listPendingProposals,
  approveProposal,
  rejectProposal,
  markProposalApplied
} = require("../knowledge-improvement");

const {
  recordAudit,
  getAuditLog
} = require("../audit-log");

const crypto = require("crypto");

const {
  getKnowledge
} = require("../knowledge");

const {
  prepareEvolution,
  applyEvolution,
  rollbackEvolution,
  verifyEvolutionState
} = require("../knowledge-memory-evolution");

const {
  applyKnowledgeImprovementControlled
} = require("../knowledge-controlled-apply");

function writeAudit({
  actorRole,
  action,
  resourceId,
  status,
  details
}) {
  try {
    return recordAudit({
      actorRole,
      action,
      resource: "knowledge_improvement",
      resourceId,
      status,
      details
    });
  } catch (error) {
    return {
      logged: false,
      error: error.message
    };
  }
}

function registerKnowledgeImprovementRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS
) {
  app.get(
    "/api/admin/knowledge-improvements",
    requireAdminPermission(
      PERMISSIONS.SYSTEM_ADMIN
    ),
    (req, res) => {
      try {
        const proposals =
          listPendingProposals();

        res.json({
          success: true,
          count: proposals.length,
          proposals
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          reason:
            error.message ||
            "Failed to load improvement proposals."
        });
      }
    }
  );

  app.get(
    "/api/admin/knowledge-improvements/:id",
    requireAdminPermission(
      PERMISSIONS.SYSTEM_ADMIN
    ),
    (req, res) => {
      try {
        const proposal =
          getProposal(req.params.id);

        if (!proposal) {
          return res.status(404).json({
            success: false,
            reason:
              "Improvement proposal not found."
          });
        }

        return res.json({
          success: true,
          proposal
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          reason:
            error.message ||
            "Failed to load improvement proposal."
        });
      }
    }
  );

  app.post(
    "/api/admin/knowledge-improvements/:id/approve",
    requireAdminPermission(
      PERMISSIONS.SYSTEM_ADMIN
    ),
    (req, res) => {
      const id = req.params.id;

      try {
        const proposal =
          getProposal(id);

        if (!proposal) {
          writeAudit({
            actorRole: req.role,
            action:
              "KNOWLEDGE_IMPROVEMENT_APPROVE_FAILED",
            resourceId: id,
            status: "failed",
            details: {
              reason:
                "Improvement proposal not found."
            }
          });

          return res.status(404).json({
            success: false,
            reason:
              "Improvement proposal not found."
          });
        }

        const result =
          approveProposal(id);

        if (!result.success) {
          writeAudit({
            actorRole: req.role,
            action:
              "KNOWLEDGE_IMPROVEMENT_APPROVE_FAILED",
            resourceId: id,
            status: "failed",
            details: {
              reason: result.reason
            }
          });

          return res.status(400).json(
            result
          );
        }

        writeAudit({
          actorRole: req.role,
          action:
            "KNOWLEDGE_IMPROVEMENT_APPROVED",
          resourceId: id,
          status: "success",
          details: {
            title:
              proposal.existing?.title || "",
            topic:
              proposal.existing?.topic || ""
          }
        });

        return res.json({
          success: true,
          proposal:
            result.proposal
        });

      } catch (error) {
        writeAudit({
          actorRole: req.role,
          action:
            "KNOWLEDGE_IMPROVEMENT_APPROVE_FAILED",
          resourceId: id,
          status: "failed",
          details: {
            reason:
              error.message
          }
        });

        return res.status(500).json({
          success: false,
          reason:
            error.message ||
            "Failed to approve improvement proposal."
        });
      }
    }
  );

  app.post(
    "/api/admin/knowledge-improvements/:id/reject",
    requireAdminPermission(
      PERMISSIONS.SYSTEM_ADMIN
    ),
    (req, res) => {
      const id = req.params.id;

      try {
        const proposal =
          getProposal(id);

        if (!proposal) {
          writeAudit({
            actorRole: req.role,
            action:
              "KNOWLEDGE_IMPROVEMENT_REJECT_FAILED",
            resourceId: id,
            status: "failed",
            details: {
              reason:
                "Improvement proposal not found."
            }
          });

          return res.status(404).json({
            success: false,
            reason:
              "Improvement proposal not found."
          });
        }

        const result =
          rejectProposal(id);

        if (!result.success) {
          writeAudit({
            actorRole: req.role,
            action:
              "KNOWLEDGE_IMPROVEMENT_REJECT_FAILED",
            resourceId: id,
            status: "failed",
            details: {
              reason:
                result.reason
            }
          });

          return res.status(400).json(
            result
          );
        }

        writeAudit({
          actorRole: req.role,
          action:
            "KNOWLEDGE_IMPROVEMENT_REJECTED",
          resourceId: id,
          status: "success",
          details: {
            title:
              proposal.existing?.title || "",
            topic:
              proposal.existing?.topic || ""
          }
        });

        return res.json({
          success: true,
          proposal:
            result.proposal
        });

      } catch (error) {
        writeAudit({
          actorRole: req.role,
          action:
            "KNOWLEDGE_IMPROVEMENT_REJECT_FAILED",
          resourceId: id,
          status: "failed",
          details: {
            reason:
              error.message
          }
        });

        return res.status(500).json({
          success: false,
          reason:
            error.message ||
            "Failed to reject improvement proposal."
        });
      }
    }
  );

  /*
   * Controlled Knowledge Improvement Apply
   *
   * The route itself remains admin-only.
   * All actual modification work is delegated
   * to the controlled apply engine.
   */

  app.post(
    "/api/admin/knowledge-improvements/:id/apply",
    requireAdminPermission(
      PERMISSIONS.SYSTEM_ADMIN
    ),
    async (req, res) => {
      const id = req.params.id;
      const actor =
        req.role || "system-admin";

      try {
        const proposal = getProposal(id);

        if (!proposal) {
          return res.status(404).json({
            success: false,
            applied: false,
            reason:
              "Improvement proposal not found."
          });
        }

        if (proposal.status !== "approved") {
          return res.status(400).json({
            success: false,
            applied: false,
            blocked: true,
            reason:
              `Proposal must be approved before apply. Current status: ${proposal.status}`
          });
        }

        const currentKnowledge =
          getKnowledge();

        if (!Array.isArray(currentKnowledge)) {
          throw new Error(
            "Current knowledge state is invalid."
          );
        }

        const existingIndex =
          currentKnowledge.findIndex(item =>
            String(item.title || "")
              .trim()
              .toLowerCase() ===
              String(proposal.existing?.title || "")
                .trim()
                .toLowerCase() &&
            String(item.topic || "")
              .trim()
              .toLowerCase() ===
              String(proposal.existing?.topic || "")
                .trim()
                .toLowerCase()
          );

        if (existingIndex < 0) {
          return res.status(409).json({
            success: false,
            applied: false,
            controlled: true,
            status:
              "original_knowledge_not_found"
          });
        }

        const existing =
          currentKnowledge[existingIndex];

        const currentContentHash =
          crypto
            .createHash("sha256")
            .update(
              String(existing.content || ""),
              "utf8"
            )
            .digest("hex");

        if (
          !proposal.existing?.contentHash ||
          currentContentHash !==
            proposal.existing.contentHash
        ) {
          return res.status(409).json({
            success: false,
            applied: false,
            controlled: true,
            status: "stale_proposal",
            reason:
              "Knowledge content changed after proposal creation."
          });
        }

        const proposedState =
          currentKnowledge.map(
            (item, index) =>
              index === existingIndex
                ? {
                    ...item,
                    ...proposal.proposed
                  }
                : item
          );

        const expectedPreStateHash =
          crypto
            .createHash("sha256")
            .update(
              JSON.stringify(currentKnowledge),
              "utf8"
            )
            .digest("hex");

        const evolutionProposal = {
          id,
          status: "approved",
          target: "knowledge",
          expectedPreStateHash,
          proposedState
        };

        const prepared =
          await prepareEvolution(
            evolutionProposal,
            { actor }
          );

        if (!prepared || prepared.ok !== true) {
          return res.status(409).json({
            success: false,
            applied: false,
            controlled: true,
            stage: "prepare",
            status:
              prepared?.status ||
              "prepare_failed",
            reason:
              prepared?.reason ||
              prepared?.message ||
              prepared?.error ||
              "Stage 4.12 preparation failed."
          });
        }

        const applyResult =
          await applyEvolution(
            evolutionProposal,
            { actor }
          );

        if (
          !applyResult ||
          applyResult.ok !== true
        ) {
          return res.status(500).json({
            success: false,
            applied: false,
            controlled: true,
            stage: "apply",
            status:
              applyResult?.status ||
              "apply_failed",
            reason:
              applyResult?.reason ||
              applyResult?.message ||
              applyResult?.error ||
              "Stage 4.12 apply failed.",
            changeId:
              applyResult?.changeId || null,
            snapshotId:
              applyResult?.snapshotId || null,
            rollback:
              applyResult?.rollback || null
          });
        }

        const verification =
          await verifyEvolutionState(
            "knowledge"
          );

        if (
          !verification ||
          verification.ok !== true
        ) {
          let rollback = null;

          if (
            applyResult.changeId &&
            applyResult.snapshotId
          ) {
            rollback =
              await rollbackEvolution({
                target: "knowledge",
                changeId:
                  applyResult.changeId,
                snapshotId:
                  applyResult.snapshotId,
                proposalId: id,
                restoredBy: actor
              });
          }

          return res.status(500).json({
            success: false,
            applied: false,
            controlled: true,
            status:
              "final_verification_failed",
            verification,
            rollback
          });
        }

        const markResult =
          markProposalApplied(id);

        if (
          !markResult ||
          markResult.success !== true
        ) {
          let rollback = null;

          if (
            applyResult.changeId &&
            applyResult.snapshotId
          ) {
            rollback =
              await rollbackEvolution({
                target: "knowledge",
                changeId:
                  applyResult.changeId,
                snapshotId:
                  applyResult.snapshotId,
                proposalId: id,
                restoredBy: actor
              });
          }

          return res.status(500).json({
            success: false,
            applied: false,
            controlled: true,
            status:
              "proposal_commit_failed",
            rollback
          });
        }

        writeAudit({
          actorRole: req.role,
          action:
            "KNOWLEDGE_IMPROVEMENT_APPLIED",
          resourceId: id,
          status: "success",
          details: {
            stage: "4.12",
            changeId:
              applyResult.changeId || null,
            snapshotId:
              applyResult.snapshotId || null,
            verification
          }
        });

        return res.json({
          success: true,
          applied: true,
          controlled: true,
          stage: "4.12",
          status:
            applyResult.status ||
            "applied_verified",
          proposal:
            markResult.proposal,
          changeId:
            applyResult.changeId || null,
          snapshotId:
            applyResult.snapshotId || null,
          verification
        });
      } catch (error) {
        writeAudit({
          actorRole: req.role,
          action:
            "KNOWLEDGE_IMPROVEMENT_APPLY_FAILED",
          resourceId: id,
          status: "failed",
          details: {
            reason: error.message
          }
        });

        return res.status(500).json({
          success: false,
          applied: false,
          controlled: true,
          reason:
            error.message ||
            "Failed to apply improvement proposal."
        });
      }
    }
  );

  app.get(
    "/api/admin/audit-log",
    requireAdminPermission(
      PERMISSIONS.AUDIT_LOG
    ),
    (req, res) => {
      try {
        const requestedLimit =
          Number(req.query.limit);

        const limit =
          Number.isFinite(requestedLimit)
            ? Math.min(
                Math.max(
                  Math.floor(requestedLimit),
                  1
                ),
                500
              )
            : 100;

        const entries =
          getAuditLog(limit);

        return res.json({
          success: true,
          count: entries.length,
          entries
        });

      } catch (error) {
        return res.status(500).json({
          success: false,
          reason:
            error.message ||
            "Failed to load audit log."
        });
      }
    }
  );
}

module.exports =
  registerKnowledgeImprovementRoutes;
