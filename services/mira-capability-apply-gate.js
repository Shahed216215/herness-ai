"use strict";

const fs = require("fs");
const path = require("path");
const storagePath = require('../mira-storage');

const {
  getCapabilityRequest
} = require("../capability-request");

const {
  getArtifact,
  updateArtifactStatus
} = require("../staging-manager");

const {
  getProposal,
  moveToPendingApproval,
  approveProposal
} = require("../change-management");

const {
  prepareApply,
  applyPreparedChange
} = require("../artifact-apply-engine");

const PROJECT_ROOT =
  path.resolve(__dirname, "..");

const APPLY_AUDIT_FILE =
  storagePath("capability-apply-audit.json");

const MAX_AUDIT_ENTRIES = 1000;


function assertRequestId(requestId) {
  if (
    typeof requestId !== "string" ||
    !requestId.trim()
  ) {
    throw new Error(
      "requestId is required."
    );
  }
}


function assertAdminActor(actor) {
  if (
    typeof actor !== "string" ||
    !/^admin(?::|$)/i.test(
      actor.trim()
    )
  ) {
    throw new Error(
      "Controlled apply requires an authorized admin actor."
    );
  }
}


function readAudit() {
  if (
    !fs.existsSync(
      APPLY_AUDIT_FILE
    )
  ) {
    return [];
  }

  try {
    const raw =
      fs.readFileSync(
        APPLY_AUDIT_FILE,
        "utf8"
      );

    const parsed =
      JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed
      : [];
  } catch (error) {
    throw new Error(
      "Capability apply audit could not be loaded."
    );
  }
}


function writeAudit(entries) {
  const limited =
    entries.slice(
      -MAX_AUDIT_ENTRIES
    );

  fs.writeFileSync(
    APPLY_AUDIT_FILE,
    JSON.stringify(
      limited,
      null,
      2
    ) + "\n",
    "utf8"
  );
}


function recordAudit(entry) {
  const entries =
    readAudit();

  entries.push(entry);

  writeAudit(entries);
}


function authorizeCapabilityApply(
  requestId,
  actor = "admin"
) {
  assertRequestId(requestId);
  assertAdminActor(actor);

  const request =
    getCapabilityRequest(
      requestId
    );

  if (!request) {
    throw new Error(
      "Capability request could not be loaded."
    );
  }

  if (
    ![
      "validated",
      "approved_for_controlled_apply"
    ].includes(
      request.status
    )
  ) {
    throw new Error(
      `Capability request must be validated or approved_for_controlled_apply before controlled apply. Current: ${request.status}`
    );
  }

  if (!request.validation) {
    throw new Error(
      "Capability validation record is required."
    );
  }

  if (
    request.validation.status !==
    "validated"
  ) {
    throw new Error(
      "Capability validation must be successful before controlled apply."
    );
  }

  if (!request.approval) {
    throw new Error(
      "Human approval is required before controlled apply."
    );
  }

  if (
    request.approval.status !==
    "approved"
  ) {
    throw new Error(
      "Capability does not have a valid human approval."
    );
  }

  if (
    typeof request.approval.approvedBy !==
    "string" ||
    !/^admin(?::|$)/i.test(
      request.approval.approvedBy
    )
  ) {
    throw new Error(
      "Capability approval was not granted by an authorized admin actor."
    );
  }

  if (
    request.approval.executionAllowed !==
    false
  ) {
    throw new Error(
      "Capability execution boundary is invalid."
    );
  }

  if (
    request.approval.activationAllowed !==
    false
  ) {
    throw new Error(
      "Capability activation boundary is invalid."
    );
  }

  if (!request.proposal) {
    throw new Error(
      "Capability proposal link is missing."
    );
  }

  const changeId =
    request.proposal.changeId;

  if (
    typeof changeId !== "string" ||
    !changeId.trim()
  ) {
    throw new Error(
      "Capability proposal changeId is missing."
    );
  }

  const proposal =
    getProposal(changeId);

  if (!proposal) {
    throw new Error(
      "Linked capability proposal could not be loaded."
    );
  }

  if (
    proposal.status !==
    "proposed" &&
    proposal.status !==
    "pending_approval" &&
    proposal.status !==
    "approved"
  ) {
    throw new Error(
      `Linked capability proposal cannot enter controlled apply from status: ${proposal.status}`
    );
  }

  const artifactResult =
    getArtifact(changeId);

  if (
    !artifactResult ||
    !artifactResult.ok ||
    !artifactResult.manifest
  ) {
    throw new Error(
      "Capability staging artifact could not be loaded."
    );
  }

  const manifest =
    artifactResult.manifest;

  if (
    manifest.status !==
    "ready_for_review"
  ) {
    throw new Error(
      `Capability artifact must be ready_for_review before controlled apply. Current: ${manifest.status}`
    );
  }

  return {
    ok: true,
    status:
      "controlled_apply_authorized",
    requestId,
    changeId,
    actor,
    humanApprovalVerified: true,
    validationVerified: true,
    proposalStatus:
      proposal.status,
    artifactStatus:
      manifest.status,
    executionAllowed: false,
    activationAllowed: false,
    applyAllowed: true
  };
}


