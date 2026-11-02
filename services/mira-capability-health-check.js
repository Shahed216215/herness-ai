"use strict";

const fs = require("fs");
const path = require("path");

const {
  getCapabilityRequest
} = require("../capability-request");

const {
  getArtifact
} = require("../staging-manager");

const PROJECT_ROOT =
  path.resolve(__dirname, "..");

function assertText(value, name) {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new Error(
      `${name} is required.`
    );
  }

  return value.trim();
}

function safeProjectPath(relativePath) {
  const value =
    assertText(
      relativePath,
      "artifact path"
    );

  if (
    path.isAbsolute(value) ||
    value.includes("\0")
  ) {
    throw new Error(
      "Unsafe artifact path."
    );
  }

  const normalized =
    path.normalize(value);

  if (
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(
      "Artifact path traversal is not allowed."
    );
  }

  return path.join(
    PROJECT_ROOT,
    normalized
  );
}

function checkSyntax(filePath) {
  const { spawnSync } =
    require("child_process");

  const result =
    spawnSync(
      process.execPath,
      ["--check", filePath],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        timeout: 30000
      }
    );

  return {
    ok: result.status === 0,
    status:
      result.status === 0
        ? "syntax_valid"
        : "syntax_invalid",
    exitCode:
      result.status,
    stderr:
      String(
        result.stderr || ""
      ).slice(0, 2000)
  };
}

function checkModuleLoad(filePath) {
  try {
    delete require.cache[
      require.resolve(filePath)
    ];

    const moduleValue =
      require(filePath);

    return {
      ok:
        !!moduleValue &&
        typeof moduleValue ===
          "object",
      status:
        "module_loaded"
    };
  } catch (error) {
    return {
      ok: false,
      status:
        "module_load_failed",
      error:
        error.message
    };
  }
}

function checkInactiveBoundary(
  filePath
) {
  const source =
    fs.readFileSync(
      filePath,
      "utf8"
    );

  const executionBlocked =
    /executionAllowed\s*:\s*false/.test(
      source
    );

  const activationBlocked =
    /activationAllowed\s*:\s*false/.test(
      source
    );

  const inactiveStatus =
    /status\s*:\s*["']staged_only["']/.test(
      source
    );

  const executionGuard =
    /STAGED_ARTIFACT_NOT_ACTIVE/.test(
      source
    );

  return {
    ok:
      executionBlocked &&
      activationBlocked &&
      inactiveStatus &&
      executionGuard,

    status:
      executionBlocked &&
      activationBlocked &&
      inactiveStatus &&
      executionGuard
        ? "inactive_boundary_verified"
        : "inactive_boundary_failed",

    executionAllowed:
      executionBlocked
        ? false
        : null,

    activationAllowed:
      activationBlocked
        ? false
        : null
  };
}

function healthCheckCapability(
  requestId
) {
  const id =
    assertText(
      requestId,
      "requestId"
    );

  const request =
    getCapabilityRequest(id);

  if (!request) {
    throw new Error(
      "Capability request could not be loaded."
    );
  }

  if (
    request.status !==
    "approved_for_controlled_apply"
  ) {
    throw new Error(
      `Capability request is not in an applied-ready state. Current: ${request.status}`
    );
  }

  if (!request.approval) {
    throw new Error(
      "Human approval record is required."
    );
  }

  if (
    request.approval.status !==
    "approved"
  ) {
    throw new Error(
      "Capability approval is not valid."
    );
  }

  if (!request.proposal) {
    throw new Error(
      "Capability proposal is missing."
    );
  }

  const changeId =
    request.proposal.changeId;

  const artifactResult =
    getArtifact(changeId);

  if (!artifactResult.ok) {
    throw new Error(
      artifactResult.error ||
      "Capability artifact could not be loaded."
    );
  }

  const manifest =
    artifactResult.manifest;

  if (
    manifest.status !==
    "applied"
  ) {
    throw new Error(
      `Capability artifact must be applied before health check. Current: ${manifest.status}`
    );
  }

  if (
    !Array.isArray(
      manifest.artifacts
    ) ||
    manifest.artifacts.length === 0
  ) {
    throw new Error(
      "Applied capability has no artifacts."
    );
  }

  const checks = [];

  for (
    const artifact
    of manifest.artifacts
  ) {
    const filePath =
      safeProjectPath(
        artifact.path
      );

    if (
      !fs.existsSync(filePath)
    ) {
      checks.push({
        path: artifact.path,
        ok: false,
        status:
          "applied_file_missing"
      });

      continue;
    }

    const stat =
      fs.statSync(filePath);

    if (
      !stat.isFile()
    ) {
      checks.push({
        path: artifact.path,
        ok: false,
        status:
          "applied_artifact_not_file"
      });

      continue;
    }

    const syntax =
      checkSyntax(
        filePath
      );

    const moduleLoad =
      syntax.ok
        ? checkModuleLoad(
            filePath
          )
        : {
            ok: false,
            status:
              "module_load_skipped"
          };

    const boundary =
      checkInactiveBoundary(
        filePath
      );

    checks.push({
      path:
        artifact.path,

      ok:
        syntax.ok &&
        moduleLoad.ok &&
        boundary.ok,

      syntax,
      moduleLoad,
      boundary
    });
  }

  const allHealthy =
    checks.length > 0 &&
    checks.every(
      check =>
        check.ok === true
    );

  return {
    ok:
      allHealthy,

    status:
      allHealthy
        ? "health_check_passed"
        : "health_check_failed",

    requestId: id,

    changeId,

    artifactStatus:
      manifest.status,

    checks,

    executionAllowed:
      false,

    activationAllowed:
      false,

    applyAllowed:
      false,

    healthCheckPassed:
      allHealthy
  };
}

module.exports = {
  healthCheckCapability
};
