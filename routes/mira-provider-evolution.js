"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");

const {
  createProposal,
  getProposal,
  listProposals,
  moveToPendingApproval,
  approveProposal,
  completeProposal
} = require("../change-management");

const {
  recordAudit
} = require("../audit-log");

const {
  validateProviderConfiguration,
  testProviderHealth,
  buildSafeAuditDetails,
  scanSecretSafety
} = require("../services/mira-provider-evolution");

const providerCredentialStore = require("../services/provider-credential-store");

const router = express.Router();

const RUNTIME_CONFIG_PATH = path.join(
  __dirname,
  "..",
  "provider-runtime-config.json"
);

const ROLLBACK_CONFIG_PATH = path.join(
  __dirname,
  "..",
  "provider-runtime-rollback.json"
);
const STAGING_CONFIG_PATH = path.join(
  __dirname,
  "..",
  "provider-runtime-staging.json"
);

function normalizeRuntimeConfig(value = {}) {
  const result = {
    provider: String(value.provider || "").trim().toLowerCase(),
    model: String(value.model || "").trim()
  };

  if (
    value.fallbackEnabled === true &&
    String(value.fallbackProvider || "").trim() &&
    String(value.fallbackModel || "").trim() &&
    String(value.fallbackProvider).trim().toLowerCase() !== result.provider
  ) {
    result.fallbackEnabled = true;
    result.fallbackProvider = String(value.fallbackProvider).trim().toLowerCase();
    result.fallbackModel = String(value.fallbackModel).trim();
  }

  return result;
}

function readRuntimeConfig() {
  if (!fs.existsSync(RUNTIME_CONFIG_PATH)) {
    return { provider: "", model: "" };
  }
  return normalizeRuntimeConfig(
    JSON.parse(fs.readFileSync(RUNTIME_CONFIG_PATH, "utf8"))
  );
}

function writeRuntimeConfig(config) {
  const safeConfig = normalizeRuntimeConfig(config);
  const temporaryPath = RUNTIME_CONFIG_PATH + ".tmp";

  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(safeConfig, null, 2) + "\n",
    "utf8"
  );
  fs.renameSync(temporaryPath, RUNTIME_CONFIG_PATH);
}

function restoreRuntimeConfig() {
  if (!fs.existsSync(ROLLBACK_CONFIG_PATH)) return false;

  const snapshot = normalizeRuntimeConfig(
    JSON.parse(fs.readFileSync(ROLLBACK_CONFIG_PATH, "utf8"))
  );
  writeRuntimeConfig(snapshot);

  const restored = readRuntimeConfig();
  if (JSON.stringify(restored) !== JSON.stringify(snapshot)) {
    throw new Error("runtime_config_restore_verification_failed");
  }

  fs.unlinkSync(ROLLBACK_CONFIG_PATH);
  return true;
}

function saveRollbackSnapshot(config) {
  fs.writeFileSync(
    ROLLBACK_CONFIG_PATH,
    JSON.stringify(normalizeRuntimeConfig(config), null, 2) + "\n",
    "utf8"
  );
}

function audit({
  actorRole,
  action,
  resourceId = "",
  status = "success",
  details = {}
}) {
  try {
    return recordAudit({
      actorRole,
      action,
      resource: "mira-provider-evolution",
      resourceId,
      status,
      details
    });
  } catch (error) {
    return null;
  }
}

function normalizeText(
  value,
  fallback = "",
  max = 2000
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return String(value)
    .trim()
    .slice(0, max);
}

function safeProviderRequest(body) {
  const source = body && typeof body === "object" ? body : {};
  return {
    provider: normalizeText(source.provider, "", 100),
    model: normalizeText(source.model, "", 200),
    fallbackEnabled: source.fallbackEnabled === true,
    fallbackProvider: normalizeText(source.fallbackProvider, "", 100),
    fallbackModel: normalizeText(source.fallbackModel, "", 200),
    title: normalizeText(source.title, "", 200),
    reason: normalizeText(source.reason, "", 2000),
    expectedBenefit: normalizeText(source.expectedBenefit, "", 2000),
    affectedResources: Array.isArray(source.affectedResources)
      ? [...new Set(source.affectedResources
          .map(item => normalizeText(item, "", 300))
          .filter(Boolean))].slice(0, 20)
      : []
  };
}

