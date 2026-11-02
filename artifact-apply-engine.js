"use strict";

const { validateStagedArtifact, runValidationTests } = require("./services/mira-change-validation");


const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  getArtifact,
  updateArtifactStatus,
  safeRelativePath
} = require("./staging-manager");

const {
  getProposal
} = require("./change-management");

const PROJECT_ROOT = path.resolve(__dirname);

const BACKUP_ROOT = path.join(
  PROJECT_ROOT,
  "backups",
  "artifact-applies"
);

const MAX_FILE_SIZE =
  5 * 1024 * 1024;

const LOCK_STALE_MS =
  15 * 60 * 1000;

const RECOVERY_STATUSES = new Set([
  "applying",
  "rollback_in_progress",
  "recovery_required"
]);

function sha256(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function ensureChangeId(changeId) {
  if (
    typeof changeId !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(changeId)
  ) {
    throw new Error("Invalid changeId.");
  }
}

function safeProjectPath(relativePath) {
  const safe =
    safeRelativePath(relativePath);

  if (!safe) {
    throw new Error(
      `Unsafe target path: ${relativePath}`
    );
  }

  const absolute =
    path.resolve(
      PROJECT_ROOT,
      safe
    );

  const relative =
    path.relative(
      PROJECT_ROOT,
      absolute
    );

  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Target escapes project root: ${relativePath}`
    );
  }

  return {
    relativePath: safe,
    absolutePath: absolute
  };
}

function stagingFilePath(
  changeId,
  relativePath
) {
  ensureChangeId(changeId);

  const safe =
    safeRelativePath(relativePath);

  if (!safe) {
    throw new Error(
      `Unsafe staged path: ${relativePath}`
    );
  }

  const stagedRoot =
    path.resolve(
      PROJECT_ROOT,
      "staging",
      "changes",
      changeId,
      "proposed"
    );

  const absolute =
    path.resolve(
      stagedRoot,
      safe
    );

  const relative =
    path.relative(
      stagedRoot,
      absolute
    );

  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Staged file escapes staging root: ${relativePath}`
    );
  }

  return absolute;
}

function transactionPath(changeId) {
  ensureChangeId(changeId);

  return path.join(
    BACKUP_ROOT,
    changeId
  );
}

function lockPath(changeId) {
  return `${transactionPath(changeId)}.lock`;
}

function writeJson(
  filePath,
  data
) {
  fs.mkdirSync(
    path.dirname(filePath),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      data,
      null,
      2
    ),
    "utf8"
  );
}

function readJson(filePath) {
  return JSON.parse(
    fs.readFileSync(
      filePath,
      "utf8"
    )
  );
}

function isProcessAlive(pid) {
  if (
    !Number.isInteger(pid) ||
    pid <= 0
  ) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function acquireTransactionLock(
  changeId
) {
  ensureChangeId(changeId);

  const target =
    lockPath(changeId);

  fs.mkdirSync(
    path.dirname(target),
    {
      recursive: true
    }
  );

  try {
    fs.mkdirSync(target);
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }

    let lockInfo = null;

    try {
      lockInfo = readJson(
        path.join(
          target,
          "lock.json"
        )
      );
    } catch (readError) {
      lockInfo = null;
    }

    const lockAge =
      lockInfo?.createdAt
        ? Date.now() -
          Date.parse(
            lockInfo.createdAt
          )
        : Infinity;

    const active =
      Number.isInteger(
        lockInfo?.pid
      ) &&
      isProcessAlive(
        lockInfo.pid
      );

    if (
      active &&
      lockAge < LOCK_STALE_MS
    ) {
      throw new Error(
        "Transaction is locked by another active process."
      );
    }

    try {
      fs.rmSync(
        target,
        {
          recursive: true,
          force: true
        }
      );
    } catch (cleanupError) {
      throw new Error(
        `Unable to clear stale transaction lock: ${cleanupError.message}`
      );
    }

    fs.mkdirSync(target);

  }

  writeJson(
    path.join(
      target,
      "lock.json"
    ),
    {
      version: 1,
      changeId,
      pid: process.pid,
      createdAt:
        new Date().toISOString()
    }
  );

  return target;
}

