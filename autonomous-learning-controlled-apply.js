"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');
const crypto = require("crypto");

const {
  getProposal,
  markProposalApplied
} = require("./autonomous-learning-proposals");

const {
  getKnowledge,
  addLearning
} = require("./knowledge");

const {
  loadKnowledgeFromDrive,
  saveKnowledgeToDrive
} = require("./google-drive");

const {
  createSnapshot,
  verifySnapshot,
  restoreSnapshot
} = require("./snapshot-manager");

const KNOWLEDGE_FILE = storagePath("knowledge.json");

function hashData(value) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(value, null, 2),
      "utf8"
    )
    .digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameData(a, b) {
  return hashData(a) === hashData(b);
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function findMatchingKnowledge(
  knowledge,
  learning
) {
  return knowledge.find(item =>
    normalize(item.title) ===
      normalize(learning.title) &&
    normalize(item.topic) ===
      normalize(learning.topic)
  );
}

function readLocalKnowledge() {
  if (!fs.existsSync(KNOWLEDGE_FILE)) {
    throw new Error(
      "knowledge.json not found"
    );
  }

  const raw = fs.readFileSync(
    KNOWLEDGE_FILE,
    "utf8"
  );

  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(
      "knowledge.json must contain an array"
    );
  }

  return parsed;
}