/*
 * POST /request
 *
 * Stage 4.11:
 * Provider Change Request -> Proposal
 */
router.post(
  "/request",
  (req, res, next) => {
    try {
      const actor =
        req.role || "admin";

      const request =
        safeProviderRequest(
          req.body
        );

      /*
       * Explicitly scan the complete incoming
       * body for credential material.
       *
       * We never return the offending value.
       */
      const secretSafety =
        scanSecretSafety(
          req.body || {}
        );

      if (!secretSafety.ok) {
        audit({
          actorRole: actor,
          action:
            "MIRA_PROVIDER_SECRET_SAFETY_BLOCKED",
          status: "failed",
          details: {
            reason:
              secretSafety.status,
            field:
              secretSafety.field || ""
          }
        });

        return res.status(400).json({
          success: false,
          status:
            "secret_safety_blocked",
          error:
            "Provider request contains prohibited credential material.",
          field:
            secretSafety.field || ""
        });
      }

      const validation = validateProviderConfiguration({
        provider: request.provider,
        model: request.model,
        fallbackEnabled: request.fallbackEnabled,
        fallbackProvider: request.fallbackProvider,
        fallbackModel: request.fallbackModel
      });

      if (!validation.ok) {
        audit({
          actorRole: actor,
          action:
            "MIRA_PROVIDER_CONFIGURATION_REJECTED",
          status: "failed",
          details: {
            provider:
              request.provider,
            model:
              request.model,
            validationStatus:
              validation.status
          }
        });

        return res.status(400).json({
          success: false,
          status:
            "provider_configuration_invalid",
          validation
        });
      }

      const title =
        request.title ||
        `Mira Provider Evolution: ${request.provider}`;

      const reason =
        request.reason ||
        `Change Mira AI provider configuration to ${request.provider}.`;

      const expectedBenefit =
        request.expectedBenefit ||
        "Use the approved provider and model through the controlled Evolution lifecycle.";

      const proposal =
        createProposal({
          title,
          reason,
          expectedBenefit,

          category: "provider",

          /*
           * Provider changes require approval.
           */
          risk: "medium",

          actor,

          affectedResources:
            request.affectedResources.length > 0
              ? request.affectedResources
              : [
                  "services/ai.js",
                  "providers/index.js"
                ],

          estimatedComplexity:
            "medium",

          backupRequired: true,

          testRequired: true,

          proposalSource:
            "provider-evolution",

          metadata: {
            evolution: true,
            stage: "4.11",

            provider:
              validation.provider,

            model: validation.model,
            fallbackEnabled: validation.fallbackEnabled === true,
            ...(validation.fallbackEnabled === true ? {
              fallbackProvider: validation.fallbackProvider,
              fallbackModel: validation.fallbackModel
            } : {}),
            configurationStatus:
              validation.status,

            secretSafety:
              "passed",

            /*
             * Never store request body,
             * API keys, tokens or credentials.
             */
            credentialStorage:
              "prohibited"
          }
        });

      const pending =
        moveToPendingApproval(
          proposal.changeId,
          actor
        );

      audit({
        actorRole: actor,

        action:
          "MIRA_PROVIDER_PROPOSAL_CREATED",

        resourceId:
          proposal.changeId,

        details: {
          provider:
            validation.provider,

          model:
            validation.model,

          configurationStatus:
            validation.status,

          secretSafety:
            "passed",

          approvalRequired:
            true
        }
      });

      return res.status(201).json({
        success: true,

        status:
          "pending_approval",

        message:
          "Provider change proposal created and is waiting for Admin approval.",

        proposal:
          pending || proposal
      });
    } catch (error) {
      audit({
        actorRole:
          req.role || "admin",

        action:
          "MIRA_PROVIDER_PROPOSAL_FAILED",

        status: "failed",

        details: {
          error:
            String(
              error?.message ||
              "Provider proposal failed"
            ).slice(0, 500)
        }
      });

      next(error);
    }
  }
);

/*
 * POST /:id/health
 *
 * Stage 4.11:
 * Test Connection / Health
 *
 * This endpoint does NOT approve or apply anything.
 */