function releaseTransactionLock(
  changeId
) {
  ensureChangeId(changeId);

  const target =
    lockPath(changeId);

  if (!fs.existsSync(target)) {
    return;
  }

  try {
    const lockInfo =
      readJson(
        path.join(
          target,
          "lock.json"
        )
      );

    if (
      lockInfo?.pid &&
      lockInfo.pid !== process.pid
    ) {
      return;
    }
  } catch (error) {
    // Continue cleanup for malformed local lock.
  }

  fs.rmSync(
    target,
    {
      recursive: true,
      force: true
    }
  );
}

function cleanupPath(target) {
  if (!target) {
    return;
  }

  try {
    fs.rmSync(
      target,
      {
        recursive: true,
        force: true
      }
    );
  } catch (error) {
    // Cleanup is best-effort.
  }
}

function prepareApply(changeId) {
  ensureChangeId(changeId);

  const proposal =
    getProposal(changeId);

  if (!proposal) {
    throw new Error(
      "Evolution proposal not found."
    );
  }

  if (
    proposal.status !==
    "approved"
  ) {
    throw new Error(
      "Proposal must be approved before apply."
    );
  }

  const artifact =
    getArtifact(changeId);

  if (
    !artifact ||
    !artifact.manifest
  ) {
    throw new Error(
      "Staging artifact not found."
    );
  }

  if (
    artifact.manifest.status !==
    "approved_for_apply"
  ) {
    throw new Error(
      "Artifact must be approved_for_apply before apply."
    );
  }

  if (
    !Array.isArray(
      artifact.manifest.artifacts
    ) ||
    artifact.manifest.artifacts.length ===
      0
  ) {
    throw new Error(
      "Staging artifact contains no files."
    );
  }

  const transactionRoot =
    transactionPath(changeId);

  if (
    fs.existsSync(
      transactionRoot
    )
  ) {
    throw new Error(
      "An apply transaction already exists for this change."
    );
  }

  const temporaryRoot =
    `${transactionRoot}.prepare-${process.pid}-${Date.now()}`;

  const manifest = {
    version: 2,
    changeId,
    createdAt:
      new Date().toISOString(),
    status: "prepared",
    files: []
  };

  try {
    fs.mkdirSync(
      path.join(
        temporaryRoot,
        "existing"
      ),
      {
        recursive: true
      }
    );

    for (
      const artifactEntry
      of artifact.manifest.artifacts
    ) {
      if (
        !artifactEntry ||
        typeof artifactEntry.path !==
          "string"
      ) {
        throw new Error(
          "Invalid artifact entry."
        );
      }

      const target =
        safeProjectPath(
          artifactEntry.path
        );

      const staged =
        stagingFilePath(
          changeId,
          artifactEntry.path
        );

      if (
        !fs.existsSync(staged)
      ) {
        throw new Error(
          `Staged file missing: ${artifactEntry.path}`
        );
      }

      const stagedStat =
        fs.statSync(staged);

      if (
        !stagedStat.isFile()
      ) {
        throw new Error(
          `Staged artifact is not a regular file: ${artifactEntry.path}`
        );
      }

      if (
        stagedStat.size >
        MAX_FILE_SIZE
      ) {
        throw new Error(
          `Artifact exceeds size limit: ${artifactEntry.path}`
        );
      }

      const stagedBuffer =
        fs.readFileSync(staged);

      const stagedHash =
        sha256(stagedBuffer);


    const validation = validateStagedArtifact({ resourcePath: artifactEntry.path, stagedPath: staged, expectedSha256: artifactEntry.sha256 || stagedHash, category: artifact.manifest.category || "other" });

    if (!validation.ok) { const error = new Error("Apply blocked: Stage 4.9 validation failed."); error.code = "MIRA_CHANGE_VALIDATION_FAILED"; error.validation = validation; throw error; }

    const validationTests = runValidationTests(artifact.manifest.validation);

    if (!validationTests.ok) { const error = new Error("Apply blocked: Stage 4.9 unit/integration tests failed."); error.code = "MIRA_CHANGE_TESTS_FAILED"; error.validation = validation; error.tests = validationTests; throw error; }
      if (
        artifactEntry.sha256 &&
        artifactEntry.sha256 !==
          stagedHash
      ) {
        throw new Error(
          `Staged artifact hash mismatch: ${artifactEntry.path}`
        );
      }

      const exists =
        fs.existsSync(
          target.absolutePath
        );

      let backupRelative = null;
      let originalHash = null;

      if (exists) {
        const stat =
          fs.statSync(
            target.absolutePath
          );

        if (!stat.isFile()) {
          throw new Error(
            `Target is not a regular file: ${artifactEntry.path}`
          );
        }

        const originalBuffer =
          fs.readFileSync(
            target.absolutePath
          );

        originalHash =
          sha256(
            originalBuffer
          );

        const backupPath =
          path.join(
            temporaryRoot,
            "existing",
            target.relativePath
          );

        fs.mkdirSync(
          path.dirname(
            backupPath
          ),
          {
            recursive: true
          }
        );

        fs.copyFileSync(
          target.absolutePath,
          backupPath
        );

        backupRelative =
          path.relative(
            temporaryRoot,
            backupPath
          );
      }

      manifest.files.push({
        targetPath:
          target.relativePath,
        stagedPath:
          artifactEntry.path,
        existedBefore:
          exists,
        backupPath:
          backupRelative,
        originalSha256:
          originalHash,
        stagedSha256:
          stagedHash
      });
    }

    writeJson(
      path.join(
        temporaryRoot,
        "transaction.json"
      ),
      manifest
    );

    if (
      fs.existsSync(
        transactionRoot
      )
    ) {
      throw new Error(
        "Apply transaction appeared during preparation."
      );
    }

    fs.renameSync(
      temporaryRoot,
      transactionRoot
    );

    return {
      ok: true,
      transactionRoot,
      manifest
    };

  } catch (error) {
    cleanupPath(
      temporaryRoot
    );

    throw error;
  }
}

