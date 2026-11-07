"use strict";

const express = require("express");

const {
  createProposal,
  getProposal,
  listProposals,
  moveToPendingApproval,
  approveProposal,
  completeProposal,
  rejectProposal,
  getGovernanceStatus
} = require("../change-management");

const {
  applyApprovedChange,
  getApplyEngineStatus
} = require("../apply-engine");

const {
  recordAudit
} = require("../audit-log");

const {
  stageApprovedProposal
} = require("../services/mira-evolution-staging");

const {
  prepareApply,
  applyPreparedChange,
  rollbackPreparedChange,
  getArtifactApplyStatus
} = require("../artifact-apply-engine");

const {
  runVerification
} = require("../services/mira-verification-engine");

const {
  getArtifact,
  verifyArtifact,
  updateArtifactStatus
} = require("../staging-manager");

function now() {
  return new Date().toISOString();
}

function normalizeText(value, fallback = "", max = 2000) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value)
    .trim()
    .slice(0, max);
}

function normalizeResources(resources) {
  if (!Array.isArray(resources)) {
    return [];
  }

  return [
    ...new Set(
      resources
        .map(item => normalizeText(item, "", 300))
        .filter(Boolean)
    )
  ].slice(0, 50);
}

function isSafeSnapshotResource(resource) {
  if (typeof resource !== "string") {
    return false;
  }

  const value = resource.trim();

  if (!value) {
    return false;
  }

  const normalized = value.replace(/\\/g, "/");

  if (
    normalized.startsWith("/") ||
    normalized.includes("..") ||
    normalized.includes("\0")
  ) {
    return false;
  }

  const blockedNames = new Set([
    ".env",
    ".env~",
    "client_secret.json",
    "google-token.json"
  ]);

  const basename = normalized.split("/").pop();

  if (blockedNames.has(basename)) {
    return false;
  }

  if (normalized.endsWith("/")) {
    return false;
  }

  return true;
}

function normalizeApplyResources(resources) {
  return [
    ...new Set(
      normalizeResources(resources)
        .filter(isSafeSnapshotResource)
    )
  ].slice(0, 50);
}

function inferCategory(instruction, requestedCategory) {
  const explicit = normalizeText(
    requestedCategory,
    ""
  ).toLowerCase();

  const valid = [
    "knowledge",
    "memory",
    "tool",
    "provider",
    "security",
    "performance",
    "ui",
    "testing",
    "automation",
    "cloud",
    "self_improvement",
    "other"
  ];

  if (valid.includes(explicit)) {
    return explicit;
  }

  const text = instruction.toLowerCase();

  if (/tool|টুল|function|ফাংশন/.test(text)) {
    return "tool";
  }

  if (
    /provider|openai|gemini|groq|deepseek|model/.test(text)
  ) {
    return "provider";
  }

  if (
    /github|render|cloud|deploy|deployment/.test(text)
  ) {
    return "cloud";
  }

  if (/memory|মেমরি/.test(text)) {
    return "memory";
  }

  if (/knowledge|জ্ঞান|learning|শেখা/.test(text)) {
    return "knowledge";
  }

  if (
    /security|cyber|firewall|নিরাপত্তা/.test(text)
  ) {
    return "security";
  }

  if (
    /ui|dashboard|page|menu|interface/.test(text)
  ) {
    return "ui";
  }

  return "self_improvement";
}

function inferRisk(category, instruction) {
  const text = instruction.toLowerCase();

  if (
    category === "security" ||
    category === "provider" ||
    category === "cloud" ||
    /github|render|deploy|production|credential|secret|token/.test(text)
  ) {
    return "high";
  }

  if (
    category === "tool" ||
    category === "self_improvement" ||
    category === "automation"
  ) {
    return "medium";
  }

  return "low";
}

function inferComplexity(category, instruction) {
  const text = instruction.toLowerCase();

  if (
    category === "cloud" ||
    category === "provider" ||
    /architecture|migration|production|deployment/.test(text)
  ) {
    return "high";
  }

  if (
    category === "tool" ||
    category === "self_improvement" ||
    category === "automation"
  ) {
    return "medium";
  }

  return "low";
}

