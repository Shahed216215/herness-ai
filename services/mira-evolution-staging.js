"use strict";

const {
  createArtifact,
  addArtifactFile,
  verifyArtifact,
  getArtifact,
  updateArtifactStatus
} = require("../staging-manager");

function normalizeText(value, fallback = "", max = 10000) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value)
    .trim()
    .slice(0, max);
}

function safeChangeId(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 120);
}

function buildPlanArtifact(proposal) {
  const instruction = normalizeText(
    proposal?.metadata?.instruction,
    proposal?.title || "Mira Evolution proposal"
  );

  const analysis =
    proposal?.metadata?.analysis || {};

  return [
    '"use strict";',
    "",
    "// Mira Evolution staged implementation plan.",
    "// This artifact is inactive and must not be executed directly.",
    "",
    "module.exports = {",
    "  changeId: " +
      JSON.stringify(proposal.changeId) +
      ",",
    "  category: " +
      JSON.stringify(proposal.category || "other") +
      ",",
    "  risk: " +
      JSON.stringify(proposal.risk || "unknown") +
      ",",
    "  instruction: " +
      JSON.stringify(instruction) +
      ",",
    "  analysis: " +
      JSON.stringify(analysis, null, 2) +
      ",",
    "  executionAllowed: false,",
    '  status: "staged_only"',
    "};",
    ""
  ].join("\n");
}

function buildToolScaffold(proposal) {
  const changeId = safeChangeId(
    proposal.changeId
  );

  const instruction = normalizeText(
    proposal?.metadata?.instruction,
    proposal?.title || "Mira tool proposal"
  );

  return [
    '"use strict";',
    "",
    "// Mira Evolution staged tool scaffold.",
    "// This file is outside the active tools/ directory.",
    "// It must remain inactive until a future approved apply stage.",
    "",
    "module.exports = {",
    '  name: "mira-staged-tool-' +
      changeId +
      '",',
    "  declaration: {",
    '    name: "mira_staged_tool",',
    '    description: "Staged Mira tool awaiting controlled apply.",',
    "    input_schema: {",
    '      type: "object",',
    "      properties: {},",
    "      additionalProperties: true",
    "    }",
    "  },",
    "",
    "  async execute(args) {",
    "    void args;",
    '    throw new Error("STAGED_ARTIFACT_NOT_ACTIVE");',
    "  },",
    "",
    "  metadata: {",
    '    stage: "stage4",',
    "    executionAllowed: false,",
    "    instruction: " +
      JSON.stringify(instruction) +
      ",",
    '    status: "staged_only"',
    "  }",
    "};",
    ""
  ].join("\n");
}

async function stageApprovedProposal(
  proposal,
  actor = "admin"
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
        "Only an approved proposal can create a staging artifact.",
      currentStatus: proposal.status
    };
  }

  const existing = getArtifact(
    proposal.changeId
  );

  if (existing?.ok) {
    const verification = verifyArtifact(
      proposal.changeId
    );

    return {
      ok: verification.ok,
      status: verification.ok
        ? "already_staged"
        : "staged_artifact_invalid",
      artifact: existing,
      verification
    };
  }

  const created = createArtifact({
    changeId: proposal.changeId,
    title: proposal.title,
    description:
      "Controlled implementation artifact generated from an approved Mira Evolution proposal.",
    createdBy: actor,
    category: proposal.category || "other"
  });

  if (!created?.ok) {
    return {
      ok: false,
      status: "artifact_creation_failed",
      error:
        created?.error ||
        created?.message ||
        "Unable to create staging artifact."
    };
  }

  addArtifactFile({
    changeId: proposal.changeId,
    targetPath:
      "services/mira-evolution-plan-" +
      safeChangeId(proposal.changeId) +
      ".js",
    description:
      "Inactive implementation plan generated from the approved proposal.",
    content:
      buildPlanArtifact(proposal)
  });

  if (proposal.category === "tool") {
    addArtifactFile({
      changeId: proposal.changeId,
      targetPath:
        "services/mira-staged-tool-" +
        safeChangeId(proposal.changeId) +
        ".js",
      description:
        "Inactive tool scaffold. It cannot execute from staging.",
      content:
        buildToolScaffold(proposal)
    });
  }

  const verification =
    verifyArtifact(proposal.changeId);

  if (!verification.ok) {
    updateArtifactStatus(
      proposal.changeId,
      "failed"
    );

    return {
      ok: false,
      status: "staged_artifact_invalid",
      artifact: getArtifact(proposal.changeId),
      verification
    };
  }

  const statusUpdate =
    updateArtifactStatus(
      proposal.changeId,
      "ready_for_review"
    );

  if (!statusUpdate?.ok) {
    return {
      ok: false,
      status: "artifact_status_update_failed",
      artifact: getArtifact(proposal.changeId),
      verification,
      statusUpdate
    };
  }

  return {
    ok: true,
    status: "staged_ready_for_review",
    artifact: getArtifact(proposal.changeId),
    verification,
    statusUpdate
  };
}

module.exports = {
  stageApprovedProposal
};
