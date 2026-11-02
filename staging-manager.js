"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PROJECT_ROOT = path.resolve(__dirname);
const STAGING_ROOT = path.join(
  PROJECT_ROOT,
  "staging",
  "changes"
);

const BLOCKED_BASENAMES = new Set([
  ".env",
  ".env~",
  "client_secret.json",
  "google-token.json"
]);

const ALLOWED_ARTIFACT_ROOTS = [
  "tools/",
  "services/",
  "routes/",
  "public/"
];

const MAX_ARTIFACT_SIZE = 5 * 1024 * 1024;

function now() {
  return new Date().toISOString();
}

function createId() {
  return `artifact-${Date.now()}-${crypto
    .randomBytes(6)
    .toString("hex")}`;
}

function validateChangeId(changeId) {
  if (
    typeof changeId !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(changeId)
  ) {
    throw new Error("Invalid changeId");
  }
}


function assertNoSymlinkPath(targetPath, boundaryPath = PROJECT_ROOT) {
  const boundary = path.resolve(boundaryPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(boundary, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Filesystem boundary traversal blocked");
  }

  let current = boundary;
  const components = relative.split(path.sep).filter(Boolean);

  for (const candidate of [current, ...components.map(part => {
    current = path.join(current, part);
    return current;
  })]) {
    let stat;
    try {
      stat = fs.lstatSync(candidate);
    } catch (error) {
      if (error && error.code === "ENOENT") break;
      throw error;
    }

    if (stat.isSymbolicLink()) {
      throw new Error("Symlink path blocked");
    }
  }
}

function safeRelativePath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath.trim()
  ) {
    throw new Error("Invalid artifact path");
  }

  const clean = relativePath
    .replace(/\\/g, "/")
    .trim();

  if (
    clean.startsWith("/") ||
    clean.includes("\0")
  ) {
    throw new Error("Unsafe artifact path");
  }

  const absolute = path.resolve(
    PROJECT_ROOT,
    clean
  );

  const relative = path.relative(
    PROJECT_ROOT,
    absolute
  );

  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Artifact path traversal blocked");
  }

  assertNoSymlinkPath(absolute, PROJECT_ROOT);

  const basename = path.basename(clean);

  if (BLOCKED_BASENAMES.has(basename)) {
    throw new Error(
      `Sensitive artifact blocked: ${basename}`
    );
  }

  const normalized =
    clean.endsWith("/")
      ? clean
      : clean;

  const allowed =
    ALLOWED_ARTIFACT_ROOTS.some(
      root =>
        normalized === root.slice(0, -1) ||
        normalized.startsWith(root)
    );

  if (!allowed) {
    throw new Error(
      `Artifact path not allowed: ${clean}`
    );
  }

  return clean;
}

function artifactDir(changeId) {
  validateChangeId(changeId);

  return path.join(
    STAGING_ROOT,
    changeId
  );
}

function manifestPath(changeId) {
  return path.join(
    artifactDir(changeId),
    "manifest.json"
  );
}

function ensureDir(dir) {
  fs.mkdirSync(dir, {
    recursive: true
  });
}

