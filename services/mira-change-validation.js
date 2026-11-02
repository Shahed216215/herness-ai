"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const BLOCKED_BASENAMES = new Set([
  ".env",
  ".env~",
  "client_secret.json",
  "google-token.json",
  "google-token.json~"
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/
];

function normalizeRelativePath(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\\/g, "/");
}

function isSafeRelativePath(value) {
  const normalized = normalizeRelativePath(value);

  if (!normalized) {
    return false;
  }

  if (
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").includes("..")
  ) {
    return false;
  }

  const basename = normalized.split("/").pop();

  if (BLOCKED_BASENAMES.has(basename)) {
    return false;
  }

  return true;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function syntaxCheck(stagedPath) {
  const result = spawnSync(
    process.execPath,
    ["--check", stagedPath],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true
    }
  );

  if (result.error) {
    return {
      ok: false,
      status: "syntax_execution_error",
      message: result.error.message
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      status: "syntax_failed",
      exitCode: result.status,
      stderr: String(result.stderr || "").slice(0, 4000)
    };
  }

  return {
    ok: true,
    status: "syntax_passed"
  };
}

function structuralCheck(resourcePath, stagedPath, category) {
  if (!fs.existsSync(stagedPath)) {
    return {
      ok: false,
      status: "staged_artifact_missing"
    };
  }

  const stat = fs.statSync(stagedPath);

  if (!stat.isFile()) {
    return {
      ok: false,
      status: "staged_artifact_not_file"
    };
  }

  if (stat.size > MAX_FILE_SIZE) {
    return {
      ok: false,
      status: "staged_artifact_too_large"
    };
  }

  if (!isSafeRelativePath(resourcePath)) {
    return {
      ok: false,
      status: "unsafe_artifact_path"
    };
  }

  if (
    category === "tool" &&
    resourcePath.toLowerCase().endsWith(".js")
  ) {
    const source = fs.readFileSync(
      stagedPath,
      "utf8"
    );

    const hasModuleExport =
      /module\.exports\s*=/.test(source) ||
      /exports\.[A-Za-z_$][\w$]*\s*=/.test(source);

    if (!hasModuleExport) {
      return {
        ok: false,
        status: "tool_export_structure_failed"
      };
    }
  }

  return {
    ok: true,
    status: "structural_passed"
  };
}

function securityCheck(resourcePath, stagedPath) {
  if (!isSafeRelativePath(resourcePath)) {
    return {
      ok: false,
      status: "unsafe_resource_path"
    };
  }

  const source =
    fs.readFileSync(
      stagedPath,
      "utf8"
    );

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(source)) {
      return {
        ok: false,
        status: "credential_pattern_detected"
      };
    }
  }

  return {
    ok: true,
    status: "security_passed"
  };
}

function artifactIntegrityCheck(
  resourcePath,
  stagedPath,
  expectedSha256
) {
  if (
    typeof expectedSha256 !== "string" ||
    !expectedSha256
  ) {
    return {
      ok: false,
      status: "artifact_hash_missing"
    };
  }

  const actualSha256 =
    sha256File(stagedPath);

  return {
    ok: actualSha256 === expectedSha256,
    status:
      actualSha256 === expectedSha256
        ? "artifact_integrity_passed"
        : "artifact_integrity_failed",
    expectedSha256,
    actualSha256
  };
}

function runDeclaredTest(command, cwd) {
  if (
    typeof command !== "string" ||
    !command.trim()
  ) {
    return {
      ok: false,
      status: "test_command_missing"
    };
  }

  /*
   * Deliberately execute through the shell only for
   * administrator-approved validation commands stored
   * in the artifact manifest.
   */
  const result = spawnSync(
    "sh",
    ["-c", command],
    {
      cwd,
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true
    }
  );

  if (result.error) {
    return {
      ok: false,
      status: "test_execution_error",
      message: result.error.message
    };
  }

  return {
    ok: result.status === 0,
    status:
      result.status === 0
        ? "test_passed"
        : "test_failed",
    exitCode: result.status,
    stdout: String(result.stdout || "").slice(0, 4000),
    stderr: String(result.stderr || "").slice(0, 4000)
  };
}