function writeLocalKnowledge(data) {
  const tempFile =
    `${KNOWLEDGE_FILE}.${process.pid}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(
    tempFile,
    KNOWLEDGE_FILE
  );
}

async function restoreDriveState(
  previousDrive
) {
  const result =
    await saveKnowledgeToDrive(
      clone(previousDrive)
    );

  if (!result) {
    throw new Error(
      "Google Drive restore returned no result"
    );
  }

  return result;
}

async function rollback({
  snapshotId,
  previousDrive,
  actor
}) {
  const rollbackResult =
    restoreSnapshot(
      "autonomous-learning",
      snapshotId,
      {
        confirm: true,
        restoredBy:
          actor || "system"
      }
    );

  if (!rollbackResult.ok) {
    throw new Error(
      `Local snapshot rollback failed: ${
        rollbackResult.error ||
        rollbackResult.status
      }`
    );
  }

  await restoreDriveState(
    previousDrive
  );

  const restoredLocal =
    readLocalKnowledge();

  const restoredDrive =
    await loadKnowledgeFromDrive();

  if (
    !sameData(
      restoredLocal,
      restoredDrive
    )
  ) {
    throw new Error(
      "Rollback verification failed: local and Drive data differ"
    );
  }

  return {
    ok: true,
    status: "rollback_verified"
  };
}

function createVerifiedSnapshot({
  changeId,
  actor
}) {
  const snapshot =
    createSnapshot({
      changeId:
        "autonomous-learning",
      files: [
        "knowledge.json"
      ],
      createdBy:
        actor || "system",
      reason:
        `Autonomous learning controlled apply: ${changeId}`
    });

  if (
    !snapshot ||
    snapshot.ok !== true
  ) {
    throw new Error(
      `Snapshot creation failed: ${
        snapshot?.error ||
        snapshot?.status ||
        "unknown error"
      }`
    );
  }

  const verification =
    verifySnapshot(
      "autonomous-learning",
      snapshot.snapshotId
    );

  if (
    !verification ||
    verification.ok !== true
  ) {
    throw new Error(
      `Snapshot verification failed: ${
        verification?.error ||
        verification?.status ||
        "unknown error"
      }`
    );
  }

  return snapshot;
}

async function applyAutonomousLearningControlled({
  changeId,
  actor = "system-admin"
} = {}) {
  if (
    typeof changeId !== "string" ||
    changeId.trim() === ""
  ) {
    return {
      ok: false,
      status: "invalid_change_id",
      error:
        "changeId is required"
    };
  }

  const proposal =
    getProposal(changeId);

  if (!proposal) {
    return {
      ok: false,
      status: "proposal_not_found",
      error:
        `Proposal not found: ${changeId}`
    };
  }

  if (
    proposal.status !== "approved"
  ) {
    return {
      ok: false,
      status: "approval_required",
      error:
        `Proposal status is ${proposal.status}; approved status is required`
    };
  }

  const learning =
    proposal.learning;

  if (
    !learning ||
    typeof learning !== "object"
  ) {
    return {
      ok: false,
      status: "invalid_learning_payload",
      error:
        "Approved proposal has no valid learning payload"
    };
  }

  let previousLocal;
  let previousDrive;
  let snapshotId = null;

  try {
    previousLocal =
      clone(readLocalKnowledge());

    const moduleKnowledge =
      clone(getKnowledge());

    if (
      !sameData(
        previousLocal,
        moduleKnowledge
      )
    ) {
      throw new Error(
        "Local knowledge state mismatch before apply"
      );
    }

    previousDrive =
      clone(
        await loadKnowledgeFromDrive()
      );

    if (
      !Array.isArray(previousDrive)
    ) {
      throw new Error(
        "Google Drive knowledge data is not an array"
      );
    }

    if (
      !sameData(
        previousLocal,
        previousDrive
      )
    ) {
      throw new Error(
        "Local knowledge and Google Drive knowledge differ before apply"
      );
    }

    const duplicate =
      findMatchingKnowledge(
        previousLocal,
        learning
      );

    if (duplicate) {
      return {
        ok: false,
        status: "duplicate_learning",
        error:
          "Equivalent learning already exists",
        existingId:
          duplicate.id || null
      };
    }

    const snapshot =
      createVerifiedSnapshot({
        changeId,
        actor
      });

    snapshotId =
      snapshot.snapshotId;

    const sourceUrl =
      Array.isArray(proposal.sources) &&
      proposal.sources.length > 0
        ? proposal.sources[0]?.url ||
          proposal.sources[0]?.link ||
          ""
        : "";

    const saved =
      await addLearning({
        ...clone(learning),
        source:
          learning.source ||
          sourceUrl
      });

    if (!saved) {
      throw new Error(
        "addLearning returned no result"
      );
    }

    const afterLocal =
      clone(readLocalKnowledge());

    if (
      afterLocal.length !==
      previousLocal.length + 1
    ) {
      throw new Error(
        "Knowledge count did not increase by exactly one"
      );
    }

    const appliedEntry =
      findMatchingKnowledge(
        afterLocal,
        learning
      );

    if (!appliedEntry) {
      throw new Error(
        "Applied learning entry was not found locally"
      );
    }

    const afterDrive =
      clone(
        await loadKnowledgeFromDrive()
      );

    if (
      !Array.isArray(afterDrive)
    ) {
      throw new Error(
        "Google Drive knowledge data is not an array after apply"
      );
    }

    if (
      !sameData(
        afterLocal,
        afterDrive
      )
    ) {
      throw new Error(
        "Local knowledge and Google Drive differ after apply"
      );
    }

    const localHash =
      hashData(afterLocal);

    const driveHash =
      hashData(afterDrive);

    if (
      localHash !== driveHash
    ) {
      throw new Error(
        "Local and Drive hashes differ after apply"
      );
    }

    const applied =
      markProposalApplied(
        changeId,
        actor,
        snapshotId
      );

    if (
      !applied ||
      applied.status !== "applied"
    ) {
      throw new Error(
        "Proposal could not be marked applied"
      );
    }

    return {
      ok: true,
      status: "autonomous_learning_applied",
      changeId,
      proposalId: changeId,
      snapshotId,
      actor,
      knowledgeCount:
        afterLocal.length,
      appliedLearningId:
        appliedEntry.id || null,
      localHash,
      driveHash,
      driveSynced: true,
      verified: true
    };
  } catch (error) {
    let rollbackInfo = null;

    if (
      snapshotId &&
      previousDrive
    ) {
      try {
        rollbackInfo =
          await rollback({
            snapshotId,
            previousDrive,
            actor
          });
      } catch (rollbackError) {
        rollbackInfo = {
          ok: false,
          status:
            "rollback_failed",
          error:
            rollbackError.message
        };
      }
    } else if (previousLocal) {
      try {
        writeLocalKnowledge(
          previousLocal
        );

        if (previousDrive) {
          await restoreDriveState(
            previousDrive
          );
        }

        const restoredLocal =
          readLocalKnowledge();

        const restoredDrive =
          await loadKnowledgeFromDrive();

        rollbackInfo = {
          ok:
            sameData(
              restoredLocal,
              restoredDrive
            ),
          status:
            "manual_state_rollback_verified"
        };
      } catch (rollbackError) {
        rollbackInfo = {
          ok: false,
          status:
            "rollback_failed",
          error:
            rollbackError.message
        };
      }
    }

    return {
      ok: false,
      status:
        "autonomous_learning_apply_failed",
      error:
        error.message,
      snapshotId,
      rollback:
        rollbackInfo
    };
  }
}

module.exports = {
  name:
    "autonomous_learning_controlled_apply",
  applyAutonomousLearningControlled,
  hashData
};