function verifyPreparedIntegrity(
  changeId,
  manifest
) {
  const results = [];

  for (
    const file
    of manifest.files
  ) {
    const target =
      safeProjectPath(
        file.targetPath
      );

    const staged =
      stagingFilePath(
        changeId,
        file.stagedPath
      );

    if (
      !fs.existsSync(staged)
    ) {
      throw new Error(
        `Staged file missing during integrity check: ${file.stagedPath}`
      );
    }

    const stagedStat =
      fs.statSync(staged);

    if (
      !stagedStat.isFile()
    ) {
      throw new Error(
        `Staged file is not regular: ${file.stagedPath}`
      );
    }

    const stagedBuffer =
      fs.readFileSync(staged);

    const stagedHash =
      sha256(stagedBuffer);

    if (
      stagedHash !==
      file.stagedSha256
    ) {
      throw new Error(
        `Staged integrity mismatch: ${file.stagedPath}`
      );
    }

    const targetExists =
      fs.existsSync(
        target.absolutePath
      );

    if (
      file.existedBefore
    ) {
      if (!targetExists) {
        throw new Error(
          `Target disappeared before apply: ${file.targetPath}`
        );
      }

      const targetStat =
        fs.statSync(
          target.absolutePath
        );

      if (
        !targetStat.isFile()
      ) {
        throw new Error(
          `Target is not regular before apply: ${file.targetPath}`
        );
      }

      const currentHash =
        sha256(
          fs.readFileSync(
            target.absolutePath
          )
        );

      if (
        currentHash !==
        file.originalSha256
      ) {
        throw new Error(
          `Target changed after preparation: ${file.targetPath}`
        );
      }
    } else if (
      targetExists
    ) {
      throw new Error(
        `New target appeared after preparation: ${file.targetPath}`
      );
    }

    results.push({
      targetPath:
        file.targetPath,
      stagedSha256:
        stagedHash,
      originalSha256:
        file.originalSha256,
      targetExists
    });
  }

  return {
    ok: true,
    status:
      "prepared_integrity_verified",
    changeId,
    fileCount:
      results.length,
    files: results
  };
}

function verifyAppliedIntegrity(
  changeId,
  manifest
) {
  const results = [];

  for (
    const file
    of manifest.files
  ) {
    const target =
      safeProjectPath(
        file.targetPath
      );

    if (
      !fs.existsSync(
        target.absolutePath
      )
    ) {
      throw new Error(
        `Applied target is missing: ${file.targetPath}`
      );
    }

    const stat =
      fs.statSync(
        target.absolutePath
      );

    if (!stat.isFile()) {
      throw new Error(
        `Applied target is not a regular file: ${file.targetPath}`
      );
    }

    const currentHash =
      sha256(
        fs.readFileSync(
          target.absolutePath
        )
      );

    if (
      currentHash !==
      file.stagedSha256
    ) {
      throw new Error(
        `Post-apply integrity mismatch: ${file.targetPath}`
      );
    }

    results.push({
      targetPath:
        file.targetPath,
      expectedSha256:
        file.stagedSha256,
      actualSha256:
        currentHash,
      ok: true
    });
  }

  return {
    ok: true,
    status:
      "applied_integrity_verified",
    changeId,
    fileCount:
      results.length,
    files: results
  };
}

