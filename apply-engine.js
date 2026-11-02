"use strict";

const {
  getProposal
} = require("./change-management");

const {
  createSnapshot,
  verifySnapshot,
  restoreSnapshot
} = require("./snapshot-manager");

const APPROVED_STATUS = "approved";

function now() {
  return new Date().toISOString();
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) {
    return [];
  }

  return [
    ...new Set(
      files
        .filter(file => typeof file === "string")
        .map(file => file.trim())
        .filter(Boolean)
    )
  ];
}

function validateProposal(proposal) {
  if (!proposal) {
    return {
      ok: false,
      status: "proposal_not_found"
    };
  }

  if (proposal.status !== APPROVED_STATUS) {
    return {
      ok: false,
      status: "approval_required",
      currentStatus: proposal.status,
      message:
        "Only approved changes can enter the apply stage."
    };
  }

  const files =
    normalizeFiles(
      proposal.affectedResources
    );

  if (files.length === 0) {
    return {
      ok: false,
      status: "affected_resources_required",
      message:
        "Approved proposal has no valid affected resources."
    };
  }

  return {
    ok: true,
    files
  };
}

function resolveProposal(changeId, proposalOverride) {
  if (
    proposalOverride !== undefined &&
    proposalOverride !== null
  ) {
    if (
      typeof proposalOverride !== "object" ||
      Array.isArray(proposalOverride)
    ) {
      return {
        ok: false,
        status: "invalid_proposal_override",
        message:
          "Proposal override must be a proposal object."
      };
    }

    if (
      proposalOverride.changeId !== changeId
    ) {
      return {
        ok: false,
        status: "proposal_override_change_id_mismatch",
        message:
          "Proposal override changeId must match the requested changeId."
      };
    }

    return {
      ok: true,
      proposal: proposalOverride,
      source: "override"
    };
  }

  const proposal =
    getProposal(changeId);

  return {
    ok: true,
    proposal,
    source: "governance_store"
  };
}

async function executeApply(applyFn, context) {
  if (typeof applyFn !== "function") {
    return {
      ok: false,
      status: "apply_function_required"
    };
  }

  try {
    const result =
      await applyFn(context);

    return {
      ok: true,
      status: "apply_completed",
      result
    };
  } catch (error) {
    return {
      ok: false,
      status: "apply_failed",
      error: error.message
    };
  }
}

async function executeTest(testFn, context) {
  if (typeof testFn !== "function") {
    return {
      ok: true,
      status: "test_not_provided",
      skipped: true
    };
  }

  try {
    const result =
      await testFn(context);

    if (result === false) {
      return {
        ok: false,
        status: "test_failed"
      };
    }

    if (
      result &&
      typeof result === "object" &&
      result.ok === false
    ) {
      return {
        ok: false,
        status: "test_failed",
        result
      };
    }

    return {
      ok: true,
      status: "test_passed",
      result
    };
  } catch (error) {
    return {
      ok: false,
      status: "test_failed",
      error: error.message
    };
  }
}

async function applyApprovedChange(options = {}) {
  const {
    changeId,
    actor = "system",
    applyFn,
    testFn,
    proposalOverride
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

  const proposalResolution =
    resolveProposal(
      changeId,
      proposalOverride
    );

  if (!proposalResolution.ok) {
    return proposalResolution;
  }

  const proposal =
    proposalResolution.proposal;

  const validation =
    validateProposal(proposal);

  if (!validation.ok) {
    return validation;
  }

  const files = validation.files;

  const snapshot =
    createSnapshot({
      changeId,
      files,
      createdBy: actor,
      reason:
        `Pre-apply snapshot for ${changeId}`
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

  const context = {
    changeId,
    proposal,
    snapshotId:
      snapshot.snapshotId,
    files,
    actor,
    startedAt: now()
  };

  const applyResult =
    await executeApply(
      applyFn,
      context
    );

  if (!applyResult.ok) {
    const rollback =
      restoreSnapshot(
        changeId,
        snapshot.snapshotId,
        {
          confirm: true,
          restoredBy: actor
        }
      );

    return {
      ok: false,
      status: "apply_failed_rolled_back",
      changeId,
      snapshotId:
        snapshot.snapshotId,
      apply: applyResult,
      rollback
    };
  }

  const testResult =
    await executeTest(
      testFn,
      context
    );

  if (!testResult.ok) {
    const rollback =
      restoreSnapshot(
        changeId,
        snapshot.snapshotId,
        {
          confirm: true,
          restoredBy: actor
        }
      );

    return {
      ok: false,
      status: "test_failed_rolled_back",
      changeId,
      snapshotId:
        snapshot.snapshotId,
      apply: applyResult,
      test: testResult,
      rollback
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
    apply: applyResult,
    test: testResult
  };
}

function getApplyEngineStatus() {
  return {
    ok: true,
    engine: "operational",
    approvalRequired: true,
    snapshotRequired: true,
    snapshotVerificationRequired: true,
    automaticRollbackOnFailure: true,
    productionModification:
      "approval_required",
    integratedWithProduction:
      false,
    proposalOverrideSupported: true,
    proposalOverrideRequiresMatchingChangeId: true,
    proposalOverrideStillRequiresApproval: true
  };
}

module.exports = {
  applyApprovedChange,
  getApplyEngineStatus
};
