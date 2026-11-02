"use strict";

const path = require("path");

const {
  getArtifact,
  verifyArtifact
} = require("../staging-manager");

const {
  validateStagedArtifact
} = require("./mira-change-validation");

const PROJECT_ROOT =
  path.resolve(__dirname, "..");

function validateCapabilityArtifact(
  changeId
) {
  if (
    typeof changeId !== "string" ||
    !changeId.trim()
  ) {
    throw new Error(
      "changeId is required."
    );
  }

  const artifactResult =
    getArtifact(changeId);

  if (!artifactResult.ok) {
    throw new Error(
      artifactResult.error ||
      "Staged artifact could not be loaded."
    );
  }

  const manifest =
    artifactResult.manifest;

  if (
    manifest.status !==
    "ready_for_review"
  ) {
    throw new Error(
      `Capability artifact must be ready_for_review before validation. Current: ${manifest.status}`
    );
  }

  if (
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length === 0
  ) {
    throw new Error(
      "Capability artifact contains no files."
    );
  }

  const integrity =
    verifyArtifact(changeId);

  if (!integrity.ok) {
    throw new Error(
      "Staged artifact integrity verification failed."
    );
  }

  const artifactResults = [];

  for (
    const artifact of manifest.artifacts
  ) {
    const stagedPath =
      path.join(
        PROJECT_ROOT,
        "staging",
        "changes",
        changeId,
        "proposed",
        artifact.path
      );

    const result =
      validateStagedArtifact({
        resourcePath:
          artifact.path,

        stagedPath,

        category:
          manifest.category ||
          "other",

        expectedSha256:
          artifact.sha256
      });

    artifactResults.push({
      path:
        artifact.path,

      ok:
        result.ok === true,

      result
    });
  }

  const artifactsValid =
    artifactResults.length > 0 &&
    artifactResults.every(
      item =>
        item.ok === true
    );

  if (!artifactsValid) {
    return {
      ok: false,

      status:
        "validation_failed",

      changeId,

      integrity,

      artifacts:
        artifactResults,

      executionAllowed:
        false,

      approvalRequired:
        true,

      applyAllowed:
        false,

      activationAllowed:
        false
    };
  }

  return {
    ok: true,

    status:
      "validated",

    changeId,

    integrity: {
      ok:
        integrity.ok,

      fileCount:
        integrity.fileCount
    },

    artifacts:
      artifactResults,

    executionAllowed:
      false,

    approvalRequired:
      true,

    applyAllowed:
      false,

    activationAllowed:
      false
  };
}

module.exports = {
  validateCapabilityArtifact
};