function applyPreparedChange(
  changeId
) {
  ensureChangeId(changeId);

  const transactionRoot =
    transactionPath(changeId);

  const transactionFile =
    path.join(
      transactionRoot,
      "transaction.json"
    );

  if (
    !fs.existsSync(
      transactionFile
    )
  ) {
    throw new Error(
      "Apply transaction has not been prepared."
    );
  }

  const lock =
    acquireTransactionLock(
      changeId
    );

  try {
    const manifest =
      readJson(transactionFile);

    if (
      ![
        "prepared",
        "applying"
      ].includes(
        manifest.status
      )
    ) {
      throw new Error(
        `Transaction cannot be applied from status: ${manifest.status}`
      );
    }

    const preflight =
      verifyPreparedIntegrity(
        changeId,
        manifest
      );

    manifest.status =
      "applying";

    manifest.applyStartedAt =
      new Date().toISOString();

    writeJson(
      transactionFile,
      manifest
    );

    try {
      for (
        const file
        of manifest.files
      ) {
        const target =
          safeProjectPath(
            file.targetPath
          );

        const staged =
          stagingFilePath(
            changeId,
            file.stagedPath
          );

        if (
          !fs.existsSync(staged)
        ) {
          throw new Error(
            `Staged file missing during apply: ${file.stagedPath}`
          );
        }

        const targetBuffer =
          fs.readFileSync(staged);

        fs.mkdirSync(
          path.dirname(
            target.absolutePath
          ),
          {
            recursive: true
          }
        );

        const tempPath =
          `${target.absolutePath}.mira-apply-tmp-${process.pid}`;

        fs.writeFileSync(
          tempPath,
          targetBuffer
        );

        fs.renameSync(
          tempPath,
          target.absolutePath
        );
      }

      const postflight =
        verifyAppliedIntegrity(
          changeId,
          manifest
        );

      manifest.status =
        "applied";

      manifest.appliedAt =
        new Date().toISOString();

      manifest.preflight =
        preflight;

      manifest.postflight =
        postflight;

      writeJson(
        transactionFile,
        manifest
      );

      const artifactUpdate =
        updateArtifactStatus(
          changeId,
          "applied"
        );

      if (
        !artifactUpdate?.ok
      ) {
        throw new Error(
          artifactUpdate?.error ||
          "Unable to update artifact status after apply."
        );
      }

      return {
        ok: true,
        status: "applied",
        changeId,
        files:
          manifest.files.length,
        preflight,
        postflight
      };

    } catch (error) {
      manifest.status =
        "applying";

      manifest.lastError =
        error.message;

      writeJson(
        transactionFile,
        manifest
      );

      try {
        const rollback =
          rollbackPreparedChange(
            changeId,
            {
              lockAlreadyHeld: true
            }
          );

        throw new Error(
          `${error.message} | Automatic rollback completed: ${rollback.status}`
        );
      } catch (rollbackError) {
        if (
          rollbackError.message.startsWith(
            `${error.message} | Automatic rollback completed:`
          )
        ) {
          throw rollbackError;
        }

        try {
          manifest.status =
            "recovery_required";

          manifest.recoveryRequiredAt =
            new Date().toISOString();

          manifest.recoveryError =
            rollbackError.message;

          writeJson(
            transactionFile,
            manifest
          );
        } catch (writeError) {
          // Preserve the original recovery failure.
        }

        throw new Error(
          `${error.message} | Rollback failed: ${rollbackError.message}`
        );
      }
    }

  } finally {
    releaseTransactionLock(
      changeId
    );
  }
}