router.post(
  "/:id/health",
  async (req, res, next) => {
    try {
      const actor =
        req.role || "admin";

      const proposal =
        getProposal(
          req.params.id
        );

      if (!proposal) {
        return res.status(404).json({
          success: false,
          status:
            "proposal_not_found",
          error:
            "Provider Evolution proposal not found."
        });
      }

      if (
        proposal.category !==
        "provider"
      ) {
        return res.status(400).json({
          success: false,
          status:
            "not_provider_proposal",
          error:
            "This proposal is not a Provider Evolution proposal."
        });
      }

      const provider =
        proposal.metadata?.provider;

      const model =
        proposal.metadata?.model;

      const validation =
        validateProviderConfiguration({
          provider,
          model
        });

      if (!validation.ok) {
        return res.status(400).json({
          success: false,
          status:
            "provider_configuration_invalid",
          validation
        });
      }

      const health =
        await testProviderHealth({
          provider,
          model
        });

      audit({
        actorRole: actor,

        action:
          "MIRA_PROVIDER_HEALTH_CHECK",

        resourceId:
          proposal.changeId,

        status:
          health.ok
            ? "success"
            : "failed",

        details: {
          provider,
          model,
          healthStatus:
            health.status,
          responseReceived:
            Boolean(
              health.responseReceived
            ),
          error:
            health.ok
              ? undefined
              : health.error
        }
      });

      return res.json({
        success: health.ok,
        status:
          health.status,

        provider,
        model,

        health: {
          ok: health.ok,
          responseReceived:
            Boolean(
              health.responseReceived
            ),
          error:
            health.ok
              ? undefined
              : health.error
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * POST /:id/approve
 *
 * Stage 4.11:
 * Approval
 *
 * No automatic approval is performed.
 */
router.post(
  "/:id/approve",
  (req, res, next) => {
    try {
      const actor =
        req.role || "admin";

      const proposal =
        getProposal(
          req.params.id
        );

      if (!proposal) {
        return res.status(404).json({
          success: false,
          status:
            "proposal_not_found",
          error:
            "Provider Evolution proposal not found."
        });
      }

      if (
        proposal.category !==
        "provider"
      ) {
        return res.status(400).json({
          success: false,
          status:
            "not_provider_proposal",
          error:
            "This proposal is not a Provider Evolution proposal."
        });
      }

      /*
       * Approval remains an explicit Admin action.
       */
      const approved =
        approveProposal(
          proposal.changeId,
          actor
        );

      if (!approved) {
        return res.status(409).json({
          success: false,
          status:
            "approval_failed",
          error:
            "Provider proposal could not be approved."
        });
      }

      const safeAudit =
        buildSafeAuditDetails({
          provider:
            approved.metadata?.provider,
          model:
            approved.metadata?.model
        });

      audit({
        actorRole: actor,

        action:
          "MIRA_PROVIDER_PROPOSAL_APPROVED",

        resourceId:
          approved.changeId,

        details: {
          ...safeAudit,
          approvalRequired:
            true
        }
      });

      return res.json({
        success: true,
        status: "approved",
        message:
          "Provider Evolution proposal approved. Apply remains a separate controlled step.",
        proposal: approved
      });
    } catch (error) {
      next(error);
    }
  }
);


/*
 * POST /:id/apply
 *
 * Stage 4.11:
 * Approved Provider Change
 * -> Snapshot
 * -> Apply
 * -> Post-Apply Health Verify
 * -> PASS / ROLLBACK
 */
router.post(
  "/:id/apply",
  async (req, res, next) => {
    try {
      const proposal = getProposal(req.params.id);
      if (!proposal) {
        return res.status(404).json({ success: false, status: "proposal_not_found" });
      }
      if (proposal.category !== "provider") {
        return res.status(400).json({ success: false, status: "not_provider_proposal" });
      }
      if (proposal.status !== "approved") {
        return res.status(409).json({
          success: false,
          status: "approval_required",
          error: "Provider proposal must be approved before staging."
        });
      }

      const config = {
        provider: proposal.metadata?.provider || "",
        model: proposal.metadata?.model || "",
        fallbackEnabled: proposal.metadata?.fallbackEnabled === true,
        fallbackProvider: proposal.metadata?.fallbackProvider || "",
        fallbackModel: proposal.metadata?.fallbackModel || ""
      };
      const validation = validateProviderConfiguration(config);
      if (!validation.ok) {
        return res.status(400).json({
          success: false,
          status: "configuration_validation_failed",
          result: validation.status
        });
      }

      const stagedConfig = normalizeRuntimeConfig({
        provider: validation.provider,
        model: validation.model || "",
        fallbackEnabled: validation.fallbackEnabled === true,
        fallbackProvider: validation.fallbackProvider || "",
        fallbackModel: validation.fallbackModel || ""
      });
      const record = {
        changeId: proposal.changeId,
        config: stagedConfig,
        stagedAt: new Date().toISOString(),
        stagedBy: req.role || "admin"
      };
      const temporaryPath = STAGING_CONFIG_PATH + ".tmp";
      fs.writeFileSync(temporaryPath, JSON.stringify(record, null, 2) + "\n", "utf8");
      fs.renameSync(temporaryPath, STAGING_CONFIG_PATH);

      audit({
        actorRole: req.role || "admin",
        action: "MIRA_PROVIDER_CHANGE_STAGED",
        resourceId: proposal.changeId,
        status: "staged",
        details: buildSafeAuditDetails(stagedConfig)
      });
      return res.json({
        success: true,
        status: "staged",
        changeId: proposal.changeId
      });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * POST /:id/activate
 * Live activation is separate from staging and requires a matching staging record.
 */
router.post(
  "/:id/activate",
  async (req, res, next) => {
    let snapshotCreated = false;

    try {
      const actor =
        req.role || "admin";

      const proposal =
        getProposal(req.params.id);

      if (!proposal) {
        return res.status(404).json({
          success: false,
          status: "proposal_not_found"
        });
      }

      if (proposal.category !== "provider") {
        return res.status(400).json({
          success: false,
          status: "not_provider_proposal"
        });
      }

      if (proposal.status !== "approved") {
        return res.status(409).json({
          success: false,
          status: "approval_required",
          error:
            "Provider proposal must be approved before apply."
        });
      }

      const config = {
        provider: proposal.metadata?.provider || "",
        model: proposal.metadata?.model || "",
        fallbackEnabled: proposal.metadata?.fallbackEnabled === true,
        fallbackProvider: proposal.metadata?.fallbackProvider || "",
        fallbackModel: proposal.metadata?.fallbackModel || ""
      };

      const validation =
        validateProviderConfiguration(config);

      if (!validation.ok) {
        return res.status(400).json({
          success: false,
          status: "configuration_validation_failed",
          result: validation.status
        });
      }

      if (!fs.existsSync(STAGING_CONFIG_PATH)) {
        return res.status(409).json({
          success: false,
          status: "staging_required"
        });
      }

      let staged;
      try {
        staged = JSON.parse(fs.readFileSync(STAGING_CONFIG_PATH, "utf8"));
      } catch (_) {
        return res.status(409).json({
          success: false,
          status: "staging_invalid"
        });
      }

      const expectedStagedConfig = normalizeRuntimeConfig({
        provider: validation.provider,
        model: validation.model || "",
        fallbackEnabled: validation.fallbackEnabled === true,
        fallbackProvider: validation.fallbackProvider || "",
        fallbackModel: validation.fallbackModel || ""
      });
      if (
        staged.changeId !== proposal.changeId ||
        JSON.stringify(normalizeRuntimeConfig(staged.config)) !==
          JSON.stringify(expectedStagedConfig)
      ) {
        return res.status(409).json({
          success: false,
          status: "staging_mismatch"
        });
      }

      const currentConfig =
        readRuntimeConfig();

      saveRollbackSnapshot(currentConfig);
      snapshotCreated = true;

      writeRuntimeConfig({
        provider: validation.provider,
        model: validation.model || "",
        fallbackEnabled: validation.fallbackEnabled === true,
        fallbackProvider: validation.fallbackProvider || "",
        fallbackModel: validation.fallbackModel || ""
      });

      const verification =
        await testProviderHealth({
          provider: validation.provider,
          model: validation.model || ""
        });

      if (!verification.ok) {
        let rollbackCompleted = false;

        try {
          rollbackCompleted = restoreRuntimeConfig();
        } catch (_) {
          rollbackCompleted = false;
        }

        if (!rollbackCompleted) {
          try {
            audit({
              actorRole: actor,
              action: "MIRA_PROVIDER_CHANGE_ROLLBACK_FAILED",
              resourceId: proposal.changeId,
              status: "rollback_failed",
              details: {
                ...buildSafeAuditDetails(config),
                verification: verification.status,
                verificationError: verification.error || "",
                rollback: "failed",
                recoveryRequired: true
              }
            });
          } catch (_) {}

          return res.status(500).json({
            success: false,
            status: "rollback_failed",
            verification: {
              ok: false,
              status: verification.status,
              error: verification.error || ""
            },
            rollback: "failed",
            recoveryRequired: true
          });
        }

        audit({
          actorRole: actor,
          action: "MIRA_PROVIDER_CHANGE_ROLLED_BACK",
          resourceId: proposal.changeId,
          status: "rollback",
          details: {
            ...buildSafeAuditDetails(config),
            verification: verification.status,
            verificationError: verification.error || "",
            rollback: "completed"
          }
        });

        return res.status(409).json({
          success: false,
          status: "rolled_back",
          verification: {
            ok: false,
            status: verification.status,
            error: verification.error || ""
          },
          rollback: "completed"
        });
      }

      try {
        const completed =
          completeProposal(
            proposal.changeId,
            actor
          );

        if (fs.existsSync(ROLLBACK_CONFIG_PATH)) {
          fs.unlinkSync(ROLLBACK_CONFIG_PATH);
        }
        try {
          if (fs.existsSync(STAGING_CONFIG_PATH)) {
            const stagedAfterActivation = JSON.parse(
              fs.readFileSync(STAGING_CONFIG_PATH, "utf8")
            );
            if (stagedAfterActivation.changeId === proposal.changeId) {
              fs.unlinkSync(STAGING_CONFIG_PATH);
            }
          }
        } catch (_) {
          audit({
            actorRole: actor,
            action: "MIRA_PROVIDER_STAGING_CLEANUP_FAILED",
            resourceId: proposal.changeId,
            status: "cleanup_failed",
            details: {
              ...buildSafeAuditDetails(config),
              cleanup: "failed",
              activation: "verified"
            }
          });
        }

        audit({
          actorRole: actor,
          action:
            "MIRA_PROVIDER_CHANGE_APPLIED",
          resourceId: completed.changeId,
          details: {
            ...buildSafeAuditDetails(config),
            apply: "passed",
            verification: "passed",
            rollback: "not_required"
          }
        });

        return res.json({
          success: true,
          status: "applied_verified",
          proposal: completed,
          verification: {
            ok: true,
            status:
              verification.status
          },
          rollback: "not_required"
        });
      } catch (completionError) {
        throw completionError;
      }
    } catch (error) {
      if (snapshotCreated) {
        try {
          const restored = restoreRuntimeConfig();

          if (!restored) {
            throw new Error("rollback_snapshot_missing");
          }
        } catch (rollbackError) {
          try {
            audit({
              actorRole: req.role || "admin",
              action: "MIRA_PROVIDER_CHANGE_ROLLBACK_FAILED",
              resourceId: req.params.id,
              status: "rollback_failed",
              details: {
                rollback: "failed",
                recoveryRequired: true
              }
            });
          } catch (_) {}

          return res.status(500).json({
            success: false,
            status: "rollback_failed",
            rollback: "failed",
            recoveryRequired: true
          });
        }
      }

      next(error);
    }
  }
);

/*
 * POST /:id/verify
 *
 * Stage 4.11:
 * Post-Apply Provider Verification
 */
router.post(
  "/:id/verify",
  async (req, res, next) => {
    try {
      const actor =
        req.role || "admin";

      const proposal =
        getProposal(req.params.id);

      if (!proposal) {
        return res.status(404).json({
          success: false,
          status: "proposal_not_found"
        });
      }

      if (proposal.category !== "provider") {
        return res.status(400).json({
          success: false,
          status: "not_provider_proposal"
        });
      }

      // Verification is allowed only after activation completed successfully.
      // Reject incomplete proposals before any provider health request.
      if (proposal.status !== "complete") {
        return res.status(409).json({
          success: false,
          status: "proposal_not_completed",
          verification: "not_run"
        });
      }

      const config = {
        provider:
          proposal.metadata?.provider || "",
        model:
          proposal.metadata?.model || "",
        fallbackEnabled:
          proposal.metadata?.fallbackEnabled === true,
        fallbackProvider:
          proposal.metadata?.fallbackProvider || "",
        fallbackModel:
          proposal.metadata?.fallbackModel || ""
      };

      const validation =
        validateProviderConfiguration(config);

      if (!validation.ok) {
        return res.status(400).json({
          success: false,
          status: "configuration_validation_failed",
          result: validation.status
        });
      }

      const runtime =
        readRuntimeConfig();

      const expectedFallbackEnabled =
        validation.fallbackEnabled === true;

      const runtimeFallbackEnabled =
        runtime.fallbackEnabled === true;

      const fallbackMatches =
        runtimeFallbackEnabled === expectedFallbackEnabled &&
        (
          !expectedFallbackEnabled ||
          (
            runtime.fallbackProvider === validation.fallbackProvider &&
            runtime.fallbackModel === validation.fallbackModel
          )
        );

      const runtimeMatches =
        runtime.provider === validation.provider &&
        runtime.model === (validation.model || "") &&
        fallbackMatches;

      if (!runtimeMatches) {
        return res.status(409).json({
          success: false,
          status: "runtime_configuration_mismatch",
          verification: "failed"
        });
      }

      const verification =
        await testProviderHealth(config);

      audit({
        actorRole: actor,
        action:
          "MIRA_PROVIDER_CHANGE_VERIFIED",
        resourceId: proposal.changeId,
        status:
          verification.ok
            ? "success"
            : "failed",
        details: {
          ...buildSafeAuditDetails(config),
          verification:
            verification.status
        }
      });

      return res.status(
        verification.ok ? 200 : 409
      ).json({
        success: verification.ok,
        status:
          verification.ok
            ? "verified"
            : "verification_failed",
        verification: {
          ok: verification.ok,
          status: verification.status
        }
      });
    } catch (error) {
      next(error);
    }
  }
);


/*
 * Read-only recovery of the current provider proposal.
 * Admin permission is inherited from the router mount.
 * No provider API request or activation occurs here.
 */
router.get("/pending-proposal", (req, res) => {
  try {
    const allProviderProposals = listProposals({ category: "provider" });
    const requestedChangeId = String(req.query.changeId || "").trim();
    let proposal;

    if (requestedChangeId) {
      proposal = allProviderProposals.find(
        p => p.changeId === requestedChangeId
      );

      if (!proposal) {
        return res.status(404).json({
          success: false,
          status: "proposal_not_found"
        });
      }

      if (proposal.category !== "provider") {
        return res.status(400).json({
          success: false,
          status: "not_provider_proposal"
        });
      }

      if (!["pending_approval", "approved"].includes(proposal.status)) {
        return res.status(409).json({
          success: false,
          status: "proposal_not_active"
        });
      }
    } else {
      const candidates = allProviderProposals.filter(p =>
        p.status === "pending_approval" ||
        p.status === "approved"
      );

      if (candidates.length === 0) {
        return res.status(404).json({
          success: false,
          status: "no_active_provider_proposal"
        });
      }

      if (candidates.length > 1) {
        return res.status(409).json({
          success: false,
          status: "multiple_active_provider_proposals",
          count: candidates.length
        });
      }

      proposal = candidates[0];
    }
    const metadata = proposal.metadata || {};

    const expectedConfig = normalizeRuntimeConfig({
      provider: metadata.provider || "",
      model: metadata.model || "",
      fallbackEnabled: metadata.fallbackEnabled === true,
      fallbackProvider: metadata.fallbackProvider || "",
      fallbackModel: metadata.fallbackModel || ""
    });

    let staged = false;

    if (proposal.status === "approved" &&
        fs.existsSync(STAGING_CONFIG_PATH)) {
      try {
        const record = JSON.parse(
          fs.readFileSync(STAGING_CONFIG_PATH, "utf8")
        );

        staged =
          record.changeId === proposal.changeId &&
          JSON.stringify(normalizeRuntimeConfig(record.config)) ===
            JSON.stringify(expectedConfig);
      } catch (_) {
        staged = false;
      }
    }

    return res.json({
      success: true,
      status: "proposal_loaded",
      staged,
      proposal: {
        changeId: proposal.changeId,
        status: proposal.status,
        title: String(proposal.title || "").slice(0, 200),
        provider: String(metadata.provider || "").slice(0, 100),
        model: String(metadata.model || "").slice(0, 200)
      }
    });
  } catch (_) {
    return res.status(500).json({
      success: false,
      status: "proposal_recovery_failed"
    });
  }
});


/*
 * Read-only runtime status. This reports configuration only.
 * It does not test connectivity or activate/change a provider.
 */
router.get("/runtime-status", (req, res) => {
  try {
    const runtime = require("../providers").getProviderStatus();
    const provider = runtime && typeof runtime.provider === "string"
      ? runtime.provider.slice(0, 100) : "";
    const model = runtime && typeof runtime.model === "string"
      ? runtime.model.slice(0, 200) : "";
    const fallbackEnabled = !!(runtime && runtime.fallbackEnabled === true);

    return res.json({
      success: true,
      status: "runtime_status_loaded",
      provider,
      model,
      fallbackEnabled,
      ...(fallbackEnabled ? {
        fallbackProvider: String(runtime.fallbackProvider || "").slice(0, 100),
        fallbackModel: String(runtime.fallbackModel || "").slice(0, 200)
      } : {}),
      connectionStatus: "not_checked",
      liveConnectionVerified: false,
      activationPerformed: false
    });
  } catch (_) {
    return res.status(500).json({
      success: false,
      status: "runtime_status_unavailable",
      connectionStatus: "not_checked",
      liveConnectionVerified: false,
      activationPerformed: false
    });
  }
});


/*
 * Custom Provider configuration V1.
 * These endpoints save configuration only; they do not test or activate providers.
 */
router.get("/custom-slots", (req, res, next) => {
  try {
    const config = require("../services/custom-provider-config").readConfig();
    return res.json({
      success: true,
      status: "configuration_loaded",
      slots: config.slots
    });
  } catch (_) {
    return res.status(500).json({
      success: false,
      status: "configuration_read_failed"
    });
  }
});

router.put("/custom-slots", (req, res, next) => {
  try {
    const service = require("../services/custom-provider-config");
    const validation = service.validateSlots(req.body || {});

    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        status: validation.status
      });
    }

    const saved = service.writeConfig({ slots: validation.slots });

    audit({
      actorRole: req.role || "admin",
      action: "MIRA_CUSTOM_PROVIDER_CONFIGURATION_SAVED",
      status: "success",
      details: {
        configuredSlots: saved.slots.filter(slot => slot.endpoint).length,
        secretValuesAccepted: false,
        providerActivated: false
      }
    });

    return res.json({
      success: true,
      status: "configuration_saved_not_activated",
      slots: saved.slots
    });
  } catch (_) {
    return res.status(500).json({
      success: false,
      status: "configuration_save_failed"
    });
  }
});




// MIRA_PROVIDER_CREDENTIAL_ROUTES_V1
// This router is mounted behind the existing SYSTEM_ADMIN permission middleware.
// Never return plaintext credentials from the metadata endpoint.
const CREDENTIAL_PROVIDER_ENV = Object.freeze({
  openai: ["OPENAI_API_KEY", "OPENAI_MODEL"],
  gemini: ["GEMINI_API_KEY", "GEMINI_MODEL"],
  groq: ["GROQ_API_KEY", "GROQ_MODEL"],
  deepseek: ["DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"],
  openrouter: ["OPENROUTER_API_KEY", "OPENROUTER_MODEL"],
  huggingface: ["HF_TOKEN", "HF_MODEL"],
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"],
  xai: ["XAI_API_KEY", "XAI_MODEL"],
  custom1: ["CUSTOM_PROVIDER1_KEY", "CUSTOM_PROVIDER1_MODEL"],
  custom2: ["CUSTOM_PROVIDER2_KEY", "CUSTOM_PROVIDER2_MODEL"],
  custom3: ["CUSTOM_PROVIDER3_KEY", "CUSTOM_PROVIDER3_MODEL"],
  custom4: ["CUSTOM_PROVIDER4_KEY", "CUSTOM_PROVIDER4_MODEL"],
  custom5: ["CUSTOM_PROVIDER5_KEY", "CUSTOM_PROVIDER5_MODEL"]
});

function credentialNoStore(res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("X-Content-Type-Options", "nosniff");
}

function credentialEncryptionReady() {
  const value = process.env.MIRA_CREDENTIALS_ENCRYPTION_KEY || "";
  return Buffer.byteLength(value, "utf8") >= 32;
}

function safeCredentialError(res, error) {
  if (error && error.code === "CREDENTIAL_ENCRYPTION_NOT_CONFIGURED") {
    return res.status(503).json({
      ok: false,
      error: "credential_encryption_not_configured"
    });
  }
  return res.status(400).json({
    ok: false,
    error: "credential_operation_failed"
  });
}

router.get("/credentials", (req, res) => {
  credentialNoStore(res);
  const envConfigured = {};
  for (const [provider, names] of Object.entries(CREDENTIAL_PROVIDER_ENV)) {
    envConfigured[provider] = Boolean(process.env[names[0]]);
  }

  let managed = {};
  let storeAvailable = true;
  try {
    managed = providerCredentialStore.list();
  } catch {
    storeAvailable = false;
  }

  const providers = {};
  for (const [provider, names] of Object.entries(CREDENTIAL_PROVIDER_ENV)) {
    const managedEntry = managed[provider];
    const hasManaged = Boolean(managedEntry && managedEntry.configured);
    const hasEnvironment = envConfigured[provider];
    providers[provider] = {
      configured: hasManaged || hasEnvironment,
      source: hasManaged ? "managed" : (hasEnvironment ? "environment" : "none"),
      hint: hasManaged ? managedEntry.hint : "",
      model: hasManaged && managedEntry.model
        ? managedEntry.model
        : (process.env[names[1]] || "")
    };
  }

  return res.json({
    ok: true,
    encryptionReady: credentialEncryptionReady(),
    storeAvailable,
    providers
  });
});

router.put("/credentials/:provider", (req, res) => {
  credentialNoStore(res);
  const provider = String(req.params.provider || "").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CREDENTIAL_PROVIDER_ENV, provider)) {
    return res.status(400).json({ ok: false, error: "unsupported_provider" });
  }
  if (!credentialEncryptionReady()) {
    return res.status(503).json({
      ok: false,
      error: "credential_encryption_not_configured"
    });
  }

  try {
    const body = req.body || {};
    if (typeof body.key !== "string") {
      return res.status(400).json({ ok: false, error: "api_key_required" });
    }
    const result = providerCredentialStore.set(
      provider,
      body.key,
      typeof body.model === "string" ? body.model : ""
    );
    return res.json({
      ok: true,
      provider,
      credential: result,
      activated: false
    });
  } catch (error) {
    return safeCredentialError(res, error);
  }
});

router.post("/credentials/:provider/reveal", (req, res) => {
  credentialNoStore(res);
  const provider = String(req.params.provider || "").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CREDENTIAL_PROVIDER_ENV, provider)) {
    return res.status(400).json({ ok: false, error: "unsupported_provider" });
  }

  try {
    try {
      recordAudit({
        actorRole: req.role || (req.session && req.session.role) || "admin",
        action: "provider_credential_reveal_attempt",
        resource: "mira-provider-evolution",
        resourceId: provider,
        status: "attempt",
        details: { provider }
      });
    } catch (auditError) {
      return res.status(503).json({
        ok: false,
        error: "credential_audit_unavailable"
      });
    }

    const result = providerCredentialStore.reveal(provider);
    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "managed_credential_not_found"
      });
    }
    try {
      recordAudit({
        actorRole: req.role || (req.session && req.session.role) || "admin",
        action: "provider_credential_reveal",
        resource: "mira-provider-evolution",
        resourceId: provider,
        status: "success",
        details: { provider }
      });
    } catch (auditError) {
      return res.status(503).json({
        ok: false,
        error: "credential_audit_unavailable"
      });
    }

    return res.json({
      ok: true,
      provider,
      key: result.key,
      model: result.model
    });
  } catch (error) {
    return safeCredentialError(res, error);
  }
});

router.delete("/credentials/:provider", (req, res) => {
  credentialNoStore(res);
  const provider = String(req.params.provider || "").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CREDENTIAL_PROVIDER_ENV, provider)) {
    return res.status(400).json({ ok: false, error: "unsupported_provider" });
  }
  if (!credentialEncryptionReady()) {
    return res.status(503).json({
      ok: false,
      error: "credential_encryption_not_configured"
    });
  }

  try {
    const removed = providerCredentialStore.remove(provider);
    return res.json({ ok: true, provider, removed, activated: false });
  } catch (error) {
    return safeCredentialError(res, error);
  }
});
// /MIRA_PROVIDER_CREDENTIAL_ROUTES_V1

module.exports = router;