function validateStagedArtifact(options = {}) {
  const resourcePath =
    normalizeRelativePath(
      options.resourcePath
    );

  const stagedPath =
    typeof options.stagedPath === "string"
      ? path.resolve(options.stagedPath)
      : "";

  const category =
    typeof options.category === "string"
      ? options.category.trim().toLowerCase()
      : "other";

  if (!isSafeRelativePath(resourcePath)) {
    return {
      ok: false,
      status: "validation_blocked",
      reason: "unsafe_artifact_path"
    };
  }

  const relativeStaged =
    stagedPath
      ? path.relative(
          PROJECT_ROOT,
          stagedPath
        )
      : "";

  if (
    !stagedPath ||
    relativeStaged.startsWith("..") ||
    path.isAbsolute(relativeStaged)
  ) {
    return {
      ok: false,
      status: "validation_blocked",
      reason: "staged_path_outside_project"
    };
  }

  if (!fs.existsSync(stagedPath)) {
    return {
      ok: false,
      status: "validation_blocked",
      reason: "staged_artifact_missing"
    };
  }

  const syntax =
    resourcePath.toLowerCase().endsWith(".js")
      ? syntaxCheck(stagedPath)
      : {
          ok: true,
          status: "not_applicable"
        };

  const structural =
    structuralCheck(
      resourcePath,
      stagedPath,
      category
    );

  const security =
    securityCheck(
      resourcePath,
      stagedPath
    );

  const integrity =
    artifactIntegrityCheck(
      resourcePath,
      stagedPath,
      options.expectedSha256
    );

  const ok =
    syntax.ok &&
    structural.ok &&
    security.ok &&
    integrity.ok;

  return {
    ok,
    status: ok
      ? "validation_passed"
      : "validation_failed",
    resource: resourcePath,
    tests: {
      syntax,
      structural,
      security,
      integrity
    }
  };
}

function runValidationTests(
  validation
) {
  const tests =
    validation &&
    Array.isArray(validation.tests)
      ? validation.tests
      : [];

  if (tests.length === 0) {
    return {
      ok: false,
      status: "required_tests_missing",
      unit: {
        ok: false,
        status: "unit_tests_missing"
      },
      integration: {
        ok: false,
        status: "integration_tests_missing"
      }
    };
  }

  const unitTests =
    tests.filter(
      test =>
        test &&
        test.type === "unit"
    );

  const integrationTests =
    tests.filter(
      test =>
        test &&
        test.type === "integration"
    );

  if (
    unitTests.length === 0 ||
    integrationTests.length === 0
  ) {
    return {
      ok: false,
      status: "required_test_category_missing",
      unit: {
        ok: unitTests.length > 0,
        status:
          unitTests.length > 0
            ? "unit_tests_declared"
            : "unit_tests_missing"
      },
      integration: {
        ok: integrationTests.length > 0,
        status:
          integrationTests.length > 0
            ? "integration_tests_declared"
            : "integration_tests_missing"
      }
    };
  }

  const unitResults =
    unitTests.map(test =>
      runDeclaredTest(
        test.command,
        PROJECT_ROOT
      )
    );

  const integrationResults =
    integrationTests.map(test =>
      runDeclaredTest(
        test.command,
        PROJECT_ROOT
      )
    );

  const unitOk =
    unitResults.every(
      result => result.ok
    );

  const integrationOk =
    integrationResults.every(
      result => result.ok
    );

  return {
    ok:
      unitOk &&
      integrationOk,
    status:
      unitOk && integrationOk
        ? "tests_passed"
        : "tests_failed",
    unit: {
      ok: unitOk,
      results: unitResults
    },
    integration: {
      ok: integrationOk,
      results: integrationResults
    }
  };
}

module.exports = {
  validateStagedArtifact,
  runValidationTests,
  normalizeRelativePath,
  isSafeRelativePath
};