function rollbackPreparedChange(
  changeId,
  options = {}
) {
  const lockAlreadyHeld =
    options.lockAlreadyHeld === true;
  ensureChangeId(changeId);

  const transactionRoot =
    transactionPath(changeId);

  const transactionFile =
    path.join(
      transactionRoot,
      "transaction.json"
    );

  if (
    !fs.existsSync(
      transactionFile
    )
  ) {
    throw new Error(
      "Apply transaction not found."
    );
  }

  let lock = null;

  if (!lockAlreadyHeld) {
    lock =
      acquireTransactionLock(
        changeId
      );
  }

  try {
    const manifest =
      readJson(transactionFile);

    if (
      ![
        "prepared",
        "applying",
        "applied",
        "recovery_required"
      ].includes(
        manifest.status
      )
    ) {
      throw new Error(
        `Transaction cannot be rolled back from status: ${manifest.status}`
      );
    }

    manifest.status =
      "rollback_in_progress";

    manifest.rollbackStartedAt =
      new Date().toISOString();

    writeJson(
      transactionFile,
      manifest
    );

    try {
      for (
        const file
        of manifest.files
      ) {
        const target =
          safeProjectPath(
            file.targetPath
          );

        if (
          file.existedBefore
        ) {
          const backupPath =
            path.join(
              transactionRoot,
              file.backupPath
            );

          if (
            !fs.existsSync(
              backupPath
            )
          ) {
            throw new Error(
              `Backup file missing: ${file.targetPath}`
            );
          }

          const backupStat =
            fs.statSync(
              backupPath
            );

          if (
            !backupStat.isFile()
          ) {
            throw new Error(
              `Backup is not a regular file: ${file.targetPath}`
            );
          }

          const backupBuffer =
            fs.readFileSync(
              backupPath
            );

          if (
            file.originalSha256 &&
            sha256(
              backupBuffer
            ) !==
              file.originalSha256
          ) {
            throw new Error(
              `Backup integrity mismatch: ${file.targetPath}`
            );
          }

          fs.mkdirSync(
            path.dirname(
              target.absolutePath
            ),
            {
              recursive: true
            }
          );

          const tempPath =
            `${target.absolutePath}.mira-rollback-tmp-${process.pid}`;

          fs.writeFileSync(
            tempPath,
            backupBuffer
          );

          fs.renameSync(
            tempPath,
            target.absolutePath
          );

        } else if (
          fs.existsSync(
            target.absolutePath
          )
        ) {
          fs.unlinkSync(
            target.absolutePath
          );
        }
      }

      for (
        const file
        of manifest.files
      ) {
        const target =
          safeProjectPath(
            file.targetPath
          );

        if (
          file.existedBefore
        ) {
          if (
            !fs.existsSync(
              target.absolutePath
            )
          ) {
            throw new Error(
              `Rollback target missing after restore: ${file.targetPath}`
            );
          }

          const restoredHash =
            sha256(
              fs.readFileSync(
                target.absolutePath
              )
            );

          if (
            restoredHash !==
            file.originalSha256
          ) {
            throw new Error(
              `Rollback integrity mismatch: ${file.targetPath}`
            );
          }
        } else if (
          fs.existsSync(
            target.absolutePath
          )
        ) {
          throw new Error(
            `New file still exists after rollback: ${file.targetPath}`
          );
        }
      }

      manifest.status =
        "rolled_back";

      manifest.rolledBackAt =
        new Date().toISOString();

      writeJson(
        transactionFile,
        manifest
      );

      const artifactUpdate =
        updateArtifactStatus(
          changeId,
          "failed"
        );

      if (
        !artifactUpdate?.ok
      ) {
        throw new Error(
          artifactUpdate?.error ||
          "Unable to update artifact status after rollback."
        );
      }

      return {
        ok: true,
        status: "rolled_back",
        changeId,
        files:
          manifest.files.length
      };

    } catch (error) {
      try {
        manifest.status =
          "recovery_required";

        manifest.recoveryRequiredAt =
          new Date().toISOString();

        manifest.recoveryError =
          error.message;

        writeJson(
          transactionFile,
          manifest
        );
      } catch (writeError) {
        // Preserve original error.
      }

      throw error;
    }

  } finally {
    if (!lockAlreadyHeld) {
      releaseTransactionLock(
        changeId
      );
    }
  }
}

function getArtifactApplyStatus(
  changeId
) {
  ensureChangeId(changeId);

  const transactionRoot =
    transactionPath(changeId);

  const transactionFile =
    path.join(
      transactionRoot,
      "transaction.json"
    );

  if (
    !fs.existsSync(transactionFile)
  ) {
    return {
      exists: false,
      changeId
    };
  }

  return {
    exists: true,
    changeId,
    transaction:
      readJson(transactionFile)
  };
}

module.exports = {
  prepareApply,
  applyPreparedChange,
  rollbackPreparedChange,
  getArtifactApplyStatus
};
