"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PROJECT_ROOT = path.resolve(__dirname);
const SNAPSHOT_ROOT = path.join(
  PROJECT_ROOT,
  "backups",
  "changes"
);

const BLOCKED_FILES = new Set([
  ".env",
  ".env~",
  "client_secret.json",
  "google-token.json"
]);

function now() {
  return new Date().toISOString();
}

function createId() {
  return `snapshot-${Date.now()}-${crypto
    .randomBytes(6)
    .toString("hex")}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function validateChangeId(changeId) {
  if (
    typeof changeId !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(changeId)
  ) {
    throw new Error("Invalid changeId");
  }
}

function validateSnapshotId(snapshotId) {
  if (
    typeof snapshotId !== "string" ||
    !/^snapshot-[0-9]+-[a-f0-9]+$/.test(snapshotId)
  ) {
    throw new Error("Invalid snapshotId");
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

function safeProjectPath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath.trim()
  ) {
    throw new Error("Invalid file path");
  }

  const clean = relativePath
    .replace(/\\/g, "/")
    .trim();

  if (
    clean.startsWith("/") ||
    clean.includes("\0")
  ) {
    throw new Error("Unsafe file path");
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
    throw new Error("Path traversal blocked");
  }

  assertNoSymlinkPath(absolute, PROJECT_ROOT);

  if (BLOCKED_FILES.has(path.basename(absolute))) {
    throw new Error(
      `Sensitive file blocked: ${path.basename(absolute)}`
    );
  }

  return absolute;
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
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

function snapshotDir(changeId, snapshotId) {
  validateChangeId(changeId);
  validateSnapshotId(snapshotId);

  return path.join(
    SNAPSHOT_ROOT,
    changeId,
    snapshotId
  );
}

function createSnapshot(options = {}) {
  const {
    changeId,
    files,
    createdBy = "system",
    reason = "",
    maxFileSize = 5 * 1024 * 1024
  } = options;

  try {
    validateChangeId(changeId);

    if (!Array.isArray(files) || files.length === 0) {
      throw new Error(
        "At least one file is required"
      );
    }

    const uniqueFiles = [
      ...new Set(
        files.map(file => {
          if (typeof file !== "string") {
            throw new Error(
              "Every file path must be a string"
            );
          }

          return file.trim();
        })
      )
    ];

    const snapshotId = createId();
    const dir = snapshotDir(
      changeId,
      snapshotId
    );
    const filesDir = path.join(
      dir,
      "files"
    );

    ensureDir(filesDir);

    const manifest = [];

    for (const relativePath of uniqueFiles) {
      const source =
        safeProjectPath(relativePath);

      if (!fs.existsSync(source)) {
        throw new Error(
          `File not found: ${relativePath}`
        );
      }

      const stat = fs.statSync(source);

      if (!stat.isFile()) {
        throw new Error(
          `Not a regular file: ${relativePath}`
        );
      }

      if (stat.size > maxFileSize) {
        throw new Error(
          `File too large: ${relativePath}`
        );
      }

      const destination = path.join(
        filesDir,
        relativePath
      );

      ensureDir(
        path.dirname(destination)
      );

      fs.copyFileSync(
        source,
        destination
      );

      manifest.push({
        path: relativePath,
        size: stat.size,
        sha256: sha256(source)
      });
    }

    const metadata = {
      snapshotVersion: 1,
      snapshotId,
      changeId,
      createdAt: now(),
      createdBy,
      reason,
      fileCount: manifest.length,
      files: manifest
    };

    atomicWriteJson(
      path.join(dir, "metadata.json"),
      metadata
    );

    return {
      ok: true,
      status: "snapshot_created",
      snapshotId,
      changeId,
      fileCount: manifest.length,
      metadata
    };
  } catch (error) {
    return {
      ok: false,
      status: "snapshot_failed",
      error: error.message
    };
  }
}

function loadMetadata(
  changeId,
  snapshotId
) {
  const dir = snapshotDir(
    changeId,
    snapshotId
  );

  const metadataPath = path.join(
    dir,
    "metadata.json"
  );

  if (!fs.existsSync(metadataPath)) {
    throw new Error(
      "Snapshot metadata not found"
    );
  }

  const metadata = JSON.parse(
    fs.readFileSync(
      metadataPath,
      "utf8"
    )
  );

  if (
    metadata.snapshotVersion !== 1 ||
    metadata.snapshotId !== snapshotId ||
    metadata.changeId !== changeId ||
    !Array.isArray(metadata.files)
  ) {
    throw new Error(
      "Invalid snapshot metadata"
    );
  }

  return {
    dir,
    metadata
  };
}

function verifySnapshot(
  changeId,
  snapshotId
) {
  try {
    const {
      dir,
      metadata
    } = loadMetadata(
      changeId,
      snapshotId
    );

    const results = [];

    for (const item of metadata.files) {
      const filePath = path.join(
        dir,
        "files",
        item.path
      );

      if (!fs.existsSync(filePath)) {
        results.push({
          path: item.path,
          ok: false,
          reason: "missing"
        });

        continue;
      }

      const stat =
        fs.statSync(filePath);

      const actualHash =
        sha256(filePath);

      results.push({
        path: item.path,
        ok:
          stat.size === item.size &&
          actualHash === item.sha256,
        sizeMatches:
          stat.size === item.size,
        hashMatches:
          actualHash === item.sha256
      });
    }

    const verified =
      results.length === metadata.fileCount &&
      results.every(item => item.ok);

    return {
      ok: verified,
      status: verified
        ? "snapshot_verified"
        : "snapshot_verification_failed",
      snapshotId,
      changeId,
      fileCount: results.length,
      files: results
    };
  } catch (error) {
    return {
      ok: false,
      status: "snapshot_verification_failed",
      error: error.message
    };
  }
}

function restoreSnapshot(
  changeId,
  snapshotId,
  options = {}
) {
  const {
    confirm = false,
    restoredBy = "system"
  } = options;

  if (confirm !== true) {
    return {
      ok: false,
      status: "confirmation_required"
    };
  }

  try {
    const {
      dir,
      metadata
    } = loadMetadata(
      changeId,
      snapshotId
    );

    const verification =
      verifySnapshot(
        changeId,
        snapshotId
      );

    if (!verification.ok) {
      return {
        ok: false,
        status: "restore_blocked",
        reason:
          "Snapshot integrity verification failed"
      };
    }

    const restored = [];

    for (const item of metadata.files) {
      const source = path.join(
        dir,
        "files",
        item.path
      );

      const destination =
        safeProjectPath(item.path);

      ensureDir(
        path.dirname(destination)
      );

      const temp =
        `${destination}.${process.pid}.restore.tmp`;

      assertNoSymlinkPath(source, SNAPSHOT_ROOT);

      fs.copyFileSync(
        source,
        temp
      );

      fs.renameSync(
        temp,
        destination
      );

      restored.push({
        path: item.path,
        sha256: item.sha256
      });
    }

    return {
      ok: true,
      status: "snapshot_restored",
      snapshotId,
      changeId,
      restoredBy,
      restoredAt: now(),
      fileCount: restored.length,
      files: restored
    };
  } catch (error) {
    return {
      ok: false,
      status: "snapshot_restore_failed",
      error: error.message
    };
  }
}

function listSnapshots(
  changeId = null
) {
  try {
    if (changeId !== null) {
      validateChangeId(changeId);
    }

    if (!fs.existsSync(SNAPSHOT_ROOT)) {
      return {
        ok: true,
        snapshots: []
      };
    }

    let changeIds;

    if (changeId) {
      changeIds = [changeId];
    } else {
      changeIds = fs.readdirSync(
        SNAPSHOT_ROOT,
        { withFileTypes: true }
      )
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    }

    const snapshots = [];

    for (const currentChangeId of changeIds) {
      const dir = path.join(
        SNAPSHOT_ROOT,
        currentChangeId
      );

      if (!fs.existsSync(dir)) {
        continue;
      }

      const entries = fs.readdirSync(
        dir,
        { withFileTypes: true }
      );

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        try {
          const {
            metadata
          } = loadMetadata(
            currentChangeId,
            entry.name
          );

          snapshots.push({
            snapshotId:
              metadata.snapshotId,
            changeId:
              metadata.changeId,
            createdAt:
              metadata.createdAt,
            createdBy:
              metadata.createdBy,
            fileCount:
              metadata.fileCount,
            reason:
              metadata.reason
          });
        } catch {
          // Ignore invalid snapshot directories.
        }
      }
    }

    snapshots.sort(
      (a, b) =>
        String(b.createdAt).localeCompare(
          String(a.createdAt)
        )
    );

    return {
      ok: true,
      snapshots
    };
  } catch (error) {
    return {
      ok: false,
      status: "snapshot_list_failed",
      error: error.message
    };
  }
}

function getSnapshotStatus() {
  try {
    ensureDir(SNAPSHOT_ROOT);

    const result =
      listSnapshots();

    return {
      ok: result.ok,
      snapshotSystem:
        result.ok
          ? "operational"
          : "degraded",
      root:
        path.relative(
          PROJECT_ROOT,
          SNAPSHOT_ROOT
        ),
      totalSnapshots:
        result.ok
          ? result.snapshots.length
          : 0,
      productionModification:
        "approval_required",
      automaticRestore: false
    };
  } catch (error) {
    return {
      ok: false,
      snapshotSystem: "unavailable",
      error: error.message
    };
  }
}

module.exports = {
  createSnapshot,
  verifySnapshot,
  restoreSnapshot,
  listSnapshots,
  getSnapshotStatus
};