function buildAnalysis(instruction, category) {
  const normalized = instruction.trim();

  const implementationPlan = {
    capability: normalized,

    proposedActions: [],

    proposedResources: [],

    toolChanges: [],

    providerChanges: [],

    cloudChanges: [],

    testPlan: [
      "Validate proposed changes before permanent application.",
      "Run syntax and structural checks.",
      "Run relevant feature/tool health tests.",
      "Verify the result after application."
    ],

    backupPlan: {
      required: true,
      strategy:
        "Create a verified snapshot before applying approved changes."
    },

    rollbackPlan: {
      required: true,
      strategy:
        "Restore the verified pre-change snapshot if application or testing fails."
    }
  };

  if (category === "tool") {
    implementationPlan.proposedActions.push(
      "Design or update the requested Mira tool.",
      "Validate tool name, declaration and execute interface.",
      "Register the tool only during the controlled apply stage."
    );

    implementationPlan.toolChanges.push(
      "Create or update the required tool module.",
      "Run tool-health validation before release."
    );

    implementationPlan.proposedResources.push(
      "tools/<approved-tool-file>.js"
    );
  }

  if (category === "provider") {
    implementationPlan.proposedActions.push(
      "Analyze the requested AI provider or model configuration.",
      "Validate provider configuration without exposing secrets."
    );

    implementationPlan.providerChanges.push(
      "Update provider configuration only after Admin approval.",
      "Keep API keys, tokens and credentials outside source code."
    );

    implementationPlan.proposedResources.push(
      "services/ai.js"
    );
  }

  if (category === "cloud") {
    implementationPlan.proposedActions.push(
      "Analyze the requested GitHub, Render or cloud integration.",
      "Prepare a controlled deployment or synchronization plan."
    );

    implementationPlan.cloudChanges.push(
      "Validate cloud configuration.",
      "Perform synchronization or deployment only after explicit approval."
    );
  }

  if (category === "ui") {
    implementationPlan.proposedActions.push(
      "Design the requested dashboard or interface change.",
      "Validate the UI JavaScript and affected API mappings."
    );

    implementationPlan.proposedResources.push(
      "public/index.html"
    );
  }

  if (category === "memory") {
    implementationPlan.proposedActions.push(
      "Analyze the requested memory capability.",
      "Preserve existing memory limits and Drive synchronization behavior."
    );

    implementationPlan.proposedResources.push(
      "memory.js"
    );
  }

  if (category === "knowledge") {
    implementationPlan.proposedActions.push(
      "Analyze the requested knowledge or learning capability.",
      "Preserve existing knowledge validation and backup behavior."
    );

    implementationPlan.proposedResources.push(
      "knowledge.js"
    );
  }

  if (
    category === "self_improvement" ||
    category === "automation"
  ) {
    implementationPlan.proposedActions.push(
      "Analyze the requested Mira capability as a controlled self-improvement.",
      "Separate proposal generation from permanent implementation."
    );
  }

  if (category === "security") {
    implementationPlan.proposedActions.push(
      "Perform a security-focused impact analysis.",
      "Require explicit approval before any security-sensitive modification."
    );

    implementationPlan.testPlan.unshift(
      "Run security and authorization validation."
    );
  }

  return {
    engine: "mira-evolution-stage3",
    analyzedAt: now(),
    instructionLength: normalized.length,
    category,
    objective: normalized,

    implementationMode: "controlled_apply",

    implementationPlan,

    approvalRequired: true,

    permanentChangeAllowed: "approved_only",

    githubPushAllowed: false,

    renderDeployAllowed: false,

    secretModificationAllowed: false
  };
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
      resource: "mira-evolution",
      resourceId,
      status,
      details
    });
  } catch (error) {
    return null;
  }
}

function getApplyTestPlan(proposal) {
  const category = proposal?.category || "other";

  const tests = [
    "Confirm proposal remains approved.",
    "Confirm affected resources are safe snapshot resources.",
    "Run Node.js syntax checks for changed JavaScript files."
  ];

  if (category === "tool") {
    tests.push(
      "Run tool-health validation after the change."
    );
  }

  if (category === "ui") {
    tests.push(
      "Validate dashboard JavaScript structure after the change."
    );
  }

  if (
    category === "provider" ||
    category === "security"
  ) {
    tests.push(
      "Run provider/security structural validation without exposing secrets."
    );
  }

  return tests;
}

