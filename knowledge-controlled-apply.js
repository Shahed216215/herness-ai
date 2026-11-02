"use strict";

const crypto = require("crypto");

const {
  getProposal,
  markProposalApplied
} = require("./knowledge-improvement");

const {
  getKnowledge,
  updateLearning
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

function now() {
  return new Date().toISOString();
}

function hashContent(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex");
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function findExistingKnowledge(proposal, knowledge) {
  if (
    !proposal ||
    !proposal.existing ||
    !Array.isArray(knowledge)
  ) {
    return null;
  }

  return (
    knowledge.find(item =>
      normalize(item.title) ===
        normalize(proposal.existing.title) &&
      normalize(item.topic) ===
        normalize(proposal.existing.topic)
    ) || null
  );
}

function sameData(a, b) {
  try {
    return (
      JSON.stringify(a) ===
      JSON.stringify(b)
    );
  } catch (error) {
    return false;
  }
}

function findEntryByTitleTopic(
  knowledge,
  title,
  topic
) {
  if (!Array.isArray(knowledge)) {
    return null;
  }

  return (
    knowledge.find(item =>
      normalize(item.title) === normalize(title) &&
      normalize(item.topic) === normalize(topic)
    ) || null
  );
}

async function restoreDriveState(previousDriveKnowledge) {
  try {
    if (!Array.isArray(previousDriveKnowledge)) {
      return {
        ok: false,
        status: "drive_previous_state_invalid"
      };
    }

    const result =
      await saveKnowledgeToDrive(
        previousDriveKnowledge
      );

    if (!result || result.success !== true) {
      return {
        ok: false,
        status: "drive_restore_failed",
        result
      };
    }

    const verified =
      await loadKnowledgeFromDrive();

    if (
      !Array.isArray(verified) ||
      !sameData(
        verified,
        previousDriveKnowledge
      )
    ) {
      return {
        ok: false,
        status: "drive_restore_verification_failed"
      };
    }

    return {
      ok: true,
      status: "drive_restored"
    };
  } catch (error) {
    return {
      ok: false,
      status: "drive_restore_failed",
      error: error.message
    };
  }
}

async function rollback(
  changeId,
  snapshotId,
  previousDriveKnowledge,
  actor
) {
  const localRollback =
    restoreSnapshot(
      changeId,
      snapshotId,
      {
        confirm: true,
        restoredBy: actor
      }
    );

  if (!localRollback.ok) {
    return {
      ok: false,
      status: "local_rollback_failed",
      localRollback,
      driveRollback: null
    };
  }

  const driveRollback =
    await restoreDriveState(
      previousDriveKnowledge
    );

  if (!driveRollback.ok) {
    return {
      ok: false,
      status: "drive_rollback_failed",
      localRollback,
      driveRollback
    };
  }

  return {
    ok: true,
    status: "rolled_back",
    localRollback,
    driveRollback
  };
}

async function applyKnowledgeImprovementControlled(
  options = {}
) {
  const {
    changeId,
    actor = "system"
  } = options;

  if (
    typeof changeId !== "string" ||
    !changeId.trim()
  ) {
    return {
      ok: false,
      status: "change_id_required"
    };
  }

  const proposal =
    getProposal(changeId);

  if (!proposal) {
    return {
      ok: false,
      status: "proposal_not_found"
    };
  }

  if (proposal.status !== "approved") {
    return {
      ok: false,
      status: "approval_required",
      currentStatus: proposal.status
    };
  }

  if (
    !proposal.existing ||
    !proposal.proposed
  ) {
    return {
      ok: false,
      status: "proposal_data_invalid"
    };
  }

  /*
   * Preflight:
   * Load both local and Drive state before making
   * any modification. If they differ, stop rather
   * than overwriting an unknown state.
   */
  const localBefore =
    getKnowledge();

  let driveBefore;

  try {
    driveBefore =
      await loadKnowledgeFromDrive();
  } catch (error) {
    return {
      ok: false,
      status: "drive_preflight_failed",
      error: error.message
    };
  }

  if (!Array.isArray(driveBefore)) {
    return {
      ok: false,
      status: "drive_preflight_invalid"
    };
  }

  if (!sameData(localBefore, driveBefore)) {
    return {
      ok: false,
      status: "local_drive_state_mismatch",
      message:
        "Local knowledge and Google Drive knowledge differ. Apply was blocked."
    };
  }

  const existing =
    findExistingKnowledge(
      proposal,
      localBefore
    );

  if (!existing) {
    return {
      ok: false,
      status: "original_knowledge_not_found"
    };
  }

  const currentHash =
    hashContent(existing.content);

  const expectedHash =
    proposal.existing.contentHash || "";

  if (
    !expectedHash ||
    currentHash !== expectedHash
  ) {
    return {
      ok: false,
      status: "stale_proposal",
      message:
        "Knowledge content changed after proposal creation."
    };
  }

  /*
   * Snapshot only the actual local resource that
   * will be modified.
   */
  const snapshot =
    createSnapshot({
      changeId,
      files: ["knowledge.json"],
      createdBy: actor,
      reason:
        `Pre-apply knowledge snapshot for ${changeId}`
    });

  if (!snapshot.ok) {
    return {
      ok: false,
      status: "snapshot_required",
      snapshot
    };
  }

  const snapshotVerification =
    verifySnapshot(
      changeId,
      snapshot.snapshotId
    );

  if (!snapshotVerification.ok) {
    return {
      ok: false,
      status: "snapshot_verification_required",
      snapshot,
      snapshotVerification
    };
  }

  let updateResult;

  try {
    updateResult =
      await updateLearning(
        {
          title:
            proposal.existing.title,
          topic:
            proposal.existing.topic
        },
        proposal.proposed
      );
  } catch (error) {
    const rollbackResult =
      await rollback(
        changeId,
        snapshot.snapshotId,
        driveBefore,
        actor
      );

    return {
      ok: false,
      status:
        rollbackResult.ok
          ? "apply_failed_rolled_back"
          : "apply_failed_rollback_failed",
      error: error.message,
      snapshotId:
        snapshot.snapshotId,
      rollback: rollbackResult
    };
  }

  if (
    !updateResult ||
    updateResult.updated !== true
  ) {
    const rollbackResult =
      await rollback(
        changeId,
        snapshot.snapshotId,
        driveBefore,
        actor
      );

    return {
      ok: false,
      status:
        rollbackResult.ok
          ? "apply_failed_rolled_back"
          : "apply_failed_rollback_failed",
      snapshotId:
        snapshot.snapshotId,
      apply: updateResult,
      rollback: rollbackResult
    };
  }

  /*
   * updateLearning() can report updated=true even
   * when Drive synchronization failed. Treat that
   * as an apply failure.
   */
  if (updateResult.drive !== true) {
    const rollbackResult =
      await rollback(
        changeId,
        snapshot.snapshotId,
        driveBefore,
        actor
      );

    return {
      ok: false,
      status:
        rollbackResult.ok
          ? "drive_sync_failed_rolled_back"
          : "drive_sync_failed_rollback_failed",
      snapshotId:
        snapshot.snapshotId,
      apply: updateResult,
      rollback: rollbackResult
    };
  }

  const localAfter =
    getKnowledge();

  const updatedEntry =
    findEntryByTitleTopic(
      localAfter,
      proposal.proposed.title,
      proposal.proposed.topic
    );

  if (!updatedEntry) {
    const rollbackResult =
      await rollback(
        changeId,
        snapshot.snapshotId,
        driveBefore,
        actor
      );

    return {
      ok: false,
      status:
        rollbackResult.ok
          ? "verification_failed_rolled_back"
          : "verification_failed_rollback_failed",
      snapshotId:
        snapshot.snapshotId,
      rollback: rollbackResult
    };
  }

  if (
    normalize(updatedEntry.content) !==
    normalize(proposal.proposed.content)
  ) {
    const rollbackResult =
      await rollback(
        changeId,
        snapshot.snapshotId,
        driveBefore,
        actor
      );

    return {
      ok: false,
      status:
        rollbackResult.ok
          ? "content_verification_failed_rolled_back"
          : "content_verification_failed_rollback_failed",
      snapshotId:
        snapshot.snapshotId,
      rollback: rollbackResult
    };
  }

  let driveAfter;

  try {
    driveAfter =
      await loadKnowledgeFromDrive();
  } catch (error) {
    const rollbackResult =
      await rollback(
        changeId,
        snapshot.snapshotId,
        driveBefore,
        actor
      );

    return {
      ok: false,
      status:
        rollbackResult.ok
          ? "drive_verification_failed_rolled_back"
          : "drive_verification_failed_rollback_failed",
      snapshotId:
        snapshot.snapshotId,
      error: error.message,
      rollback: rollbackResult
    };
  }

  if (!sameData(localAfter, driveAfter)) {
    const rollbackResult =
      await rollback(
        changeId,
        snapshot.snapshotId,
        driveBefore,
        actor
      );

    return {
      ok: false,
      status:
        rollbackResult.ok
          ? "local_drive_verification_failed_rolled_back"
          : "local_drive_verification_failed_rollback_failed",
      snapshotId:
        snapshot.snapshotId,
      rollback: rollbackResult
    };
  }

  /*
   * Final lifecycle commit:
   * Only after all verification succeeds do we
   * transition the proposal to applied.
   */
  const markResult =
    markProposalApplied(changeId);

  if (!markResult || markResult.success !== true) {
    const rollbackResult =
      await rollback(
        changeId,
        snapshot.snapshotId,
        driveBefore,
        actor
      );

    return {
      ok: false,
      status:
        rollbackResult.ok
          ? "proposal_commit_failed_rolled_back"
          : "proposal_commit_failed_rollback_failed",
      snapshotId:
        snapshot.snapshotId,
      proposalMarkedApplied: false,
      rollback: rollbackResult,
      reason:
        markResult?.reason ||
        "Proposal could not be marked as applied."
    };
  }

  return {
    ok: true,
    status: "apply_test_passed",
    changeId,
    snapshotId:
      snapshot.snapshotId,
    actor,
    appliedAt: now(),
    proposal:
      markResult.proposal,
    apply: updateResult,
    verification: {
      localVerified: true,
      driveVerified: true,
      localDriveMatch: true
    }
  };
}

module.exports = {
  applyKnowledgeImprovementControlled
};