function approveLinkedProposal(
  changeId,
  actor
) {
  let proposal =
    getProposal(changeId);

  if (!proposal) {
    throw new Error(
      "Linked capability proposal could not be loaded."
    );
  }

  if (
    proposal.status ===
    "approved"
  ) {
    return proposal;
  }

  if (
    proposal.status !==
    "proposed"
  ) {
    throw new Error(
      `Linked capability proposal cannot move to pending approval from status "${proposal.status}".`
    );
  }

  proposal =
    moveToPendingApproval(
      changeId,
      actor
    );

  if (
    !proposal ||
    proposal.status !==
    "pending_approval"
  ) {
    throw new Error(
      "Linked capability proposal could not enter pending approval."
    );
  }

  proposal =
    approveProposal(
      changeId,
      actor
    );

  if (
    !proposal ||
    proposal.status !==
    "approved"
  ) {
    throw new Error(
      "Linked capability proposal could not be approved for controlled apply."
    );
  }

  return proposal;
}


function applyCapabilityRequest(
  requestId,
  actor = "admin"
) {
  const authorization =
    authorizeCapabilityApply(
      requestId,
      actor
    );

  const {
    changeId
  } = authorization;

  recordAudit({
    requestId,
    changeId,
    actor,
    event:
      "controlled_apply_authorized",
    createdAt:
      new Date().toISOString()
  });

  let proposal;

  try {
    proposal =
      approveLinkedProposal(
        changeId,
        actor
      );

    recordAudit({
      requestId,
      changeId,
      actor,
      event:
        "linked_proposal_approved_for_controlled_apply",
      createdAt:
        new Date().toISOString(),
      proposalStatus:
        proposal.status
    });

  } catch (error) {
    recordAudit({
      requestId,
      changeId,
      actor,
      event:
        "linked_proposal_approval_failed",
      createdAt:
        new Date().toISOString(),
      error:
        error.message
    });

    throw error;
  }

  const statusResult =
    updateArtifactStatus(
      changeId,
      "approved_for_apply"
    );

  if (
    !statusResult ||
    statusResult.ok !== true
  ) {
    throw new Error(
      "Capability artifact could not be moved to approved_for_apply."
    );
  }

  let prepared;

  try {
    prepared =
      prepareApply(
        changeId
      );
  } catch (error) {
    try {
      updateArtifactStatus(
        changeId,
        "failed"
      );
    } catch (statusError) {
      // Best-effort status update.
    }

    recordAudit({
      requestId,
      changeId,
      actor,
      event:
        "controlled_apply_prepare_failed",
      createdAt:
        new Date().toISOString(),
      error:
        error.message
    });

    throw error;
  }

  let applied;

  try {
    applied =
      applyPreparedChange(
        changeId
      );
  } catch (error) {
    try {
      updateArtifactStatus(
        changeId,
        "failed"
      );
    } catch (statusError) {
      // Best-effort status update.
    }

    recordAudit({
      requestId,
      changeId,
      actor,
      event:
        "controlled_apply_failed",
      createdAt:
        new Date().toISOString(),
      error:
        error.message
    });

    throw error;
  }

  recordAudit({
    requestId,
    changeId,
    actor,
    event:
      "controlled_apply_completed",
    createdAt:
      new Date().toISOString(),
    resultStatus:
      applied &&
      applied.status
        ? applied.status
        : "applied"
  });

  return {
    ok: true,
    status:
      "controlled_apply_completed",
    requestId,
    changeId,
    authorization,
    proposal,
    prepared,
    applied,
    executionAllowed: false,
    activationAllowed: false
  };
}


function autonomousApplyAttempt(
  requestId
) {
  assertRequestId(requestId);

  return {
    ok: false,
    status:
      "apply_denied",
    requestId,
    reason:
      "Autonomous controlled apply is not permitted.",
    humanApprovalRequired: true,
    executionAllowed: false,
    activationAllowed: false
  };
}


function getCapabilityApplyAudit() {
  return readAudit();
}


module.exports = {
  authorizeCapabilityApply,
  applyCapabilityRequest,
  autonomousApplyAttempt,
  getCapabilityApplyAudit
};
