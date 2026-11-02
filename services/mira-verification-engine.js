"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const BLOCKED_BASENAMES = new Set([
  ".env",
  ".env~",
  "client_secret.json",
  "google-token.json"
]);

const MAX_RESOURCES = 50;

function normalizeResource(resource) {
  if (typeof resource !== "string") {
    return "";
  }

  return resource
    .trim()
    .replace(/\\/g, "/");
}

function isSafeResource(resource) {
  const normalized = normalizeResource(resource);

  if (!normalized) {
    return false;
  }

  if (
    normalized.startsWith("/") ||
    normalized.includes("..") ||
    normalized.includes("\0")
  ) {
    return false;
  }

  const basename =
    normalized.split("/").pop();

  if (BLOCKED_BASENAMES.has(basename)) {
    return false;
  }

  if (normalized.endsWith("/")) {
    return false;
  }

  return true;
}

function safeProjectPath(resource) {
  const normalized =
    normalizeResource(resource);

  if (!isSafeResource(normalized)) {
    throw new Error(
      "Unsafe verification resource: " +
        normalized
    );
  }

  const target =
    path.resolve(
      PROJECT_ROOT,
      normalized
    );

  const relative =
    path.relative(
      PROJECT_ROOT,
      target
    );

  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      "Verification resource escaped project root."
    );
  }

  return target;
}

function normalizeResources(resources) {
  if (!Array.isArray(resources)) {
    return [];
  }

  return [
    ...new Set(
      resources
        .map(normalizeResource)
        .filter(isSafeResource)
    )
  ].slice(0, MAX_RESOURCES);
}

function runNodeSyntaxCheck(resource) {
  const target = safeProjectPath(resource);

  if (!fs.existsSync(target)) {
    return {
      ok: false,
      resource,
      status: "missing",
      message:
        "Verification target does not exist."
    };
  }

  const stat = fs.statSync(target);

  if (!stat.isFile()) {
    return {
      ok: false,
      resource,
      status: "not_a_file",
      message:
        "Verification target is not a regular file."
    };
  }

  if (!resource.toLowerCase().endsWith(".js")) {
    return {
      ok: true,
      resource,
      status: "not_applicable",
      message:
        "Syntax check skipped for non-JavaScript resource."
    };
  }

  const result = spawnSync(
    process.execPath,
    ["--check", target],
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
      resource,
      status: "execution_error",
      message: result.error.message
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      resource,
      status: "syntax_failed",
      exitCode: result.status,
      stdout: String(
        result.stdout || ""
      ).slice(0, 4000),
      stderr: String(
        result.stderr || ""
      ).slice(0, 4000)
    };
  }

  return {
    ok: true,
    resource,
    status: "syntax_passed",
    exitCode: 0
  };
}

function runStructuralCheck(
  resource,
  category
) {
  const target = safeProjectPath(resource);

  if (!fs.existsSync(target)) {
    return {
      ok: false,
      resource,
      status: "missing"
    };
  }

  const stat = fs.statSync(target);

  if (!stat.isFile()) {
    return {
      ok: false,
      resource,
      status: "not_a_file"
    };
  }

  if (
    category !== "tool" ||
    !resource.toLowerCase().endsWith(".js")
  ) {
    return {
      ok: true,
      resource,
      status: "structural_passed"
    };
  }

  try {
    const resolved =
      require.resolve(target);

    delete require.cache[resolved];

    const tool = require(target);

    const valid =
      tool &&
      typeof tool === "object" &&
      typeof tool.name === "string" &&
      tool.name.trim().length > 0 &&
      tool.declaration &&
      typeof tool.declaration === "object" &&
      typeof tool.execute === "function";

    return {
      ok: valid,
      resource,
      status: valid
        ? "tool_structure_passed"
        : "tool_structure_failed",
      interface: {
        name:
          typeof tool?.name === "string",
        declaration:
          !!tool?.declaration,
        execute:
          typeof tool?.execute === "function"
      }
    };
  } catch (error) {
    return {
      ok: false,
      resource,
      status: "module_load_failed",
      message: error.message
    };
  }
}

async function runToolHealthCheck() {
  const healthPath =
    path.join(
      PROJECT_ROOT,
      "tools",
      "tool-health.js"
    );

  if (!fs.existsSync(healthPath)) {
    return {
      ok: false,
      status: "health_checker_missing"
    };
  }

  try {
    const health =
      require(healthPath);

    if (
      !health ||
      typeof health.execute !== "function"
    ) {
      return {
        ok: false,
        status: "health_checker_invalid"
      };
    }

    const raw =
      await health.execute();

    let parsed;

    try {
      parsed =
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw;
    } catch (error) {
      return {
        ok: false,
        status: "health_result_invalid",
        message: error.message
      };
    }

    return {
      ok: parsed?.success === true,
      status:
        parsed?.success === true
          ? "health_passed"
          : "health_failed",
      result: parsed
    };
  } catch (error) {
    return {
      ok: false,
      status: "health_execution_failed",
      message: error.message
    };
  }
}

async function runVerification(options = {}) {
  const resources =
    normalizeResources(
      options.resources
    );

  const category =
    typeof options.category === "string"
      ? options.category
          .trim()
          .toLowerCase()
      : "other";

  const phase =
    options.phase === "post_apply"
      ? "post_apply"
      : "pre_apply";

  const syntaxResults =
    resources.map(
      runNodeSyntaxCheck
    );

  const structuralResults =
    resources.map(resource =>
      runStructuralCheck(
        resource,
        category
      )
    );

  const syntaxPassed =
    syntaxResults.every(
      result => result.ok
    );

  const structuralPassed =
    structuralResults.every(
      result => result.ok
    );

  let health = {
    ok: true,
    status: "not_required"
  };

  if (
    phase === "post_apply" &&
    category === "tool"
  ) {
    health =
      await runToolHealthCheck();
  }

  const ok =
    syntaxPassed &&
    structuralPassed &&
    health.ok;

  return {
    ok,
    status: ok
      ? "verification_passed"
      : "verification_failed",
    phase,
    category,
    resourceCount:
      resources.length,
    tests: {
      syntax: {
        ok: syntaxPassed,
        results: syntaxResults
      },
      structural: {
        ok: structuralPassed,
        results: structuralResults
      },
      health
    }
  };
}

module.exports = {
  runVerification,
  runNodeSyntaxCheck,
  runStructuralCheck,
  runToolHealthCheck
};