function atomicWriteJson(filePath, data) {
  const tempPath =
    `${filePath}.${process.pid}.tmp`;

  fs.writeFileSync(
    tempPath,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(
    tempPath,
    filePath
  );
}

function sha256Buffer(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function readManifest(changeId) {
  const file = manifestPath(changeId);

  if (!fs.existsSync(file)) {
    throw new Error(
      "Staging manifest not found"
    );
  }

  const manifest =
    JSON.parse(
      fs.readFileSync(
        file,
        "utf8"
      )
    );

  if (
    manifest.version !== 1 ||
    manifest.changeId !== changeId ||
    !Array.isArray(manifest.artifacts)
  ) {
    throw new Error(
      "Invalid staging manifest"
    );
  }

  return manifest;
}

function createArtifact(options = {}) {
  const {
    changeId,
    title = "",
    description = "",
    createdBy = "system",
    category = "self_improvement"
  } = options;

  try {
    validateChangeId(changeId);

    const dir =
      artifactDir(changeId);

    if (fs.existsSync(dir)) {
      return {
        ok: false,
        status: "artifact_exists",
        changeId
      };
    }

    ensureDir(
      path.join(
        dir,
        "proposed"
      )
    );

    ensureDir(
      path.join(
        dir,
        "tests"
      )
    );

    const manifest = {
      version: 1,
      artifactId: createId(),
      changeId,
      status: "draft",
      title: String(title || ""),
      description:
        String(description || ""),
      category:
        String(category || "self_improvement"),
      createdBy:
        String(createdBy || "system"),
      createdAt: now(),
      updatedAt: now(),
      artifacts: [],
      tests: [],
      validation:
        options.validation &&
        typeof options.validation === "object"
          ? options.validation
          : null
    };

    atomicWriteJson(
      manifestPath(changeId),
      manifest
    );

    return {
      ok: true,
      status: "artifact_created",
      artifactId:
        manifest.artifactId,
      changeId,
      manifest
    };
  } catch (error) {
    return {
      ok: false,
      status: "artifact_create_failed",
      error: error.message
    };
  }
}

function addArtifactFile(options = {}) {
  const {
    changeId,
    targetPath,
    content,
    description = ""
  } = options;

  try {
    const manifest =
      readManifest(changeId);

    if (
      typeof content !== "string"
    ) {
      throw new Error(
        "Artifact content must be a string"
      );
    }

    const safePath =
      safeRelativePath(targetPath);

    const buffer =
      Buffer.from(
        content,
        "utf8"
      );

    if (
      buffer.length >
      MAX_ARTIFACT_SIZE
    ) {
      throw new Error(
        "Artifact content is too large"
      );
    }

    const dir =
      path.join(
        artifactDir(changeId),
        "proposed",
        safePath
      );

    assertNoSymlinkPath(dir, PROJECT_ROOT);

    ensureDir(
      path.dirname(dir)
    );

    fs.writeFileSync(
      dir,
      buffer
    );

    const existingIndex =
      manifest.artifacts.findIndex(
        item =>
          item.path === safePath
      );

    const entry = {
      path: safePath,
      size: buffer.length,
      sha256:
        sha256Buffer(buffer),
      description:
        String(description || ""),
      updatedAt: now()
    };

    if (existingIndex >= 0) {
      manifest.artifacts[
        existingIndex
      ] = entry;
    } else {
      manifest.artifacts.push(entry);
    }

    manifest.updatedAt = now();

    atomicWriteJson(
      manifestPath(changeId),
      manifest
    );

    return {
      ok: true,
      status: "artifact_file_added",
      changeId,
      artifact: entry
    };
  } catch (error) {
    return {
      ok: false,
      status: "artifact_file_add_failed",
      error: error.message
    };
  }
}

function verifyArtifact(changeId) {
  try {
    const manifest =
      readManifest(changeId);

    const results = [];

    for (
      const item of manifest.artifacts
    ) {
      const file =
        path.join(
          artifactDir(changeId),
          "proposed",
          item.path
        );

      if (!fs.existsSync(file)) {
        results.push({
          path: item.path,
          ok: false,
          reason: "missing"
        });

        continue;
      }

      const stat =
        fs.statSync(file);

      if (!stat.isFile()) {
        results.push({
          path: item.path,
          ok: false,
          reason: "not_a_file"
        });

        continue;
      }

      const content =
        fs.readFileSync(file);

      const hash =
        sha256Buffer(content);

      results.push({
        path: item.path,
        ok:
          stat.size === item.size &&
          hash === item.sha256,
        sizeMatches:
          stat.size === item.size,
        hashMatches:
          hash === item.sha256
      });
    }

    const verified =
      results.length ===
        manifest.artifacts.length &&
      results.every(
        item => item.ok
      );

    return {
      ok: verified,
      status: verified
        ? "artifact_verified"
        : "artifact_verification_failed",
      changeId,
      artifactId:
        manifest.artifactId,
      fileCount: results.length,
      files: results
    };
  } catch (error) {
    return {
      ok: false,
      status: "artifact_verification_failed",
      error: error.message
    };
  }
}

function updateArtifactStatus(
  changeId,
  status
) {
  const allowedStatuses = new Set([
    "draft",
    "ready_for_review",
    "approved_for_apply",
    "applied",
    "rejected",
    "failed"
  ]);

  if (!allowedStatuses.has(status)) {
    return {
      ok: false,
      status: "invalid_artifact_status"
    };
  }

  try {
    const manifest =
      readManifest(changeId);

    manifest.status = status;
    manifest.updatedAt = now();

    atomicWriteJson(
      manifestPath(changeId),
      manifest
    );

    return {
      ok: true,
      status: "artifact_status_updated",
      changeId,
      artifactStatus: status
    };
  } catch (error) {
    return {
      ok: false,
      status: "artifact_status_update_failed",
      error: error.message
    };
  }
}

function getArtifact(changeId) {
  try {
    return {
      ok: true,
      status: "artifact_loaded",
      manifest:
        readManifest(changeId)
    };
  } catch (error) {
    return {
      ok: false,
      status: "artifact_load_failed",
      error: error.message
    };
  }
}

function getStagingStatus() {
  try {
    ensureDir(STAGING_ROOT);

    return {
      ok: true,
      stagingSystem: "operational",
      root:
        path.relative(
          PROJECT_ROOT,
          STAGING_ROOT
        ),
      productionModification:
        "approval_required",
      activeToolLoading:
        "disabled_until_apply"
    };
  } catch (error) {
    return {
      ok: false,
      stagingSystem: "unavailable",
      error: error.message
    };
  }
}

module.exports = {
  createArtifact,
  addArtifactFile,
  verifyArtifact,
  updateArtifactStatus,
  getArtifact,
  getStagingStatus,
  safeRelativePath
};