function validateEvolutionApplyRequest(
  proposal,
  requestedResources
) {
  if (!proposal) {
    return {
      ok: false,
      status: "proposal_not_found",
      message: "Evolution proposal not found."
    };
  }

  if (proposal.status !== "approved") {
    return {
      ok: false,
      status: "approval_required",
      message:
        "Only an approved Mira Evolution proposal can enter the apply stage.",
      currentStatus: proposal.status
    };
  }

  const proposalResources =
    normalizeResources(proposal.affectedResources);

  const requestResources =
    normalizeResources(requestedResources);

  const resources =
    requestResources.length > 0
      ? requestResources
      : proposalResources;

  if (resources.length === 0) {
    return {
      ok: false,
      status: "affected_resources_required",
      message:
        "Apply requires at least one safe existing project file."
    };
  }

  const invalidRequested =
    requestResources.filter(
      resource =>
        !isSafeSnapshotResource(resource)
    );

  if (invalidRequested.length > 0) {
    return {
      ok: false,
      status: "unsafe_resource",
      message:
        "One or more requested resources are blocked.",
      blockedResources: invalidRequested
    };
  }

  const invalidProposal =
    proposalResources.filter(
      resource =>
        !isSafeSnapshotResource(resource)
    );

  if (invalidProposal.length > 0) {
    return {
      ok: false,
      status: "unsafe_proposal_resource",
      message:
        "Proposal contains blocked or invalid resources.",
      blockedResources: invalidProposal
    };
  }

  const normalizedResources =
    normalizeApplyResources(resources);

  if (normalizedResources.length === 0) {
    return {
      ok: false,
      status: "unsafe_resource",
      message:
        "No safe resources remain after validation."
    };
  }

  return {
    ok: true,
    resources: normalizedResources
  };
}

