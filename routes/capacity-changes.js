const express = require("express");

const {
  createProposal,
  getProposal,
  listPendingProposals,
  approveProposal,
  rejectProposal,
  markApplied,
  loadProposals
} = require("../capacity-change");

const {
  getCapacity,
  setCapacity,
  getAllCapacities
} = require("../capacity-config");

const {
  recordAudit,
  getAuditLog
} = require("../audit-log");

function writeAudit({
  actorRole,
  action,
  resourceId,
  status = "success",
  details = {}
}) {
  return recordAudit({
    actorRole,
    action,
    resource: "capacity_change",
    resourceId,
    status,
    details
  });
}

function registerCapacityChangeRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS
) {
  const router =
    express.Router();

  const requireCapacityAdmin =
    requireAdminPermission(
      PERMISSIONS.CAPACITY_ADMIN
    );

  /*
   * GET all capacity changes
   */
  router.get(
    "/",
    requireCapacityAdmin,
    (req, res) => {
      try {
        const proposals =
          loadProposals();

        res.json({
          success: true,
          capacities:
            getAllCapacities(),
          proposals:
            proposals
              .slice()
              .reverse()
        });
      } catch (error) {
        res.status(500).json({
          error:
            "Failed to load capacity changes."
        });
      }
    }
  );

  /*
   * Recent audit records for capacity changes
   */
  router.get(
    "/audit/recent",
    requireCapacityAdmin,
    (req, res) => {
      try {
        const entries =
          getAuditLog(100)
            .filter(
              entry =>
                entry.resource ===
                "capacity_change"
            );

        return res.json({
          success: true,
          entries
        });
      } catch (error) {
        return res.status(500).json({
          error:
            "Failed to load capacity audit log."
        });
      }
    }
  );

  /*
   * GET one proposal
   */
  router.get(
    "/:id",
    requireCapacityAdmin,
    (req, res) => {
      try {
        const proposal =
          getProposal(req.params.id);

        if (!proposal) {
          return res.status(404).json({
            error:
              "Capacity change proposal not found."
          });
        }

        return res.json({
          success: true,
          proposal
        });
      } catch (error) {
        return res.status(500).json({
          error:
            "Failed to load capacity change proposal."
        });
      }
    }
  );

  /*
   * CREATE PROPOSAL
   *
   * Proposal does NOT change capacity.
   */
  router.post(
    "/",
    requireCapacityAdmin,
    (req, res) => {
      try {
        const {
          target,
          requestedCapacity,
          reason,
          source
        } = req.body || {};

        const currentCapacity =
          getCapacity(target);

        const result =
          createProposal({
            target,
            currentCapacity,
            requestedCapacity,
            reason,
            source
          });

        writeAudit({
          actorRole:
            req.role || "admin",
          action:
            result.duplicate
              ? "capacity_proposal_duplicate"
              : "capacity_proposal_created",
          resourceId:
            result.proposal.id,
          details: {
            target:
              result.proposal.target,
            currentCapacity:
              result.proposal.currentCapacity,
            requestedCapacity:
              result.proposal.requestedCapacity,
            reason:
              result.proposal.reason
          }
        });

        return res.status(
          result.duplicate
            ? 200
            : 201
        ).json({
          success: true,
          duplicate:
            result.duplicate,
          proposal:
            result.proposal
        });
      } catch (error) {
        return res.status(400).json({
          error:
            error.message
        });
      }
    }
  );

  /*
   * APPROVE PROPOSAL
   *
   * Approval does NOT change capacity.
   */
  router.post(
    "/:id/approve",
    requireCapacityAdmin,
    (req, res) => {
      try {
        const proposal =
          getProposal(req.params.id);

        if (!proposal) {
          return res.status(404).json({
            error:
              "Capacity change proposal not found."
          });
        }

        const actualCapacity =
          getCapacity(
            proposal.target
          );

        if (
          actualCapacity !==
          proposal.currentCapacity
        ) {
          writeAudit({
            actorRole:
              req.role || "admin",
            action:
              "capacity_proposal_approval_conflict",
            resourceId:
              proposal.id,
            status:
              "conflict",
            details: {
              target:
                proposal.target,
              expectedCapacity:
                proposal.currentCapacity,
              actualCapacity
            }
          });

          return res.status(409).json({
            error:
              "Proposal is stale because the current capacity has changed."
          });
        }

        const approved =
          approveProposal(
            proposal.id
          );

        writeAudit({
          actorRole:
            req.role || "admin",
          action:
            "capacity_proposal_approved",
          resourceId:
            approved.id,
          details: {
            target:
              approved.target,
            currentCapacity:
              approved.currentCapacity,
            requestedCapacity:
              approved.requestedCapacity
          }
        });

        return res.json({
          success: true,
          capacityChanged: false,
          proposal: approved
        });
      } catch (error) {
        return res.status(400).json({
          error:
            error.message
        });
      }
    }
  );

  /*
   * REJECT PROPOSAL
   */
  router.post(
    "/:id/reject",
    requireCapacityAdmin,
    (req, res) => {
      try {
        const proposal =
          getProposal(req.params.id);

        if (!proposal) {
          return res.status(404).json({
            error:
              "Capacity change proposal not found."
          });
        }

        const rejected =
          rejectProposal(
            proposal.id
          );

        writeAudit({
          actorRole:
            req.role || "admin",
          action:
            "capacity_proposal_rejected",
          resourceId:
            rejected.id,
          details: {
            target:
              rejected.target,
            currentCapacity:
              rejected.currentCapacity,
            requestedCapacity:
              rejected.requestedCapacity
          }
        });

        return res.json({
          success: true,
          proposal: rejected
        });
      } catch (error) {
        return res.status(400).json({
          error:
            error.message
        });
      }
    }
  );

  /*
   * APPLY APPROVED PROPOSAL
   */
  router.post(
    "/:id/apply",
    requireCapacityAdmin,
    (req, res) => {
      try {
        const proposal =
          getProposal(req.params.id);

        if (!proposal) {
          return res.status(404).json({
            error:
              "Capacity change proposal not found."
          });
        }

        if (
          proposal.status !==
          "approved"
        ) {
          return res.status(400).json({
            error:
              "Only approved proposals can be applied."
          });
        }

        const actualCapacity =
          getCapacity(
            proposal.target
          );

        if (
          actualCapacity !==
          proposal.currentCapacity
        ) {
          writeAudit({
            actorRole:
              req.role || "admin",
            action:
              "capacity_apply_conflict",
            resourceId:
              proposal.id,
            status:
              "conflict",
            details: {
              target:
                proposal.target,
              expectedCapacity:
                proposal.currentCapacity,
              actualCapacity
            }
          });

          return res.status(409).json({
            error:
              "Apply blocked because the current capacity no longer matches the approved proposal."
          });
        }

        const changed =
          setCapacity(
            proposal.target,
            proposal.requestedCapacity
          );

        let applied;

        try {
          applied =
            markApplied(
              proposal.id
            );
        } catch (markError) {
          try {
            setCapacity(
              proposal.target,
              proposal.currentCapacity
            );
          } catch (rollbackError) {
            writeAudit({
              actorRole:
                req.role || "admin",
              action:
                "capacity_apply_recovery_failed",
              resourceId:
                proposal.id,
              status:
                "error",
              details: {
                target:
                  proposal.target,
                recoveryError:
                  rollbackError.message
              }
            });
          }

          throw markError;
        }

        writeAudit({
          actorRole:
            req.role || "admin",
          action:
            "capacity_applied",
          resourceId:
            applied.id,
          details: {
            target:
              changed.target,
            previousCapacity:
              changed.previousCapacity,
            requestedCapacity:
              changed.requestedCapacity
          }
        });

        return res.json({
          success: true,
          capacityChanged: true,
          previousCapacity:
            changed.previousCapacity,
          currentCapacity:
            changed.requestedCapacity,
          proposal: applied
        });
      } catch (error) {
        return res.status(400).json({
          error:
            error.message
        });
      }
    }
  );

  /*
   * ROLLBACK APPLIED PROPOSAL
   */
  router.post(
    "/:id/rollback",
    requireCapacityAdmin,
    (req, res) => {
      try {
        const proposal =
          getProposal(req.params.id);

        if (!proposal) {
          return res.status(404).json({
            error:
              "Capacity change proposal not found."
          });
        }

        if (
          proposal.status !==
          "applied"
        ) {
          return res.status(400).json({
            error:
              "Only applied proposals can be rolled back."
          });
        }

        const actualCapacity =
          getCapacity(
            proposal.target
          );

        if (
          actualCapacity !==
          proposal.requestedCapacity
        ) {
          writeAudit({
            actorRole:
              req.role || "admin",
            action:
              "capacity_rollback_conflict",
            resourceId:
              proposal.id,
            status:
              "conflict",
            details: {
              target:
                proposal.target,
              expectedCapacity:
                proposal.requestedCapacity,
              actualCapacity
            }
          });

          return res.status(409).json({
            error:
              "Rollback blocked because the current capacity has changed since apply."
          });
        }

        const changed =
          setCapacity(
            proposal.target,
            proposal.currentCapacity
          );

        const rolledBack =
          markRolledBack(
            proposal.id
          );

        writeAudit({
          actorRole:
            req.role || "admin",
          action:
            "capacity_rolled_back",
          resourceId:
            rolledBack.id,
          details: {
            target:
              changed.target,
            restoredCapacity:
              changed.requestedCapacity,
            previousAppliedCapacity:
              changed.previousCapacity
          }
        });

        return res.json({
          success: true,
          capacityChanged: true,
          restoredCapacity:
            changed.requestedCapacity,
          proposal:
            rolledBack
        });
      } catch (error) {
        return res.status(400).json({
          error:
            error.message
        });
      }
    }
  );

  app.use(
    "/api/admin/capacity-changes",
    router
  );
}

function markRolledBack(id) {
  const {
    updateProposal
  } = require("../capacity-change");

  return updateProposal(
    id,
    current => ({
      ...current,
      status: "rolled_back",
      rolledBackAt:
        new Date().toISOString()
    })
  );
}

module.exports =
  registerCapacityChangeRoutes;