async function runArtifactApply(
  proposal,
  actor
) {
  if (!proposal) {
    throw new Error("Evolution proposal not found.");
  }

  if (proposal.status !== "approved") {
    throw new Error("Proposal must be approved before artifact apply.");
  }

  const artifact = getArtifact(proposal.changeId);

  if (!artifact || !artifact.manifest) {
    throw new Error("Staging artifact not found.");
  }

  if (artifact.manifest.status !== "approved_for_apply") {
    throw new Error("Artifact must be approved_for_apply before apply.");
  }

  const artifactVerification = verifyArtifact(proposal.changeId);

  if (!artifactVerification.ok) {
    throw new Error(artifactVerification.message || "Staged artifact verification failed.");
  }

  const artifactResources = Array.isArray(artifact.manifest.files)
    ? artifact.manifest.files.map(file => file?.targetPath).filter(Boolean)
      : [];

  const resources = normalizeApplyResources([...(proposal.affectedResources || []), ...artifactResources ]);

  const preApplyVerification = await runVerification({ resources, category: proposal.category, phase: "pre_apply" });


  if (!preApplyVerification.ok) {
    const error = new Error("Pre-apply verification failed.");
    error.verification = preApplyVerification;
    throw error;
  }

  const prepared = prepareApply(proposal.changeId);
  if (!prepared.ok) {
    throw new Error("Artifact apply preparation failed.");
  }

  const result = applyPreparedChange(proposal.changeId);

  let postApplyVerification;

  try {
    postApplyVerification = await runVerification({ resources, category: proposal.category, phase: "post_apply" });
  } catch (error) {
    postApplyVerification = { ok: false, status: "verification_execution_failed", plase: "post_apply", error: error.message };
  }

  if (!postApplyVerification.ok) {
    let rollback;
    try { rollback = rollbackPreparedChange(proposal.changeId); } catch (error) { rollback = { ok: false, status: "rollback_failed", error: error.message }; }
    const error = new Error(rollback?.ok ? "Post-apply verification failed; rollback completed." : "Post-apply verification failed; rollback failed and recovery may be required.");
    error.verification = postApplyVerification;
    error.rollback = rollback;
    throw error;
  }

  return { ok: true, actor, result, artifactVerification, verification: { preApply: preApplyVerification, postApply: postApplyVerification, status: "PASS" }, transaction: getArtifactApplyStatus(proposal.changeId) };
}
function registerMiraEvolutionRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS
) {
  const router = express.Router();

  // Evolution can stage/apply repository resources and must not reach legacy
  // Memory/Knowledge stores while HFM read-only authority is active.
  router.use((req, res, next) => {
    if (process.env.MIRA_HFM_STANDING_READ_AUTHORITY_ENABLED === "true" ||
        process.env.MIRA_HFM_WORK_LEARNING_ENABLED === "true" ||
        process.env.MIRA_HFM_MEMORY_READ_ENABLED === "true" ||
        process.env.MIRA_HFM_MEMORY_WRITE_ENABLED === "true") {
      return res.status(403).json({
        success: false,
        blocked: true,
        code: "HFM_READ_ONLY_AUTHORITY_BLOCKS_LEGACY_EVOLUTION",
        reason: "Legacy Evolution is unavailable while HFM grants memory.read only."
      });
    }
    return next();
  });


  router.get(
    "/status",
    (req, res) => {
      return res.json({
        success: true,

        evolution: {
          name: "Mira Evolution",
          stage: "4.5",
          status: "artifact_transaction_apply",

          autonomousAnalysis: true,

          approvalRequired: true,

          artifactApprovalRequired: true,

          directModification: "approved_only",

          stagingEnabled: true,

          transactionApplyEnabled: true,

          rollbackEnabled: true,

          githubPush: false,

          renderDeploy: false,

          arbitraryCodeExecution: false
        },

        governance:
          getGovernanceStatus(),

        applyEngine:
          getApplyEngineStatus()
      });
    }
  );

  router.get(
    "/proposals",
    (req, res, next) => {
      try {
        const status =
          normalizeText(
            req.query.status,
            ""
          );

        const category =
          normalizeText(
            req.query.category,
            ""
          );

        const proposals =
          listProposals({
            ...(status ? { status } : {}),
            ...(category ? { category } : {})
          });

        return res.json({
          success: true,
          count: proposals.length,
          proposals
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/proposals/:id",
    (req, res, next) => {
      try {
        const proposal =
          getProposal(req.params.id);

        if (!proposal) {
          return res.status(404).json({
            success: false,
            error:
              "Evolution proposal not found."
          });
        }

        return res.json({
          success: true,
          proposal
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/instruction",
    (req, res, next) => {
      try {
        const body = req.body || {};

        const instruction =
          normalizeText(
            body.instruction,
            "",
            10000
          );

        if (!instruction) {
          return res.status(400).json({
            success: false,
            status: "validation_error",
            error: "instruction is required"
          });
        }

        const actor =
          req.role || "admin";

        const category =
          inferCategory(
            instruction,
            body.category
          );

        const risk =
          inferRisk(
            category,
            instruction
          );

        const complexity =
          inferComplexity(
            category,
            instruction
          );

        const title =
          normalizeText(
            body.title,
            `Mira Evolution: ${instruction.slice(0, 120)}`,
            200
          );

        const reason =
          normalizeText(
            body.reason,
            `Admin instruction received by Mira: ${instruction}`,
            2000
          );

        const expectedBenefit =
          normalizeText(
            body.expectedBenefit,
            "Implement the requested Mira capability through the controlled Evolution lifecycle.",
            2000
          );

        const affectedResources =
          normalizeResources(
            body.affectedResources
          );

        const analysis =
          buildAnalysis(
            instruction,
            category
          );

        const proposal =
          createProposal({
            title,
            reason,
            expectedBenefit,
            category,
            risk,
            actor,

            affectedResources,

            estimatedComplexity:
              complexity,

            backupRequired: true,

            testRequired: true,

            proposalSource: "admin",

            metadata: {
              evolution: true,
              instruction,
              analysis
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
            "MIRA_EVOLUTION_PROPOSAL_CREATED",

          resourceId:
            proposal.changeId,

          status: "success",

          details: {
            category,
            risk,
            estimatedComplexity:
              complexity,
            proposalSource: "admin",
            approvalRequired: true
          }
        });

        return res.status(201).json({
          success: true,

          status:
            "pending_approval",

          message:
            "Mira Evolution proposal created and is waiting for Admin approval.",

          analysis,

          proposal:
            pending || proposal
        });
      } catch (error) {
        audit({
          actorRole:
            req.role || "admin",

          action:
            "MIRA_EVOLUTION_PROPOSAL_FAILED",

          status: "failed",

          details: {
            error: error.message
          }
        });

        next(error);
      }
    }
  );

  router.post(
    "/proposals/:id/approve",
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
            error:
              "Evolution proposal not found."
          });
        }

        const approved =
          approveProposal(
            req.params.id,
            actor
          );

        audit({
          actorRole: actor,

          action:
            "MIRA_EVOLUTION_PROPOSAL_APPROVED",

          resourceId:
            req.params.id,

          status: "success",

          details: {
            category:
              proposal.category,

            risk:
              proposal.risk
          }
        });

        return res.json({
          success: true,
          status: "approved",
          proposal: approved
        });
      } catch (error) {
        audit({
          actorRole:
            req.role || "admin",

          action:
            "MIRA_EVOLUTION_APPROVAL_FAILED",

          resourceId:
            req.params.id,

          status: "failed",

          details: {
            error:
              error.message
          }
        });

        next(error);
      }
    }
  );

  router.post(
    "/proposals/:id/reject",
    (req, res, next) => {
      try {
        const actor =
          req.role || "admin";

        const reason =
          normalizeText(
            req.body?.reason,
            "Rejected by Admin.",
            1000
          );

        const proposal =
          getProposal(
            req.params.id
          );

        if (!proposal) {
          return res.status(404).json({
            success: false,
            error:
              "Evolution proposal not found."
          });
        }

        const rejected =
          rejectProposal(
            req.params.id,
            actor,
            reason
          );

        audit({
          actorRole: actor,

          action:
            "MIRA_EVOLUTION_PROPOSAL_REJECTED",

          resourceId:
            req.params.id,

          status: "success",

          details: {
            reason
          }
        });

        return res.json({
          success: true,
          status: "rejected",
          proposal: rejected
        });
      } catch (error) {
        audit({
          actorRole:
            req.role || "admin",

          action:
            "MIRA_EVOLUTION_REJECTION_FAILED",

          resourceId:
            req.params.id,

          status: "failed",

          details: {
            error:
              error.message
          }
        });

        next(error);
      }
    }
  );

  router.post(
    "/proposals/:id/stage",
    async (req, res, next) => {
      try {
        const actor =
          req.role || "admin";

        const proposal =
          getProposal(
            req.params.id
          );

        if (!proposal) {
          audit({
            actorRole: actor,

            action:
              "MIRA_EVOLUTION_STAGE_BLOCKED",

            resourceId:
              req.params.id,

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
            message:
              "Evolution proposal not found."
          });
        }

        if (
          proposal.status !==
          "approved"
        ) {
          audit({
            actorRole: actor,

            action:
              "MIRA_EVOLUTION_STAGE_BLOCKED",

            resourceId:
              proposal.changeId,

            status: "blocked",

            details: {
              reason:
                "approval_required",

              currentStatus:
                proposal.status
            }
          });

          return res.status(400).json({
            success: false,

            status:
              "approval_required",

            message:
              "Only an approved proposal can be staged.",

            currentStatus:
              proposal.status
          });
        }

        const result =
          await stageApprovedProposal(
            proposal,
            actor
          );

        if (!result.ok) {
          audit({
            actorRole: actor,

            action:
              "MIRA_EVOLUTION_STAGE_FAILED",

            resourceId:
              proposal.changeId,

            status: "failed",

            details: {
              result
            }
          });

          return res.status(500).json({
            success: false,
            status:
              result.status,
            result
          });
        }

        audit({
          actorRole: actor,

          action:
            "MIRA_EVOLUTION_STAGE_COMPLETED",

          resourceId:
            proposal.changeId,

          status: "success",

          details: {
            stagingStatus:
              result.status,

            implementationModified:
              false,

            activeToolsModified:
              false
          }
        });

        return res.json({
          success: true,

          status:
            result.status,

          message:
            "Proposal staged successfully and is ready for review. No production files were modified.",

          artifact:
            result.artifact,

          verification:
            result.verification
        });
      } catch (error) {
        audit({
          actorRole:
            req.role || "admin",

          action:
            "MIRA_EVOLUTION_STAGE_FAILED",

          resourceId:
            req.params.id,

          status: "failed",

          details: {
            error:
              error.message
          }
        });

        next(error);
      }
    }
  );

  router.post(
    "/proposals/:id/approve-apply",
    async (req, res, next) => {
      try {
        const actor =
          req.role || "admin";

        const proposal =
          getProposal(req.params.id);

        if (!proposal) {
          audit({
            actorRole: actor,
            action:
              "MIRA_EVOLUTION_ARTIFACT_APPROVAL_BLOCKED",
            resourceId: req.params.id,
            status: "blocked",
            details: {
              reason: "proposal_not_found"
            }
          });

          return res.status(404).json({
            success: false,
            status: "proposal_not_found",
            message:
              "Evolution proposal not found."
          });
        }

        if (proposal.status !== "approved") {
          return res.status(400).json({
            success: false,
            status: "proposal_approval_required",
            message:
              "The Evolution proposal must be approved first.",
            currentStatus:
              proposal.status
          });
        }

        const artifact =
          getArtifact(proposal.changeId);

        if (!artifact || !artifact.manifest) {
          return res.status(404).json({
            success: false,
            status:
              "staging_artifact_not_found",
            message:
              "Staging artifact not found."
          });
        }

        const verification =
          verifyArtifact(proposal.changeId);

        if (!verification.ok) {
          audit({
            actorRole: actor,
            action:
              "MIRA_EVOLUTION_ARTIFACT_APPROVAL_BLOCKED",
            resourceId: proposal.changeId,
            status: "blocked",
            details: {
              reason:
                "artifact_verification_failed",
              verification
            }
          });

          return res.status(400).json({
            success: false,
            status:
              "artifact_verification_failed",
            message:
              "Staged artifact verification failed.",
            verification
          });
        }

        if (
          artifact.manifest.status !==
          "ready_for_review"
        ) {
          return res.status(400).json({
            success: false,
            status:
              "artifact_not_ready_for_review",
            message:
              "Artifact must be ready_for_review before apply approval.",
            currentStatus:
              artifact.manifest.status
          });
        }

        const updated =
          updateArtifactStatus(
            proposal.changeId,
            "approved_for_apply"
          );

        audit({
          actorRole: actor,
          action:
            "MIRA_EVOLUTION_ARTIFACT_APPROVED_FOR_APPLY",
          resourceId: proposal.changeId,
          status: "success",
          details: {
            implementationModified: false,
            artifactStatus:
              updated.artifactStatus
          }
        });

        return res.json({
          success: true,
          status:
            "approved_for_apply",
          message:
            "Artifact approved for apply. No production files were modified.",
          artifact: updated,
          verification
        });
      } catch (error) {
        audit({
          actorRole:
            req.role || "admin",
          action:
            "MIRA_EVOLUTION_ARTIFACT_APPROVAL_ERROR",
          resourceId: req.params.id,
          status: "failed",
          details: {
            error: error.message
          }
        });

        next(error);
      }
    }
  );

  router.post(
    "/proposals/:id/apply",
    async (req, res, next) => {
      try {
        const actor =
          req.role || "admin";

        const proposal =
          getProposal(req.params.id);

        if (!proposal) {
          audit({
            actorRole: actor,
            action:
              "MIRA_EVOLUTION_APPLY_BLOCKED",
            resourceId: req.params.id,
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
            message:
              "Evolution proposal not found."
          });
        }

        if (
          proposal.status !==
          "approved"
        ) {
          audit({
            actorRole: actor,
            action:
              "MIRA_EVOLUTION_APPLY_BLOCKED",
            resourceId:
              proposal.changeId,
            status: "blocked",
            details: {
              reason:
                "proposal_approval_required",
              currentStatus:
                proposal.status
            }
          });

          return res.status(400).json({
            success: false,
            status:
              "proposal_approval_required",
            message:
              "Only an approved Evolution proposal can be applied.",
            currentStatus:
              proposal.status
          });
        }

        const artifact =
          getArtifact(
            proposal.changeId
          );

        if (
          !artifact ||
          !artifact.manifest
        ) {
          return res.status(404).json({
            success: false,
            status:
              "staging_artifact_not_found",
            message:
              "Staging artifact not found. Stage the approved proposal first."
          });
        }

        if (
          artifact.manifest.status !==
          "approved_for_apply"
        ) {
          audit({
            actorRole: actor,
            action:
              "MIRA_EVOLUTION_APPLY_BLOCKED",
            resourceId:
              proposal.changeId,
            status: "blocked",
            details: {
              reason:
                "artifact_approval_required",
              currentStatus:
                artifact.manifest.status
            }
          });

          return res.status(400).json({
            success: false,
            status:
              "artifact_approval_required",
            message:
              "The staged artifact requires explicit approval before apply.",
            currentStatus:
              artifact.manifest.status
          });
        }

        const verification =
          verifyArtifact(
            proposal.changeId
          );

        if (!verification.ok) {
          audit({
            actorRole: actor,
            action:
              "MIRA_EVOLUTION_APPLY_BLOCKED",
            resourceId:
              proposal.changeId,
            status: "blocked",
            details: {
              reason:
                "artifact_verification_failed",
              verification
            }
          });

          return res.status(400).json({
            success: false,
            status:
              "artifact_verification_failed",
            message:
              "Staged artifact verification failed.",
            verification
          });
        }

        const existing =
          getArtifactApplyStatus(
            proposal.changeId
          );

        if (
          existing.exists &&
          existing.transaction?.status ===
            "applied"
        ) {
          return res.status(400).json({
            success: false,
            status:
              "artifact_already_applied",
            message:
              "This artifact has already been applied.",
            transaction:
              existing.transaction
          });
        }

        const result =
          await runArtifactApply(
            proposal,
            actor
          );

        const completedProposal =
          completeProposal(
            proposal.changeId,
            actor
          );

        audit({
          actorRole: actor,
          action:
            "MIRA_EVOLUTION_APPLY_COMPLETED",
          resourceId:
            proposal.changeId,
          status: "success",
          details: {
            implementationModified:
              true,
            artifactStatus:
              result.result.status,
            files:
              result.result.files
          }
        });

        return res.json({
          success: true,
          status:
            "apply_completed",
          message:
            "Approved staged artifact applied successfully.",
          result:
            result.result,
          verification:
            result.verification,
          transaction:
            result.transaction
        });
      } catch (error) {
        audit({
          actorRole:
            req.role || "admin",
          action:
            "MIRA_EVOLUTION_APPLY_ERROR",
          resourceId:
            req.params.id,
          status: "failed",
          details: {
            error:
              error.message
          }
        });

        next(error);
      }
    }
  );


  router.post(
    "/proposals/:id/rollback",
    async (req, res, next) => {
      const actor =
        req.role || "admin";

      try {
        const proposal =
          getProposal(req.params.id);

        if (!proposal) {
          return res.status(404).json({
            success: false,
            status:
              "proposal_not_found",
            message:
              "Evolution proposal not found."
          });
        }

        if (
          proposal.status !== "approved"
        ) {
          audit({
            actorRole: actor,
            action:
              "MIRA_EVOLUTION_ROLLBACK_BLOCKED",
            resourceId:
              proposal.changeId,
            status: "blocked",
            details: {
              reason:
                "proposal_not_approved",
              currentStatus:
                proposal.status
            }
          });

          return res.status(400).json({
            success: false,
            status:
              "proposal_approval_required",
            message:
              "Only an approved Evolution proposal can be rolled back.",
            currentStatus:
              proposal.status
          });
        }

        const artifact =
          getArtifact(
            proposal.changeId
          );

        if (
          !artifact ||
          !artifact.manifest
        ) {
          return res.status(404).json({
            success: false,
            status:
              "staging_artifact_not_found",
            message:
              "Staging artifact not found."
          });
        }

        const transaction =
          getArtifactApplyStatus(
            proposal.changeId
          );

        if (
          !transaction.exists
        ) {
          return res.status(400).json({
            success: false,
            status:
              "apply_transaction_not_found",
            message:
              "No apply transaction exists for this proposal."
          });
        }

        if (
          transaction.transaction?.status !==
            "applied"
        ) {
          return res.status(400).json({
            success: false,
            status:
              "rollback_not_available",
            message:
              "Rollback requires an applied transaction.",
            currentStatus:
              transaction.transaction?.status ||
              "unknown"
          });
        }

        const result =
          rollbackPreparedChange(
            proposal.changeId
          );

        audit({
          actorRole: actor,
          action:
            "MIRA_EVOLUTION_ROLLBACK_COMPLETED",
          resourceId:
            proposal.changeId,
          status: "success",
          details: {
            transactionStatus:
              result.status,
            files:
              result.files
          }
        });

        return res.json({
          success: true,
          status:
            "rollback_completed",
          message:
            "Applied artifact was rolled back successfully.",
          result,
          transaction:
            getArtifactApplyStatus(
              proposal.changeId
            )
        });
      } catch (error) {
        audit({
          actorRole: actor,
          action:
            "MIRA_EVOLUTION_ROLLBACK_ERROR",
          resourceId:
            req.params.id,
          status: "failed",
          details: {
            error:
              error.message
          }
        });

        next(error);
      }
    }
  );


  app.use(
    "/api/admin/mira-evolution",
    requireAdminPermission(
      PERMISSIONS.SYSTEM_ADMIN
    ),
    router
  );
}

module.exports =
  registerMiraEvolutionRoutes;
